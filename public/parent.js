import { ensureTelegramSession, roleLabel } from './auth.js';

const $ = (selector) => document.querySelector(selector);
let currentUser = null;
let settings = null;

function toast(message, error = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3200);
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function fillSettings(data) {
  settings = data.settings;
  $('#childName').value = settings.childName;
  $('#morningTime').value = settings.morningTime;
  $('#eveningTime').value = settings.eveningTime;
  $('#timezone').value = settings.timezone;
  const notice = $('#telegramNotice');
  notice.classList.toggle('good', data.telegramConfigured);
  notice.textContent = data.telegramConfigured
    ? 'Telegram-бот подключён. Получатели уведомлений определяются по ролям доступа.'
    : 'TELEGRAM_BOT_TOKEN не настроен. Telegram-доступ и уведомления не работают.';
}

async function loadToday() {
  const state = await api('/api/state');
  $('#todaySummary').innerHTML = ['morning', 'evening'].map((slot) => {
    const dose = state.todayDoses[slot];
    const label = slot === 'morning' ? 'Утро' : 'Вечер';
    const time = slot === 'morning' ? state.settings.morningTime : state.settings.eveningTime;
    let value = 'Не отмечено';
    if (dose) value = new Intl.DateTimeFormat('ru-RU', { timeZone: state.settings.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(dose.takenAt));
    return `<div class="history-row"><div><div class="history-main">${label}</div><div class="history-meta">План: ${time}</div></div><span class="status ${dose ? 'done' : ''}">${dose ? '✓ ' : ''}${value}</span></div>`;
  }).join('');
}

$('#settingsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('/api/parent/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        childName: $('#childName').value,
        morningTime: $('#morningTime').value,
        eveningTime: $('#eveningTime').value,
        timezone: $('#timezone').value,
      }),
    });
    settings = data.settings;
    toast('Настройки сохранены.');
    await loadToday();
  } catch (error) { toast(error.message, true); }
});

$('#testTelegram').addEventListener('click', async () => {
  try {
    const data = await api('/api/parent/telegram/test', { method: 'POST' });
    toast(`Тест отправлен: ${data.sent}.`);
  } catch (error) { toast(error.message, true); }
});

async function start() {
  try {
    currentUser = await ensureTelegramSession();
    if (!['parent', 'admin'].includes(currentUser.role)) {
      throw new Error('Этот раздел доступен только родителю или администратору.');
    }
    $('#signedInAs').textContent = `${roleLabel(currentUser.role)} · Telegram ID ${currentUser.telegramId}`;
    $('#adminHelp').classList.toggle('hidden', currentUser.role !== 'admin');
    const data = await api('/api/parent/settings');
    fillSettings(data);
    $('#accessGate').classList.add('hidden');
    $('#parentApp').classList.remove('hidden');
    await loadToday();
  } catch (error) {
    $('#accessMessage').textContent = error.message || 'Доступ закрыт.';
  }
}

void start();
