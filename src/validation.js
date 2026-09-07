export const SLOT_LABELS = {
  morning: 'утренний',
  evening: 'вечерний',
};

export function assertSlot(slot) {
  if (slot !== 'morning' && slot !== 'evening') {
    throw new ValidationError('Неизвестный приём лекарства.');
  }
  return slot;
}

export function assertTime(value, fieldName = 'Время') {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new ValidationError(`${fieldName} должно быть в формате HH:MM.`);
  }
  return value;
}

export function assertTimezone(value) {
  if (typeof value !== 'string' || value.length > 80) {
    throw new ValidationError('Некорректный часовой пояс.');
  }
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: value }).format(new Date());
  } catch {
    throw new ValidationError('Неизвестный часовой пояс. Используйте формат Europe/Berlin.');
  }
  return value;
}

export function sanitizeName(value) {
  if (typeof value !== 'string') throw new ValidationError('Имя обязательно.');
  const clean = value.trim().replace(/\s+/g, ' ');
  if (clean.length < 1 || clean.length > 50) {
    throw new ValidationError('Имя должно содержать от 1 до 50 символов.');
  }
  return clean;
}

export function sanitizeChatIds(value) {
  if (!Array.isArray(value)) throw new ValidationError('Список Telegram-чатов должен быть массивом.');
  const unique = [];
  for (const raw of value) {
    const id = String(raw).trim();
    if (!/^-?\d{1,20}$/.test(id)) {
      throw new ValidationError(`Некорректный Telegram chat ID: ${id}`);
    }
    if (!unique.includes(id)) unique.push(id);
  }
  if (unique.length > 10) throw new ValidationError('Можно подключить не больше 10 Telegram-чатов.');
  return unique;
}

export function sanitizeSettings(input, current = {}) {
  return {
    childName: sanitizeName(input.childName ?? current.childName ?? 'Ребёнок'),
    morningTime: assertTime(input.morningTime ?? current.morningTime ?? '08:00', 'Утреннее время'),
    eveningTime: assertTime(input.eveningTime ?? current.eveningTime ?? '20:00', 'Вечернее время'),
    timezone: assertTimezone(input.timezone ?? current.timezone ?? 'Europe/Berlin'),
    telegramChatIds: sanitizeChatIds(input.telegramChatIds ?? current.telegramChatIds ?? []),
  };
}

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}
