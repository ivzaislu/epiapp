import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import {
  AuthError,
  buildSessionCookie,
  createSessionToken,
  getCookie,
  validateTelegramInitData,
  verifySessionToken,
} from '../src/auth.js';

const BOT_TOKEN = '123456:TEST_TOKEN';
const NOW = Date.UTC(2026, 8, 7, 21, 50, 0);

function signedInitData({ userId = '123456789', authDate = Math.floor(NOW / 1000) } = {}) {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: 'AAE-test-query',
    user: JSON.stringify({ id: Number(userId), first_name: 'Анна', username: 'anna_test' }),
  });
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

test('validates signed Telegram Mini App initData', () => {
  const result = validateTelegramInitData(signedInitData(), BOT_TOKEN, { now: NOW });
  assert.equal(result.user.id, '123456789');
  assert.equal(result.user.firstName, 'Анна');
  assert.equal(result.user.username, 'anna_test');
});

test('rejects tampered Telegram initData', () => {
  const tampered = signedInitData().replace('123456789', '987654321');
  assert.throws(
    () => validateTelegramInitData(tampered, BOT_TOKEN, { now: NOW }),
    (error) => error instanceof AuthError && /подпись/i.test(error.message),
  );
});

test('rejects stale Telegram initData', () => {
  const initData = signedInitData({ authDate: Math.floor(NOW / 1000) - 7200 });
  assert.throws(
    () => validateTelegramInitData(initData, BOT_TOKEN, { now: NOW, maxAgeSeconds: 3600 }),
    (error) => error instanceof AuthError && /устарела/i.test(error.message),
  );
});

test('creates and verifies signed session tokens', () => {
  const session = createSessionToken('123456789', BOT_TOKEN, { now: NOW, ttlSeconds: 60 });
  assert.deepEqual(verifySessionToken(session, BOT_TOKEN, { now: NOW + 30_000 }), {
    telegramId: '123456789',
    expiresAt: Math.floor(NOW / 1000) + 60,
  });
  assert.throws(() => verifySessionToken(session, BOT_TOKEN, { now: NOW + 61_000 }), AuthError);
});

test('session cookies are HttpOnly, Secure and SameSite=Strict', () => {
  const session = createSessionToken('123456789', BOT_TOKEN, { now: NOW });
  const cookie = buildSessionCookie(session);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.equal(getCookie(cookie, 'epiapp_session'), session);
});
