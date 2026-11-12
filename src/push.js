import { parentNotificationFeed } from './reminders.js';

export async function runPushCheck({ store, adminId, origin, send, now = new Date(), logger = console }) {
  if (!send) return { sent: 0, failed: 0 };
  const state = await store.read();
  const parents = new Set([String(adminId), ...state.access.users.filter((user) => user.role === 'parent').map((user) => String(user.telegramId))]);
  let sent = 0;
  let failed = 0;
  for (const device of state.access.devices) {
    if (device.revokedAt || !parents.has(String(device.telegramId)) || !device.push?.enabled || !device.push.token || !device.push.subscription) continue;
    const feed = parentNotificationFeed(state, { now, since: new Date(device.push.since) });
    const test = device.push.test;
    if (test && Date.parse(test.at) <= now.getTime() && now.getTime() - Date.parse(test.at) <= 300000) {
      feed.notifications.push({ id: test.id, tag: test.id, type: 'taken', at: test.at, title: 'Тест фоновой доставки', body: 'Уведомление пришло через UnifiedPush/VAPID. Это тест, он не создаёт отметку о приёме.' });
    }
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
        await send({ subscription: device.push.subscription, data: {
          id: event.id, tag: event.tag, type: event.type, at: event.at, title: event.title, body: event.body,
          deviceId: device.id, origin: target.push.origin || origin, revision: String(target.push.revision),
          resolvesTag: dose ? `reminder:${dose.localDate}:${dose.slot}` : '',
        } });
        await store.completeDevicePush(device.id, device.push.token, event.id, { sent: true });
        sent++;
      } catch (error) {
        await store.completeDevicePush(device.id, device.push.token, event.id, { invalid: error.invalidSubscription === true });
        failed++;
        logger.error?.('Android push delivery failed.');
        if (error.invalidSubscription) break;
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
