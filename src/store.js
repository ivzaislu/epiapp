import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { assertSlot, sanitizeSettings } from './validation.js';

const DEFAULT_STATE = {
  version: 2,
  settings: {
    childName: 'Ребёнок',
    morningTime: '08:00',
    eveningTime: '20:00',
    timezone: 'Europe/Berlin',
    telegramChatIds: [],
  },
  doses: [],
  access: {
    users: [],
    invites: [],
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

function inviteHash(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

function normalizeAccess(parsed) {
  const users = Array.isArray(parsed?.users)
    ? parsed.users.filter((user) => user && /^\d{1,20}$/.test(String(user.telegramId)) && ['child', 'parent'].includes(user.role))
    : [];
  const invites = Array.isArray(parsed?.invites)
    ? parsed.invites.filter((invite) => invite && typeof invite.tokenHash === 'string' && ['child', 'parent'].includes(invite.role))
    : [];
  return { users, invites };
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
        version: 2,
        settings: sanitizeSettings(parsed.settings ?? {}, DEFAULT_STATE.settings),
        doses: Array.isArray(parsed.doses) ? parsed.doses : [],
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

  async updateSettings(input) {
    return this.mutate(async (state) => {
      state.settings = sanitizeSettings(input, state.settings);
      return clone(state.settings);
    });
  }

  async takeDose(slot, now = new Date()) {
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
      },
      todayDoses,
      recentDoses: recent,
    };
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
      return before !== state.access.users.length;
    });
  }
}
