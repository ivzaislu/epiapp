import { ensureTelegramSession, roleLabel } from './auth.js?v=12';
import { childHistoryView } from './history.js?v=12';

const $ = (id) => document.getElementById(id);

let user = null;
let mode = 'child';
let screen = 'today';
let state = null;
let settings = null;
let settingsPack = null;
let stats7 = null;
let stats30 = null;
let historyExpanded = false;
let monthExpanded = false;
let pendingSlot = null;
let demo = false;
let saving = false;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function toast(message, error = false) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3200);
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос.');
  return data;
}

function clock(iso, timeZone) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
}

function formatTakenAt(iso, timeZone) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
}

function nowClock(timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const bag = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${bag.hour}:${bag.minute}`;
}

function isDue(hhmm, timeZone) {
  return nowClock(timeZone) >= hhmm;
}

function longDate(timeZone) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone, weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date());
}

function dateKey(offset, timeZone = 'Europe/Berlin') {
  const now = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function weekdayLabel(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('ru-RU', { weekday: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day, 12)))
    .replace('.', '');
}

function dotClass(slot) {
  if (!slot?.expected) return 'wait';
  return slot.taken ? 'done' : 'open';
}

function slotPhrase(slot) {
  if (!slot?.expected) return 'ещё не время';
  return slot.taken ? 'подтверждено' : 'нет отметки';
}

function paintChrome() {
  const zone = state?.settings?.timezone || settings?.timezone || 'Europe/Berlin';
  const name = state?.settings?.childName || settings?.childName || 'EpiApp';
  const medication = state?.settings?.medicationName || settings?.medicationName || 'Препарат не указан';
  $('back').hidden = screen === 'today';
  if (mode === 'child') {
    $('kicker').textContent = longDate(zone);
    $('title').textContent = name;
    $('sub').textContent = medication;
    return;
  }
  const titles = {
    today: [`Сегодня · ${longDate(zone)}`, name, medication],
    scheme: ['Схема', name, ''],
    reminders: ['Напоминания', name, ''],
    month: ['30 дней', name, ''],
    telegram: ['Telegram', name, ''],
  };
  const [kicker, title, sub] = titles[screen] || titles.today;
  $('kicker').textContent = kicker;
  $('title').textContent = title;
  $('sub').textContent = sub;
}

function doseRows(canTake) {
  return ['morning', 'evening'].map((slot) => {
    const dose = state.todayDoses?.[slot];
    const label = slot === 'morning' ? 'Утро' : 'Вечер';
    const time = state.settings[slot === 'morning' ? 'morningTime' : 'eveningTime'];
    const amount = state.settings[slot === 'morning' ? 'morningDose' : 'eveningDose'] || '';
    const due = isDue(time, state.settings.timezone);
    let status = 'ещё не отмечено';
    if (dose) status = `подтверждено в ${clock(dose.takenAt, state.settings.timezone)}`;
    else if (!canTake && !due) status = 'ещё не время';
    const button = canTake && !dose
      ? `<button class="${due ? 'primary' : 'quiet'} take" type="button" data-slot="${slot}">Я принял</button>`
      : '';
    return `<article class="dose${dose ? ' is-done' : ''}">
      <h2>${label} · ${escapeHtml(time)}</h2>
      <p class="status">${escapeHtml(status)}</p>
      ${amount ? `<p class="meta">${escapeHtml(amount)}</p>` : ''}
      ${button}
    </article>`;
  }).join('');
}

function weekBlock() {
  const days = stats7?.days || [];
  if (!days.length) return '<p class="sentence">За 7 дней отметок ещё нет.</p>';
  const sentence = stats7.expected
    ? `За 7 дней отмечено ${stats7.taken} из ${stats7.expected}.`
    : 'За эту неделю время приёма ещё не наступило.';
  const today = state?.today;
  const head = days.map((day) => {
    const mark = day.localDate === today ? ' is-today' : '';
    return `<div class="day${mark}"><span>${escapeHtml(weekdayLabel(day.localDate))}</span><b>${Number(day.localDate.slice(8))}</b></div>`;
  }).join('');
  const lane = (slot, label) => `<div class="lane"><span class="lane-name">${label}</span>${days.map((day) => {
    const mark = day.localDate === today ? ' is-today' : '';
    return `<i class="dot ${dotClass(day.slots[slot])}${mark}" title="${label}, ${escapeHtml(day.localDate)}"></i>`;
  }).join('')}</div>`;
  return `<p class="sentence">${escapeHtml(sentence)}</p>
    <div class="week" style="--days:${days.length}">
      <div class="week-head"><span></span>${head}</div>
      ${lane('morning', 'утро')}
      ${lane('evening', 'вечер')}
    </div>
    <p class="legend"><span><i class="dot done"></i>подтверждено</span><span><i class="dot open"></i>нет отметки</span><span><i class="dot wait"></i>ещё не время</span></p>`;
}

function historyBlock(items, expanded, emptyText) {
  if (!items.length) return `<p class="help">${escapeHtml(emptyText)}</p>`;
  const view = childHistoryView(items, expanded);
  const rows = view.visible.map((dose) => `
    <div class="hist">
      <span>${dose.slot === 'evening' ? 'Вечер' : 'Утро'}</span>
      <span>${escapeHtml(formatTakenAt(dose.takenAt, state.settings.timezone))}</span>
    </div>`).join('');
  const toggle = view.canToggle
    ? `<button class="texty" id="historyToggle" type="button">${escapeHtml(view.buttonLabel)}</button>`
    : '';
  return `<p class="help">${escapeHtml(view.metaLabel)}</p>${rows}${toggle}`;
}

function field(name, label, value, extra = '') {
  return `<label for="${name}">${label}</label><input id="${name}" name="${name}" value="${escapeHtml(value)}" ${extra}>`;
}

function schemeScreen() {
  return `<form data-form="scheme" class="form">
    <fieldset>
      <legend>Кто</legend>
      ${field('childName', 'Имя', settings.childName, 'maxlength="50" required autocomplete="name"')}
    </fieldset>
    <fieldset>
      <legend>Препарат</legend>
      ${field('medicationName', 'Название', settings.medicationName || '', 'maxlength="100" autocomplete="off"')}
      ${field('morningDose', 'Доза утром', settings.morningDose || '', 'maxlength="80" placeholder="Например, 1 таблетка" autocomplete="off"')}
      ${field('eveningDose', 'Доза вечером', settings.eveningDose || '', 'maxlength="80" placeholder="Например, 1 таблетка" autocomplete="off"')}
      <p class="help">Приложение не назначает препарат и не меняет дозу.</p>
    </fieldset>
    <fieldset>
      <legend>Когда</legend>
      <div class="pair">
        <div>${field('morningTime', 'Утро', settings.morningTime, 'type="time" required')}</div>
        <div>${field('eveningTime', 'Вечер', settings.eveningTime, 'type="time" required')}</div>
      </div>
      ${field('timezone', 'Часовой пояс', settings.timezone, 'required placeholder="Europe/Berlin" autocomplete="off"')}
      <p class="help">Например: Europe/Berlin или Europe/Moscow.</p>
    </fieldset>
    <button class="primary" type="submit">Сохранить схему</button>
    <p class="help">${escapeHtml(auditLine())}</p>
  </form>`;
}

function remindersScreen() {
  const on = settings.remindersEnabled !== false;
  const number = (name, label, value, min, max) => field(
    name, label, value, `inputmode="numeric" type="number" min="${min}" max="${max}" step="1"`,
  );
  return `<form data-form="reminders" class="form">
    <label class="toggle"><input name="remindersEnabled" type="checkbox"${on ? ' checked' : ''}><span>Писать в Telegram, пока отметки нет</span></label>
    <fieldset id="reminderFields"${on ? '' : ' disabled'}>
      <legend>Когда писать</legend>
      ${number('reminderFirstMinutes', 'Первое напоминание, минуты', settings.reminderFirstMinutes ?? 15, 5, 60)}
      ${number('reminderUrgentMinutes', 'Срочное, минуты', settings.reminderUrgentMinutes ?? 30, 10, 120)}
      ${number('reminderRepeatMinutes', 'Повторять каждые, минуты', settings.reminderRepeatMinutes ?? 15, 5, 60)}
      ${number('reminderStopMinutes', 'Повторять не дольше, минуты', settings.reminderStopMinutes ?? 60, 15, 240)}
      <p class="help">Обычно: через 15 минут, срочное через 30, затем каждые 15 минут до часа. Беззвучный режим это не обходит.</p>
    </fieldset>
    <button class="primary" type="submit">Сохранить напоминания</button>
  </form>`;
}

function monthScreen() {
  const stats = stats30;
  if (!stats?.days?.length) return '<p class="sentence">За 30 дней данных ещё нет.</p>';
  const sentence = stats.expected
    ? `За 30 дней отмечено ${stats.taken} из ${stats.expected}.`
    : 'За 30 дней время приёма ещё не наступило.';
  const morning = stats.bySlot.morning;
  const evening = stats.bySlot.evening;
  const today = state?.today;
  const cells = stats.days.map((day) => `
    <div class="cell${day.localDate === today ? ' is-today' : ''}" title="${escapeHtml(day.localDate)}: утро — ${slotPhrase(day.slots.morning)}, вечер — ${slotPhrase(day.slots.evening)}">
      <span>${Number(day.localDate.slice(8))}</span>
      <i class="dot ${dotClass(day.slots.morning)}"></i>
      <i class="dot ${dotClass(day.slots.evening)}"></i>
    </div>`).join('');
  const days = [...stats.days].reverse();
  const view = childHistoryView(days, monthExpanded);
  const rows = view.visible.map((day) => `
    <div class="hist stacked">
      <span>${escapeHtml(day.localDate.slice(8))}.${escapeHtml(day.localDate.slice(5, 7))}</span>
      <span>утро — ${slotPhrase(day.slots.morning)}</span>
      <span>вечер — ${slotPhrase(day.slots.evening)}</span>
    </div>`).join('');
  const toggle = view.canToggle
    ? `<button class="texty" id="historyToggle" type="button">${escapeHtml(view.buttonLabel)}</button>`
    : '';
  return `<p class="sentence">${escapeHtml(sentence)}</p>
    <p class="split">Утро: ${escapeHtml(morning.taken)} из ${escapeHtml(morning.expected)}. Вечер: ${escapeHtml(evening.taken)} из ${escapeHtml(evening.expected)}.</p>
    <p class="split">Полных дней подряд: ${escapeHtml(stats.currentStreak)}.</p>
    <div class="month">${cells}</div>
    <p class="legend"><span><i class="dot done"></i>подтверждено</span><span><i class="dot open"></i>нет отметки</span><span><i class="dot wait"></i>ещё не время</span></p>
    <h2 class="block-title">По дням</h2>
    <div class="list">
      <p class="help">${escapeHtml(view.metaLabel)}</p>
      ${rows}${toggle}
    </div>`;
}

function telegramScreen() {
  const ready = Boolean(settingsPack?.telegramConfigured);
  const admin = user?.role === 'admin'
    ? '<p class="help">Пригласить ребёнка или родителя можно в чате с ботом.</p>'
    : '';
  return `<div class="panel plain">
      <p class="sentence">${ready
        ? 'Бот подключён. Сообщение уходит администратору и приглашённым родителям.'
        : 'Бот не настроен. Сообщения не отправляются.'}</p>
      <p class="help">Обычное уведомление не содержит название препарата и дозу.</p>
      ${admin}
    </div>
    <button id="testTelegram" class="primary" type="button"${ready ? '' : ' disabled'}>Отправить тест</button>`;
}

function childScreen() {
  return `<div class="panel">${doseRows(true)}</div>
    <p class="note">Отметка появляется только после ответа сервера.</p>
    <h2 class="block-title">Последние отметки</h2>
    <div class="list">${historyBlock(state.recentDoses || [], historyExpanded, 'Пока нет отметок.')}</div>`;
}

function parentToday() {
  return `<div class="panel">${doseRows(false)}</div>
    <p class="note">Подтвердить приём может только ребёнок.</p>
    <section class="panel week-panel">${weekBlock()}</section>
    <nav class="menu">
      <button type="button" data-go="scheme"><span>Схема</span><small>имя, препарат, дозы и время</small></button>
      <button type="button" data-go="reminders"><span>Напоминания</span><small>Telegram, если отметки нет</small></button>
      <button type="button" data-go="month"><span>30 дней</span><small>те же точки за месяц</small></button>
      <button type="button" data-go="telegram"><span>Telegram</span><small>проверка, что сообщения доходят</small></button>
    </nav>
    <p class="note">Вы вошли как ${escapeHtml(roleLabel(user?.role))}.</p>`;
}

function render() {
  paintChrome();
  const root = $('screen');
  if (mode === 'child') root.innerHTML = childScreen();
  else if (screen === 'scheme') root.innerHTML = schemeScreen();
  else if (screen === 'reminders') root.innerHTML = remindersScreen();
  else if (screen === 'month') root.innerHTML = monthScreen();
  else if (screen === 'telegram') root.innerHTML = telegramScreen();
  else root.innerHTML = parentToday();
}

function auditLine() {
  const changes = settingsPack?.recentChanges || [];
  if (!changes.length) return 'История изменений появится после первого сохранения.';
  let when = changes[0].at;
  try {
    when = new Intl.DateTimeFormat('ru-RU', {
      timeZone: settings.timezone,
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(changes[0].at));
  } catch { /* оставляем исходную строку */ }
  return `Последнее изменение: ${when}.`;
}

function readField(form, name, fallback) {
  const input = form.elements[name];
  if (!input) return fallback;
  if (input.type === 'checkbox') return input.checked;
  return String(input.value).trim() === '' ? fallback : input.value;
}

function collect(form) {
  const reminders = form.dataset.form === 'reminders';
  return {
    childName: readField(form, 'childName', settings.childName),
    medicationName: readField(form, 'medicationName', settings.medicationName || ''),
    morningDose: readField(form, 'morningDose', settings.morningDose || ''),
    eveningDose: readField(form, 'eveningDose', settings.eveningDose || ''),
    morningTime: readField(form, 'morningTime', settings.morningTime),
    eveningTime: readField(form, 'eveningTime', settings.eveningTime),
    timezone: readField(form, 'timezone', settings.timezone),
    remindersEnabled: reminders ? readField(form, 'remindersEnabled', false) : settings.remindersEnabled !== false,
    reminderFirstMinutes: Number(readField(form, 'reminderFirstMinutes', settings.reminderFirstMinutes ?? 15)),
    reminderUrgentMinutes: Number(readField(form, 'reminderUrgentMinutes', settings.reminderUrgentMinutes ?? 30)),
    reminderRepeatMinutes: Number(readField(form, 'reminderRepeatMinutes', settings.reminderRepeatMinutes ?? 15)),
    reminderStopMinutes: Number(readField(form, 'reminderStopMinutes', settings.reminderStopMinutes ?? 60)),
  };
}

function openSheet(slot) {
  if (mode !== 'child' || !state) return;
  pendingSlot = slot;
  const amount = slot === 'morning' ? state.settings.morningDose : state.settings.eveningDose;
  const parts = [state.settings.medicationName, amount].filter(Boolean);
  $('sheetTitle').textContent = slot === 'morning' ? 'Утреннее лекарство уже принято?' : 'Вечернее лекарство уже принято?';
  $('sheetText').textContent = parts.length
    ? `${parts.join(' · ')}. Нажимайте «Да» только после приёма.`
    : 'Нажимайте «Да» только после приёма.';
  $('sheet').hidden = false;
  $('sheetYes').focus();
}

function closeSheet() {
  pendingSlot = null;
  $('sheet').hidden = true;
}

async function confirmTake() {
  if (!pendingSlot || saving || mode !== 'child') return;
  const slot = pendingSlot;
  if (demo) {
    closeSheet();
    toast('Это пример экрана. Отметка не сохраняется.');
    return;
  }
  saving = true;
  $('sheetYes').disabled = true;
  $('sheetYes').textContent = 'Сохраняю…';
  try {
    const data = await api('/api/take', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot }),
    });
    closeSheet();
    await refresh();
    if (data.notification?.configured && data.notification.failed === 0) toast('Готово. Родителю отправлено сообщение.');
    else if (data.notification?.configured) toast('Отметка сохранена, но часть сообщений не дошла.', true);
    else toast('Готово. Отметка сохранена.');
  } catch (error) {
    toast(error.message, true);
  } finally {
    saving = false;
    const yes = $('sheetYes');
    if (yes) {
      yes.disabled = false;
      yes.textContent = 'Да, отметить';
    }
  }
}

async function save(form) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const data = await api('/api/parent/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(collect(form)),
    });
    settings = data.settings;
    settingsPack = { ...settingsPack, ...data, telegramConfigured: settingsPack?.telegramConfigured };
    toast('Сохранено.');
    await refresh();
  } catch (error) {
    toast(error.message, true);
    button.disabled = false;
  }
}

async function sendTest() {
  const button = $('testTelegram');
  if (!button || button.disabled) return;
  button.disabled = true;
  try {
    const data = await api('/api/parent/telegram/test', { method: 'POST' });
    toast(`Тест отправлен: ${data.sent}.`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = !settingsPack?.telegramConfigured;
  }
}

async function refresh() {
  if (mode === 'child') {
    state = await api('/api/state');
  } else {
    const [today, week, month, pack] = await Promise.all([
      api('/api/state'),
      api('/api/parent/stats?days=7'),
      api('/api/parent/stats?days=30'),
      api('/api/parent/settings'),
    ]);
    state = today;
    stats7 = week.stats;
    stats30 = month.stats;
    settingsPack = pack;
    settings = pack.settings;
  }
  render();
}

function demoStats(count) {
  const days = [];
  for (let ago = count - 1; ago >= 0; ago -= 1) {
    const today = ago === 0;
    const missEvening = ago === 2;
    const morning = { expected: true, taken: !today, scheduled: '08:00' };
    const evening = { expected: !today, taken: !today && !missEvening, scheduled: '20:00' };
    days.push({
      localDate: dateKey(-ago),
      expected: Number(morning.expected) + Number(evening.expected),
      taken: Number(morning.taken) + Number(evening.taken),
      complete: morning.expected && evening.expected && morning.taken && evening.taken,
      slots: { morning, evening },
    });
  }
  const expected = days.reduce((sum, day) => sum + day.expected, 0);
  const taken = days.reduce((sum, day) => sum + day.taken, 0);
  const countSlot = (slot, key) => days.filter((day) => day.slots[slot][key]).length;
  let currentStreak = 0;
  for (let index = days.length - 1; index >= 0; index -= 1) {
    const day = days[index];
    if (index === days.length - 1 && day.expected < 2) continue;
    if (day.complete) currentStreak += 1;
    else if (day.expected > 0) break;
  }
  return {
    expected,
    taken,
    missed: Math.max(0, expected - taken),
    currentStreak,
    days,
    bySlot: {
      morning: { taken: countSlot('morning', 'taken'), expected: countSlot('morning', 'expected') },
      evening: { taken: countSlot('evening', 'taken'), expected: countSlot('evening', 'expected') },
    },
  };
}

function applyDemo() {
  const base = {
    childName: 'Маша',
    medicationName: 'Препарат по схеме',
    morningTime: '08:00',
    eveningTime: '20:00',
    morningDose: '1 таблетка',
    eveningDose: '1 таблетка',
    timezone: 'Europe/Berlin',
    remindersEnabled: true,
    reminderFirstMinutes: 15,
    reminderUrgentMinutes: 30,
    reminderRepeatMinutes: 15,
    reminderStopMinutes: 60,
  };
  state = {
    today: dateKey(0),
    settings: base,
    todayDoses: {
      evening: { slot: 'evening', takenAt: new Date(Date.now() - 2 * 3600000).toISOString() },
    },
    recentDoses: [
      { slot: 'evening', takenAt: new Date(Date.now() - 26 * 3600000).toISOString() },
      { slot: 'morning', takenAt: new Date(Date.now() - 36 * 3600000).toISOString() },
      { slot: 'evening', takenAt: new Date(Date.now() - 50 * 3600000).toISOString() },
      { slot: 'morning', takenAt: new Date(Date.now() - 60 * 3600000).toISOString() },
      { slot: 'evening', takenAt: new Date(Date.now() - 74 * 3600000).toISOString() },
    ],
  };
  settings = base;
  settingsPack = { settings: base, recentChanges: [], telegramConfigured: true };
  stats7 = demoStats(7);
  stats30 = demoStats(30);
}

function showApp() {
  $('gate').hidden = true;
  $('app').hidden = false;
}

function paintTelegram() {
  const telegram = window.Telegram?.WebApp;
  try {
    telegram?.setHeaderColor?.('#f6f3ee');
    telegram?.setBackgroundColor?.('#f6f3ee');
  } catch { /* старые клиенты Telegram */ }
}

export function boot() {
  const params = new URLSearchParams(location.search);
  const demoName = params.get('demo');
  demo = demoName === '1' || demoName === 'child' || demoName === 'parent';
  paintTelegram();
  $('back').addEventListener('click', () => {
    screen = 'today';
    render();
  });
  $('screen').addEventListener('click', (event) => {
    const go = event.target.closest('[data-go]');
    if (go) {
      screen = go.dataset.go;
      render();
      return;
    }
    const take = event.target.closest('.take');
    if (take) openSheet(take.dataset.slot);
    if (event.target.id === 'historyToggle') {
      if (screen === 'month') monthExpanded = !monthExpanded;
      else historyExpanded = !historyExpanded;
      render();
    }
    if (event.target.id === 'testTelegram') sendTest();
  });
  $('screen').addEventListener('change', (event) => {
    if (event.target.name !== 'remindersEnabled') return;
    const fields = event.target.form.querySelector('#reminderFields');
    if (fields) fields.disabled = !event.target.checked;
  });
  $('screen').addEventListener('submit', (event) => {
    event.preventDefault();
    if (demo) {
      toast('Это пример экрана. Изменения не сохраняются.');
      return;
    }
    save(event.target);
  });
  $('sheetNo').addEventListener('click', closeSheet);
  $('sheetYes').addEventListener('click', confirmTake);
  $('sheet').addEventListener('click', (event) => {
    if (event.target.id === 'sheet') closeSheet();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('sheet').hidden) closeSheet();
  });

  if (demo) {
    mode = demoName === 'parent' || location.pathname === '/parent' ? 'parent' : 'child';
    user = { role: mode === 'parent' ? 'parent' : 'child', telegramId: '0' };
    applyDemo();
    showApp();
    const requested = params.get('screen');
    if (mode === 'parent' && ['scheme', 'reminders', 'month', 'telegram'].includes(requested)) {
      screen = requested;
    }
    render();
    return;
  }

  ensureTelegramSession().then(async (nextUser) => {
    user = nextUser;
    const parentPath = location.pathname === '/parent' || location.pathname === '/parent.html';
    if (parentPath && !['parent', 'admin'].includes(user.role)) {
      throw new Error('Этот раздел только для родителя.');
    }
    mode = ['parent', 'admin'].includes(user.role) ? 'parent' : 'child';
    showApp();
    try {
      await refresh();
    } catch (error) {
      $('app').hidden = true;
      $('gate').hidden = false;
      throw error;
    }
    setInterval(() => {
      if (screen === 'today' && $('sheet').hidden) refresh().catch(() => undefined);
    }, 30000);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js?v=11').catch(() => undefined);
  }).catch((error) => {
    $('gateMessage').textContent = error.message || 'Доступ закрыт.';
  });
}
