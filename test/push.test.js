import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPublicKey, createVerify } from 'node:crypto';
import { Store } from '../src/store.js';
import { runPushCheck } from '../src/push.js';
import { createWebPushSender, validateSubscription } from '../src/webpush.js';
import { pushFixture } from '../test-support/subscription.mjs';
import webpush from 'web-push';
import httpEce from 'http_ece';

const now = new Date('2026-11-12T08:05:00.000Z');
const before = new Date('2026-11-12T07:50:00.000Z');
const logger = { error() {} };
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'epiapp-push-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new Store(join(dir, 'state.json'));
  await store.updateSettings({ remindersEnabled: false, childName: 'Fixture' });
  const devices = [];
  const { publicKey } = await store.ensureWebPushKeys();
  for (const [id, role] of [['100', 'admin'], ['200', 'parent'], ['300', 'child']]) {
    if (role !== 'admin') {
      const invite = await store.createInvite(role, '100');
      await store.acceptInvite(invite.token, { id });
    }
    const pair = await store.createDevicePairCode(id);
    const device = await store.pairDevice(pair.code);
    await store.registerDevicePush(device.device.id, { enabled: true, subscription: pushFixture(id).subscription, revision: 1, now: before, vapidPublicKey: publicKey, origin: 'https://family.example' });
    devices.push(device);
  }
  await store.takeDose('morning', new Date('2026-11-12T08:00:00.000Z'));
  return { store, devices };
}
const options = (store, send) => ({ store, adminId: '100', origin: 'https://family.example', send, now, logger });

