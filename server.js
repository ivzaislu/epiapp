import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { Store } from './src/store.js';
import { listRecentChats, notifyDose, sendTelegramMessage } from './src/telegram.js';
import { ValidationError } from './src/validation.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const DATA_FILE = process.env.DATA_FILE || join(ROOT, 'data', 'epiapp.json');
const PORT = Number(process.env.PORT || 3000);
const store = new Store(DATA_FILE);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
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

function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function requireParent(req) {
  const configuredPin = process.env.PARENT_PIN;
  if (!configuredPin) {
    const error = new Error('PARENT_PIN не настроен на сервере.');
    error.statusCode = 503;
    throw error;
  }
  if (!safeEqual(req.headers['x-parent-pin'], configuredPin)) {
    const error = new Error('Неверный PIN родителя.');
    error.statusCode = 401;
    throw error;
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
    const bytes = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath)] || 'application/octet-stream',
      'cache-control': extname(filePath) === '.html' ? 'no-store' : 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    res.end(bytes);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/healthz') {
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        return json(res, 200, await store.childState());
      }
      if (req.method === 'POST' && url.pathname === '/api/take') {
        const payload = await body(req);
        const result = await store.takeDose(payload.slot);
        const notification = await notifyDose({
          token: process.env.TELEGRAM_BOT_TOKEN,
          chatIds: result.settings.telegramChatIds,
          childName: result.settings.childName,
          slot: result.dose.slot,
          takenAt: result.dose.takenAt,
          timeZone: result.settings.timezone,
        });
        return json(res, 201, { dose: result.dose, notification });
      }
      if (req.method === 'GET' && url.pathname === '/api/parent/settings') {
        requireParent(req);
        const state = await store.read();
        return json(res, 200, {
          settings: state.settings,
          telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
        });
      }
      if (req.method === 'POST' && url.pathname === '/api/parent/settings') {
        requireParent(req);
        return json(res, 200, { settings: await store.updateSettings(await body(req)) });
      }
      if (req.method === 'GET' && url.pathname === '/api/parent/telegram/chats') {
        requireParent(req);
        return json(res, 200, { chats: await listRecentChats(process.env.TELEGRAM_BOT_TOKEN) });
      }
      if (req.method === 'POST' && url.pathname === '/api/parent/telegram/test') {
        requireParent(req);
        const state = await store.read();
        const chatIds = state.settings.telegramChatIds;
        if (!process.env.TELEGRAM_BOT_TOKEN) throw Object.assign(new Error('TELEGRAM_BOT_TOKEN не настроен.'), { statusCode: 503 });
        if (chatIds.length === 0) throw new ValidationError('Сначала подключите хотя бы один Telegram-чат.');
        const results = await Promise.allSettled(chatIds.map((chatId) => sendTelegramMessage({
          token: process.env.TELEGRAM_BOT_TOKEN,
          chatId,
          text: `✅ EpiApp подключён. Уведомления для ${state.settings.childName} работают.`,
        })));
        const failed = results.filter((result) => result.status === 'rejected');
        if (failed.length) throw Object.assign(new Error(`Не удалось отправить ${failed.length} из ${results.length} сообщений.`), { statusCode: 502 });
        return json(res, 200, { sent: results.length });
      }
      if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
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
  createServer().listen(PORT, () => {
    console.log(`EpiApp: http://localhost:${PORT}`);
  });
}
