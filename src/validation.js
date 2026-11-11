import { randomBytes } from 'node:crypto';

export const SLOT_LABELS = {
  morning: 'утренний',
  evening: 'вечерний',
};

const MED_ID = /^(?:legacy|m[a-z0-9]{7})$/;
const CUSTOM_SLOT = /^(?:legacy|m[a-z0-9]{7})@(?:[01]\d|2[0-3]):[0-5]\d$/;

export function assertSlot(slot) {
  if (slot === 'morning' || slot === 'evening' || CUSTOM_SLOT.test(String(slot || ''))) return slot;
  throw new ValidationError('Неизвестный приём лекарства.');
}

export function schedulePlan(settings) {
  const medications = Array.isArray(settings?.medications) ? settings.medications : [];
  const classic = medications.length === 1 && medications[0]?.intakes?.length === 2;
  const several = medications.length > 1;
  const plan = [];
  medications.forEach((medication, medIndex) => {
    const name = medication.name || '';
    medication.intakes.forEach((intake, index) => {
      let slot = `${medication.id}@${intake.time}`;
      if (classic && index === 0) slot = 'morning';
      if (classic && index === 1) slot = 'evening';
      const short = name || `Препарат ${medIndex + 1}`;
      const label = several ? `${short} · ${intake.time}` : intake.time;
      plan.push({
        slot,
        time: intake.time,
        dose: intake.dose || '',
        medicationId: medication.id,
        medicationName: name,
        label,
        lane: intake.time,
      });
    });
  });
  const timeCount = {};
  plan.forEach((item) => { timeCount[item.time] = (timeCount[item.time] || 0) + 1; });
  plan.forEach((item) => {
    if (timeCount[item.time] > 1) {
      item.lane = (item.medicationName || 'препарат').slice(0, 8);
    }
  });
  return plan;
}

function newMedicationId() {
  return `m${randomBytes(4).toString('hex').slice(0, 7)}`;
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

function cleanMedication(raw, usedIds) {
  if (!raw || typeof raw !== 'object') throw new ValidationError('Некорректный препарат.');
  let id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!MED_ID.test(id) || usedIds.has(id)) id = newMedicationId();
  usedIds.add(id);
  const name = sanitizeOptionalText(raw.name ?? '', 'Название препарата', 100);
  if (!Array.isArray(raw.intakes) || raw.intakes.length < 1 || raw.intakes.length > 3) {
    throw new ValidationError('У препарата может быть от одного до трёх приёмов.');
  }
  const seen = new Set();
  const intakes = raw.intakes.map((intake, index) => {
    const time = assertTime(intake?.time, `Время приёма ${index + 1}`);
    if (seen.has(time)) throw new ValidationError('Время приёмов одного препарата не должно совпадать.');
    seen.add(time);
    return {
      time,
      dose: sanitizeOptionalText(intake?.dose ?? '', 'Доза', 80),
    };
  });
  return { id, name, intakes };
}

function medicationsFromLegacy(input, current) {
  return [{
    id: current.medications?.[0]?.id || 'legacy',
    name: sanitizeOptionalText(input.medicationName ?? current.medicationName ?? '', 'Название препарата', 100),
    intakes: [
      {
        time: assertTime(input.morningTime ?? current.morningTime ?? '08:00', 'Утреннее время'),
        dose: sanitizeOptionalText(input.morningDose ?? current.morningDose ?? '', 'Утренняя доза', 80),
      },
      {
        time: assertTime(input.eveningTime ?? current.eveningTime ?? '20:00', 'Вечернее время'),
        dose: sanitizeOptionalText(input.eveningDose ?? current.eveningDose ?? '', 'Вечерняя доза', 80),
      },
    ],
  }];
}

function sanitizeMedications(input, current) {
  if (Array.isArray(input.medications)) {
    if (input.medications.length < 1 || input.medications.length > 6) {
      throw new ValidationError('Можно добавить от одного до шести препаратов.');
    }
    const usedIds = new Set();
    return input.medications.map((medication) => cleanMedication(medication, usedIds));
  }
  const legacyKeys = ['medicationName', 'morningDose', 'eveningDose', 'morningTime', 'eveningTime'];
  const editsLegacy = legacyKeys.some((key) => input[key] != null && input[key] !== current[key]);
  if (Array.isArray(current.medications) && current.medications.length) {
    if (!editsLegacy) {
      const usedIds = new Set();
      return current.medications.map((medication) => cleanMedication(medication, usedIds));
    }
    if (current.medications.length !== 1 || current.medications[0].intakes.length !== 2) {
      throw new ValidationError('Для изменения этой схемы откройте текущий веб-кабинет.');
    }
    return [cleanMedication(medicationsFromLegacy(input, current)[0], new Set())];
  }
  return medicationsFromLegacy(input, current);
}

function mirrorSchedule(medications) {
  const plan = schedulePlan({ medications });
  const first = plan[0];
  const last = plan[plan.length - 1];
  const names = medications.map((medication) => medication.name).filter(Boolean);
  return {
    medicationName: names.join(', '),
    morningTime: first.time,
    eveningTime: last.time,
    morningDose: first.dose,
    eveningDose: last.dose,
  };
}

const ACCENTS = ['blue', 'sky', 'teal', 'indigo', 'navy'];

function sanitizeAccent(value) {
  return ACCENTS.includes(value) ? value : 'blue';
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

  const medications = sanitizeMedications(input, current);

  return {
    childName: sanitizeName(input.childName ?? current.childName ?? 'Ребёнок'),
    ...mirrorSchedule(medications),
    timezone: assertTimezone(input.timezone ?? current.timezone ?? 'Europe/Berlin'),
    medications,
    remindersEnabled: sanitizeBoolean(input.remindersEnabled, current.remindersEnabled ?? true),
    telegramRemindersEnabled: sanitizeBoolean(input.telegramRemindersEnabled, current.telegramRemindersEnabled ?? true),
    reminderFirstMinutes,
    reminderUrgentMinutes,
    reminderRepeatMinutes,
    reminderStopMinutes,
    telegramChatIds: sanitizeChatIds(input.telegramChatIds ?? current.telegramChatIds ?? []),
    accent: sanitizeAccent(input.accent ?? current.accent),
  };
}

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}
