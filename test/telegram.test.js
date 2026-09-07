import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDoseMessage, buildInviteStartLink, notifyDose, parseBotCommand } from '../src/telegram.js';

test('dose message contains only minimal adherence information', () => {
  const message = buildDoseMessage({
    childName: 'Аня', slot: 'morning', takenAt: '2026-09-07T06:04:00.000Z', timeZone: 'Europe/Berlin',
  });
  assert.equal(message, '✅ Аня: утренний приём отмечен в 08:04.');
  assert.doesNotMatch(message, /мг|доз|препарат/i);
});

test('notifyDose does not attempt network when Telegram is not configured', async () => {
  const result = await notifyDose({
    token: '', chatIds: [], childName: 'Аня', slot: 'morning', takenAt: new Date().toISOString(), timeZone: 'Europe/Berlin',
  });
  assert.deepEqual(result, { configured: false, sent: 0, failed: 0, errors: [] });
});

test('parses admin invitation and revoke commands', () => {
  assert.deepEqual(parseBotCommand('/invite_child'), { command: 'invite_child', argument: '' });
  assert.deepEqual(parseBotCommand('/revoke 123456789'), { command: 'revoke', argument: '123456789' });
  assert.deepEqual(parseBotCommand('/start@EpiAppBot invite_token'), { command: 'start', argument: 'invite_token' });
});

test('builds one-time Telegram start link', () => {
  assert.equal(
    buildInviteStartLink('EpiAppBot', 'abc_DEF-123'),
    'https://t.me/EpiAppBot?start=invite_abc_DEF-123',
  );
});
