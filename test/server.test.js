import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createServer, resolvePublicAppUrl } from '../server.js';
import { Store } from '../src/store.js';

const BOT_TOKEN = '123456:SERVER_TEST_TOKEN';
const ADMIN_ID = '111111111';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function tempStore() {
  const dir = await mkdtemp(join(tmpdir(), 'epiapp-server-'));
  return new Store(join(dir, 'state.json'));
}

function signedInitData(userId) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: `query-${userId}`,
    user: JSON.stringify({ id: Number(userId), first_name: 'Test' }),
  });
  const check = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

async function authenticate(baseUrl, userId) {
  const response = await fetch(`${baseUrl}/api/auth/telegram`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initData: signedInitData(userId) }),
  });
  const data = await response.json();
  assert.equal(response.status, 200, data.error);
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie);
  return setCookie.split(';')[0];
}

test('HEAD / returns the static page headers without a body', async () => {
  const server = createServer();
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, { method: 'HEAD' });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /^text\/html/);
    assert.ok(Number(response.headers.get('content-length')) > 0);
    assert.equal(await response.text(), '');
  } finally {
    await close(server);
  }
});

test('private API rejects requests without Telegram session', async () => {
  const store = await tempStore();
  const server = createServer({ store, botToken: BOT_TOKEN, adminId: ADMIN_ID });
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/state`);
    assert.equal(response.status, 401);
  } finally {
    await close(server);
  }
});

test('admin can authenticate but cannot record a child dose', async () => {
  const store = await tempStore();
  const server = createServer({ store, botToken: BOT_TOKEN, adminId: ADMIN_ID });
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const cookie = await authenticate(baseUrl, ADMIN_ID);
    const state = await fetch(`${baseUrl}/api/state`, { headers: { cookie } });
    assert.equal(state.status, 200);

    const take = await fetch(`${baseUrl}/api/take`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ slot: 'morning' }),
    });
    assert.equal(take.status, 403);
  } finally {
    await close(server);
  }
});

test('invited child authenticates but cannot open parent settings', async () => {
  const store = await tempStore();
  const invite = await store.createInvite('child', ADMIN_ID);
  await store.acceptInvite(invite.token, { id: '222222222', firstName: 'Child' });
  await store.updateSettings({ remindersEnabled: false, reminderFirstMinutes: 20 });
  const server = createServer({ store, botToken: BOT_TOKEN, adminId: ADMIN_ID });
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const cookie = await authenticate(baseUrl, '222222222');
    const response = await fetch(`${baseUrl}/api/parent/settings`, { headers: { cookie } });
    assert.equal(response.status, 403);
    const state = await fetch(`${baseUrl}/api/state`, { headers: { cookie } });
    const { settings } = await state.json();
    assert.equal(settings.remindersEnabled, false);
    assert.equal(settings.reminderFirstMinutes, 20);
  } finally {
    await close(server);
  }
});

test('only the admin can merge a legacy backup and its marks appear in an older period', async () => {
  const store = await tempStore();
  const invite = await store.createInvite('parent', ADMIN_ID);
  await store.acceptInvite(invite.token, { id: '333333333', firstName: 'Parent' });
  const existing = await store.takeDose('morning', new Date('2025-01-05T07:00:00.000Z'));
  const before = await store.read();
  const server = createServer({ store, botToken: BOT_TOKEN, adminId: ADMIN_ID });
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  const doses = [
    { id: randomUUID(), slot: 'morning', localDate: '2025-01-05', takenAt: '2025-01-05T07:05:00.000Z' },
    { id: randomUUID(), slot: 'evening', localDate: '2025-01-05', takenAt: '2025-01-05T19:00:00.000Z' },
  ];

  try {
    const admin = await authenticate(baseUrl, ADMIN_ID);
    const parent = await authenticate(baseUrl, '333333333');
    const upload = (cookie, data = doses) => fetch(`${baseUrl}/api/parent/stats/import`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ doses: data, settings: { childName: 'Old name' }, access: { users: [] } }),
    });
    assert.equal((await upload(parent)).status, 403);
    assert.equal((await upload(admin, [doses[0], { ...doses[1], localDate: '2025-02-30' }])).status, 400);
    assert.deepEqual(await store.read(), before);

    const result = await upload(admin);
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { imported: 1, skipped: 1 });
    assert.deepEqual(await (await upload(admin)).json(), { imported: 0, skipped: 2 });
    const after = await store.read();
    assert.deepEqual(after.settings, before.settings);
    assert.deepEqual(after.access, before.access);
    assert.deepEqual(after.doses[0], existing.dose);

    const response = await fetch(`${baseUrl}/api/parent/stats?days=30&through=2025-01-05`, { headers: { cookie: parent } });
    assert.equal(response.status, 200);
    const { stats } = await response.json();
    assert.equal(stats.periodEnd, '2025-01-05');
    assert.equal(stats.taken, 2);
    assert.equal(stats.days.at(-1).slots.evening.takenAt, doses[1].takenAt);
  } finally {
    await close(server);
  }
});

test('notification feed is available to parent sessions and parent devices only', async () => {
  const store = await tempStore();
  for (const [role, id] of [['parent', '333333333'], ['child', '222222222']]) {
    const invite = await store.createInvite(role, ADMIN_ID);
    await store.acceptInvite(invite.token, { id, firstName: 'Fixture' });
  }
  await store.takeDose('morning');
  const server = createServer({ store, botToken: BOT_TOKEN, adminId: ADMIN_ID });
  const port = await listen(server);
  const origin = `http://127.0.0.1:${port}`;
  try {
    const endpoint = origin + '/api/parent/notifications';
    assert.equal((await fetch(endpoint)).status, 401);
    const child = await authenticate(origin, '222222222');
    assert.equal((await fetch(endpoint, { headers: { cookie: child } })).status, 403);
    const parent = await authenticate(origin, '333333333');
    const feed = await (await fetch(endpoint, { headers: { cookie: parent } })).json();
    assert.equal(feed.notifications.filter((item) => item.type === 'taken').length, 1);
    assert.equal((await fetch(endpoint + '?since=invalid', { headers: { cookie: parent } })).status, 400);
    const code = await store.createDevicePairCode('333333333');
    const device = await store.pairDevice(code.code, { deviceName: 'Parent fixture' });
    const headers = { authorization: `Bearer ${device.deviceToken}` };
    assert.equal((await fetch(endpoint, { headers })).status, 200);
    await store.revokeAccessUser('333333333');
    assert.equal((await fetch(endpoint, { headers })).status, 401);
  } finally {
    await close(server);
  }
});

