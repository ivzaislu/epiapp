import { createSign } from 'node:crypto';
import { parentNotificationFeed } from './reminders.js';

const OAUTH_URL = 'https://oauth2.googleapis.com/token';

export function createFcmSender(raw, { request = fetch, clock = () => Date.now() } = {}) {
  if (!raw) return null;
  let credentials;
  try { credentials = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { throw new Error('Некорректный FIREBASE_SERVICE_ACCOUNT_JSON.'); }
  const { project_id: project, client_email: email, private_key: key } = credentials;
  if (!/^[a-z0-9-]{4,64}$/.test(project || '') || !/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(email || '') || !String(key || '').includes('BEGIN PRIVATE KEY')) {
    throw new Error('В Firebase service account отсутствуют project_id, client_email или private_key.');
  }
  let accessToken = '';
  let expires = 0;
  let authorizing;
  async function authorize() {
    if (accessToken && expires > clock() + 60_000) return accessToken;
    if (!authorizing) authorizing = (async () => {
      const iat = Math.floor(clock() / 1000);
      const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: OAUTH_URL, iat, exp: iat + 3600 })}`;
      const signature = createSign('RSA-SHA256').update(unsigned).sign(key).toString('base64url');
      const response = await request(OAUTH_URL, {
        method: 'POST', body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
        signal: AbortSignal.timeout(10_000),
      });
      const result = await response.json();
      if (!response.ok || typeof result.access_token !== 'string') throw new Error('FCM OAuth authorization failed.');
      accessToken = result.access_token;
      expires = clock() + Math.min(3600, Number(result.expires_in) || 3600) * 1000;
      return accessToken;
    })().finally(() => { authorizing = null; });
    return authorizing;
  }
  return async ({ token, data }) => {
    const response = await request(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
      method: 'POST', headers: { authorization: `Bearer ${await authorize()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { token, data, android: { priority: 'HIGH', ttl: data.type === 'reminder' ? '300s' : '86400s' } } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      if (response.status === 401) { accessToken = ''; expires = 0; }
      const result = await response.json().catch(() => ({}));
      const error = new Error(`FCM delivery failed: HTTP ${response.status}.`);
      error.invalidToken = (result.error?.details || []).some((detail) => detail['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError' && detail.errorCode === 'UNREGISTERED');
      throw error;
    }
  };
}

export async function runPushCheck({ store, adminId, origin, send, now = new Date(), logger = console }) {
  if (!send) return { sent: 0, failed: 0 };
  const state = await store.read();
  const parents = new Set([String(adminId), ...state.access.users.filter((user) => user.role === 'parent').map((user) => String(user.telegramId))]);
  let sent = 0;
  let failed = 0;
  for (const device of state.access.devices) {
    if (device.revokedAt || !parents.has(String(device.telegramId)) || !device.push?.enabled || !device.push.token) continue;
    const feed = parentNotificationFeed(state, { now, since: new Date(device.push.since) });
    for (const event of feed.notifications) {
      if (!await store.claimDevicePush(device.id, device.push.token, event.id)) continue;
      // Check access again after taking the lease; revocation/opt-out must stop new sends.
      const current = await store.read();
      const target = current.access.devices.find((item) => item.id === device.id);
      const allowed = String(device.telegramId) === String(adminId) || current.access.users.some((user) => String(user.telegramId) === String(device.telegramId) && user.role === 'parent');
      if (!allowed || target?.revokedAt || !target?.push?.enabled || target.push.token !== device.push.token) {
        await store.completeDevicePush(device.id, device.push.token, event.id);
        continue;
      }
      if (event.type === 'reminder' && !parentNotificationFeed(current, { now }).notifications.some((item) => item.id === event.id)) {
        await store.completeDevicePush(device.id, device.push.token, event.id);
        continue;
      }
      try {
        const dose = event.type === 'taken' ? current.doses.find((item) => `taken:${item.id}` === event.id) : null;
        await send({ token: device.push.token, data: {
          id: event.id, tag: event.tag, type: event.type, at: event.at, title: event.title, body: event.body,
          deviceId: device.id, origin, revision: String(target.push.revision),
          resolvesTag: dose ? `reminder:${dose.localDate}:${dose.slot}` : '',
        } });
        await store.completeDevicePush(device.id, device.push.token, event.id, { sent: true });
        sent++;
      } catch (error) {
        await store.completeDevicePush(device.id, device.push.token, event.id, { invalid: error.invalidToken === true });
        failed++;
        logger.error?.('Android push delivery failed.');
        if (error.invalidToken) break;
      }
    }
  }
  return { sent, failed };
}

export function createPushDispatcher(options) {
  let running;
  const check = () => {
    if (!running) running = runPushCheck(options).finally(() => { running = null; });
    return running;
  };
  const timer = setInterval(() => { void check().catch(() => options.logger?.error?.('Push scheduler failed.')); }, 10_000);
  timer.unref?.();
  return { check, stop() { clearInterval(timer); } };
}
