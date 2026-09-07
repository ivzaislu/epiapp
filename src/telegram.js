import { SLOT_LABELS } from './validation.js';

export function formatLocalTime(date, timeZone) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function buildDoseMessage({ childName, slot, takenAt, timeZone }) {
  const label = SLOT_LABELS[slot] ?? 'приём';
  const time = formatLocalTime(new Date(takenAt), timeZone);
  return `✅ ${childName}: ${label} приём отмечен в ${time}.`;
}

async function telegramRequest(token, method, payload = undefined) {
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN не настроен.');
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: payload ? 'POST' : 'GET',
    headers: payload ? { 'content-type': 'application/json' } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.description || `Telegram API вернул HTTP ${response.status}`);
  }
  return data.result;
}

export async function sendTelegramMessage({ token, chatId, text }) {
  return telegramRequest(token, 'sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });
}

export async function notifyDose({ token, chatIds, childName, slot, takenAt, timeZone }) {
  if (!token || chatIds.length === 0) {
    return { configured: false, sent: 0, failed: 0, errors: [] };
  }
  const text = buildDoseMessage({ childName, slot, takenAt, timeZone });
  const results = await Promise.allSettled(
    chatIds.map((chatId) => sendTelegramMessage({ token, chatId, text })),
  );
  const errors = results
    .map((result, index) => ({ result, chatId: chatIds[index] }))
    .filter(({ result }) => result.status === 'rejected')
    .map(({ result, chatId }) => ({ chatId, message: result.reason?.message ?? 'Неизвестная ошибка' }));
  return {
    configured: true,
    sent: results.length - errors.length,
    failed: errors.length,
    errors,
  };
}

export async function listRecentChats(token) {
  const updates = await telegramRequest(token, 'getUpdates');
  const chats = new Map();
  for (const update of updates.slice(-100)) {
    const message = update.message ?? update.edited_message ?? update.channel_post;
    const chat = message?.chat;
    if (!chat?.id) continue;
    const label = [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.title || chat.username || String(chat.id);
    chats.set(String(chat.id), { id: String(chat.id), label, type: chat.type });
  }
  return [...chats.values()];
}