test('invited parent can manage medication settings and read statistics', async () => {
  const store = await tempStore();
  const invite = await store.createInvite('parent', ADMIN_ID);
  await store.acceptInvite(invite.token, { id: '333333333', firstName: 'Parent' });
  const server = createServer({ store, botToken: BOT_TOKEN, adminId: ADMIN_ID });
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const cookie = await authenticate(baseUrl, '333333333');
    const read = await fetch(`${baseUrl}/api/parent/settings`, { headers: { cookie } });
    assert.equal(read.status, 200);
    const available = (await read.json()).timezones;
    assert.ok(available.includes('Europe/Berlin'));
    assert.ok(available.includes('UTC'));
    assert.ok(available.length > 300);
    for (const zone of available) assert.doesNotThrow(() => new Intl.DateTimeFormat('ru', { timeZone: zone }));

    const update = await fetch(`${baseUrl}/api/parent/settings`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        childName: 'Аня',
        medicationName: 'Препарат X',
        morningDose: '1 таблетка',
        eveningDose: '1/2 таблетки',
        morningTime: '08:00',
        eveningTime: '20:00',
        timezone: 'Europe/Berlin',
      }),
    });
    assert.equal(update.status, 200);
    const updated = await update.json();
    assert.equal(updated.settings.medicationName, 'Препарат X');
    assert.equal(updated.settings.eveningDose, '1/2 таблетки');
    assert.equal(updated.recentChanges[0].actorTelegramId, '333333333');

    const stats = await fetch(`${baseUrl}/api/parent/stats?days=30`, { headers: { cookie } });
    assert.equal(stats.status, 200);
    const statsData = await stats.json();
    assert.equal(statsData.stats.requestedDays, 30);

    const pairing = await store.createDevicePairCode('333333333');
    const pair = await fetch(`${baseUrl}/api/device/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: pairing.code, deviceName: 'Native Parent' }),
    });
    assert.equal(pair.status, 201);
    const pairData = await pair.json();

    const nativeSettings = await fetch(`${baseUrl}/api/parent/settings`, {
      headers: { authorization: `Bearer ${pairData.deviceToken}` },
    });
    assert.equal(nativeSettings.status, 200);
    assert.equal((await nativeSettings.json()).settings.medicationName, 'Препарат X');

    const nativeStats = await fetch(`${baseUrl}/api/parent/stats?days=7`, {
      headers: { authorization: `Bearer ${pairData.deviceToken}` },
    });
    assert.equal(nativeStats.status, 200);

    // The parent may view the same child state, but may never mark a dose for the child.
    const childPreview = await fetch(`${baseUrl}/api/device/schedule`, {
      headers: { authorization: `Bearer ${pairData.deviceToken}` },
    });
    assert.equal(childPreview.status, 200);
    assert.equal((await childPreview.json()).user.role, 'parent');

    const forbiddenTake = await fetch(`${baseUrl}/api/device/take`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${pairData.deviceToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ slot: 'morning' }),
    });
    assert.equal(forbiddenTake.status, 403);
    assert.equal(Object.hasOwn((await store.childState()).todayDoses, 'morning'), false);
  } finally {
    await close(server);
  }
});

test('Android APK pairs once, creates a secure web session and loses access after revoke', async () => {
  const store = await tempStore();
  const invite = await store.createInvite('child', ADMIN_ID);
  await store.acceptInvite(invite.token, { id: '444444444', firstName: 'Android Child' });
  const pairing = await store.createDevicePairCode('444444444');

  const server = createServer({ store, botToken: BOT_TOKEN, adminId: ADMIN_ID });
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const pair = await fetch(`${baseUrl}/api/device/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: pairing.code, deviceName: 'Pixel Test' }),
    });
    assert.equal(pair.status, 201);
    const pairData = await pair.json();
    assert.equal(pairData.user.role, 'child');
    assert.ok(pairData.deviceToken.length >= 32);
    assert.match(pair.headers.get('set-cookie') || '', /HttpOnly/i);
    assert.match(pair.headers.get('set-cookie') || '', /Secure/i);

    const replay = await fetch(`${baseUrl}/api/device/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: pairing.code, deviceName: 'Replay' }),
    });
    assert.equal(replay.status, 401);

    const nativeState = await fetch(`${baseUrl}/api/device/schedule`, {
      headers: { authorization: `Bearer ${pairData.deviceToken}` },
    });
    assert.equal(nativeState.status, 200);
    const nativeData = await nativeState.json();
    assert.equal(nativeData.user.role, 'child');

    const nativeTake = await fetch(`${baseUrl}/api/device/take`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${pairData.deviceToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ slot: 'morning' }),
    });
    assert.equal(nativeTake.status, 201);
    const afterTake = await fetch(`${baseUrl}/api/device/schedule`, {
      headers: { authorization: `Bearer ${pairData.deviceToken}` },
    });
    assert.equal(afterTake.status, 200);
    assert.ok((await afterTake.json()).todayDoses.morning);

    const nativeHistory = await fetch(`${baseUrl}/api/state`, {
      headers: { authorization: `Bearer ${pairData.deviceToken}` },
    });
    assert.equal(nativeHistory.status, 200);
    const historyData = await nativeHistory.json();
    assert.equal(historyData.recentDoses[0].slot, 'morning');

    const nativeSession = await fetch(`${baseUrl}/api/device/session`, {
      method: 'POST',
      headers: { authorization: `Bearer ${pairData.deviceToken}` },
    });
    assert.equal(nativeSession.status, 200);
    assert.match(nativeSession.headers.get('set-cookie') || '', /SameSite=Strict/i);

    await store.revokeAccessUser('444444444');
    const afterRevoke = await fetch(`${baseUrl}/api/device/schedule`, {
      headers: { authorization: `Bearer ${pairData.deviceToken}` },
    });
    assert.equal(afterRevoke.status, 401);
  } finally {
    await close(server);
  }
});


test('strong Android pairing link and six-digit fallback are jointly single-use', async () => {
  const store = await tempStore();
  const pairing = await store.createDevicePairCode('444444444');
  assert.match(pairing.linkToken, /^[A-Za-z0-9_-]{32,128}$/);
  const paired = await store.pairDevice(pairing.linkToken, { deviceName: 'Pixel Native' });
  assert.ok(paired.deviceToken.length >= 32);
  await assert.rejects(
    store.pairDevice(pairing.code, { deviceName: 'Manual Replay' }),
    (error) => error.statusCode === 401,
  );
  await assert.rejects(
    store.pairDevice(pairing.linkToken, { deviceName: 'Link Replay' }),
    (error) => error.statusCode === 401,
  );
});


test('Android pairing handoff opens the native deep link without manual server entry', async () => {
  const server = createServer();
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/android/connect?token=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control') || '', /no-store/);
    const html = await response.text();
    assert.match(html, /epiapp:\/\/connect/);
    assert.match(html, /token=AAAAAAAA/);

    const invalid = await fetch(`http://127.0.0.1:${port}/android/connect?token=nope`);
    assert.equal(invalid.status, 400);
  } finally {
    await close(server);
  }
});


