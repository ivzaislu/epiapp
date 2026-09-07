import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { InviteError, Store } from '../src/store.js';

async function tempStore() {
  const dir = await mkdtemp(join(tmpdir(), 'epiapp-access-'));
  return new Store(join(dir, 'state.json'));
}

test('admin can create a one-time child invitation and user can accept it', async () => {
  const store = await tempStore();
  const now = new Date('2026-09-07T21:50:00.000Z');
  const invite = await store.createInvite('child', '111111111', { now, ttlMs: 60_000 });
  assert.equal(invite.role, 'child');
  assert.ok(invite.token.length >= 16);

  const user = await store.acceptInvite(invite.token, {
    id: '222222222', firstName: 'Аня', username: 'anya',
  }, { now: new Date(now.getTime() + 5_000) });
  assert.equal(user.telegramId, '222222222');
  assert.equal(user.role, 'child');
  assert.equal((await store.getAccessUser('222222222')).firstName, 'Аня');

  await assert.rejects(
    () => store.acceptInvite(invite.token, { id: '333333333' }, { now: new Date(now.getTime() + 10_000) }),
    (error) => error instanceof InviteError && /уже использовано/i.test(error.message),
  );
});

test('expired invitations cannot be accepted', async () => {
  const store = await tempStore();
  const now = new Date('2026-09-07T21:50:00.000Z');
  const invite = await store.createInvite('parent', '111111111', { now, ttlMs: 1_000 });
  await assert.rejects(
    () => store.acceptInvite(invite.token, { id: '222222222' }, { now: new Date(now.getTime() + 2_000) }),
    (error) => error instanceof InviteError && /истёк/i.test(error.message),
  );
});

test('access user can be revoked immediately', async () => {
  const store = await tempStore();
  const invite = await store.createInvite('parent', '111111111');
  await store.acceptInvite(invite.token, { id: '222222222', firstName: 'Мама' });
  assert.equal((await store.listAccessUsers()).length, 1);
  assert.equal(await store.revokeAccessUser('222222222'), true);
  assert.equal(await store.getAccessUser('222222222'), null);
});
