import test from 'node:test';
import assert from 'node:assert/strict';
import {
  botActionFromText,
  handleBotMessage,
  resolveAndroidApkUrl,
  sendAndroidApk,
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

test('custom intake notifications mention the intake once', () => {
  for (const slot of ['m1234567@12:00', 'legacy@12:00']) {
    const message = buildDoseMessage({
      childName: 'Аня', slot, takenAt: '2026-09-07T10:04:00.000Z', timeZone: 'Europe/Berlin',
    });
    assert.equal(message, '✅ Аня: приём отмечен в 12:04.');
  }
  assert.equal(buildDoseMessage({
    childName: 'Аня', slot: 'evening', takenAt: '2026-09-07T18:04:00.000Z', timeZone: 'Europe/Berlin',
  }), '✅ Аня: вечерний приём отмечен в 20:04.');
});

test('parses admin invitation and revoke commands', () => {
  assert.deepEqual(parseBotCommand('/invite_child'), { command: 'invite_child', argument: '' });
  assert.deepEqual(parseBotCommand('/revoke 123456789'), { command: 'revoke', argument: '123456789' });
  assert.deepEqual(parseBotCommand('/start@EpiAppBot invite_token'), { command: 'start', argument: 'invite_token' });
  assert.deepEqual(parseBotCommand('/android'), { command: 'android', argument: '' });
});

test('maps Telegram menu buttons to bot actions', () => {
  assert.deepEqual(botActionFromText('👶 Пригласить ребёнка'), { command: 'invite_child', argument: '' });
  assert.deepEqual(botActionFromText('Второй родитель'), { command: 'invite_parent', argument: '' });
  assert.deepEqual(botActionFromText('📊 Статистика'), { command: 'stats', argument: '' });
  assert.deepEqual(botActionFromText('📥 Скачать приложение'), { command: 'download', argument: '' });
  assert.deepEqual(botActionFromText('📲 Подключить Android'), { command: 'android', argument: '' });
});

test('all roles receive Android pairing button and role-specific Telegram keyboards', () => {
  const server = 'https://family.example.com';
  const admin = mainMenuMarkup('admin', server);
  const parent = mainMenuMarkup('parent', server);
  const child = mainMenuMarkup('child', server);
  assert.ok(admin.keyboard.flat().some((button) => button.text === '👶 Пригласить ребёнка'));
  assert.ok(admin.keyboard.flat().some((button) => button.text === 'Второй родитель'));
  assert.ok(parent.keyboard.flat().some((button) => button.text === '📊 Статистика'));
  assert.equal(parent.keyboard.flat().some((button) => button.text.includes('Пригласить')), false);
  assert.equal(child.keyboard.flat().some((button) => button.text === '📊 Статистика'), false);
  for (const menu of [admin, parent, child]) {
    assert.ok(menu.keyboard.flat().some((button) => button.text === '📲 Подключить Android'));
    assert.ok(menu.keyboard.flat().some((button) => button.text === '📥 Скачать приложение'));
    assert.equal(menu.keyboard[0][0].web_app.url, server);
  }
});

test('builds one-time Telegram start link', () => {
  assert.equal(
    buildInviteStartLink('EpiAppBot', 'abc_DEF-123'),
    'https://t.me/EpiAppBot?start=invite_abc_DEF-123',
  );
});


test('APK distribution accepts HTTPS APK URLs only', () => {
  assert.match(resolveAndroidApkUrl(), /^https:\/\/.*\.apk$/);
  for (const value of ['http://example.com/app.apk', 'https://user:pass@example.com/app.apk', 'https://example.com/page', 'https://example.com/app.apk#fragment']) {
    assert.throws(() => resolveAndroidApkUrl(value));
  }
});

function privateMessage(id, text) {
  return { from: { id }, chat: { id, type: 'private' }, text };
}

const stubApk = () => new Response(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0]));

