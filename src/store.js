import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertSlot, sanitizeSettings } from './validation.js';

const DEFAULT_STATE = {
  version: 1,
  settings: {
    childName: 'Ребёнок',
    morningTime: '08:00',
    eveningTime: '20:00',
    timezone: 'Europe/Berlin',
    telegramChatIds: [],
  },
  doses: [],
};

function clone(value) {
  return structuredClone(value);
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
        settings: sanitizeSettings(parsed.settings ?? {}, DEFAULT_STATE.settings),
        doses: Array.isArray(parsed.doses) ? parsed.doses : [],
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
}
