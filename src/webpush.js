import { createECDH } from 'node:crypto';
import webpush from 'web-push';
import { ValidationError } from './validation.js';

export function validateSubscription(value) {
  if (!value || typeof value !== 'object') throw new ValidationError('Отсутствует Web Push подписка.');
  let url;
  try { url = new URL(value.endpoint); } catch { throw new ValidationError('Некорректный push endpoint.'); }
  // This experiment supports the embedded Google distributor only. Never turn a submitted URL into SSRF.
  if (url.protocol !== 'https:' || url.hostname !== 'fcm.googleapis.com' || url.port || url.username || url.password
    || url.search || url.hash || !/^\/(?:fcm\/send|wp)\/[A-Za-z0-9_:.-]{20,4096}$/.test(url.pathname)) {
    throw new ValidationError('Эксперимент поддерживает только Google Web Push endpoints.');
  }
  const { p256dh, auth } = value.keys || {};
  if (typeof p256dh !== 'string' || !/^[A-Za-z0-9_-]{87}$/.test(p256dh)
    || typeof auth !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(auth)) throw new ValidationError('Некорректные ключи Web Push.');
  try {
    const point = Buffer.from(p256dh, 'base64url');
    if (point.length !== 65 || point[0] !== 4 || Buffer.from(auth, 'base64url').length !== 16) throw new Error();
    createECDH('prime256v1').setPublicKey(point);
  } catch { throw new ValidationError('Некорректный публичный ключ подписки.'); }
  return { endpoint: url.href, keys: { p256dh, auth } };
}

export function generateWebPushKeys() { return webpush.generateVAPIDKeys(); }

export function createWebPushSender({ store, subject, sendNotification = webpush.sendNotification }) {
  const parsed = new URL(subject);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Web Push requires a public HTTPS APP_BASE_URL.');
  return async ({ subscription, data }) => {
    const target = validateSubscription(subscription);
    const keys = await store.ensureWebPushKeys();
    try {
      await sendNotification(target, JSON.stringify(data), {
        vapidDetails: { subject: parsed.origin, ...keys }, contentEncoding: 'aes128gcm',
        TTL: data.type === 'reminder' ? 300 : 86400, urgency: 'high', timeout: 10000,
      });
    } catch (error) {
      const failure = new Error('Web Push delivery failed.');
      failure.invalidSubscription = error.statusCode === 404 || error.statusCode === 410;
      throw failure;
    }
  };
}
