import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { assertSlot, sanitizeSettings } from './validation.js';

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
      && ['morning', 'evening'].includes(entry.slot)
      && typeof entry.stageKey === 'string'
      && /^\d{1,20}$/.test(String(entry.chatId || ''))
      && typeof entry.sentAt === 'string')
    .slice(-1000);
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
      return {
        ...clone(DEFAULT_STATE),
        ...parsed,
        version: 5,
        settings: sanitizeSettings(parsed.settings ?? {}, DEFAULT_STATE.settings),
        doses: Array.isArray(parsed.doses) ? parsed.doses : [],
        audit: normalizeAudit(parsed.audit),
        reminderDeliveries: normalizeReminderDeliveries(parsed.reminderDeliveries),
        access: normalizeAccess(parsed.access),
      };
    } catch (error) {
      if (error?.code === 'ENOENT') return clone(DEFAULT_STATE);
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
        'remindersEnabled', 'reminderFirstMinutes', 'reminderUrgentMinutes', 'reminderRepeatMinutes', 'reminderStopMinutes',
      ];
      const changedFields = fields.filter((field) => previous[field] !== next[field]);
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
      const localDate = dateKey(now, state.settings.timezone);
      const duplicate = state.doses.find((dose) => dose.localDate === localDate && dose.slot === slot);
      if (duplicate) throw new DuplicateDoseError(slot, localDate);

      const dose = {
        id: randomUUID(),
        slot,
        localDate,
        takenAt: now.toISOString(),
        takenByTelegramId: String(actor?.telegramId || ''),
      };
      state.doses.push(dose);
      if (state.doses.length > 730) state.doses = state.doses.slice(-730);
      return { dose: clone(dose), settings: clone(state.settings) };
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
      },
      todayDoses,
      recentDoses: recent,
    };
  }

  async statistics(days = 7, now = new Date()) {
    const state = await this.read();
    const windowDays = Math.max(1, Math.min(90, Number(days) || 7));
    const today = dateKey(now, state.settings.timezone);
    const windowStart = addDaysKey(today, -(windowDays - 1));
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
    const rows = [];

    for (let key = periodStart; key <= today; key = addDaysKey(key, 1)) {
      const slotRows = {};
      for (const slot of ['morning', 'evening']) {
        const dose = doseMap.get(`${key}:${slot}`) || null;
        const scheduled = slot === 'morning' ? state.settings.morningTime : state.settings.eveningTime;
        const expected = key < today || Boolean(dose) || (key === today && currentTime >= scheduled);
        slotRows[slot] = {
          expected,
          taken: Boolean(dose),
          takenAt: dose?.takenAt || null,
          scheduled,
        };
      }
      const expected = Number(slotRows.morning.expected) + Number(slotRows.evening.expected);
      const taken = Number(slotRows.morning.taken && slotRows.morning.expected) + Number(slotRows.evening.taken && slotRows.evening.expected);
      rows.push({
        localDate: key,
        expected,
        taken,
        rate: expected ? Math.round((taken / expected) * 100) : null,
        complete: expected === 2 && taken === 2,
        slots: slotRows,
      });
    }

    const expected = rows.reduce((sum, row) => sum + row.expected, 0);
    const taken = rows.reduce((sum, row) => sum + row.taken, 0);
    const bySlot = Object.fromEntries(['morning', 'evening'].map((slot) => {
      const slotExpected = rows.filter((row) => row.slots[slot].expected).length;
      const slotTaken = rows.filter((row) => row.slots[slot].expected && row.slots[slot].taken).length;
      return [slot, {
        expected: slotExpected,
        taken: slotTaken,
        rate: slotExpected ? Math.round((slotTaken / slotExpected) * 100) : null,
      }];
    }));

    let currentStreak = 0;
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (row.localDate === today && row.expected < 2) continue;
      if (row.expected === 2 && row.taken === 2) currentStreak += 1;
      else if (row.expected > 0) break;
    }

    return {
      requestedDays: windowDays,
      periodStart,
      periodEnd: today,
      expected,
      taken,
      missed: Math.max(0, expected - taken),
      rate: expected ? Math.round((taken / expected) * 100) : null,
      completedDays: rows.filter((row) => row.complete).length,
      currentStreak,
      bySlot,
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

      const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
      state.access.deviceCodes.push({
        id: randomUUID(),
        codeHash,
        telegramId: normalized,
        createdAt: now.toISOString(),
        expiresAt,
        usedAt: null,
      });
      if (state.access.deviceCodes.length > 100) state.access.deviceCodes = state.access.deviceCodes.slice(-100);
      return { code, expiresAt };
    });
  }

  async pairDevice(code, { deviceName = 'Android', now = new Date() } = {}) {
    const normalizedCode = String(code || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(normalizedCode)) throw new DeviceAuthError('Код подключения должен содержать 6 цифр.', 400);
    const codeHash = secretHash(normalizedCode);

    return this.mutate(async (state) => {
      const entry = state.access.deviceCodes.find((item) => item.codeHash === codeHash);
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
