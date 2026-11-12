// Tests may use local HTTP fixtures. Telegram is always a stub; other external calls are rejected.
const localFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]') return localFetch(input, options);
  if (url.hostname === 'api.telegram.org') return Promise.resolve(Response.json({ ok: true, result: { message_id: 1 } }));
  throw new Error('External network is disabled in tests; provide an explicit fixture.');
};
