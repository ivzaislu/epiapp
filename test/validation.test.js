import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSettings, ValidationError } from '../src/validation.js';

test('sanitizeSettings accepts a normal family configuration', () => {
  const value = sanitizeSettings({
    childName: '  Аня  ',
    morningTime: '08:15',
    eveningTime: '20:30',
    timezone: 'Europe/Berlin',
    medicationName: '  Препарат X  ',
    morningDose: '  1 таблетка ',
    eveningDose: ' 1/2 таблетки ',
    remindersEnabled: true,
    reminderFirstMinutes: 15,
    reminderUrgentMinutes: 30,
    reminderRepeatMinutes: 15,
    reminderStopMinutes: 60,
    telegramChatIds: ['123', '123', '-456'],
  });
  assert.deepEqual(value, {
    childName: 'Аня',
    morningTime: '08:15',
    eveningTime: '20:30',
    timezone: 'Europe/Berlin',
    medicationName: 'Препарат X',
    morningDose: '1 таблетка',
    eveningDose: '1/2 таблетки',
    remindersEnabled: true,
    telegramRemindersEnabled: true,
    reminderFirstMinutes: 15,
    reminderUrgentMinutes: 30,
    reminderRepeatMinutes: 15,
    reminderStopMinutes: 60,
    telegramChatIds: ['123', '-456'],
    accent: 'blue',
    medications: [{
      id: 'legacy',
      name: 'Препарат X',
      intakes: [
        { time: '08:15', dose: '1 таблетка' },
        { time: '20:30', dose: '1/2 таблетки' },
      ],
    }],
  });
});

test('sanitizeSettings rejects invalid time and timezone', () => {
  assert.throws(() => sanitizeSettings({ morningTime: '25:00' }), ValidationError);
  assert.throws(() => sanitizeSettings({ timezone: 'Mars/Olympus' }), ValidationError);
});

test('sanitizeSettings rejects overlong medication fields', () => {
  assert.throws(() => sanitizeSettings({ medicationName: 'x'.repeat(101) }), ValidationError);
  assert.throws(() => sanitizeSettings({ morningDose: 'x'.repeat(81) }), ValidationError);
});

test('sanitizeSettings validates reminder escalation order', () => {
  assert.throws(() => sanitizeSettings({ reminderFirstMinutes: 30, reminderUrgentMinutes: 20 }), ValidationError);
  assert.throws(() => sanitizeSettings({ reminderUrgentMinutes: 30, reminderStopMinutes: 20 }), ValidationError);
  assert.throws(() => sanitizeSettings({ reminderRepeatMinutes: 2 }), ValidationError);
});

test('sanitizeSettings rejects malformed Telegram chat ids', () => {
  assert.throws(() => sanitizeSettings({ telegramChatIds: ['@username'] }), ValidationError);
});

test('old settings payloads cannot replace a multi-intake plan', () => {
  const current = sanitizeSettings({
    medications: [{ id: 'm1234567', name: 'Example', intakes: [{ time: '08:00' }, { time: '12:00' }, { time: '20:00' }] }],
  });
  const updated = sanitizeSettings({ medicationName: current.medicationName, remindersEnabled: false }, current);
  assert.deepEqual(updated.medications, current.medications);
  assert.equal(updated.remindersEnabled, false);
  assert.throws(() => sanitizeSettings({ morningTime: '09:00' }, current), ValidationError);
});
