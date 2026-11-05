import { ensureTelegramSession, roleLabel } from './auth.js';
import { childHistoryView } from './history.js?v=8';

const $ = (selector) => document.querySelector(selector);
const slotLabels = { morning: 'утренний', evening: 'вечерний' };
const androidTakenNotified = new Set();
let pendingSlot = null;
let state = null;
let currentUser = null;
let historyExpanded = false;

function toast(message, error = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3200);
}

function notifyAndroidTaken(slot) {
  if (androidTakenNotified.has(slot)) return;
  try {
    window.EpiAndroid?.doseTaken?.(slot);
    androidTakenNotified.add(slot);
  } catch {
    // Normal browser/Telegram Mini App has no Android bridge.
  }
}

function formatTakenAt(iso, timeZone) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;',
  })[char]);
}

function clock(iso, timeZone) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
}

function refreshAlarmLine() {
  const el = $('#alarmLine');
  const bridge = window.EpiAndroid;
  if (!el || !bridge || typeof bridge.alarmLine !== 'function') return;
  let text = '';
  try { text = String(bridge.alarmLine() || ''); } catch { text = ''; }
  el.textContent = text;
  el.classList.toggle('hidden', !text);
}

function render(next) {
  state = next;
  const childName = next.settings.childName || 'Сегодня';
  $('#greeting').textContent = childName;
  $('#todayLabel').textContent = currentUser?.role === 'child'
    ? `Расписание на ${next.today}`
    : `Просмотр на ${next.today}. Отметить может только ребёнок.`;
  const med = next.settings.medicationName || 'Препарат не указан';
  $('#medicationLine').textContent = med;
  $('#saveNote').textContent = currentUser?.role === 'child'
    ? 'Отметка появляется только после ответа сервера. Звук будильника сам по себе приём не записывает.'
    : 'Родитель видит статус и не подтверждает приём за ребёнка.';

  const canTake = currentUser?.role === 'child';
  $('#doseList').innerHTML = ['morning', 'evening'].map((slot) => {
    const dose = next.todayDoses[slot];
    const label = slot === 'morning' ? 'Утро' : 'Вечер';
    const time = next.settings[slot === 'morning' ? 'morningTime' : 'eveningTime'];
    const amount = next.settings[slot === 'morning' ? 'morningDose' : 'eveningDose'] || '';
    const status = dose ? `подтверждено в ${clock(dose.takenAt, next.settings.timezone)}` : 'ещё не отмечено';
    const button = canTake && !dose
      ? `<button class="primary take-button" data-slot="${slot}" type="button">Я принял</button>`
      : '';
    if (canTake && dose) notifyAndroidTaken(slot);
    return `<article class="dose-row${dose ? ' is-done' : ''}">
      <div class="dose-name">${label} · ${escapeHtml(time)}</div>
      <div class="dose-status">${escapeHtml(status)}</div>
      <div class="dose-meta">${escapeHtml(amount)}</div>
      ${button}
    </article>`;
  }).join('');

  refreshAlarmLine();
  renderHistory(next);
}

function renderHistory(next = state) {
  const history = $('#history');
  const toggle = $('#historyToggle');
  const meta = $('#historyMeta');
  const count = $('#historyCount');
  if (!next?.recentDoses?.length) {
    history.innerHTML = '<div class="empty">Пока нет отметок.</div>';
    toggle.classList.add('hidden');
    toggle.setAttribute('aria-expanded', 'false');
    meta.textContent = 'Пока нет отметок';
    count.textContent = '0';
    return;
  }

  const view = childHistoryView(next.recentDoses, historyExpanded);
  history.innerHTML = view.visible.map((dose) => `
    <div class="history-row">
      <div class="history-main">${slotLabels[dose.slot]} приём</div>
      <div class="history-meta">${formatTakenAt(dose.takenAt, next.settings.timezone)}</div>
    </div>`).join('');

  count.textContent = String(view.total);
  meta.textContent = view.metaLabel;
  toggle.classList.toggle('hidden', !view.canToggle);
  toggle.setAttribute('aria-expanded', String(view.expanded));
  toggle.textContent = view.buttonLabel;
}

