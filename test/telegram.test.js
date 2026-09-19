import test from 'node:test';
import assert from 'node:assert/strict';
import {
  botActionFromText,
  buildDoseMessage,
  buildInviteStartLink,
  mainMenuMarkup,
  notifyDose,
  parseBotCommand,
} from '../src/telegram.js';

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
  assert.deepEqual(parseBotCommand('/android'), { command: 'android', argument: '' });
});

test('maps Telegram menu buttons to bot actions', () => {
  assert.deepEqual(botActionFromText('👶 Пригласить ребёнка'), { command: 'invite_child', argument: '' });
  assert.deepEqual(botActionFromText('👨‍👩‍👧 Пригласить родителя'), { command: 'invite_parent', argument: '' });
  assert.deepEqual(botActionFromText('📊 Статистика'), { command: 'stats', argument: '' });
  assert.deepEqual(botActionFromText('📲 Подключить Android'), { command: 'android', argument: '' });
});

test('all roles receive Android pairing button and role-specific Telegram keyboards', () => {
  const server = 'https://family.example.com';
  const admin = mainMenuMarkup('admin', server);
  const parent = mainMenuMarkup('parent', server);
  const child = mainMenuMarkup('child', server);
  assert.ok(admin.keyboard.flat().some((button) => button.text === '👶 Пригласить ребёнка'));
  assert.ok(admin.keyboard.flat().some((button) => button.text === '👨‍👩‍👧 Пригласить родителя'));
  assert.ok(parent.keyboard.flat().some((button) => button.text === '📊 Статистика'));
  assert.equal(parent.keyboard.flat().some((button) => button.text.includes('Пригласить')), false);
  assert.equal(child.keyboard.flat().some((button) => button.text === '📊 Статистика'), false);
  for (const menu of [admin, parent, child]) {
    assert.ok(menu.keyboard.flat().some((button) => button.text === '📲 Подключить Android'));
    assert.equal(menu.keyboard[0][0].web_app.url, server);
  }
});

test('builds one-time Telegram start link', () => {
  assert.equal(
    buildInviteStartLink('EpiAppBot', 'abc_DEF-123'),
    'https://t.me/EpiAppBot?start=invite_abc_DEF-123',
  );
});
