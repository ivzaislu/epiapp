import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSettings, ValidationError } from '../src/validation.js';

test('sanitizeSettings accepts a normal family configuration', () => {
  const value = sanitizeSettings({
    childName: '  Аня  ',
    morningTime: '08:15',
    eveningTime: '20:30',
    timezone: 'Europe/Berlin',
    telegramChatIds: ['123', '123', '-456'],
  });
  assert.deepEqual(value, {
    childName: 'Аня',
    morningTime: '08:15',
    eveningTime: '20:30',
    timezone: 'Europe/Berlin',
    telegramChatIds: ['123', '-456'],
  });
});

test('sanitizeSettings rejects invalid time and timezone', () => {
  assert.throws(() => sanitizeSettings({ morningTime: '25:00' }), ValidationError);
  assert.throws(() => sanitizeSettings({ timezone: 'Mars/Olympus' }), ValidationError);
});

test('sanitizeSettings rejects malformed Telegram chat ids', () => {
  assert.throws(() => sanitizeSettings({ telegramChatIds: ['@username'] }), ValidationError);
});
