import { createECDH, randomBytes } from 'node:crypto';
export function pushFixture(id = 'fixture') {
  const key = createECDH('prime256v1');
  key.generateKeys();
  return {
    privateKey: key,
    subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/fixture_endpoint_${id}_1234567890`,
      keys: { p256dh: key.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } },
  };
}
