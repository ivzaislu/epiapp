import { dateKey } from './store.js';
import { buildDoseMessage, sendTelegramMessage } from './telegram.js';
import { schedulePlan } from './validation.js';

function minutesFromTime(value) {
  const [hours, minutes] = String(value || '00:00').split(':').map(Number);
  return hours * 60 + minutes;
}

function localMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(map.hour) * 60 + Number(map.minute);
}

function previousDateKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1, 12)).toISOString().slice(0, 10);
}

export function reminderStage(settings, lateMinutes) {
  if (!settings.remindersEnabled) return null;
  const first = Number(settings.reminderFirstMinutes);
  const urgent = Number(settings.reminderUrgentMinutes);
  const repeat = Number(settings.reminderRepeatMinutes);
  const stop = Number(settings.reminderStopMinutes);

  if (!Number.isFinite(lateMinutes) || lateMinutes < first) return null;
  if (lateMinutes < urgent) {
    return { key: `late-${first}`, minute: first, urgent: false, lateMinutes };
  }
  if (lateMinutes > stop + repeat) return null;

  const stageMinute = Math.min(stop, urgent + Math.floor((lateMinutes - urgent) / repeat) * repeat);
  return { key: `urgent-${stageMinute}`, minute: stageMinute, urgent: true, lateMinutes };
}

function lateMinutesForDate({ targetDate, today, nowMinutes, scheduledMinutes }) {
  if (targetDate === today) return nowMinutes - scheduledMinutes;
  if (targetDate === previousDateKey(today)) return nowMinutes + 1440 - scheduledMinutes;
  return Number.NaN;
}

function slotPhrase(slot, time) {
  if (slot === 'morning') return 'утреннем приёме';
  if (slot === 'evening') return 'вечернем приёме';
  return `приёме в ${time}`;
}

export function buildReminderText({ recipientRole, childName, slot, stage, time = '' }) {
  const label = slotPhrase(slot, time);
  const late = Math.max(stage.minute, Math.floor(stage.lateMinutes));
  if (recipientRole === 'child') {
    if (!stage.urgent) {
      return `⏰ Напоминание EpiApp\n\nОтметки о ${label} пока нет. Прошло около ${late} мин после заданного времени.\n\nЕсли лекарство уже принято — открой EpiApp и отметь приём.`;
    }
    return `🚨 ВАЖНО — EpiApp\n\nОтметки о ${label} нет уже около ${late} мин.\n\nЕсли лекарство уже принято — пожалуйста, открой EpiApp и отметь приём. Если нет — сообщи родителю.`;
  }

  if (!stage.urgent) {
    return `⏰ EpiApp: у ${childName} пока нет отметки о ${label} через ${late} мин после заданного времени.`;
  }
  return `🚨 ВАЖНО — EpiApp\n\nУ ${childName} нет отметки о ${label} уже около ${late} мин. Пожалуйста, проверьте ситуацию.`;
}

function appButton(url, text = '📱 Открыть EpiApp') {
  return { inline_keyboard: [[{ text, web_app: { url } }]] };
}

export function parentNotificationFeed(state, { now = new Date(), since = null } = {}) {
  const settings = state.settings;
  const cutoff = Math.max(now.getTime() - 24 * 3600_000, since?.getTime() ?? 0);
  const notifications = state.doses
    .filter((dose) => Date.parse(dose.takenAt) >= cutoff && Date.parse(dose.takenAt) <= now.getTime())
    .map((dose) => ({
      id: `taken:${dose.id}`,
      tag: `taken:${dose.id}`,
      type: 'taken',
      at: dose.takenAt,
      title: 'Приём подтверждён',
      body: buildDoseMessage({
        childName: settings.childName, slot: dose.slot, takenAt: dose.takenAt, timeZone: settings.timezone,
      }),
    }));
  const activeReminderTags = [];
  const today = dateKey(now, settings.timezone);
  const nowMinutes = localMinutes(now, settings.timezone);
  const recorded = new Set(state.doses.map((dose) => `${dose.localDate}:${dose.slot}`));
  for (const localDate of [today, previousDateKey(today)]) {
    for (const item of schedulePlan(settings)) {
      if (recorded.has(`${localDate}:${item.slot}`)) continue;
      const stage = reminderStage(settings, lateMinutesForDate({
        targetDate: localDate, today, nowMinutes, scheduledMinutes: minutesFromTime(item.time),
      }));
      if (!stage) continue;
      const tag = `reminder:${localDate}:${item.slot}`;
      activeReminderTags.push(tag);
      const at = new Date(Math.floor(now.getTime() / 60_000) * 60_000 - (stage.lateMinutes - stage.minute) * 60_000);
      if (at.getTime() < cutoff) continue;
      notifications.push({
        id: `${tag}:${stage.key}`, tag, type: 'reminder', at: at.toISOString(),
        title: stage.urgent ? 'Долго нет отметки' : 'Пока нет отметки',
        body: buildReminderText({ recipientRole: 'parent', childName: settings.childName, slot: item.slot, time: item.time, stage }),
      });
    }
  }
  notifications.sort((left, right) => left.at.localeCompare(right.at));
  return { notifications: notifications.slice(-50), activeReminderTags, checkedAt: now.toISOString() };
}

