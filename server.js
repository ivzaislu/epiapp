import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AuthError,
  buildSessionCookie,
  clearSessionCookie,
  createSessionToken,
  getCookie,
  validateTelegramInitData,
  verifySessionToken,
} from './src/auth.js';
import { startReminderScheduler } from './src/reminders.js';
import { Store } from './src/store.js';
import { notifyDose, sendTelegramMessage, startTelegramBot } from './src/telegram.js';
import { ValidationError } from './src/validation.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const DATA_FILE = process.env.DATA_FILE || join(ROOT, 'data', 'epiapp.json');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const defaultStore = new Store(DATA_FILE);
const pairingAttempts = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function json(res, status, payload, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32_768) throw new ValidationError('Слишком большой запрос.');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ValidationError('Ожидался JSON.');
  }
}

async function serveStatic(req, res, pathname) {
  let relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (relative === 'parent') relative = 'parent.html';
  const filePath = resolve(PUBLIC_DIR, relative);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${sep}`)) return false;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    res.writeHead(200, {
      'content-type': MIME[extname(filePath)] || 'application/octet-stream',
      'content-length': info.size,
      'cache-control': extname(filePath) === '.html' ? 'no-store' : 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    if (req.method === 'HEAD') res.end();
    else res.end(await readFile(filePath));
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function configuredAccess(botToken, adminId) {
  if (!botToken) throw new AuthError('TELEGRAM_BOT_TOKEN не настроен.', 503);
  if (!/^\d{1,20}$/.test(String(adminId || ''))) throw new AuthError('TELEGRAM_ADMIN_ID не настроен.', 503);
}

async function resolveAccessUser(telegramId, { store, adminId }) {
  if (String(telegramId) === String(adminId)) {
    return { telegramId: String(telegramId), role: 'admin', firstName: 'Администратор', lastName: '', username: '' };
  }
  return store.getAccessUser(String(telegramId));
}

async function requireUser(req, context, roles = ['child', 'parent', 'admin']) {
  configuredAccess(context.botToken, context.adminId);
  const session = getCookie(req.headers.cookie, 'epiapp_session');
  const { telegramId } = verifySessionToken(session, context.botToken);
  const user = await resolveAccessUser(telegramId, context);
  if (!user) throw new AuthError('Доступ к EpiApp отозван или не был выдан.', 403);
  if (!roles.includes(user.role)) throw new AuthError('Недостаточно прав для этого действия.', 403);
  return user;
}

function bearerToken(req) {
  const value = String(req.headers.authorization || '');
  const match = value.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new AuthError('Требуется ключ подключённого устройства.');
  return match[1].trim();
}

async function requireDevice(req, context) {
  configuredAccess(context.botToken, context.adminId);
  const device = await context.store.authenticateDevice(bearerToken(req));
  const user = await resolveAccessUser(device.telegramId, context);
  if (!user) throw new AuthError('Доступ владельца устройства отозван.', 403);
  return { device, user };
}

function pairingClientKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(req.headers['x-real-ip'] || '') || req.socket.remoteAddress || 'unknown';
}

function enforcePairingRateLimit(req, now = Date.now()) {
  const key = pairingClientKey(req);
  const windowMs = 10 * 60 * 1000;
  const maxAttempts = 8;
  const previous = pairingAttempts.get(key) || [];
  const recent = previous.filter((time) => now - time < windowMs);
  if (recent.length >= maxAttempts) throw new AuthError('Слишком много попыток подключения. Попробуйте позже.', 429);
  recent.push(now);
  pairingAttempts.set(key, recent);
  if (pairingAttempts.size > 1000) {
    for (const [entryKey, times] of pairingAttempts.entries()) {
      if (!times.some((time) => now - time < windowMs)) pairingAttempts.delete(entryKey);
    }
  }
}

async function notificationChatIds({ store, adminId }) {
  const users = await store.listAccessUsers();
  return [...new Set([
    String(adminId || ''),
    ...users.filter((user) => user.role === 'parent').map((user) => String(user.telegramId)),
  ].filter((id) => /^\d{1,20}$/.test(id)))];
}

function publicSettings(settings) {
  return {
    childName: settings.childName,
    morningTime: settings.morningTime,
    eveningTime: settings.eveningTime,
    timezone: settings.timezone,
    medicationName: settings.medicationName,
    morningDose: settings.morningDose,
    eveningDose: settings.eveningDose,
    remindersEnabled: settings.remindersEnabled,
    reminderFirstMinutes: settings.reminderFirstMinutes,
    reminderUrgentMinutes: settings.reminderUrgentMinutes,
    reminderRepeatMinutes: settings.reminderRepeatMinutes,
    reminderStopMinutes: settings.reminderStopMinutes,
  };
}

function nativeSchedule(settings) {
  return {
    childName: settings.childName,
    morningTime: settings.morningTime,
    eveningTime: settings.eveningTime,
    timezone: settings.timezone,
    remindersEnabled: settings.remindersEnabled,
    reminderFirstMinutes: settings.reminderFirstMinutes,
    reminderUrgentMinutes: settings.reminderUrgentMinutes,
    reminderRepeatMinutes: settings.reminderRepeatMinutes,
    reminderStopMinutes: settings.reminderStopMinutes,
  };
}

export function createServer(options = {}) {
  const context = {
    store: options.store || defaultStore,
    botToken: options.botToken ?? process.env.TELEGRAM_BOT_TOKEN ?? '',
    adminId: String(options.adminId ?? process.env.TELEGRAM_ADMIN_ID ?? '').trim(),
  };

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/healthz') {
        return json(res, 200, { ok: true });
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/telegram') {
        configuredAccess(context.botToken, context.adminId);
        const payload = await body(req);
        const telegram = validateTelegramInitData(payload.initData, context.botToken);
        const user = await resolveAccessUser(telegram.user.id, context);
        if (!user) throw new AuthError('Этот Telegram-аккаунт не приглашён в EpiApp.', 403);
        const session = createSessionToken(telegram.user.id, context.botToken);
        return json(res, 200, {
          user: {
            telegramId: telegram.user.id,
            role: user.role,
            firstName: telegram.user.firstName || user.firstName || '',
            username: telegram.user.username || user.username || '',
          },
        }, { 'set-cookie': buildSessionCookie(session) });
      }

      if (req.method === 'POST' && url.pathname === '/api/device/pair') {
        configuredAccess(context.botToken, context.adminId);
        enforcePairingRateLimit(req);
        const payload = await body(req);
        const paired = await context.store.pairDevice(payload.code, { deviceName: payload.deviceName });
        const user = await resolveAccessUser(paired.device.telegramId, context);
        if (!user) {
          await context.store.revokeDevice(paired.device.id);
          throw new AuthError('Доступ владельца к EpiApp уже отозван.', 403);
        }
        const session = createSessionToken(user.telegramId, context.botToken);
        const state = await context.store.read();
        return json(res, 201, {
          deviceToken: paired.deviceToken,
          device: paired.device,
          user,
          schedule: nativeSchedule(state.settings),
        }, { 'set-cookie': buildSessionCookie(session) });
      }

      if (req.method === 'POST' && url.pathname === '/api/device/session') {
        const { device, user } = await requireDevice(req, context);
        const session = createSessionToken(user.telegramId, context.botToken);
        const state = await context.store.read();
        return json(res, 200, {
          device,
          user,
          schedule: nativeSchedule(state.settings),
        }, { 'set-cookie': buildSessionCookie(session) });
      }

      if (req.method === 'GET' && url.pathname === '/api/device/schedule') {
        const { device, user } = await requireDevice(req, context);
        const state = await context.store.childState();
        return json(res, 200, {
          device,
          user,
          schedule: nativeSchedule(state.settings),
          today: state.today,
          todayDoses: state.todayDoses,
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/auth/me') {
        const user = await requireUser(req, context);
        return json(res, 200, { user });
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
        return json(res, 200, { ok: true }, { 'set-cookie': clearSessionCookie() });
      }

      if (req.method === 'GET' && url.pathname === '/api/state') {
        await requireUser(req, context);
        return json(res, 200, await context.store.childState());
      }

      if (req.method === 'POST' && url.pathname === '/api/take') {
        const child = await requireUser(req, context, ['child']);
        const payload = await body(req);
        const result = await context.store.takeDose(payload.slot, new Date(), child);
        const notification = await notifyDose({
          token: context.botToken,
          chatIds: await notificationChatIds(context),
          childName: result.settings.childName,
          slot: result.dose.slot,
          takenAt: result.dose.takenAt,
          timeZone: result.settings.timezone,
        });
        return json(res, 201, { dose: result.dose, notification });
      }

      if (req.method === 'GET' && url.pathname === '/api/parent/settings') {
        const user = await requireUser(req, context, ['parent', 'admin']);
        const state = await context.store.read();
        return json(res, 200, {
          settings: publicSettings(state.settings),
          recentChanges: await context.store.recentSettingsChanges(5),
          telegramConfigured: Boolean(context.botToken),
          role: user.role,
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/parent/settings') {
        const user = await requireUser(req, context, ['parent', 'admin']);
        const current = await context.store.read();
        const input = await body(req);
        const settings = await context.store.updateSettings({
          ...current.settings,
          childName: input.childName,
          morningTime: input.morningTime,
          eveningTime: input.eveningTime,
          timezone: input.timezone,
          medicationName: input.medicationName,
          morningDose: input.morningDose,
          eveningDose: input.eveningDose,
          remindersEnabled: input.remindersEnabled,
          reminderFirstMinutes: input.reminderFirstMinutes,
          reminderUrgentMinutes: input.reminderUrgentMinutes,
          reminderRepeatMinutes: input.reminderRepeatMinutes,
          reminderStopMinutes: input.reminderStopMinutes,
        }, user);
        return json(res, 200, {
          settings: publicSettings(settings),
          recentChanges: await context.store.recentSettingsChanges(5),
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/parent/stats') {
        await requireUser(req, context, ['parent', 'admin']);
        const days = Number(url.searchParams.get('days') || 7);
        return json(res, 200, { stats: await context.store.statistics(days) });
      }

      if (req.method === 'POST' && url.pathname === '/api/parent/telegram/test') {
        await requireUser(req, context, ['parent', 'admin']);
        if (!context.botToken) throw Object.assign(new Error('TELEGRAM_BOT_TOKEN не настроен.'), { statusCode: 503 });
        const state = await context.store.read();
        const chatIds = await notificationChatIds(context);
        const results = await Promise.allSettled(chatIds.map((chatId) => sendTelegramMessage({
          token: context.botToken,
          chatId,
          text: `✅ EpiApp подключён. Уведомления для ${state.settings.childName} работают.`,
        })));
        const failed = results.filter((result) => result.status === 'rejected');
        if (failed.length) throw Object.assign(new Error(`Не удалось отправить ${failed.length} из ${results.length} сообщений.`), { statusCode: 502 });
        return json(res, 200, { sent: results.length });
      }

      if ((req.method === 'GET' || req.method === 'HEAD') && !url.pathname.startsWith('/api/')) {
        if (await serveStatic(req, res, url.pathname)) return;
      }
      json(res, 404, { error: 'Не найдено.' });
    } catch (error) {
      const status = error?.statusCode || 500;
      if (status >= 500) console.error(error);
      json(res, status, { error: error?.message || 'Внутренняя ошибка сервера.' });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const server = createServer();
  server.listen(PORT, HOST, () => {
    console.log(`EpiApp: http://${HOST}:${PORT}`);
  });

  const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
  const adminId = String(process.env.TELEGRAM_ADMIN_ID || '').trim();
  const appUrl = process.env.APP_BASE_URL || 'https://epiapp.duckdns.org';
  if (botToken && adminId) {
    startTelegramBot({ token: botToken, store: defaultStore, adminId, appUrl })
      .then(({ username }) => console.log(`EpiApp Telegram bot: @${username}`))
      .catch((error) => console.error('Telegram bot failed to start:', error));
    startReminderScheduler({
      token: botToken,
      store: defaultStore,
      adminId,
      appUrl,
      logger: console,
    });
    console.log('EpiApp reminders: enabled scheduler (settings-controlled)');
  } else {
    console.warn('EpiApp Telegram access is disabled: configure TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_ID.');
  }
}
