import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildReminderText, parentNotificationFeed, reminderStage, runReminderCheck } from '../src/reminders.js';
import { Store } from '../src/store.js';

async function tempStore() {
  const dir = await mkdtemp(join(tmpdir(), 'epiapp-reminders-'));
  return new Store(join(dir, 'state.json'));
}

test('reminder stages escalate at configured times', () => {
  const settings = {
    remindersEnabled: true,
    reminderFirstMinutes: 15,
    reminderUrgentMinutes: 30,
    reminderRepeatMinutes: 15,
    reminderStopMinutes: 60,
  };
  assert.equal(reminderStage(settings, 14), null);
  assert.equal(reminderStage(settings, 15).key, 'late-15');
  assert.equal(reminderStage(settings, 29).key, 'late-15');
  assert.equal(reminderStage(settings, 30).key, 'urgent-30');
  assert.equal(reminderStage(settings, 46).key, 'urgent-45');
  assert.equal(reminderStage(settings, 61).key, 'urgent-60');
  assert.equal(reminderStage(settings, 76), null);
});

test('parent app feed works independently of Telegram and clears reminders after confirmation', async () => {
  const store = await tempStore();
  await store.updateSettings({
    timezone: 'UTC', telegramRemindersEnabled: false, medicationName: 'Private medicine', morningDose: 'Private dose',
  });
  const now = new Date('2026-11-10T08:31:00.000Z');
  const state = await store.read();
  const feed = parentNotificationFeed(state, { now });
  assert.equal(feed.notifications.length, 1);
  assert.equal(feed.notifications[0].title, 'Долго нет отметки');
  assert.equal(feed.notifications[0].at, '2026-11-10T08:30:00.000Z');
  assert.doesNotMatch(feed.notifications[0].body, /Private/);
  assert.equal(feed.activeReminderTags.length, 1);
  assert.equal(parentNotificationFeed(state, { now, since: new Date('2026-11-10T08:30:01Z') }).notifications.length, 0);
  assert.deepEqual(await runReminderCheck({ store, token: 'fixture', adminId: '111', appUrl: 'https://fixture.example', now }), { sent: 0, failed: 0 });
  await store.takeDose('morning', now);
  const confirmed = parentNotificationFeed(await store.read(), { now });
  assert.equal(confirmed.notifications.length, 1);
  assert.equal(confirmed.notifications[0].type, 'taken');
  assert.deepEqual(confirmed.activeReminderTags, []);
  await store.updateSettings({ remindersEnabled: false });
  assert.equal(parentNotificationFeed(await store.read(), { now }).notifications[0].type, 'taken');
});

test('parent app feed carries overdue evening reminders across midnight', async () => {
  const store = await tempStore();
  await store.updateSettings({ timezone: 'UTC', eveningTime: '23:50' });
  const feed = parentNotificationFeed(await store.read(), { now: new Date('2026-11-11T00:21:00Z') });
  assert.equal(feed.notifications[0].id, 'reminder:2026-11-10:evening:urgent-30');
  assert.equal(feed.notifications[0].at, '2026-11-11T00:20:00.000Z');
});

test('reminder text does not expose medication or dose', () => {
  const text = buildReminderText({
    recipientRole: 'parent',
    childName: 'Аня',
    slot: 'morning',
    stage: { minute: 30, lateMinutes: 31, urgent: true, key: 'urgent-30' },
  });
  assert.match(text, /ВАЖНО/);
  assert.match(text, /Аня/);
  assert.doesNotMatch(text, /мг|таблет|препарат/i);
});

test('reminder check sends once per stage to child and both parents', async () => {
  const store = await tempStore();
  await store.updateSettings({
    childName: 'Аня',
    morningTime: '08:00',
    eveningTime: '20:00',
    timezone: 'Europe/Berlin',
    remindersEnabled: true,
    reminderFirstMinutes: 15,
    reminderUrgentMinutes: 30,
    reminderRepeatMinutes: 15,
    reminderStopMinutes: 60,
  });
  const childInvite = await store.createInvite('child', '111111111');
  await store.acceptInvite(childInvite.token, { id: '222222222', firstName: 'Child' });
  const parentInvite = await store.createInvite('parent', '111111111');
  await store.acceptInvite(parentInvite.token, { id: '333333333', firstName: 'Parent' });

  const messages = [];
  const sendMessage = async (payload) => { messages.push(payload); return { message_id: messages.length }; };
  const options = {
    store,
    token: 'test-token',
    adminId: '111111111',
    appUrl: 'https://epiapp.example',
    sendMessage,
    logger: { error() {} },
  };

  const first = await runReminderCheck({ ...options, now: new Date('2026-09-08T06:16:00.000Z') });
  assert.deepEqual(first, { sent: 3, failed: 0 });
  assert.deepEqual(new Set(messages.map((item) => item.chatId)), new Set(['111111111', '222222222', '333333333']));

  const duplicate = await runReminderCheck({ ...options, now: new Date('2026-09-08T06:20:00.000Z') });
  assert.deepEqual(duplicate, { sent: 0, failed: 0 });

  const urgent = await runReminderCheck({ ...options, now: new Date('2026-09-08T06:31:00.000Z') });
  assert.deepEqual(urgent, { sent: 3, failed: 0 });
  assert.equal(messages.length, 6);
  assert.equal(messages.filter((item) => /ВАЖНО/.test(item.text)).length, 3);
});

test('recorded dose suppresses reminders for that slot', async () => {
  const store = await tempStore();
  await store.updateSettings({ morningTime: '08:00', timezone: 'Europe/Berlin' });
  const invite = await store.createInvite('child', '111111111');
  await store.acceptInvite(invite.token, { id: '222222222', firstName: 'Child' });
  await store.takeDose('morning', new Date('2026-09-08T06:05:00.000Z'));

  let count = 0;
  const result = await runReminderCheck({
    store,
    token: 'test-token',
    adminId: '111111111',
    appUrl: 'https://epiapp.example',
    now: new Date('2026-09-08T06:31:00.000Z'),
    sendMessage: async () => { count += 1; },
    logger: { error() {} },
  });
  assert.equal(result.sent, 0);
  assert.equal(count, 0);
});