export async function runReminderCheck({
  store,
  token,
  adminId,
  appUrl,
  now = new Date(),
  sendMessage = sendTelegramMessage,
  logger = console,
}) {
  if (!token || !/^\d{1,20}$/.test(String(adminId || ''))) return { sent: 0, failed: 0 };
  const state = await store.read();
  const settings = state.settings;
  if (!settings.remindersEnabled || settings.telegramRemindersEnabled === false) return { sent: 0, failed: 0 };

  const today = dateKey(now, settings.timezone);
  const candidates = [today, previousDateKey(today)];
  const nowMinutes = localMinutes(now, settings.timezone);
  const doseKeys = new Set(state.doses.map((dose) => `${dose.localDate}:${dose.slot}`));
  const alreadySent = new Set(state.reminderDeliveries.map((entry) => (
    `${entry.localDate}:${entry.slot}:${entry.stageKey}:${entry.chatId}`
  )));

  const childIds = state.access.users
    .filter((user) => user.role === 'child')
    .map((user) => String(user.telegramId));
  const parentIds = [
    String(adminId),
    ...state.access.users.filter((user) => user.role === 'parent').map((user) => String(user.telegramId)),
  ];
  const recipients = new Map();
  for (const id of childIds) if (/^\d{1,20}$/.test(id)) recipients.set(id, 'child');
  for (const id of parentIds) if (/^\d{1,20}$/.test(id) && !recipients.has(id)) recipients.set(id, 'parent');

  const plan = schedulePlan(settings);
  let sent = 0;
  let failed = 0;
  for (const targetDate of candidates) {
    for (const item of plan) {
      if (doseKeys.has(`${targetDate}:${item.slot}`)) continue;
      const lateMinutes = lateMinutesForDate({
        targetDate,
        today,
        nowMinutes,
        scheduledMinutes: minutesFromTime(item.time),
      });
      const stage = reminderStage(settings, lateMinutes);
      if (!stage) continue;

      for (const [chatId, recipientRole] of recipients.entries()) {
        const deliveryKey = `${targetDate}:${item.slot}:${stage.key}:${chatId}`;
        if (alreadySent.has(deliveryKey)) continue;
        const targetUrl = recipientRole === 'parent' ? `${appUrl.replace(/\/$/, '')}/parent` : appUrl.replace(/\/$/, '');
        try {
          await sendMessage({
            token,
            chatId,
            text: buildReminderText({
              recipientRole,
              childName: settings.childName,
              slot: item.slot,
              time: item.time,
              stage,
            }),
            replyMarkup: appButton(targetUrl),
          });
          await store.recordReminderDelivery({
            localDate: targetDate,
            slot: item.slot,
            stageKey: stage.key,
            chatId,
            sentAt: now,
          });
          alreadySent.add(deliveryKey);
          sent += 1;
        } catch (error) {
          failed += 1;
          logger.error?.(`Reminder delivery failed for ${chatId}:`, error?.message || error);
        }
      }
    }
  }
  return { sent, failed };
}

export function startReminderScheduler(options) {
  let stopped = false;
  let running = false;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await runReminderCheck(options);
    } catch (error) {
      options.logger?.error?.('Reminder scheduler failed:', error?.message || error);
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(tick, 30_000);
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
