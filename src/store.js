import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { assertSlot, sanitizeSettings, schedulePlan, ValidationError } from './validation.js';

const DEFAULT_DOSE_RETENTION = 730;

const DEFAULT_STATE = {
  version: 5,
  settings: {
    childName: 'Ребёнок',
    morningTime: '08:00',
    eveningTime: '20:00',
    timezone: 'Europe/Berlin',
    medicationName: '',
    morningDose: '',
    eveningDose: '',
    remindersEnabled: true,
    reminderFirstMinutes: 15,
    reminderUrgentMinutes: 30,
    reminderRepeatMinutes: 15,
    reminderStopMinutes: 60,
    telegramChatIds: [],
  },
  doses: [],
  audit: [],
  reminderDeliveries: [],
  access: {
    users: [],
    invites: [],
    deviceCodes: [],
    devices: [],
  },
};

function clone(value) {
  return structuredClone(value);
}

function telegramId(value) {
  const id = String(value ?? '').trim();
  if (!/^\d{1,20}$/.test(id)) throw new Error('Некорректный Telegram ID.');
  return id;
}

function hasOtherParent(state, exceptId = '') {
  return state.access.users.some((user) => user.role === 'parent' && String(user.telegramId) !== String(exceptId || ''));
}

export function familyParents(users, adminId) {
  const list = Array.isArray(users) ? users : [];
  const personName = (user, fallback) => {
    const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
    return name || fallback;
  };
  const admin = list.find((user) => String(user.telegramId) === String(adminId || ''));
  const second = list.find((user) => user.role === 'parent' && String(user.telegramId) !== String(adminId || ''));
  return [
    { place: 1, title: 'Первый', name: personName(admin, 'Администратор'), connected: true },
    { place: 2, title: 'Второй', name: second ? personName(second, 'Родитель') : '', connected: Boolean(second) },
  ];
}

function accessRole(value) {
  if (value !== 'child' && value !== 'parent') throw new Error('Неизвестная роль доступа.');
  return value;
}

function secretHash(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function inviteHash(token) {
  return secretHash(token);
}

function normalizeAccess(parsed) {
  const users = Array.isArray(parsed?.users)
    ? parsed.users.filter((user) => user && /^\d{1,20}$/.test(String(user.telegramId)) && ['child', 'parent'].includes(user.role))
    : [];
  const invites = Array.isArray(parsed?.invites)
    ? parsed.invites.filter((invite) => invite && typeof invite.tokenHash === 'string' && ['child', 'parent'].includes(invite.role))
    : [];
  const deviceCodes = Array.isArray(parsed?.deviceCodes)
    ? parsed.deviceCodes.filter((entry) => entry
      && /^[a-f0-9]{64}$/i.test(String(entry.codeHash || ''))
      && /^\d{1,20}$/.test(String(entry.telegramId || ''))
      && typeof entry.expiresAt === 'string')
    : [];
  const devices = Array.isArray(parsed?.devices)
    ? parsed.devices.filter((entry) => entry
      && typeof entry.id === 'string'
      && /^[a-f0-9]{64}$/i.test(String(entry.tokenHash || ''))
      && /^\d{1,20}$/.test(String(entry.telegramId || ''))
      && typeof entry.createdAt === 'string')
    : [];
  return { users, invites, deviceCodes, devices };
}

function normalizeAudit(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && entry.type === 'settings_updated' && typeof entry.at === 'string')
    .slice(-200);
}

function normalizeReminderDeliveries(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry
      && /^\d{4}-\d{2}-\d{2}$/.test(String(entry.localDate || ''))
      && (['morning', 'evening'].includes(entry.slot) || /^(?:legacy|m[a-z0-9]{7})@(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(entry.slot || '')))
      && typeof entry.stageKey === 'string'
      && /^\d{1,20}$/.test(String(entry.chatId || ''))
      && typeof entry.sentAt === 'string')
    .slice(-1000);
}

export function createDefaultState() {
  return normalizeState({});
}

export function normalizeState(parsed = {}) {
  return {
    ...clone(DEFAULT_STATE),
    ...(parsed && typeof parsed === 'object' ? parsed : {}),
    version: 5,
    settings: sanitizeSettings(parsed?.settings ?? {}, DEFAULT_STATE.settings),
    doses: Array.isArray(parsed?.doses) ? parsed.doses : [],
    audit: normalizeAudit(parsed?.audit),
    reminderDeliveries: normalizeReminderDeliveries(parsed?.reminderDeliveries),
    access: normalizeAccess(parsed?.access),
  };
}