test('Web Push targets each parent device, excludes children, and deduplicates concurrent checks', async (t) => {
  const { store, devices } = await fixture(t);
  const calls = [];
  const send = async (message) => { calls.push(message); };
  await Promise.all([runPushCheck(options(store, send)), runPushCheck(options(store, send))]);
  assert.equal(calls.length, 2);
  assert.deepEqual(new Set(calls.map(item => item.subscription.endpoint)), new Set(['100', '200'].map(id => `https://fcm.googleapis.com/fcm/send/fixture_endpoint_${id}_1234567890`)));
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

test('temporary Web Push errors retry; permanent unregistered tokens are removed', async (t) => {
  const { store, devices } = await fixture(t);
  await store.registerDevicePush(devices[1].device.id, { enabled: false, revision: 2 });
  assert.equal((await runPushCheck(options(store, async () => { throw new Error('offline'); }))).failed, 1);
  assert.equal((await runPushCheck(options(store, async () => {}))).sent, 1);
  // A new dose produces a new event; invalid tokens must not keep retrying.
  await store.takeDose('evening', new Date('2026-11-12T08:01:00.000Z'));
  const invalid = new Error('invalid'); invalid.invalidSubscription = true;
  assert.equal((await runPushCheck(options(store, async () => { throw invalid; }))).failed, 1);
  const device = (await store.read()).access.devices.find(item => item.id === devices[0].device.id);
  assert.equal(device.push.token, ''); assert.equal(device.push.enabled, false);
});

test('push opt-out, access revocation, and stale registration revisions are enforced', async (t) => {
  const { store, devices } = await fixture(t);
  const id = devices[0].device.id;
  await store.registerDevicePush(id, { enabled: false, revision: 5 });
  assert.equal(await store.registerDevicePush(id, { enabled: true, subscription: pushFixture('100').subscription, revision: 4, vapidPublicKey: (await store.ensureWebPushKeys()).publicKey, origin: 'https://family.example' }), false);
  await store.revokeAccessUser('200');
  assert.equal((await runPushCheck(options(store, async () => assert.fail('must not send')))).sent, 0);
  await store.registerDevicePush(id, { enabled: true, subscription: pushFixture('100').subscription, revision: 6, now, vapidPublicKey: (await store.ensureWebPushKeys()).publicKey, origin: 'https://family.example' });
  assert.equal((await runPushCheck(options(store, async () => assert.fail('disabled-period history must not be replayed')))).sent, 0);
});

test('same installation token moves between accounts and expired leases can be retried', async (t) => {
  const { store, devices } = await fixture(t);
  const subscription = pushFixture('shared').subscription;
  const token = subscription.endpoint;
  const registration = { subscription, enabled: true, revision: 2, vapidPublicKey: (await store.ensureWebPushKeys()).publicKey, origin: 'https://family.example' };
  await store.registerDevicePush(devices[0].device.id, registration);
  await store.registerDevicePush(devices[1].device.id, registration);
  const first = (await store.read()).access.devices.find(item => item.id === devices[0].device.id);
  assert.equal(first.push.enabled, false);
  const id = devices[1].device.id;
  assert.equal(await store.claimDevicePush(id, token, 'event', { now }), true);
  assert.equal(await store.claimDevicePush(id, token, 'event', { now }), false);
  assert.equal(await store.claimDevicePush(id, token, 'event', { now: new Date(now.getTime() + 61000) }), true);
});

test('Web Push encrypts payloads and signs VAPID without a Firebase service account', async (t) => {
  const { store } = await fixture(t);
  const { subscription, privateKey } = pushFixture('encryption');
  const payload = { type: 'taken', body: 'Private fixture confirmation' };
  let details;
  const send = createWebPushSender({ store, subject: 'https://family.example', sendNotification: async (sub, message, options) => {
    details = webpush.generateRequestDetails(sub, message, options);
  } });
  await send({ subscription, data: payload });
  assert.equal(details.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(details.headers.TTL, 86400);
  assert.equal(details.headers.Urgency, 'high');
  assert.ok(details.headers.Authorization.startsWith('vapid t='));
  assert.equal(details.body.includes(Buffer.from(payload.body)), false);
  const decrypted = httpEce.decrypt(details.body, { version: 'aes128gcm', privateKey, authSecret: subscription.keys.auth });
  assert.deepEqual(JSON.parse(decrypted.toString()), payload);
  const jwt = details.headers.Authorization.match(/vapid t=([^,]+)/)[1].split('.');
  const publicBytes = Buffer.from((await store.ensureWebPushKeys()).publicKey, 'base64url');
  const publicKey = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: publicBytes.subarray(1, 33).toString('base64url'), y: publicBytes.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(createVerify('SHA256').update(jwt.slice(0, 2).join('.')).verify({ key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(jwt[2], 'base64url')));
  assert.equal(JSON.parse(Buffer.from(jwt[1], 'base64url')).aud, 'https://fcm.googleapis.com');
  await send({ subscription, data: { type: 'reminder' } });
  assert.equal(details.headers.TTL, 300);
});

test('VAPID keys persist, are generated atomically, and differ for independent backends', async (t) => {
  const { store } = await fixture(t);
  const keys = await Promise.all([store.ensureWebPushKeys(), store.ensureWebPushKeys()]);
  assert.deepEqual(keys[0], keys[1]);
  const reopened = new Store(store.filePath);
  // A second reader of the same persisted state must use the same sender identity.
  assert.deepEqual((await reopened.read()).webPushKeys, keys[0]);
  assert.equal(keys[0].publicKey.length, 87);
  const independent = new Store(store.filePath + '.independent');
  assert.notEqual((await independent.ensureWebPushKeys()).publicKey, keys[0].publicKey);
});

test('subscription validation rejects SSRF URLs, malformed keys, and changed VAPID registration', async (t) => {
  const { store, devices } = await fixture(t);
  const valid = pushFixture('validation').subscription;
  for (const endpoint of ['http://fcm.googleapis.com/fcm/send/fixture_endpoint_1234567890', 'https://127.0.0.1/fcm/send/fixture_endpoint_1234567890', 'https://fcm.googleapis.com.evil.example/fcm/send/fixture_endpoint_1234567890', 'https://fcm.googleapis.com@evil.example/fcm/send/fixture_endpoint_1234567890', valid.endpoint + '?redirect=1']) {
    assert.throws(() => validateSubscription({ ...valid, endpoint }));
  }
  assert.throws(() => validateSubscription({ ...valid, keys: { ...valid.keys, auth: 'bad' } }));
  await assert.rejects(store.registerDevicePush(devices[0].device.id, { enabled: true, subscription: valid, revision: 3, vapidPublicKey: 'wrong', origin: 'https://family.example' }), /VAPID/);
});

test('delayed background-delivery test is independent of the dose feed and does not change statistics', async (t) => {
  const { store, devices } = await fixture(t);
  // Clear pre-existing events by delivering them before queueing the diagnostic test.
  await runPushCheck(options(store, async () => {}));
  const beforeState = await store.read();
  const queuedAt = new Date('2026-11-12T08:05:00.000Z');
  const queued = await store.queueDevicePushTest(devices[0].device.id, { now: queuedAt });
  assert.equal(queued.dueAt, '2026-11-12T08:05:30.000Z');
  assert.equal((await runPushCheck(options(store, async () => assert.fail('too early')))).sent, 0);
  const sent = [];
  const later = { ...options(store, async (message) => { sent.push(message); }), now: new Date(queued.dueAt) };
  assert.equal((await runPushCheck(later)).sent, 1);
  assert.ok(sent[0].data.id.startsWith('test:'));
  assert.equal((await runPushCheck(later)).sent, 0);
  assert.deepEqual((await store.read()).doses, beforeState.doses);
});
