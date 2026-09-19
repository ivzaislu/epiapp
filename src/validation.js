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

export function sanitizeOptionalText(value, fieldName, maxLength) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new ValidationError(`${fieldName} должно быть текстом.`);
  const clean = value.trim().replace(/\s+/g, ' ');
  if (clean.length > maxLength) {
    throw new ValidationError(`${fieldName} слишком длинное (максимум ${maxLength} символов).`);
  }
  return clean;
}

function sanitizeInteger(value, fieldName, min, max, fallback) {
  const candidate = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(candidate) || candidate < min || candidate > max) {
    throw new ValidationError(`${fieldName}: укажите целое число от ${min} до ${max}.`);
  }
  return candidate;
}

function sanitizeBoolean(value, fallback) {
  if (value === undefined || value === null) return Boolean(fallback);
  if (typeof value !== 'boolean') throw new ValidationError('Некорректная настройка напоминаний.');
  return value;
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
  const reminderFirstMinutes = sanitizeInteger(
    input.reminderFirstMinutes,
    'Первое напоминание',
    5,
    60,
    current.reminderFirstMinutes ?? 15,
  );
  const reminderUrgentMinutes = sanitizeInteger(
    input.reminderUrgentMinutes,
    'Срочное напоминание',
    10,
    120,
    current.reminderUrgentMinutes ?? 30,
  );
  const reminderRepeatMinutes = sanitizeInteger(
    input.reminderRepeatMinutes,
    'Повтор напоминаний',
    5,
    60,
    current.reminderRepeatMinutes ?? 15,
  );
  const reminderStopMinutes = sanitizeInteger(
    input.reminderStopMinutes,
    'Остановка повторов',
    15,
    240,
    current.reminderStopMinutes ?? 60,
  );

  if (reminderUrgentMinutes <= reminderFirstMinutes) {
    throw new ValidationError('Срочное напоминание должно быть позже первого напоминания.');
  }
  if (reminderStopMinutes < reminderUrgentMinutes) {
    throw new ValidationError('Остановка повторов должна быть не раньше срочного напоминания.');
  }

  return {
    childName: sanitizeName(input.childName ?? current.childName ?? 'Ребёнок'),
    morningTime: assertTime(input.morningTime ?? current.morningTime ?? '08:00', 'Утреннее время'),
    eveningTime: assertTime(input.eveningTime ?? current.eveningTime ?? '20:00', 'Вечернее время'),
    timezone: assertTimezone(input.timezone ?? current.timezone ?? 'Europe/Berlin'),
    medicationName: sanitizeOptionalText(input.medicationName ?? current.medicationName ?? '', 'Название препарата', 100),
    morningDose: sanitizeOptionalText(input.morningDose ?? current.morningDose ?? '', 'Утренняя доза', 80),
    eveningDose: sanitizeOptionalText(input.eveningDose ?? current.eveningDose ?? '', 'Вечерняя доза', 80),
    remindersEnabled: sanitizeBoolean(input.remindersEnabled, current.remindersEnabled ?? true),
    reminderFirstMinutes,
    reminderUrgentMinutes,
    reminderRepeatMinutes,
    reminderStopMinutes,
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