async function loadState() {
  const response = await fetch('/api/state', { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Не удалось загрузить данные.');
  render(data);
}

function openConfirm(slot) {
  if (currentUser?.role !== 'child' || !state) return;
  pendingSlot = slot;
  $('#confirmTitle').textContent = slot === 'morning' ? 'Утреннее лекарство уже выпито?' : 'Вечернее лекарство уже выпито?';
  const dose = slot === 'morning' ? state.settings.morningDose : state.settings.eveningDose;
  const parts = [state.settings.medicationName, dose].filter(Boolean);
  $('#confirmDoseText').textContent = parts.length
    ? `${parts.join(' · ')}. Нажимай «Да» только после приёма.`
    : 'Нажимай «Да» только после приёма. Отметка сразу сохранится.';
  $('#confirmModal').classList.add('open');
  $('#confirmModal').setAttribute('aria-hidden', 'false');
}

function closeConfirm() {
  pendingSlot = null;
  $('#confirmModal').classList.remove('open');
  $('#confirmModal').setAttribute('aria-hidden', 'true');
}

document.querySelector('#doseList').addEventListener('click', (event) => {
  const button = event.target.closest('.take-button');
  if (button) openConfirm(button.dataset.slot);
});
document.querySelector('#alarmLine').addEventListener('click', () => {
  try { window.EpiAndroid?.openAlarmHelp?.(); } catch { /* browser */ }
});
window.epiRefreshAlarm = refreshAlarmLine;
$('#historyToggle').addEventListener('click', () => {
  historyExpanded = !historyExpanded;
  renderHistory();
});
$('#cancelConfirm').addEventListener('click', closeConfirm);
$('#confirmModal').addEventListener('click', (event) => { if (event.target.id === 'confirmModal') closeConfirm(); });
$('#acceptConfirm').addEventListener('click', async () => {
  if (!pendingSlot || currentUser?.role !== 'child') return;
  const slot = pendingSlot;
  if (new URLSearchParams(location.search).get('demo') === '1') {
    closeConfirm();
    toast('Это пример экрана, отметка не сохраняется.');
    return;
  }
  const button = $('#acceptConfirm');
  button.disabled = true;
  button.textContent = 'Сохраняю…';
  try {
    const response = await fetch('/api/take', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slot }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Не удалось сохранить отметку.');
    notifyAndroidTaken(slot);
    closeConfirm();
    await loadState();
    if (data.notification?.configured && data.notification.failed === 0) toast('Готово. Родителю отправлено уведомление.');
    else if (data.notification?.configured) toast('Отметка сохранена, но Telegram доставил не все уведомления.', true);
    else toast('Готово. Отметка сохранена.');
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = 'Да, отметить';
  }
});

async function start() {
  const demo = new URLSearchParams(location.search).get('demo') === '1';
  if (demo) {
    currentUser = { role: 'child', telegramId: '0', firstName: 'Демо' };
    $('#accessGate').classList.add('hidden');
    $('#appShell').classList.remove('hidden');
    render({
      today: '2026-11-05',
      settings: {
        childName: 'Маша',
        medicationName: 'Препарат по схеме родителей',
        morningTime: '08:00',
        eveningTime: '20:00',
        morningDose: '1 таблетка',
        eveningDose: '1 таблетка',
        timezone: 'Europe/Berlin',
      },
      todayDoses: {
        evening: { slot: 'evening', takenAt: '2026-11-04T19:12:00.000Z' },
      },
      recentDoses: [
        { id: '1', slot: 'evening', takenAt: '2026-11-04T19:12:00.000Z', localDate: '2026-11-04' },
        { id: '2', slot: 'morning', takenAt: '2026-11-04T07:05:00.000Z', localDate: '2026-11-04' },
      ],
    });
    return;
  }
  try {
    currentUser = await ensureTelegramSession();
    $('#signedInAs') && ($('#signedInAs').textContent = `${roleLabel(currentUser.role)} · Telegram ID ${currentUser.telegramId}`);
    $('#parentLink').classList.toggle('hidden', !['parent', 'admin'].includes(currentUser.role));
    $('#accessGate').classList.add('hidden');
    $('#appShell').classList.remove('hidden');
    await loadState();
    setInterval(() => loadState().catch(() => undefined), 30000);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js?v=8').catch(() => undefined);
  } catch (error) {
    $('#accessMessage').textContent = error.message || 'Доступ закрыт.';
  }
}

void start();
