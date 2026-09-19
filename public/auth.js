export class AccessError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.name = 'AccessError';
    this.status = status;
  }
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

export async function getSession() {
  const response = await fetch('/api/auth/me', { cache: 'no-store' });
  const data = await readJson(response);
  if (!response.ok) throw new AccessError(data.error || 'Требуется вход через Telegram.', response.status);
  return data.user;
}

export async function ensureTelegramSession() {
  const telegram = window.Telegram?.WebApp;
  if (telegram) {
    telegram.ready();
    telegram.expand();
  }

  try {
    return await getSession();
  } catch (error) {
    if (error.status === 503) throw error;
  }

  const initData = telegram?.initData || '';
  if (!initData) {
    throw new AccessError('Откройте EpiApp из личного чата с Telegram-ботом. Прямой доступ по ссылке закрыт.', 401);
  }

  const response = await fetch('/api/auth/telegram', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ initData }),
  });
  const data = await readJson(response);
  if (!response.ok) throw new AccessError(data.error || 'Telegram-аккаунту не выдан доступ.', response.status);
  return data.user;
}

export function roleLabel(role) {
  if (role === 'admin') return 'Администратор';
  if (role === 'parent') return 'Родитель';
  if (role === 'child') return 'Ребёнок';
  return role || 'Пользователь';
}
