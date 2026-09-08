#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const offline = args.includes('--offline');
const dockerMode = args.includes('--docker') || process.env.EPIAPP_DEPLOYMENT === 'docker';
const envIndex = args.indexOf('--env');
const explicitEnv = envIndex >= 0 ? args[envIndex + 1] : null;

const candidates = [
  explicitEnv,
  process.env.EPIAPP_ENV_FILE,
  resolve('.env'),
  '/etc/epiapp/epiapp.env',
].filter(Boolean);

function parseEnv(text) {
  const result = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

async function loadEnv() {
  for (const path of candidates) {
    try {
      const text = await readFile(path, 'utf8');
      return { path, values: { ...parseEnv(text), ...process.env } };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return { path: null, values: { ...process.env } };
}

const results = [];
function pass(name, detail = '') { results.push({ level: 'PASS', name, detail }); }
function warn(name, detail = '') { results.push({ level: 'WARN', name, detail }); }
function fail(name, detail = '') { results.push({ level: 'FAIL', name, detail }); }

function validateOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== '/' && url.pathname !== '') return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function fetchJson(url, options = {}, timeoutMs = 8000) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  let payload = null;
  try { payload = await response.json(); } catch { /* ignore */ }
  return { response, payload };
}

const { path: envPath, values: env } = await loadEnv();
if (envPath) pass('Environment file', envPath);
else warn('Environment file', 'No .env or /etc/epiapp/epiapp.env found; using process environment only.');

const botToken = String(env.TELEGRAM_BOT_TOKEN || '').trim();
const adminId = String(env.TELEGRAM_ADMIN_ID || '').trim();
const appBaseUrl = String(env.APP_BASE_URL || '').trim();
const appDomain = String(env.APP_DOMAIN || '').trim();
const port = Number(env.PORT || 3000);
const dataFile = String(env.DATA_FILE || '').trim();

if (/^\d{6,15}:[A-Za-z0-9_-]{20,}$/.test(botToken)) pass('TELEGRAM_BOT_TOKEN', 'Configured (value hidden).');
else fail('TELEGRAM_BOT_TOKEN', 'Missing or does not look like a Telegram bot token.');

if (/^\d{1,20}$/.test(adminId)) pass('TELEGRAM_ADMIN_ID', adminId);
else fail('TELEGRAM_ADMIN_ID', 'Must contain only the numeric Telegram user ID.');

const origin = validateOrigin(appBaseUrl);
if (origin) pass('APP_BASE_URL', origin);
else fail('APP_BASE_URL', 'Must be a public HTTPS origin without a path, query or fragment.');

if (dockerMode) {
  if (!appDomain) {
    fail('APP_DOMAIN', 'Required for the bundled Docker Compose/Caddy deployment.');
  } else if (origin && new URL(origin).host === appDomain) {
    pass('APP_DOMAIN', appDomain);
  } else if (origin) {
    fail('APP_DOMAIN', `APP_DOMAIN=${appDomain} does not match ${new URL(origin).host}.`);
  }
} else if (appDomain) {
  if (origin && new URL(origin).host === appDomain) pass('APP_DOMAIN', `${appDomain} (optional outside Docker/Caddy).`);
  else if (origin) warn('APP_DOMAIN', `Optional value ${appDomain} does not match ${new URL(origin).host}.`);
}

if (Number.isInteger(port) && port > 0 && port <= 65535) pass('PORT', String(port));
else fail('PORT', 'Must be an integer from 1 to 65535.');

if (dataFile) {
  try {
    await access(dirname(dataFile), fsConstants.W_OK);
    pass('Data directory', `${dirname(dataFile)} is writable by the current user.`);
  } catch {
    warn('Data directory', `${dirname(dataFile)} is not writable by the current user (this can be normal outside the service/container user).`);
  }
} else {
  warn('DATA_FILE', 'Not set; application fallback will be used.');
}

if (!offline && origin) {
  try {
    const { response, payload } = await fetchJson(`${origin}/healthz`);
    if (response.ok && payload?.ok === true) pass('Public HTTPS healthcheck', `${origin}/healthz`);
    else fail('Public HTTPS healthcheck', `HTTP ${response.status}`);
  } catch (error) {
    fail('Public HTTPS healthcheck', error?.message || 'Request failed.');
  }
}

if (!offline && botToken) {
  try {
    const { response, payload } = await fetchJson(`https://api.telegram.org/bot${botToken}/getMe`);
    if (response.ok && payload?.ok && payload?.result?.username) pass('Telegram bot', `@${payload.result.username}`);
    else fail('Telegram bot', payload?.description || `HTTP ${response.status}`);
  } catch (error) {
    fail('Telegram bot', error?.message || 'Telegram request failed.');
  }
}

if (offline) warn('Network checks', 'Skipped because --offline was specified.');

for (const result of results) {
  const suffix = result.detail ? ` — ${result.detail}` : '';
  console.log(`[${result.level}] ${result.name}${suffix}`);
}

const failures = results.filter((result) => result.level === 'FAIL').length;
const warnings = results.filter((result) => result.level === 'WARN').length;
console.log(`\nEpiApp doctor: ${failures} failure(s), ${warnings} warning(s).`);
process.exitCode = failures ? 1 : 0;
