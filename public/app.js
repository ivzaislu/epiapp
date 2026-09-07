import { ensureTelegramSession, roleLabel } from './auth.js';

const $ = (selector) => document.querySelector(selector);
const slotLabels = { morning: 'утренний', evening: 'вечерний' };
let pendingSlot = null;
let state = null;
let currentUser = null;

function toast(message, error = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3200);
}

function formatTakenAt(iso, timeZone) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
}

function render(next) {
  state = next;
  $('#greeting').textContent = currentUser?.role === 'child'
    ? `${next.settings.childName}, сегодня всё просто.`
    : `${next.settings.childName}: отметки сегодня`;
  $('#todayLabel').textContent = currentUser?.role === 'child'
    ? 'Отмечай лекарство только после того, как выпил(а) его.'
    : 'Просмотр статуса приёма. Отметку делает только аккаунт ребёнка.';
  $('#morningTime').textContent = next.settings.morningTime;
  $('#eveningTime').textContent = next.settings.eveningTime;

  const canTake = currentUser?.role === 'child';
  for (const slot of ['morning', 'evening']) {
    const dose = next.todayDoses[slot];
    const status = $(`#${slot}Status`);
    const button = document.querySelector(`.take-button[data-slot="${slot}"]`);
    status.textContent = dose ? `✓ ${formatTakenAt(dose.takenAt, next.settings.timezone).split(', ').at(-1)}` : 'Не отмечено';
    status.classList.toggle('done', Boolean(dose));
    button.classList.toggle('hidden', !canTake);
    button.disabled = Boolean(dose) || !canTake;
    button.textContent = dose ? 'Уже отмечено' : 'Я выпил(а) лекарство';
  }

  const history = $('#history');
  if (!next.recentDoses.length) {
    history.innerHTML = '<div class="empty">Пока нет отметок.</div>';
    return;
  }
  history.innerHTML = next.recentDoses.slice(0, 12).map((dose) => `
    <div class="history-row">
      <div><div class="history-main">${slotLabels[dose.slot]} приём</div><div class="history-meta">${formatTakenAt(dose.takenAt, next.settings.timezone)}</div></div>
      <span class="status done">✓ Выпито</span>
    </div>`).join('');
}

async function loadState() {
  const response = await fetch('/api/state', { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Не удалось загрузить данные.');
  render(data);
}

function openConfirm(slot) {
  if (currentUser?.role !== 'child') return;
  pendingSlot = slot;
  $('#confirmTitle').textContent = slot === 'morning' ? 'Утреннее лекарство уже выпито?' : 'Вечернее лекарство уже выпито?';
  $('#confirmModal').classList.add('open');
  $('#confirmModal').setAttribute('aria-hidden', 'false');
}

function closeConfirm() {
  pendingSlot = null;
  $('#confirmModal').classList.remove('open');
  $('#confirmModal').setAttribute('aria-hidden', 'true');
}

document.querySelectorAll('.take-button').forEach((button) => button.addEventListener('click', () => openConfirm(button.dataset.slot)));
$('#cancelConfirm').addEventListener('click', closeConfirm);
$('#confirmModal').addEventListener('click', (event) => { if (event.target.id === 'confirmModal') closeConfirm(); });
$('#acceptConfirm').addEventListener('click', async () => {
  if (!pendingSlot || currentUser?.role !== 'child') return;
  const slot = pendingSlot;
  const button = $('#acceptConfirm');
  button.disabled = true;
  button.textContent = 'Сохраняю…';
  try {
    const response = await fetch('/api/take', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slot }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Не удалось сохранить отметку.');
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
  try {
    currentUser = await ensureTelegramSession();
    $('#signedInAs').textContent = `${roleLabel(currentUser.role)} · Telegram ID ${currentUser.telegramId}`;
    $('#parentLink').classList.toggle('hidden', !['parent', 'admin'].includes(currentUser.role));
    $('#accessGate').classList.add('hidden');
    $('#appShell').classList.remove('hidden');
    await loadState();
    setInterval(() => loadState().catch(() => undefined), 30000);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  } catch (error) {
    $('#accessMessage').textContent = error.message || 'Доступ закрыт.';
  }
}

void start();
