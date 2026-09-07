import { dateKey } from './store.js';
import { sendTelegramMessage } from './telegram.js';

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

function slotLabel(slot) {
  return slot === 'morning' ? 'утреннем' : 'вечернем';
}

export function buildReminderText({ recipientRole, childName, slot, stage }) {
  const label = slotLabel(slot);
  const late = Math.max(stage.minute, Math.floor(stage.lateMinutes));
  if (recipientRole === 'child') {
    if (!stage.urgent) {
      return `⏰ Напоминание EpiApp\n\nОтметки о ${label} приёме пока нет. Прошло около ${late} мин после заданного времени.\n\nЕсли лекарство уже принято — открой EpiApp и отметь приём.`;
    }
    return `🚨 ВАЖНО — EpiApp\n\nОтметки о ${label} приёме нет уже около ${late} мин.\n\nЕсли лекарство уже принято — пожалуйста, открой EpiApp и отметь приём. Если нет — сообщи родителю.`;
  }

  if (!stage.urgent) {
    return `⏰ EpiApp: у ${childName} пока нет отметки о ${label} приёме через ${late} мин после заданного времени.`;
  }
  return `🚨 ВАЖНО — EpiApp\n\nУ ${childName} нет отметки о ${label} приёме уже около ${late} мин. Пожалуйста, проверьте ситуацию.`;
}

function appButton(url, text = '📱 Открыть EpiApp') {
  return { inline_keyboard: [[{ text, web_app: { url } }]] };
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
  if (!settings.remindersEnabled) return { sent: 0, failed: 0 };

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

  let sent = 0;
  let failed = 0;
  for (const targetDate of candidates) {
    for (const slot of ['morning', 'evening']) {
      if (doseKeys.has(`${targetDate}:${slot}`)) continue;
      const scheduled = slot === 'morning' ? settings.morningTime : settings.eveningTime;
      const lateMinutes = lateMinutesForDate({
        targetDate,
        today,
        nowMinutes,
        scheduledMinutes: minutesFromTime(scheduled),
      });
      const stage = reminderStage(settings, lateMinutes);
      if (!stage) continue;

      for (const [chatId, recipientRole] of recipients.entries()) {
        const deliveryKey = `${targetDate}:${slot}:${stage.key}:${chatId}`;
        if (alreadySent.has(deliveryKey)) continue;
        const targetUrl = recipientRole === 'parent' ? `${appUrl.replace(/\/$/, '')}/parent` : appUrl.replace(/\/$/, '');
        try {
          await sendMessage({
            token,
            chatId,
            text: buildReminderText({
              recipientRole,
              childName: settings.childName,
              slot,
              stage,
            }),
            replyMarkup: appButton(targetUrl),
          });
          await store.recordReminderDelivery({
            localDate: targetDate,
            slot,
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
