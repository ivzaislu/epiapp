import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, DuplicateDoseError, dateKey } from '../src/store.js';

async function tempStore() {
  const dir = await mkdtemp(join(tmpdir(), 'epiapp-'));
  return new Store(join(dir, 'state.json'));
}

test('new store exposes two empty daily slots and safe public settings', async () => {
  const store = await tempStore();
  const now = new Date('2026-09-07T06:00:00.000Z');
  const state = await store.childState(now);
  assert.equal(state.settings.morningTime, '08:00');
  assert.equal(state.settings.medicationName, '');
  assert.deepEqual(state.todayDoses, {});
  assert.equal('telegramChatIds' in state.settings, false);
});

test('parents can save medication and settings changes are audited', async () => {
  const store = await tempStore();
  const actor = { telegramId: '333333333', role: 'parent' };
  const saved = await store.updateSettings({
    childName: 'Аня',
    medicationName: 'Препарат X',
    morningDose: '1 таблетка',
    eveningDose: '1/2 таблетки',
    timezone: 'Europe/Berlin',
  }, actor, new Date('2026-09-05T10:00:00.000Z'));
  assert.equal(saved.medicationName, 'Препарат X');
  assert.equal(saved.eveningDose, '1/2 таблетки');
  const changes = await store.recentSettingsChanges();
  assert.equal(changes.length, 1);
  assert.equal(changes[0].actorTelegramId, '333333333');
  assert.ok(changes[0].changedFields.includes('medicationName'));
});

test('dose is recorded once per slot per local calendar day', async () => {
  const store = await tempStore();
  await store.updateSettings({ childName: 'Аня', timezone: 'Europe/Berlin' });
  const now = new Date('2026-09-07T06:04:00.000Z');
  const first = await store.takeDose('morning', now, { telegramId: '222222222', role: 'child' });
  assert.equal(first.dose.localDate, '2026-09-07');
  assert.equal(first.dose.takenByTelegramId, '222222222');
  await assert.rejects(() => store.takeDose('morning', new Date('2026-09-07T07:00:00.000Z')), DuplicateDoseError);
  const evening = await store.takeDose('evening', new Date('2026-09-07T18:02:00.000Z'));
  assert.equal(evening.dose.slot, 'evening');
});

test('statistics count elapsed scheduled slots and expose parent summary', async () => {
  const store = await tempStore();
  await store.updateSettings({
    childName: 'Аня',
    morningTime: '08:00',
    eveningTime: '20:00',
    timezone: 'Europe/Berlin',
  }, { telegramId: '333333333', role: 'parent' }, new Date('2026-09-05T05:00:00.000Z'));

  await store.takeDose('morning', new Date('2026-09-05T06:05:00.000Z'));
  await store.takeDose('evening', new Date('2026-09-05T18:05:00.000Z'));
  await store.takeDose('morning', new Date('2026-09-06T06:05:00.000Z'));
  await store.takeDose('morning', new Date('2026-09-07T06:05:00.000Z'));
  await store.takeDose('evening', new Date('2026-09-07T18:05:00.000Z'));

  const stats = await store.statistics(7, new Date('2026-09-07T19:00:00.000Z'));
  assert.equal(stats.expected, 6);
  assert.equal(stats.taken, 5);
  assert.equal(stats.missed, 1);
  assert.equal(stats.rate, 83);
  assert.equal(stats.bySlot.morning.taken, 3);
  assert.equal(stats.bySlot.evening.taken, 2);
  assert.equal(stats.currentStreak, 1);
});

test('dose storage is persisted as valid JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'epiapp-'));
  const path = join(dir, 'state.json');
  const store = new Store(path);
  await store.takeDose('morning', new Date('2026-09-07T06:00:00.000Z'));
  const raw = await readFile(path, 'utf8');
  const saved = JSON.parse(raw);
  assert.equal(saved.doses.length, 1);
  assert.equal(saved.doses[0].slot, 'morning');
});

test('dateKey respects configured timezone', () => {
  const instant = new Date('2026-09-07T22:30:00.000Z');
  assert.equal(dateKey(instant, 'Europe/Berlin'), '2026-09-08');
  assert.equal(dateKey(instant, 'America/New_York'), '2026-09-07');
});
