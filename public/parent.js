import { ensureTelegramSession, roleLabel } from './auth.js';

const $ = (selector) => document.querySelector(selector);
let currentUser = null;
let settings = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

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

function formatAuditDate(value) {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: settings?.timezone || 'Europe/Berlin',
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function renderAudit(changes = []) {
  if (!changes.length) {
    $('#settingsAudit').textContent = 'История изменений начнёт записываться после первого сохранения.';
    return;
  }
  const latest = changes[0];
  const who = latest.actorTelegramId ? `${roleLabel(latest.actorRole)} · Telegram ID ${latest.actorTelegramId}` : 'система';
  $('#settingsAudit').textContent = `Последнее изменение: ${formatAuditDate(latest.at)} · ${who}`;
}

function fillSettings(data) {
  settings = data.settings;
  $('#childName').value = settings.childName;
  $('#medicationName').value = settings.medicationName || '';
  $('#morningDose').value = settings.morningDose || '';
  $('#eveningDose').value = settings.eveningDose || '';
  $('#morningTime').value = settings.morningTime;
  $('#eveningTime').value = settings.eveningTime;
  $('#timezone').value = settings.timezone;
  renderAudit(data.recentChanges || []);
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
    const doseText = slot === 'morning' ? state.settings.morningDose : state.settings.eveningDose;
    let value = 'Не отмечено';
    if (dose) value = new Intl.DateTimeFormat('ru-RU', { timeZone: state.settings.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(dose.takenAt));
    const meta = [state.settings.medicationName, doseText, `план ${time}`].filter(Boolean).join(' · ');
    return `<div class="history-row"><div><div class="history-main">${label}</div><div class="history-meta">${escapeHtml(meta)}</div></div><span class="status ${dose ? 'done' : ''}">${dose ? '✓ ' : ''}${escapeHtml(value)}</span></div>`;
  }).join('');
}

function percentage(value) {
  return value === null ? '—' : `${value}%`;
}

function slotDayText(slot) {
  if (!slot.expected) return 'ещё не время';
  if (!slot.taken) return 'нет отметки';
  return '✓ отмечено';
}

function renderStats(stats7, stats30) {
  $('#stats7Rate').textContent = percentage(stats7.rate);
  $('#stats7Detail').textContent = `${stats7.taken} из ${stats7.expected} · пропущено ${stats7.missed}`;
  $('#stats30Rate').textContent = percentage(stats30.rate);
  $('#stats30Detail').textContent = `${stats30.taken} из ${stats30.expected} · пропущено ${stats30.missed}`;
  $('#statsMorning').textContent = percentage(stats30.bySlot.morning.rate);
  $('#statsMorningDetail').textContent = `${stats30.bySlot.morning.taken} из ${stats30.bySlot.morning.expected}`;
  $('#statsEvening').textContent = percentage(stats30.bySlot.evening.rate);
  $('#statsEveningDetail').textContent = `${stats30.bySlot.evening.taken} из ${stats30.bySlot.evening.expected}`;
  $('#streakNotice').textContent = `Полных дней подряд: ${stats30.currentStreak}. Полностью отмеченных дней в периоде: ${stats30.completedDays}.`;

  const days = stats30.days.slice(-14).reverse();
  if (!days.length) {
    $('#statsHistory').innerHTML = '<div class="empty">Пока недостаточно данных.</div>';
    return;
  }
  $('#statsHistory').innerHTML = days.map((day) => `
    <div class="history-row stats-row">
      <div>
        <div class="history-main">${escapeHtml(day.localDate)}</div>
        <div class="history-meta">Утро: ${slotDayText(day.slots.morning)} · Вечер: ${slotDayText(day.slots.evening)}</div>
      </div>
      <span class="status ${day.complete ? 'done' : ''}">${day.taken}/${day.expected}</span>
    </div>`).join('');
}

async function loadStats() {
  const [week, month] = await Promise.all([
    api('/api/parent/stats?days=7'),
    api('/api/parent/stats?days=30'),
  ]);
  renderStats(week.stats, month.stats);
}

$('#settingsForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('/api/parent/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        childName: $('#childName').value,
        medicationName: $('#medicationName').value,
        morningDose: $('#morningDose').value,
        eveningDose: $('#eveningDose').value,
        morningTime: $('#morningTime').value,
        eveningTime: $('#eveningTime').value,
        timezone: $('#timezone').value,
      }),
    });
    settings = data.settings;
    renderAudit(data.recentChanges || []);
    toast('Таблетница и расписание сохранены.');
    await Promise.all([loadToday(), loadStats()]);
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
    await Promise.all([loadToday(), loadStats()]);
  } catch (error) {
    $('#accessMessage').textContent = error.message || 'Доступ закрыт.';
  }
}

void start();