test('APK is uploaded as multipart document then reused by Telegram file id', async () => {
  const original = globalThis.fetch;
  const calls = [];
  const apkUrl = 'https://downloads.example.com/cache-test.apk';
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url === apkUrl) return stubApk();
    assert.equal(url, 'https://api.telegram.org/botSTUB_CACHE/sendDocument');
    return Response.json({ ok: true, result: { document: { file_id: 'cached-apk-id' } } });
  };
  try {
    await sendAndroidApk({ token: 'STUB_CACHE', chatId: '100', apkUrl });
    const form = calls[1].options.body;
    assert.ok(form instanceof FormData);
    assert.equal(calls[1].options.headers, undefined);
    assert.equal(form.get('chat_id'), '100');
    assert.equal(form.get('document').name, 'cache-test.apk');
    assert.equal(form.get('document').type, 'application/vnd.android.package-archive');
    assert.equal(form.get('document').size, 8);
    assert.match(form.get('caption'), /Подключить Android/);
    await sendAndroidApk({ token: 'STUB_CACHE', chatId: '200', apkUrl });
    assert.equal(calls.length, 3);
    const reused = JSON.parse(calls[2].options.body);
    assert.equal(reused.document, 'cached-apk-id');
    assert.equal(reused.chat_id, '200');
  } finally { globalThis.fetch = original; }
});

test('all family roles can download APK without generating a pairing code', async () => {
  const original = globalThis.fetch;
  const uploads = [];
  const apkUrl = 'https://downloads.example.com/family.apk';
  globalThis.fetch = async (url, options) => {
    if (url === apkUrl) return stubApk();
    assert.match(url, /sendDocument$/);
    uploads.push(options.body);
    return Response.json({ ok: true, result: { message_id: 1 } });
  };
  try {
    for (const role of ['admin', 'parent', 'child']) {
      const id = role === 'admin' ? '100' : role === 'parent' ? '200' : '300';
      await handleBotMessage({ token: 'STUB_FAMILY', adminId: '100', appUrl: 'https://family.example.com', apkUrl,
        store: { getAccessUser: async () => ({ role }) },
        message: privateMessage(id, '📥 Скачать приложение'),
      });
      const keyboard = JSON.parse(uploads.at(-1).get('reply_markup')).keyboard.flat();
      assert.ok(keyboard.some(b => b.text === '📲 Подключить Android'));
      assert.equal(keyboard.some(b => b.text === '👶 Пригласить ребёнка'), role === 'admin');
    }
    assert.equal(uploads.length, 3);
  } finally { globalThis.fetch = original; }
});

test('uninvited accounts and group chats cannot trigger APK downloads', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, payload: JSON.parse(options.body) });
    return Response.json({ ok: true, result: {} });
  };
  const options = { token: 'STUB_DENIED', adminId: '100', appUrl: 'https://family.example.com',
    store: { getAccessUser: async () => null } };
  try {
    await handleBotMessage({ ...options, message: privateMessage('200', '/download') });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /sendMessage$/);
    assert.match(calls[0].payload.text, /Нет доступа/);
    await handleBotMessage({ ...options, message: { ...privateMessage('200', '/download'), chat: { id: '-100', type: 'group' } } });
    assert.equal(calls.length, 1);
  } finally { globalThis.fetch = original; }
});

test('download failure returns a direct APK link and installation instructions', async () => {
  const original = globalThis.fetch;
  const apkUrl = 'https://downloads.example.com/unavailable.apk';
  let fallback;
  globalThis.fetch = async (url, options) => {
    if (url === apkUrl) return new Response('<html>not an APK</html>');
    assert.match(url, /sendMessage$/);
    fallback = JSON.parse(options.body);
    return Response.json({ ok: true, result: {} });
  };
  try {
    await handleBotMessage({ token: 'STUB_FALLBACK', adminId: '100', appUrl: 'https://family.example.com', apkUrl,
      store: {}, message: privateMessage('100', '/apk') });
    assert.equal(fallback.reply_markup.inline_keyboard[0][0].url, apkUrl);
    assert.match(fallback.text, /Не удалось отправить APK/);
    assert.match(fallback.text, /Подключить Android/);
  } finally { globalThis.fetch = original; }
});

test('oversized APK is rejected before upload', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('x', { headers: { 'content-length': '50000000' } });
  try {
    await assert.rejects(sendAndroidApk({ token: 'STUB_SIZE', chatId: '100', apkUrl: 'https://downloads.example.com/large.apk' }), /размер/);
  } finally { globalThis.fetch = original; }
});
