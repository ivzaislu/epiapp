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
  assert.deepEqual(state.todayDoses, {});
  assert.equal('telegramChatIds' in state.settings, false);
});

test('dose is recorded once per slot per local calendar day', async () => {
  const store = await tempStore();
  await store.updateSettings({ childName: 'Аня', timezone: 'Europe/Berlin' });
  const now = new Date('2026-09-07T06:04:00.000Z');
  const first = await store.takeDose('morning', now);
  assert.equal(first.dose.localDate, '2026-09-07');
  await assert.rejects(() => store.takeDose('morning', new Date('2026-09-07T07:00:00.000Z')), DuplicateDoseError);
  const evening = await store.takeDose('evening', new Date('2026-09-07T18:02:00.000Z'));
  assert.equal(evening.dose.slot, 'evening');
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
