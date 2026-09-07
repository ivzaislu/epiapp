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

async function telegramRequest(token, method, payload = undefined, timeoutMs = 8000) {
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN не настроен.');
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: payload ? 'POST' : 'GET',
    headers: payload ? { 'content-type': 'application/json' } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.description || `Telegram API вернул HTTP ${response.status}`);
  }
  return data.result;
}

export async function sendTelegramMessage({ token, chatId, text, replyMarkup = undefined }) {
  return telegramRequest(token, 'sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
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

export function parseBotCommand(text) {
  if (typeof text !== 'string') return null;
  const match = text.trim().match(/^\/([a-z_]+)(?:@[a-z0-9_]+)?(?:\s+(.+))?$/i);
  if (!match) return null;
  return { command: match[1].toLowerCase(), argument: (match[2] || '').trim() };
}

export function botActionFromText(text) {
  const value = String(text || '').trim();
  const actions = new Map([
    ['👶 Пригласить ребёнка', { command: 'invite_child', argument: '' }],
    ['👨‍👩‍👧 Пригласить родителя', { command: 'invite_parent', argument: '' }],
    ['📊 Статистика', { command: 'stats', argument: '' }],
    ['👥 Пользователи', { command: 'users', argument: '' }],
    ['ℹ️ Помощь', { command: 'help', argument: '' }],
  ]);
  return actions.get(value) || null;
}

export function buildInviteStartLink(botUsername, token) {
  if (!/^[A-Za-z0-9_]{5,64}$/.test(String(botUsername || ''))) throw new Error('Некорректное имя Telegram-бота.');
  return `https://t.me/${botUsername}?start=invite_${encodeURIComponent(token)}`;
}

function displayName(user) {
  return [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || String(user?.id || 'пользователь');
}

export function mainMenuMarkup(role, appUrl) {
  const rows = [[{ text: '📱 Открыть EpiApp', web_app: { url: appUrl } }]];
  if (role === 'admin') {
    rows.push([
      { text: '👶 Пригласить ребёнка' },
      { text: '👨‍👩‍👧 Пригласить родителя' },
    ]);
    rows.push([
      { text: '📊 Статистика' },
      { text: '👥 Пользователи' },
    ]);
  } else if (role === 'parent') {
    rows.push([{ text: '📊 Статистика' }]);
  }
  rows.push([{ text: 'ℹ️ Помощь' }]);
  return {
    keyboard: rows,
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'Выберите действие',
  };
}

async function resolveRole(store, telegramId, adminId) {
  if (String(telegramId) === String(adminId)) return { telegramId: String(telegramId), role: 'admin' };
  return store.getAccessUser(String(telegramId));
}

function roleName(role) {
  if (role === 'admin') return 'администратор';
  if (role === 'parent') return 'родитель';
  return 'ребёнок';
}

function formatStats(stats) {
  const rate = stats.rate === null ? '—' : `${stats.rate}%`;
  const morning = stats.bySlot.morning.rate === null ? '—' : `${stats.bySlot.morning.rate}%`;
  const evening = stats.bySlot.evening.rate === null ? '—' : `${stats.bySlot.evening.rate}%`;
  return [
    `📊 Статистика за последние ${stats.requestedDays} дней`,
    `Отмечено: ${stats.taken} из ${stats.expected} (${rate})`,
    `Пропущенных отметок: ${stats.missed}`,
    `Утро: ${stats.bySlot.morning.taken}/${stats.bySlot.morning.expected} (${morning})`,
    `Вечер: ${stats.bySlot.evening.taken}/${stats.bySlot.evening.expected} (${evening})`,
    `Полных дней подряд: ${stats.currentStreak}`,
  ].join('\n');
}

async function handleBotMessage({ token, store, adminId, appUrl, botUsername, message }) {
  if (!message?.from?.id || message.chat?.type !== 'private') return;
  const telegramId = String(message.from.id);
  const chatId = String(message.chat.id);
  const parsed = parseBotCommand(message.text) || botActionFromText(message.text);
  if (!parsed) return;

  const telegramUser = {
    id: telegramId,
    firstName: message.from.first_name || '',
    lastName: message.from.last_name || '',
    username: message.from.username || '',
  };

  if (parsed.command === 'start' && parsed.argument.startsWith('invite_')) {
    const inviteToken = parsed.argument.slice('invite_'.length);
    try {
      const user = await store.acceptInvite(inviteToken, telegramUser);
      await sendTelegramMessage({
        token,
        chatId,
        text: `✅ Доступ подключён. Роль: ${roleName(user.role)}.`,
        replyMarkup: mainMenuMarkup(user.role, appUrl),
      });
      if (String(adminId) !== telegramId) {
        await sendTelegramMessage({
          token,
          chatId: String(adminId),
          text: `✅ ${displayName(message.from)} подключён(а) к EpiApp как ${roleName(user.role)} (Telegram ID ${telegramId}).`,
          replyMarkup: mainMenuMarkup('admin', appUrl),
        }).catch(() => undefined);
      }
    } catch (error) {
      await sendTelegramMessage({ token, chatId, text: `❌ ${error.message}` });
    }
    return;
  }

  const access = await resolveRole(store, telegramId, adminId);
  if (parsed.command === 'start') {
    if (!access) {
      await sendTelegramMessage({
        token,
        chatId,
        text: 'Доступ к EpiApp не выдан. Попросите администратора прислать одноразовое приглашение.',
        replyMarkup: { remove_keyboard: true },
      });
      return;
    }
    await sendTelegramMessage({
      token,
      chatId,
      text: `EpiApp готов. Ваша роль: ${roleName(access.role)}.`,
      replyMarkup: mainMenuMarkup(access.role, appUrl),
    });
    return;
  }

  if (!access) {
    await sendTelegramMessage({
      token,
      chatId,
      text: 'Нет доступа. Попросите администратора прислать приглашение.',
      replyMarkup: { remove_keyboard: true },
    });
    return;
  }

  if (parsed.command === 'help') {
    let text = 'Используйте кнопки меню ниже. «Открыть EpiApp» запускает защищённое приложение.';
    if (access.role === 'parent') text += '\n\nРодителю доступна статистика и изменение расписания/препарата в EpiApp.';
    if (access.role === 'admin') text += '\n\nАдминистратор также может приглашать ребёнка/родителя и управлять доступом.';
    await sendTelegramMessage({ token, chatId, text, replyMarkup: mainMenuMarkup(access.role, appUrl) });
    return;
  }

  if (parsed.command === 'stats') {
    if (!['parent', 'admin'].includes(access.role)) {
      await sendTelegramMessage({ token, chatId, text: 'Статистика доступна родителям.', replyMarkup: mainMenuMarkup(access.role, appUrl) });
      return;
    }
    const stats = await store.statistics(7);
    await sendTelegramMessage({ token, chatId, text: formatStats(stats), replyMarkup: mainMenuMarkup(access.role, appUrl) });
    return;
  }

  if (access.role !== 'admin') {
    await sendTelegramMessage({ token, chatId, text: 'Это действие доступно только администратору.', replyMarkup: mainMenuMarkup(access.role, appUrl) });
    return;
  }

  if (parsed.command === 'invite_child' || parsed.command === 'invite_parent') {
    const role = parsed.command === 'invite_child' ? 'child' : 'parent';
    const invite = await store.createInvite(role, telegramId);
    const link = buildInviteStartLink(botUsername, invite.token);
    await sendTelegramMessage({
      token,
      chatId,
      text: `Одноразовое приглашение для роли «${roleName(role)}». Действует 24 часа. Перешлите это сообщение нужному человеку:\n\n${link}`,
      replyMarkup: mainMenuMarkup('admin', appUrl),
    });
    return;
  }

  if (parsed.command === 'users') {
    const users = await store.listAccessUsers();
    const lines = [
      `admin · ${adminId} · из TELEGRAM_ADMIN_ID`,
      ...users.map((user) => {
        const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || (user.username ? `@${user.username}` : 'без имени');
        return `${user.role} · ${user.telegramId} · ${name}`;
      }),
    ];
    await sendTelegramMessage({
      token,
      chatId,
      text: `Пользователи EpiApp:\n${lines.join('\n')}\n\nДля отзыва доступа: /revoke TELEGRAM_ID`,
      replyMarkup: mainMenuMarkup('admin', appUrl),
    });
    return;
  }

  if (parsed.command === 'revoke') {
    if (!/^\d{1,20}$/.test(parsed.argument)) {
      await sendTelegramMessage({ token, chatId, text: 'Использование: /revoke TELEGRAM_ID', replyMarkup: mainMenuMarkup('admin', appUrl) });
      return;
    }
    if (parsed.argument === String(adminId)) {
      await sendTelegramMessage({ token, chatId, text: 'Администратора из TELEGRAM_ADMIN_ID нельзя удалить через бота.', replyMarkup: mainMenuMarkup('admin', appUrl) });
      return;
    }
    const removed = await store.revokeAccessUser(parsed.argument);
    await sendTelegramMessage({
      token,
      chatId,
      text: removed ? `Доступ ${parsed.argument} отозван.` : `Пользователь ${parsed.argument} не найден.`,
      replyMarkup: mainMenuMarkup('admin', appUrl),
    });
    return;
  }

  await sendTelegramMessage({ token, chatId, text: 'Неизвестная команда. Используйте кнопки меню.', replyMarkup: mainMenuMarkup(access.role, appUrl) });
}

export async function startTelegramBot({ token, store, adminId, appUrl }) {
  if (!token || !adminId) throw new Error('Для Telegram-доступа нужны TELEGRAM_BOT_TOKEN и TELEGRAM_ADMIN_ID.');
  if (!/^\d{1,20}$/.test(String(adminId))) throw new Error('TELEGRAM_ADMIN_ID должен содержать только цифры.');
  const normalizedUrl = new URL(appUrl);
  if (normalizedUrl.protocol !== 'https:') throw new Error('APP_BASE_URL для Telegram Mini App должен использовать HTTPS.');
  const baseUrl = normalizedUrl.toString().replace(/\/$/, '');

  const bot = await telegramRequest(token, 'getMe');
  if (!bot?.username) throw new Error('Telegram Bot API не вернул username бота.');

  await telegramRequest(token, 'setMyCommands', {
    commands: [
      { command: 'start', description: 'Открыть меню EpiApp' },
      { command: 'stats', description: 'Статистика отметок' },
      { command: 'invite_child', description: 'Пригласить ребёнка' },
      { command: 'invite_parent', description: 'Пригласить родителя' },
      { command: 'users', description: 'Пользователи' },
      { command: 'revoke', description: 'Отозвать доступ по Telegram ID' },
      { command: 'help', description: 'Помощь' },
    ],
  }).catch(() => undefined);

  await telegramRequest(token, 'setChatMenuButton', {
    menu_button: { type: 'web_app', text: 'Открыть EpiApp', web_app: { url: baseUrl } },
  }).catch(() => undefined);

  let stopped = false;
  let offset = 0;
  const loop = async () => {
    while (!stopped) {
      try {
        const updates = await telegramRequest(token, 'getUpdates', {
          offset,
          timeout: 25,
          allowed_updates: ['message'],
        }, 35_000);
        for (const update of updates) {
          offset = Math.max(offset, Number(update.update_id) + 1);
          await handleBotMessage({
            token,
            store,
            adminId: String(adminId),
            appUrl: baseUrl,
            botUsername: bot.username,
            message: update.message,
          }).catch((error) => console.error('Telegram update failed:', error));
        }
      } catch (error) {
        if (stopped) break;
        console.error('Telegram polling failed:', error.message || error);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  };
  void loop();

  return {
    username: bot.username,
    stop() { stopped = true; },
  };
}
