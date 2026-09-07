const $ = (selector) => document.querySelector(selector);
let pin = sessionStorage.getItem('epiapp_parent_pin') || '';
let settings = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>\"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;',
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
  const response = await fetch(path, {
    ...options,
    cache: 'no-store',
    headers: { ...(options.headers || {}), 'x-parent-pin': pin },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function parseChatIds() {
  return $('#chatIds').value.split(',').map((value) => value.trim()).filter(Boolean);
}

function fillSettings(data) {
  settings = data.settings;
  $('#childName').value = settings.childName;
  $('#morningTime').value = settings.morningTime;
  $('#eveningTime').value = settings.eveningTime;
  $('#timezone').value = settings.timezone;
  $('#chatIds').value = settings.telegramChatIds.join(', ');
  const notice = $('#telegramNotice');
  notice.classList.toggle('good', data.telegramConfigured);
  notice.textContent = data.telegramConfigured
    ? 'Telegram-бот настроен на сервере.'
    : 'TELEGRAM_BOT_TOKEN не настроен. Отметки будут сохраняться, но сообщения не отправятся.';
}

async function loadToday() {
  const state = await fetch('/api/state', { cache: 'no-store' }).then((r) => r.json());
  $('#todaySummary').innerHTML = ['morning', 'evening'].map((slot) => {
    const dose = state.todayDoses[slot];
    const label = slot === 'morning' ? 'Утро' : 'Вечер';
    const time = slot === 'morning' ? state.settings.morningTime : state.settings.eveningTime;
    let value = 'Не отмечено';
    if (dose) value = new Intl.DateTimeFormat('ru-RU', { timeZone: state.settings.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(dose.takenAt));
    return `<div class="history-row"><div><div class="history-main">${label}</div><div class="history-meta">План: ${time}</div></div><span class="status ${dose ? 'done' : ''}">${dose ? '✓ ' : ''}${value}</span></div>`;
  }).join('');
}

async function unlock() {
  const data = await api('/api/parent/settings');
  sessionStorage.setItem('epiapp_parent_pin', pin);
  fillSettings(data);
  $('#pinGate').classList.add('hidden');
  $('#parentApp').classList.remove('hidden');
  await loadToday();
}

$('#pinForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  pin = $('#parentPin').value;
  try { await unlock(); } catch (error) { toast(error.message, true); }
});

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
        telegramChatIds: parseChatIds(),
      }),
    });
    settings = data.settings;
    toast('Настройки сохранены.');
    await loadToday();
  } catch (error) { toast(error.message, true); }
});

$('#saveTelegram').addEventListener('click', async () => {
  if (!settings) return;
  try {
    const data = await api('/api/parent/settings', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...settings, telegramChatIds: parseChatIds() }),
    });
    settings = data.settings;
    $('#chatIds').value = settings.telegramChatIds.join(', ');
    toast('Telegram-чаты сохранены.');
  } catch (error) { toast(error.message, true); }
});

$('#findChats').addEventListener('click', async () => {
  $('#chatList').innerHTML = '<div class="empty">Ищу…</div>';
  try {
    const data = await api('/api/parent/telegram/chats');
    if (!data.chats.length) {
      $('#chatList').innerHTML = '<div class="empty">Чатов не найдено. Напишите боту в Telegram и попробуйте ещё раз.</div>';
      return;
    }
    const selected = new Set(parseChatIds());
    $('#chatList').innerHTML = data.chats.map((chat) => `<label class="chat-item"><input type="checkbox" value="${escapeHtml(chat.id)}" ${selected.has(chat.id) ? 'checked' : ''}><span><strong>${escapeHtml(chat.label)}</strong><br><span class="help">${escapeHtml(chat.id)} · ${escapeHtml(chat.type)}</span></span></label>`).join('');
    $('#chatList').querySelectorAll('input').forEach((input) => input.addEventListener('change', () => {
      const ids = [...$('#chatList').querySelectorAll('input:checked')].map((el) => el.value);
      $('#chatIds').value = ids.join(', ');
    }));
  } catch (error) {
    $('#chatList').innerHTML = '';
    toast(error.message, true);
  }
});

$('#testTelegram').addEventListener('click', async () => {
  try {
    await api('/api/parent/telegram/test', { method: 'POST' });
    toast('Тестовое сообщение отправлено.');
  } catch (error) { toast(error.message, true); }
});

if (pin) unlock().catch(() => { sessionStorage.removeItem('epiapp_parent_pin'); pin = ''; });