export function dateKey(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function addDaysKey(key, amount) {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount, 12));
  return date.toISOString().slice(0, 10);
}

function validDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function localTimeKey(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.hour}:${map.minute}`;
}

function sanitizeDeviceName(value) {
  const clean = String(value || 'Android').trim().replace(/\s+/g, ' ');
  return clean.slice(0, 80) || 'Android';
}

function publicDevice(device) {
  return {
    id: device.id,
    telegramId: String(device.telegramId),
    platform: device.platform,
    deviceName: device.deviceName,
    createdAt: device.createdAt,
    revokedAt: device.revokedAt || null,
  };
}

export class DuplicateDoseError extends Error {
  constructor(slot, localDate) {
    super(`Приём ${slot} уже отмечен за ${localDate}.`);
    this.name = 'DuplicateDoseError';
    this.statusCode = 409;
  }
}

export class InviteError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InviteError';
    this.statusCode = 400;
  }
}

export class DeviceAuthError extends Error {
  constructor(message, statusCode = 401) {
    super(message);
    this.name = 'DeviceAuthError';
    this.statusCode = statusCode;
  }
}

export class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.mutationQueue = Promise.resolve();
  }

  async read() {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return normalizeState(parsed);
    } catch (error) {
      if (error?.code === 'ENOENT') return createDefaultState();
      throw error;
    }
  }

  async write(state) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(tempPath, this.filePath);
  }

  mutate(operation) {
    const task = this.mutationQueue.then(async () => {
      const state = await this.read();
      const result = await operation(state);
      await this.write(state);
      return result;
    });
    this.mutationQueue = task.catch(() => undefined);
    return task;
  }

  async updateSettings(input, actor = null, now = new Date()) {
    return this.mutate(async (state) => {
      const previous = state.settings;
      const next = sanitizeSettings(input, previous);
      const fields = [
        'childName', 'morningTime', 'eveningTime', 'timezone', 'medicationName', 'morningDose', 'eveningDose',
        'remindersEnabled', 'telegramRemindersEnabled', 'reminderFirstMinutes', 'reminderUrgentMinutes', 'reminderRepeatMinutes', 'reminderStopMinutes',
        'accent',
      ];
      const changedFields = fields.filter((field) => previous[field] !== next[field]);
      if (JSON.stringify(previous.medications ?? null) !== JSON.stringify(next.medications ?? null)) {
        changedFields.push('medications');
      }
      state.settings = next;
      if (changedFields.length) {
        state.audit.push({
          id: randomUUID(),
          type: 'settings_updated',
          at: now.toISOString(),
          actorTelegramId: String(actor?.telegramId || ''),
          actorRole: String(actor?.role || ''),
          changedFields,
        });
        if (state.audit.length > 200) state.audit = state.audit.slice(-200);
      }
      return clone(state.settings);
    });
  }

  async recentSettingsChanges(limit = 5) {
    const state = await this.read();
    const safeLimit = Math.max(1, Math.min(20, Number(limit) || 5));
    return clone(state.audit.slice(-safeLimit).reverse());
  }

  async takeDose(slot, now = new Date(), actor = null) {
    assertSlot(slot);
    return this.mutate(async (state) => {
      const plan = schedulePlan(state.settings);
      const known = plan.some((item) => item.slot === slot);
      const resolved = known
        ? slot
        : (slot === 'evening' ? plan[Math.min(1, plan.length - 1)] : plan[0])?.slot;
      if (!resolved) throw new ValidationError('Схема приёма ещё не настроена.');
      const localDate = dateKey(now, state.settings.timezone);
      const duplicate = state.doses.find((dose) => dose.localDate === localDate && dose.slot === resolved);
      if (duplicate) throw new DuplicateDoseError(resolved, localDate);

      const dose = {
        id: randomUUID(),
        slot: resolved,
        localDate,
        takenAt: now.toISOString(),
        takenByTelegramId: String(actor?.telegramId || ''),
      };
      // Keep the history window already retained after an import.
      const retention = Math.max(DEFAULT_DOSE_RETENTION, state.doses.length);
      state.doses.push(dose);
      if (state.doses.length > retention) state.doses = state.doses.slice(-retention);
      return { dose: clone(dose), settings: clone(state.settings) };
    });
  }

  async importLegacyDoses(input) {
    if (!Array.isArray(input?.doses) || input.doses.length > DEFAULT_DOSE_RETENTION) {
      throw new ValidationError(`Ожидалась история из резервной копии EpiApp (до ${DEFAULT_DOSE_RETENTION} отметок).`);
    }
    const doses = input.doses.map((entry, index) => {
      const { id, slot, localDate, takenAt } = entry ?? {};
      const time = typeof takenAt === 'string' && new Date(takenAt);
      if (typeof id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)
        || (slot !== 'morning' && slot !== 'evening')
        || !validDateKey(localDate)
        || !time || !Number.isFinite(time.getTime()) || time.toISOString() !== takenAt) {
        throw new ValidationError(`Некорректная отметка в резервной копии (строка ${index + 1}).`);
      }
      return { id, slot, localDate, takenAt, takenByTelegramId: '' };
    });

    return this.mutate((state) => {
      const slots = new Set(schedulePlan(state.settings).map((item) => item.slot));
      const classic = slots.has('morning') && slots.has('evening');
      const mapping = classic ? { morning: 'morning', evening: 'evening' } : input.mapping;
      const ids = new Set(state.doses.map((dose) => dose.id));
      const pending = doses.filter((dose) => !ids.has(dose.id));
      const requiredSlots = new Set(pending.map((dose) => dose.slot));
      if ([...requiredSlots].some((slot) => !slots.has(mapping?.[slot]))
        || (requiredSlots.size === 2 && mapping.morning === mapping.evening)) {
        throw new ValidationError('Выберите разные приёмы из текущей схемы для старых утренних и вечерних отметок.');
      }

      const keys = new Set(state.doses.map((dose) => `${dose.localDate}:${dose.slot}`));
      let imported = 0;
      for (const dose of pending) {
        const slot = mapping[dose.slot];
        const key = `${dose.localDate}:${slot}`;
        if (ids.has(dose.id) || keys.has(key)) continue;
        state.doses.push({ ...dose, slot });
        ids.add(dose.id);
        keys.add(key);
        imported += 1;
      }
      if (imported) state.doses.sort((left, right) => left.takenAt.localeCompare(right.takenAt));
      return { imported, skipped: doses.length - imported };
    });
  }

  async childState(now = new Date()) {
    const state = await this.read();
    const today = dateKey(now, state.settings.timezone);
    const recent = state.doses
      .filter((dose) => dose.localDate >= dateKey(new Date(now.getTime() - 14 * 86400000), state.settings.timezone))
      .sort((a, b) => b.takenAt.localeCompare(a.takenAt));
    const todayDoses = Object.fromEntries(
      state.doses.filter((dose) => dose.localDate === today).map((dose) => [dose.slot, dose]),
    );
    return {
      today,
      settings: {
        childName: state.settings.childName,
        morningTime: state.settings.morningTime,
        eveningTime: state.settings.eveningTime,
        timezone: state.settings.timezone,
        medicationName: state.settings.medicationName,
        morningDose: state.settings.morningDose,
        eveningDose: state.settings.eveningDose,
        remindersEnabled: state.settings.remindersEnabled,
        reminderFirstMinutes: state.settings.reminderFirstMinutes,
        reminderUrgentMinutes: state.settings.reminderUrgentMinutes,
        reminderRepeatMinutes: state.settings.reminderRepeatMinutes,
        reminderStopMinutes: state.settings.reminderStopMinutes,
        medications: state.settings.medications,
        plan: schedulePlan(state.settings),
        accent: state.settings.accent,
      },
      todayDoses,
      recentDoses: recent,
    };
  }

  async statistics(days = 7, now = new Date(), through = null) {
    const state = await this.read();
    const windowDays = Math.max(1, Math.min(90, Number(days) || 7));
    const today = dateKey(now, state.settings.timezone);
    if (through !== null && (!validDateKey(through) || through > today)) {
      throw new ValidationError('Выберите дату окончания периода не позднее сегодняшней.');
    }
    const periodEnd = through ?? today;
    const windowStart = addDaysKey(periodEnd, -(windowDays - 1));
    const trackingCandidates = [
      ...state.doses.map((dose) => dose.localDate).filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(String(key))),
      ...state.audit.map((entry) => {
        const at = new Date(entry.at);
        return Number.isNaN(at.getTime()) ? null : dateKey(at, state.settings.timezone);
      }).filter(Boolean),
    ];
    const trackingStart = trackingCandidates.length ? trackingCandidates.sort()[0] : today;
    const periodStart = trackingStart > windowStart ? trackingStart : windowStart;
    const currentTime = localTimeKey(now, state.settings.timezone);
    const doseMap = new Map(state.doses.map((dose) => [`${dose.localDate}:${dose.slot}`, dose]));
    const plan = schedulePlan(state.settings);
    const rows = [];

    for (let key = periodStart; key <= periodEnd; key = addDaysKey(key, 1)) {
      const slotRows = {};
      for (const item of plan) {
        const dose = doseMap.get(`${key}:${item.slot}`) || null;
        const expected = key < today || Boolean(dose) || (key === today && currentTime >= item.time);
        slotRows[item.slot] = {
          expected,
          taken: Boolean(dose),
          takenAt: dose?.takenAt || null,
          scheduled: item.time,
          label: item.label,
        };
      }
      const expected = plan.reduce((sum, item) => sum + Number(slotRows[item.slot].expected), 0);
      const taken = plan.reduce((sum, item) => sum + Number(slotRows[item.slot].taken && slotRows[item.slot].expected), 0);
      rows.push({
        localDate: key,
        expected,
        taken,
        rate: expected ? Math.round((taken / expected) * 100) : null,
        complete: plan.length > 0 && expected === plan.length && taken === plan.length,
        slots: slotRows,
      });
    }

    const expected = rows.reduce((sum, row) => sum + row.expected, 0);
    const taken = rows.reduce((sum, row) => sum + row.taken, 0);
    const bySlot = Object.fromEntries(plan.map((item) => {
      const slotExpected = rows.filter((row) => row.slots[item.slot].expected).length;
      const slotTaken = rows.filter((row) => row.slots[item.slot].expected && row.slots[item.slot].taken).length;
      return [item.slot, {
        expected: slotExpected,
        taken: slotTaken,
        rate: slotExpected ? Math.round((slotTaken / slotExpected) * 100) : null,
      }];
    }));

    let currentStreak = 0;
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (row.localDate === today && row.expected < plan.length) continue;
      if (plan.length > 0 && row.expected === plan.length && row.taken === plan.length) currentStreak += 1;
      else if (row.expected > 0) break;
    }

    return {
      requestedDays: windowDays,
      periodStart,
      periodEnd,
      expected,
      taken,
      missed: Math.max(0, expected - taken),
      rate: expected ? Math.round((taken / expected) * 100) : null,
      completedDays: rows.filter((row) => row.complete).length,
      currentStreak,
      bySlot,
      plan,
      days: rows,
    };
  }

  async recordReminderDelivery({ localDate, slot, stageKey, chatId, sentAt = new Date() }) {
    assertSlot(slot);
    const normalizedChatId = telegramId(chatId);
    return this.mutate(async (state) => {
      const exists = state.reminderDeliveries.some((entry) => (
        entry.localDate === localDate
        && entry.slot === slot
        && entry.stageKey === stageKey
        && String(entry.chatId) === normalizedChatId
      ));
      if (exists) return false;

      const cutoff = sentAt.getTime() - 14 * 86400000;
      state.reminderDeliveries = state.reminderDeliveries.filter((entry) => {
        const time = Date.parse(entry.sentAt || '');
        return !Number.isFinite(time) || time >= cutoff;
      });
      state.reminderDeliveries.push({
        localDate,
        slot,
        stageKey: String(stageKey),
        chatId: normalizedChatId,
        sentAt: sentAt.toISOString(),
      });
      if (state.reminderDeliveries.length > 1000) state.reminderDeliveries = state.reminderDeliveries.slice(-1000);
      return true;
    });
  }

  async getAccessUser(id) {
    const normalized = telegramId(id);
    const state = await this.read();
    const user = state.access.users.find((entry) => String(entry.telegramId) === normalized);
    return user ? clone(user) : null;
  }

  async listAccessUsers() {
    const state = await this.read();
    return clone(state.access.users);
  }

  async createDevicePairCode(id, { now = new Date(), ttlMs = 5 * 60 * 1000 } = {}) {
    const normalized = telegramId(id);
    return this.mutate(async (state) => {
      const cutoff = now.getTime() - 24 * 60 * 60 * 1000;
      state.access.deviceCodes = state.access.deviceCodes.filter((entry) => {
        const expires = Date.parse(entry.expiresAt || '');
        const used = Date.parse(entry.usedAt || '');
        return (Number.isFinite(expires) && expires > now.getTime()) || (Number.isFinite(used) && used > cutoff);
      });

      let code = '';
      let codeHash = '';
      for (let attempt = 0; attempt < 20; attempt += 1) {
        code = String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, '0');
        codeHash = secretHash(code);
        if (!state.access.deviceCodes.some((entry) => entry.codeHash === codeHash && !entry.usedAt)) break;
      }
      if (!code) throw new Error('Не удалось создать код подключения устройства.');

      const linkToken = randomBytes(32).toString('base64url');
      const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
      state.access.deviceCodes.push({
        id: randomUUID(),
        codeHash,
        linkTokenHash: secretHash(linkToken),
        telegramId: normalized,
        createdAt: now.toISOString(),
        expiresAt,
        usedAt: null,
      });
      if (state.access.deviceCodes.length > 100) state.access.deviceCodes = state.access.deviceCodes.slice(-100);
      return { code, linkToken, expiresAt };
    });
  }

  async pairDevice(code, { deviceName = 'Android', now = new Date() } = {}) {
    const normalizedCode = String(code || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(normalizedCode) && !/^[A-Za-z0-9_-]{32,128}$/.test(normalizedCode)) {
      throw new DeviceAuthError('Некорректный код или токен подключения.', 400);
    }
    const codeHash = secretHash(normalizedCode);

    return this.mutate(async (state) => {
      const entry = state.access.deviceCodes.find((item) => item.codeHash === codeHash || item.linkTokenHash === codeHash);
      if (!entry || entry.usedAt) throw new DeviceAuthError('Код подключения недействителен или уже использован.', 401);
      if (Date.parse(entry.expiresAt || '') <= now.getTime()) throw new DeviceAuthError('Срок действия кода подключения истёк.', 401);

      const deviceToken = randomBytes(32).toString('base64url');
      const device = {
        id: randomUUID(),
        tokenHash: secretHash(deviceToken),
        telegramId: String(entry.telegramId),
        platform: 'android',
        deviceName: sanitizeDeviceName(deviceName),
        createdAt: now.toISOString(),
        revokedAt: null,
      };
      state.access.devices.push(device);
      if (state.access.devices.length > 50) state.access.devices = state.access.devices.slice(-50);
      entry.usedAt = now.toISOString();
      return { deviceToken, device: publicDevice(device) };
    });
  }

  async authenticateDevice(deviceToken) {
    const token = String(deviceToken || '');
    if (token.length < 32 || token.length > 256) throw new DeviceAuthError('Некорректный ключ устройства.');
    const hash = secretHash(token);
    const state = await this.read();
    const device = state.access.devices.find((entry) => entry.tokenHash === hash && !entry.revokedAt);
    if (!device) throw new DeviceAuthError('Устройство не подключено или его доступ отозван.');
    return publicDevice(device);
  }

  async registerDevicePush(deviceId, { token = '', enabled, revision, now = new Date() }) {
    if (typeof enabled !== 'boolean' || !Number.isSafeInteger(revision) || revision < 0) {
      throw new ValidationError('Некорректные настройки push.');
    }
    if (enabled && (typeof token !== 'string' || !/^[A-Za-z0-9_:.-]{20,4096}$/.test(token))) {
      throw new ValidationError('Некорректный push-токен.');
    }
    return this.mutate(async (state) => {
      const device = state.access.devices.find((item) => item.id === deviceId && !item.revokedAt);
      if (!device) throw new DeviceAuthError('Устройство не подключено.');
      if (revision < (device.push?.revision ?? -1)) return false;
      if (enabled) {
        for (const other of state.access.devices) {
          if (other.id !== deviceId && other.push?.token === token) other.push = { ...other.push, enabled: false, token: '' };
        }
      }
      device.push = {
        token: enabled ? token : '', enabled, revision,
        since: enabled && device.push?.enabled === false ? now.toISOString() : device.push?.since || now.toISOString(),
        deliveries: device.push?.deliveries || [],
      };
      return true;
    });
  }

  async claimDevicePush(deviceId, token, eventId, { now = new Date() } = {}) {
    return this.mutate(async (state) => {
      const device = state.access.devices.find((item) => item.id === deviceId && !item.revokedAt);
      if (!device?.push?.enabled || device.push.token !== token) return false;
      const deliveries = device.push.deliveries || [];
      const entry = deliveries.find((item) => item.id === eventId);
      if (entry?.sentAt || Date.parse(entry?.until || '') > now.getTime()) return false;
      device.push.deliveries = deliveries.filter((item) => item.id !== eventId && Date.parse(item.sentAt || item.until || '') >= now.getTime() - 48 * 3600_000).slice(-2047);
      device.push.deliveries.push({ id: eventId, until: new Date(now.getTime() + 60_000).toISOString() });
      return true;
    });
  }

  async completeDevicePush(deviceId, token, eventId, { sent = false, invalid = false, now = new Date() } = {}) {
    return this.mutate(async (state) => {
      const device = state.access.devices.find((item) => item.id === deviceId && !item.revokedAt);
      if (!device?.push || device.push.token !== token) return;
      if (invalid) { device.push.token = ''; device.push.enabled = false; }
      device.push.deliveries = (device.push.deliveries || []).filter((item) => item.id !== eventId);
      if (sent) device.push.deliveries.push({ id: eventId, sentAt: now.toISOString() });
    });
  }

  async listDevices() {
    const state = await this.read();
    return state.access.devices.map(publicDevice);
  }

  async revokeDevice(deviceId) {
    const id = String(deviceId || '');
    return this.mutate(async (state) => {
      const device = state.access.devices.find((entry) => entry.id === id && !entry.revokedAt);
      if (!device) return false;
      device.revokedAt = new Date().toISOString();
      return true;
    });
  }

  async createInvite(role, createdBy, { now = new Date(), ttlMs = 24 * 60 * 60 * 1000 } = {}) {
    const normalizedRole = accessRole(role);
    const creator = telegramId(createdBy);
    const token = randomBytes(24).toString('base64url');
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

    await this.mutate(async (state) => {
      if (normalizedRole === 'parent' && hasOtherParent(state)) {
        throw new InviteError('Второй родитель уже подключён. Новое приглашение не нужно.');
      }
      state.access.invites = state.access.invites.filter((invite) => {
        const expires = Date.parse(invite.expiresAt || '');
        return invite.usedAt || !Number.isFinite(expires) || expires > now.getTime() - 7 * 86400000;
      });
      state.access.invites.push({
        id: randomUUID(),
        tokenHash: inviteHash(token),
        role: normalizedRole,
        createdBy: creator,
        createdAt,
        expiresAt,
        usedAt: null,
        usedBy: null,
      });
      if (state.access.invites.length > 100) state.access.invites = state.access.invites.slice(-100);
    });

    return { token, role: normalizedRole, createdAt, expiresAt };
  }

  async acceptInvite(token, telegramUser, { now = new Date() } = {}) {
    if (typeof token !== 'string' || token.length < 16 || token.length > 128) {
      throw new InviteError('Некорректное приглашение.');
    }
    const id = telegramId(telegramUser?.id);
    const hash = inviteHash(token);

    return this.mutate(async (state) => {
      const invite = state.access.invites.find((entry) => entry.tokenHash === hash);
      if (!invite) throw new InviteError('Приглашение не найдено или уже недействительно.');
      if (invite.usedAt) throw new InviteError('Это приглашение уже использовано.');
      if (!invite.expiresAt || Date.parse(invite.expiresAt) <= now.getTime()) {
        throw new InviteError('Срок действия приглашения истёк.');
      }
      if (invite.role === 'parent' && hasOtherParent(state, id)) {
        throw new InviteError('Второй родитель уже подключён.');
      }

      const user = {
        telegramId: id,
        role: accessRole(invite.role),
        firstName: String(telegramUser?.firstName || '').slice(0, 80),
        lastName: String(telegramUser?.lastName || '').slice(0, 80),
        username: String(telegramUser?.username || '').slice(0, 80),
        addedAt: now.toISOString(),
        invitedBy: String(invite.createdBy),
      };
      const existingIndex = state.access.users.findIndex((entry) => String(entry.telegramId) === id);
      if (existingIndex >= 0) state.access.users[existingIndex] = user;
      else state.access.users.push(user);

      invite.usedAt = now.toISOString();
      invite.usedBy = id;
      return clone(user);
    });
  }

  async revokeAccessUser(id) {
    const normalized = telegramId(id);
    return this.mutate(async (state) => {
      const before = state.access.users.length;
      state.access.users = state.access.users.filter((entry) => String(entry.telegramId) !== normalized);
      if (before !== state.access.users.length) {
        const now = new Date().toISOString();
        for (const device of state.access.devices) {
          if (String(device.telegramId) === normalized && !device.revokedAt) device.revokedAt = now;
        }
      }
      return before !== state.access.users.length;
    });
  }
}
