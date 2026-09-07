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
    reminderFirstMinutes: 15,
    reminderUrgentMinutes: 30,
    reminderRepeatMinutes: 15,
    reminderStopMinutes: 60,
    telegramChatIds: ['123', '-456'],
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
