import { createHmac, timingSafeEqual } from 'node:crypto';

export class AuthError extends Error {
  constructor(message, statusCode = 401) {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
  }
}

function safeEqualBuffers(left, right) {
  if (!Buffer.isBuffer(left)) left = Buffer.from(left);
  if (!Buffer.isBuffer(right)) right = Buffer.from(right);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function validateTelegramInitData(initData, botToken, {
  now = Date.now(),
  maxAgeSeconds = 3600,
} = {}) {
  if (!botToken) throw new AuthError('TELEGRAM_BOT_TOKEN не настроен.', 503);
  if (typeof initData !== 'string' || initData.length < 1 || initData.length > 16_384) {
    throw new AuthError('Некорректные данные Telegram.');
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) {
    throw new AuthError('Telegram-подпись отсутствует или повреждена.');
  }
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expectedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (!safeEqualBuffers(Buffer.from(receivedHash, 'hex'), Buffer.from(expectedHash, 'hex'))) {
    throw new AuthError('Не удалось подтвердить подпись Telegram.');
  }

  const authDate = Number(params.get('auth_date'));
  const nowSeconds = Math.floor(now / 1000);
  if (!Number.isInteger(authDate) || authDate <= 0) {
    throw new AuthError('Telegram не передал время авторизации.');
  }
  if (authDate > nowSeconds + 30 || nowSeconds - authDate > maxAgeSeconds) {
    throw new AuthError('Авторизация Telegram устарела. Откройте приложение заново через бота.');
  }

  let user;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch {
    throw new AuthError('Некорректные данные пользователя Telegram.');
  }
  if (!user || !/^\d{1,20}$/.test(String(user.id))) {
    throw new AuthError('Telegram не передал пользователя.');
  }

  return {
    user: {
      id: String(user.id),
      firstName: typeof user.first_name === 'string' ? user.first_name : '',
      lastName: typeof user.last_name === 'string' ? user.last_name : '',
      username: typeof user.username === 'string' ? user.username : '',
      languageCode: typeof user.language_code === 'string' ? user.language_code : '',
    },
    authDate,
    queryId: params.get('query_id') || '',
    startParam: params.get('start_param') || '',
  };
}

function sessionSecret(botToken) {
  if (!botToken) throw new AuthError('TELEGRAM_BOT_TOKEN не настроен.', 503);
  return createHmac('sha256', 'EpiAppSessionV1').update(botToken).digest();
}

export function createSessionToken(telegramId, botToken, {
  now = Date.now(),
  ttlSeconds = 30 * 24 * 60 * 60,
} = {}) {
  const nowSeconds = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({
    sub: String(telegramId),
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
  })).toString('base64url');
  const signature = createHmac('sha256', sessionSecret(botToken)).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifySessionToken(sessionToken, botToken, { now = Date.now() } = {}) {
  if (typeof sessionToken !== 'string') throw new AuthError('Требуется вход через Telegram.');
  const [payload, signature, extra] = sessionToken.split('.');
  if (!payload || !signature || extra !== undefined) throw new AuthError('Некорректная сессия.');

  const expected = createHmac('sha256', sessionSecret(botToken)).update(payload).digest('base64url');
  if (!safeEqualBuffers(Buffer.from(signature), Buffer.from(expected))) {
    throw new AuthError('Сессия повреждена.');
  }

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new AuthError('Некорректная сессия.');
  }
  const nowSeconds = Math.floor(now / 1000);
  if (!parsed || !/^\d{1,20}$/.test(String(parsed.sub)) || !Number.isInteger(parsed.exp) || parsed.exp <= nowSeconds) {
    throw new AuthError('Сессия истекла. Откройте приложение заново через Telegram.');
  }
  return { telegramId: String(parsed.sub), expiresAt: parsed.exp };
}

export function getCookie(cookieHeader, name) {
  if (!cookieHeader || typeof cookieHeader !== 'string') return '';
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return '';
}

export function buildSessionCookie(value, { maxAgeSeconds = 30 * 24 * 60 * 60 } = {}) {
  return `epiapp_session=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie() {
  return 'epiapp_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
}
