import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { Store } from '../src/store.js';
import { createFcmSender, runPushCheck } from '../src/push.js';

const now = new Date('2026-11-12T08:05:00.000Z');
const before = new Date('2026-11-12T07:50:00.000Z');
const logger = { error() {} };
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'epiapp-push-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new Store(join(dir, 'state.json'));
  await store.updateSettings({ remindersEnabled: false, childName: 'Fixture' });
  const devices = [];
  for (const [id, role] of [['100', 'admin'], ['200', 'parent'], ['300', 'child']]) {
    if (role !== 'admin') {
      const invite = await store.createInvite(role, '100');
      await store.acceptInvite(invite.token, { id });
    }
    const pair = await store.createDevicePairCode(id);
    const device = await store.pairDevice(pair.code);
    await store.registerDevicePush(device.device.id, { enabled: true, token: `fixture_push_token_${id}`, revision: 1, now: before });
    devices.push(device);
  }
  await store.takeDose('morning', new Date('2026-11-12T08:00:00.000Z'));
  return { store, devices };
}
const options = (store, send) => ({ store, adminId: '100', origin: 'https://family.example', send, now, logger });

test('FCM targets each parent device, excludes children, and deduplicates concurrent checks', async (t) => {
  const { store, devices } = await fixture(t);
  const calls = [];
  const send = async (message) => { calls.push(message); };
  await Promise.all([runPushCheck(options(store, send)), runPushCheck(options(store, send))]);
  assert.equal(calls.length, 2);
  assert.deepEqual(new Set(calls.map(item => item.token)), new Set(['fixture_push_token_100', 'fixture_push_token_200']));
  assert.ok(calls.every(item => item.data.type === 'taken' && item.data.origin === 'https://family.example' && item.data.revision === '1'));
  assert.doesNotMatch(JSON.stringify(calls.map(item => item.data)), /1000|мг|доза/i);
  assert.ok(calls[0].data.resolvesTag.startsWith('reminder:'));
  assert.equal((await runPushCheck(options(store, send))).sent, 0);
  assert.equal(calls.length, 2);
  const publicData = JSON.stringify(await store.listDevices());
  assert.doesNotMatch(publicData, /fixture_push_token|push|deliveries|tokenHash/);
  await store.revokeDevice(devices[0].device.id);
  assert.equal((await runPushCheck(options(store, send))).sent, 0);
});

test('temporary FCM errors retry; permanent unregistered tokens are removed', async (t) => {
  const { store, devices } = await fixture(t);
  await store.registerDevicePush(devices[1].device.id, { enabled: false, revision: 2 });
  assert.equal((await runPushCheck(options(store, async () => { throw new Error('offline'); }))).failed, 1);
  assert.equal((await runPushCheck(options(store, async () => {}))).sent, 1);
  // A new dose produces a new event; invalid tokens must not keep retrying.
  await store.takeDose('evening', new Date('2026-11-12T08:01:00.000Z'));
  const invalid = new Error('invalid'); invalid.invalidToken = true;
  assert.equal((await runPushCheck(options(store, async () => { throw invalid; }))).failed, 1);
  const device = (await store.read()).access.devices.find(item => item.id === devices[0].device.id);
  assert.equal(device.push.token, ''); assert.equal(device.push.enabled, false);
});

test('push opt-out, access revocation, and stale registration revisions are enforced', async (t) => {
  const { store, devices } = await fixture(t);
  const id = devices[0].device.id;
  await store.registerDevicePush(id, { enabled: false, revision: 5 });
  assert.equal(await store.registerDevicePush(id, { enabled: true, token: 'fixture_push_token_100', revision: 4 }), false);
  await store.revokeAccessUser('200');
  assert.equal((await runPushCheck(options(store, async () => assert.fail('must not send')))).sent, 0);
  await store.registerDevicePush(id, { enabled: true, token: 'fixture_push_token_100', revision: 6, now });
  assert.equal((await runPushCheck(options(store, async () => assert.fail('disabled-period history must not be replayed')))).sent, 0);
});

test('same installation token moves between accounts and expired leases can be retried', async (t) => {
  const { store, devices } = await fixture(t);
  const token = 'fixture_shared_push_token';
  await store.registerDevicePush(devices[0].device.id, { token, enabled: true, revision: 2 });
  await store.registerDevicePush(devices[1].device.id, { token, enabled: true, revision: 2 });
  const first = (await store.read()).access.devices.find(item => item.id === devices[0].device.id);
  assert.equal(first.push.enabled, false);
  const id = devices[1].device.id;
  assert.equal(await store.claimDevicePush(id, token, 'event', { now }), true);
  assert.equal(await store.claimDevicePush(id, token, 'event', { now }), false);
  assert.equal(await store.claimDevicePush(id, token, 'event', { now: new Date(now.getTime() + 61000) }), true);
});

test('FCM sender signs OAuth assertions, caches credentials, uses high-priority data and bounded TTLs', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = privateKey.export({ type: 'pkcs8', format: 'pem' });
  let oauth = 0;
  const requests = [];
  const send = createFcmSender({ project_id: 'test-project', client_email: 'sender@test-project.iam.gserviceaccount.com', private_key: key }, {
    request: async (url, init) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        oauth++;
        const jwt = init.body.get('assertion').split('.');
        assert.ok(createVerify('RSA-SHA256').update(jwt.slice(0, 2).join('.')).verify(publicKey, Buffer.from(jwt[2], 'base64url')));
        const claims = JSON.parse(Buffer.from(jwt[1], 'base64url'));
        assert.equal(claims.scope, 'https://www.googleapis.com/auth/firebase.messaging');
        assert.equal(claims.exp - claims.iat, 3600);
        return Response.json({ access_token: 'oauth-fixture', expires_in: 3600 });
      }
      assert.equal(url, 'https://fcm.googleapis.com/v1/projects/test-project/messages:send');
      assert.equal(init.headers.authorization, 'Bearer oauth-fixture');
      requests.push(JSON.parse(init.body).message);
      return Response.json({ name: 'fixture' });
    },
  });
  await send({ token: 'fixture', data: { type: 'taken' } });
  await send({ token: 'fixture', data: { type: 'reminder' } });
  assert.equal(oauth, 1);
  assert.equal(requests[0].android.priority, 'HIGH');
  assert.equal(requests[0].android.ttl, '86400s');
  assert.equal(requests[1].android.ttl, '300s');
  assert.equal(requests[0].notification, undefined);
  assert.equal(createFcmSender(''), null);
  assert.throws(() => createFcmSender('not-json'));
});
