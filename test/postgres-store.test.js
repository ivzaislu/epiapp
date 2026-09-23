import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PostgresStore } from '../src/postgres-store.js';
import { DuplicateDoseError } from '../src/store.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL || '';

function tableName() {
  return `epiapp_test_${randomUUID().replaceAll('-', '')}`;
}

async function withStores(count, fn) {
  if (!DATABASE_URL) return;
  const table = tableName();
  const stores = Array.from({ length: count }, () => new PostgresStore(DATABASE_URL, { tableName: table }));
  try {
    await fn(stores);
  } finally {
    try {
      await stores[0].pool.query(`DROP TABLE IF EXISTS "${table}"`);
    } finally {
      await Promise.all(stores.map((store) => store.close()));
    }
  }
}

test('PostgreSQL store persists EpiApp settings and doses', { skip: !DATABASE_URL }, async () => {
  await withStores(2, async ([first, second]) => {
    await first.updateSettings({
      childName: 'Northflank Test',
      timezone: 'Europe/Berlin',
      morningTime: '08:00',
      eveningTime: '20:00',
    });
    await first.takeDose('morning', new Date('2026-09-23T06:05:00.000Z'));

    const state = await second.read();
    assert.equal(state.settings.childName, 'Northflank Test');
    assert.equal(state.doses.length, 1);
    assert.equal(state.doses[0].slot, 'morning');
  });
});

test('PostgreSQL transaction prevents concurrent duplicate dose writes', { skip: !DATABASE_URL }, async () => {
  await withStores(2, async ([left, right]) => {
    const now = new Date('2026-09-23T06:05:00.000Z');
    const results = await Promise.allSettled([
      left.takeDose('morning', now),
      right.takeDose('morning', now),
    ]);

    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = results.find((result) => result.status === 'rejected');
    assert.ok(rejected);
    assert.ok(rejected.reason instanceof DuplicateDoseError);
    assert.equal((await left.read()).doses.length, 1);
  });
});

test('PostgreSQL store keeps only hashes for Android device credentials', { skip: !DATABASE_URL }, async () => {
  await withStores(1, async ([store]) => {
    const invite = await store.createInvite('child', '111111111');
    await store.acceptInvite(invite.token, { id: '222222222', firstName: 'Child' });
    const pairing = await store.createDevicePairCode('222222222', {
      now: new Date('2026-09-23T06:00:00.000Z'),
    });
    const paired = await store.pairDevice(pairing.code, {
      deviceName: 'Northflank Android',
      now: new Date('2026-09-23T06:01:00.000Z'),
    });

    const raw = JSON.stringify(await store.read());
    assert.equal(raw.includes(paired.deviceToken), false);
    assert.match((await store.read()).access.devices[0].tokenHash, /^[a-f0-9]{64}$/);
  });
});

test('JSON import refuses to overwrite existing PostgreSQL state unless forced', { skip: !DATABASE_URL }, async () => {
  await withStores(1, async ([store]) => {
    await store.importState({
      settings: { childName: 'Imported once', timezone: 'Europe/Berlin' },
      doses: [],
      access: {},
    });
    await assert.rejects(
      () => store.importState({ settings: { childName: 'Second import' } }),
      /already contains EpiApp data/,
    );
    await store.importState({ settings: { childName: 'Forced import', timezone: 'Europe/Berlin' } }, { overwrite: true });
    assert.equal((await store.read()).settings.childName, 'Forced import');
  });
});