test('versioned JavaScript is revalidated instead of served stale', async () => {
  const server = createServer();
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/app.js?v=8`, { method: 'HEAD' });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /^text\/javascript/);
    assert.equal(response.headers.get('cache-control'), 'no-cache, must-revalidate');
  } finally {
    await close(server);
  }
});


test('Northflank public hostname can supply APP_BASE_URL automatically', () => {
  assert.equal(
    resolvePublicAppUrl({
      NF_HOSTS: 'http--epiapp--abc.code.run,other--epiapp--abc.code.run',
    }),
    'https://http--epiapp--abc.code.run',
  );
  assert.equal(
    resolvePublicAppUrl({
      APP_BASE_URL: 'https://custom.example.com/',
      NF_HOSTS: 'http--epiapp--abc.code.run',
    }),
    'https://custom.example.com',
  );
});

test('push registration requires device authentication and parent role and does not expose tokens', async () => {
  const store = await tempStore();
  const invite = await store.createInvite('child', ADMIN_ID);
  await store.acceptInvite(invite.token, { id: '222222222' });
  const adminCode = await store.createDevicePairCode(ADMIN_ID);
  const parent = await store.pairDevice(adminCode.code);
  const childCode = await store.createDevicePairCode('222222222');
  const child = await store.pairDevice(childCode.code);
  const server = createServer({ store, botToken: BOT_TOKEN, adminId: ADMIN_ID, pushDispatcher: { check: async () => {} } });
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;
  const payload = { token: 'fixture_push_registration_token', enabled: true, revision: 1 };
  const register = (credential, body = payload) => fetch(`${base}/api/device/push`, { method: 'POST', headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await register('invalid')).status, 401);
    assert.equal((await register(child.deviceToken)).status, 403);
    const response = await register(parent.deviceToken);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { registered: true, configured: true });
    assert.equal((await register(parent.deviceToken, { enabled: false, revision: 2 })).status, 200);
    assert.equal((await (await register(parent.deviceToken)).json()).registered, false);
    const devices = await store.listDevices();
    assert.doesNotMatch(JSON.stringify(devices), /fixture_push_registration_token|push|tokenHash/);
    await store.revokeDevice(parent.device.id);
    assert.equal((await register(parent.deviceToken)).status, 401);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
