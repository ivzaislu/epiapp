import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createServer } from '../server.js';
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
  const server = createServer({ store, botToken: BOT_TOKEN, adminId: ADMIN_ID });
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const cookie = await authenticate(baseUrl, '222222222');
    const response = await fetch(`${baseUrl}/api/parent/settings`, { headers: { cookie } });
    assert.equal(response.status, 403);
  } finally {
    await close(server);
  }
});

test('invited parent can read parent settings', async () => {
  const store = await tempStore();
  const invite = await store.createInvite('parent', ADMIN_ID);
  await store.acceptInvite(invite.token, { id: '333333333', firstName: 'Parent' });
  const server = createServer({ store, botToken: BOT_TOKEN, adminId: ADMIN_ID });
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const cookie = await authenticate(baseUrl, '333333333');
    const response = await fetch(`${baseUrl}/api/parent/settings`, { headers: { cookie } });
    assert.equal(response.status, 200);
  } finally {
    await close(server);
  }
});
