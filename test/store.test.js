import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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

test('legacy doses require distinct, existing slots for a custom medication plan', async () => {
  const store = await tempStore();
  await store.updateSettings({
    medications: [
      { id: 'm1234567', name: 'Example', intakes: [{ time: '08:00' }, { time: '12:00' }, { time: '20:00' }] },
    ],
  });
  const doses = [
    { id: randomUUID(), slot: 'morning', localDate: '2025-01-05', takenAt: '2025-01-05T07:00:00.000Z' },
    { id: randomUUID(), slot: 'evening', localDate: '2025-01-05', takenAt: '2025-01-05T19:00:00.000Z' },
  ];
  await assert.rejects(store.importLegacyDoses({ doses }), /Выберите разные приёмы/);
  await assert.rejects(store.importLegacyDoses({
    doses, mapping: { morning: 'm1234567@08:00', evening: 'm1234567@08:00' },
  }), /Выберите разные приёмы/);

  const input = { doses, mapping: { morning: 'm1234567@08:00', evening: 'm1234567@20:00' } };
  const results = await Promise.all([store.importLegacyDoses(input), store.importLegacyDoses(input)]);
  assert.deepEqual(results, [{ imported: 2, skipped: 0 }, { imported: 0, skipped: 2 }]);
  const stats = await store.statistics(1, new Date('2025-01-06T08:00:00.000Z'), '2025-01-05');
  assert.equal(stats.expected, 3);
  assert.equal(stats.taken, 2);
  assert.equal(stats.days[0].slots['m1234567@12:00'].taken, false);
});

test('Android pairing code is single-use and raw device token is never persisted', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'epiapp-device-'));
  const path = join(dir, 'state.json');
  const store = new Store(path);
  const now = new Date('2026-09-07T20:00:00.000Z');
  const pairing = await store.createDevicePairCode('222222222', { now });
  assert.match(pairing.code, /^\d{6}$/);

  const paired = await store.pairDevice(pairing.code, { deviceName: 'Test Android', now: new Date('2026-09-07T20:01:00.000Z') });
  assert.ok(paired.deviceToken.length >= 32);
  assert.equal(paired.device.telegramId, '222222222');
  assert.equal((await store.authenticateDevice(paired.deviceToken)).deviceName, 'Test Android');

  await assert.rejects(
    () => store.pairDevice(pairing.code, { deviceName: 'Second Android', now: new Date('2026-09-07T20:02:00.000Z') }),
    /недействителен|использован/,
  );

  const raw = await readFile(path, 'utf8');
  assert.equal(raw.includes(paired.deviceToken), false);
  const saved = JSON.parse(raw);
  assert.match(saved.access.devices[0].tokenHash, /^[a-f0-9]{64}$/);
  assert.match(saved.access.deviceCodes[0].codeHash, /^[a-f0-9]{64}$/);
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

test('parent can set several medications and one to three intakes', async () => {
  const store = await tempStore();
  const saved = await store.updateSettings({
    childName: 'Маша',
    timezone: 'Europe/Berlin',
    medications: [
      {
        id: 'mabcdef1',
        name: 'Утро',
        intakes: [{ time: '08:00', dose: '1 таблетка' }],
      },
      {
        id: 'mabcdef2',
        name: 'Вечер',
        intakes: [
          { time: '14:00', dose: '5 мл' },
          { time: '20:00', dose: '5 мл' },
          { time: '22:00', dose: '5 мл' },
        ],
      },
    ],
  });
  assert.equal(saved.medications.length, 2);
  assert.equal(saved.medications[1].intakes.length, 3);
  const now = new Date('2026-09-07T12:30:00.000Z');
  const state = await store.childState(now);
  assert.equal(state.settings.plan.length, 4);
  await store.takeDose(state.settings.plan[0].slot, now);
  await assert.rejects(() => store.takeDose('morning', now), DuplicateDoseError);
  const stats = await store.statistics(1, now);
  assert.equal(stats.expected, 2);
  assert.equal(stats.taken, 1);
});

test('dateKey respects configured timezone', () => {
  const instant = new Date('2026-09-07T22:30:00.000Z');
  assert.equal(dateKey(instant, 'Europe/Berlin'), '2026-09-08');
  assert.equal(dateKey(instant, 'America/New_York'), '2026-09-07');
});
