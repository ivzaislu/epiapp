import { ensureTelegramSession, roleLabel } from './auth.js?v=23';
import { childHistoryView } from './history.js?v=23';

const $ = (id) => document.getElementById(id);

const ACCENTS = [
  { id: 'blue', name: 'Синий', color: '#315bd6', press: '#2749ad', soft: '#e8eefb' },
  { id: 'sky', name: 'Голубой', color: '#1a7fd4', press: '#1467ad', soft: '#e7f3fc' },
  { id: 'teal', name: 'Бирюзовый', color: '#0c7c86', press: '#096269', soft: '#e5f4f5' },
  { id: 'indigo', name: 'Индиго', color: '#3a46b5', press: '#2e388f', soft: '#eceefb' },
  { id: 'navy', name: 'Тёмно-синий', color: '#1a3f8f', press: '#143272', soft: '#e8eef8' },
];

function accentById(id) {
  return ACCENTS.find((item) => item.id === id) || ACCENTS[0];
}

function applyAccent(id) {
  const accent = accentById(id);
  const root = document.documentElement;
  root.style.setProperty('--blue', accent.color);
  root.style.setProperty('--blue-press', accent.press);
  root.style.setProperty('--blue-soft', accent.soft);
  root.style.setProperty('--today', accent.soft);
  const theme = document.querySelector('meta[name="theme-color"]');
  if (theme) theme.setAttribute('content', accent.color);
}

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
let schemeDraft = null;

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

function planItems() {
  return state?.settings?.plan || settings?.plan || [];
}

function labelForSlot(slot) {
  const item = planItems().find((entry) => entry.slot === slot);
  if (item) return item.label;
  if (slot === 'morning') return state?.settings?.morningTime || 'Утро';
  if (slot === 'evening') return state?.settings?.eveningTime || 'Вечер';
  const time = String(slot || '').split('@')[1];
  return time || 'Приём';
}

function paintChrome() {
  const zone = state?.settings?.timezone || settings?.timezone || 'Europe/Berlin';
  const name = state?.settings?.childName || settings?.childName || 'EpiApp';
  $('back').hidden = screen === 'today';
  if (screen === 'color') {
    $('kicker').textContent = 'Оформление';
    $('title').textContent = 'Цвет';
    $('sub').textContent = '';
    return;
  }
  if (mode === 'child') {
    $('kicker').textContent = longDate(zone);
    $('title').textContent = name;
    $('sub').textContent = '';
    return;
  }
  const titles = {
    today: [`Сегодня · ${longDate(zone)}`, name, ''],
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

function prescription(item) {
  const name = item.medicationName || state?.settings?.medicationName || 'Препарат не указан';
  const dose = item.dose || 'Доза не указана';
  return { name, dose, time: item.time || '' };
}

function doseRows(canTake) {
  const plan = planItems();
  const rows = plan.length ? plan : [
    { slot: 'morning', time: state.settings.morningTime, dose: state.settings.morningDose, label: state.settings.morningTime, medicationName: state.settings.medicationName },
    { slot: 'evening', time: state.settings.eveningTime, dose: state.settings.eveningDose, label: state.settings.eveningTime, medicationName: state.settings.medicationName },
  ];
  const nextDue = rows.find((item) => !state.todayDoses?.[item.slot] && isDue(item.time, state.settings.timezone));
  return rows.map((item) => {
    const taken = state.todayDoses?.[item.slot];
    const due = isDue(item.time, state.settings.timezone);
    const rx = prescription(item);
    let status = 'ещё не отмечено';
    if (taken) status = `подтверждено в ${clock(taken.takenAt, state.settings.timezone)}`;
    else if (!canTake && !due) status = 'ещё не время';
    const button = canTake && !taken
      ? `<button class="${item.slot === nextDue?.slot ? 'primary' : 'quiet'} take" type="button" data-slot="${escapeHtml(item.slot)}">Я принял</button>`
      : '';
    return `<article class="dose${taken ? ' is-done' : ''}">
      <div class="dose-copy">
        <h2>${escapeHtml(rx.name)}</h2>
        <p class="dose-amount">${escapeHtml(rx.dose)}</p>
        <p class="status">${escapeHtml(status)}</p>
      </div>
      <time class="when">${escapeHtml(rx.time)}</time>
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
  const lanes = stats7.plan?.length ? stats7.plan : [
    { slot: 'morning', label: '08:00' },
    { slot: 'evening', label: '20:00' },
  ];
  const lane = (item) => `<div class="lane"><span class="lane-name">${escapeHtml(item.lane || item.label)}</span>${days.map((day) => {
    const mark = day.localDate === today ? ' is-today' : '';
    return `<i class="dot ${dotClass(day.slots?.[item.slot])}${mark}" title="${escapeHtml(item.label)}, ${escapeHtml(day.localDate)}"></i>`;
  }).join('')}</div>`;
  return `<p class="sentence">${escapeHtml(sentence)}</p>
    <div class="week" style="--days:${days.length}">
      <div class="week-head"><span></span>${head}</div>
      ${lanes.map(lane).join('')}
    </div>
    <p class="legend"><span>Синяя — подтверждено.</span><span>Пустая — нет отметки.</span><span>Светлая — ещё не время.</span></p>`;
}

function historyBlock(items, expanded, emptyText) {
  if (!items.length) return `<p class="help">${escapeHtml(emptyText)}</p>`;
  const view = childHistoryView(items, expanded);
  const rows = view.visible.map((dose) => {
    const item = planItems().find((entry) => entry.slot === dose.slot);
    const rx = prescription(item || { time: labelForSlot(dose.slot), medicationName: '', dose: '' });
    return `<div class="hist">
      <span class="hist-main"><span>${escapeHtml(rx.name)}</span><small><b>${escapeHtml(rx.time)}</b> ${escapeHtml(rx.dose)}</small></span>
      <span>${escapeHtml(formatTakenAt(dose.takenAt, state.settings.timezone))}</span>
    </div>`;
  }).join('');
  const toggle = view.canToggle
    ? `<button class="texty" id="historyToggle" type="button">${escapeHtml(view.buttonLabel)}</button>`
    : '';
  return `${rows}${toggle}`;
}

function field(name, label, value, extra = '') {
  return `<label for="${name}">${label}</label><input id="${name}" name="${name}" value="${escapeHtml(value)}" ${extra}>`;
}

function newMedId() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return `m${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 7)}`;
}

function setIntakeCount(medication, count) {
  const presets = ['08:00', '20:00', '14:00'];
  const next = medication.intakes.slice(0, count).map((item) => ({ ...item }));
  while (next.length < count) {
    const used = new Set(next.map((item) => item.time));
    next.push({ time: presets.find((item) => !used.has(item)) || '12:00', dose: next[0]?.dose || '' });
  }
  medication.intakes = next;
}

function ensureSchemeDraft() {
  if (schemeDraft) return schemeDraft;
  const source = settings?.medications?.length ? settings.medications : [{
    id: 'legacy',
    name: settings?.medicationName || '',
    intakes: [
      { time: settings?.morningTime || '08:00', dose: settings?.morningDose || '' },
      { time: settings?.eveningTime || '20:00', dose: settings?.eveningDose || '' },
    ],
  }];
  schemeDraft = structuredClone(source);
  return schemeDraft;
}

function syncSchemeDraft(form) {
  if (!form || !schemeDraft) return;
  schemeDraft.forEach((medication, medIndex) => {
    const name = form.elements[`med-name-${medIndex}`];
    if (name) medication.name = name.value;
    medication.intakes.forEach((intake, index) => {
      const time = form.elements[`med-time-${medIndex}-${index}`];
      const dose = form.elements[`med-dose-${medIndex}-${index}`];
      if (time?.value) intake.time = time.value;
      if (dose) intake.dose = dose.value;
    });
  });
}

function schemeScreen() {
  const meds = ensureSchemeDraft();
  const cards = meds.map((medication, medIndex) => {
    const count = medication.intakes.length;
    const choices = [1, 2, 3].map((value) => `
      <button class="count-choice${count === value ? ' on' : ''}" type="button" data-count="${value}" data-med="${medIndex}">
        ${['Один', 'Два', 'Три'][value - 1]}
      </button>`).join('');
    const intakes = medication.intakes.map((intake, index) => `
      <div class="pair">
        <div>${field(`med-time-${medIndex}-${index}`, count === 1 ? 'Время' : `Приём ${index + 1}`, intake.time, 'type="time" required')}</div>
        <div>${field(`med-dose-${medIndex}-${index}`, 'Доза', intake.dose || '', 'maxlength="80" placeholder="1 таблетка" autocomplete="off"')}</div>
      </div>`).join('');
    const remove = meds.length > 1
      ? `<button class="texty" type="button" data-remove-med="${medIndex}">Убрать препарат</button>`
      : '';
    return `<article class="med">
      ${field(`med-name-${medIndex}`, meds.length > 1 ? `Препарат ${medIndex + 1}` : 'Название', medication.name || '', 'maxlength="100" autocomplete="off"')}
      <p class="label-line">Сколько приёмов</p>
      <div class="count">${choices}</div>
      ${intakes}
      ${remove}
    </article>`;
  }).join('');
  return `<form data-form="scheme" class="form">
    <fieldset>
      <legend>Кто</legend>
      ${field('childName', 'Имя', settings.childName, 'maxlength="50" required autocomplete="name"')}
      ${field('timezone', 'Часовой пояс', settings.timezone, 'required placeholder="Europe/Berlin" autocomplete="off"')}
    </fieldset>
    <fieldset>
      <legend>Препараты</legend>
      <div class="meds">${cards}</div>
      ${meds.length < 6 ? '<button class="quiet add-med" type="button" data-add-med>Добавить препарат</button>' : ''}
      <p class="help">У каждого препарата один, два или три приёма. Приложение не назначает препарат и не меняет дозу.</p>
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
  const plan = stats.plan?.length ? stats.plan : [
    { slot: 'morning', label: '08:00' },
    { slot: 'evening', label: '20:00' },
  ];
  const today = state?.today;
  const cells = stats.days.map((day) => {
    const dots = plan.slice(0, 3).map((item) => `<i class="dot ${dotClass(day.slots?.[item.slot])}"></i>`).join('');
    return `<div class="cell${day.localDate === today ? ' is-today' : ''}" title="${escapeHtml(day.localDate)}">
      <span>${Number(day.localDate.slice(8))}</span>
      ${dots}
    </div>`;
  }).join('');
  const days = [...stats.days].reverse();
  const view = childHistoryView(days, monthExpanded);
  const rows = view.visible.map((day) => `
    <div class="hist stacked">
      <span>${escapeHtml(day.localDate.slice(8))}.${escapeHtml(day.localDate.slice(5, 7))}</span>
      ${plan.map((item) => `<span>${escapeHtml(item.label)} — ${slotPhrase(day.slots?.[item.slot])}</span>`).join('')}
    </div>`).join('');
  const toggle = view.canToggle
    ? `<button class="texty" id="historyToggle" type="button">${escapeHtml(view.buttonLabel)}</button>`
    : '';
  return `<p class="sentence">${escapeHtml(sentence)}</p>
    <p class="split">Полных дней подряд: ${escapeHtml(stats.currentStreak)}.</p>
    <div class="month">${cells}</div>
    <p class="legend"><span>Синяя — подтверждено.</span><span>Пустая — нет отметки.</span><span>Светлая — ещё не время.</span></p>
    <h2 class="block-title">По дням</h2>
    <p class="help">${escapeHtml(view.metaLabel)}</p>
    ${rows}${toggle}`;
}

function telegramScreen() {
  const ready = Boolean(settingsPack?.telegramConfigured);
  const admin = user?.role === 'admin'
    ? '<p class="help">Пригласить ребёнка или родителя можно в чате с ботом.</p>'
    : '';
  return `<section class="block">
      <p class="sentence">${ready
        ? 'Бот подключён. Сообщение уходит администратору и приглашённым родителям.'
        : 'Бот не настроен. Сообщения не отправляются.'}</p>
      <p class="help">Обычное уведомление не содержит название препарата и дозу.</p>
      ${admin}
      <button id="testTelegram" class="primary" type="button"${ready ? '' : ' disabled'}>Отправить тест</button>
    </section>`;
}

function childScreen() {
  return `<section class="block">
      ${doseRows(true)}
      <p class="note">Отметка появляется только после ответа сервера.</p>
    </section>
    <section class="block">
      <h2 class="block-title">Последние отметки</h2>
      ${historyBlock(state.recentDoses || [], historyExpanded, 'Пока нет отметок.')}
    </section>
    <nav class="menu">
      <button type="button" data-go="color"><span>Цвет</span><small>общий для ребёнка и родителя</small></button>
    </nav>`;
}

function parentToday() {
  return `<section class="block">
      ${doseRows(false)}
      <p class="note">Подтвердить приём может только ребёнок.</p>
    </section>
    <section class="block">${weekBlock()}</section>
    <nav class="menu">
      <button type="button" data-go="scheme"><span>Схема</span><small>препараты и число приёмов</small></button>
      <button type="button" data-go="reminders"><span>Напоминания</span><small>Telegram, если отметки нет</small></button>
      <button type="button" data-go="month"><span>30 дней</span><small>те же точки за месяц</small></button>
      <button type="button" data-go="telegram"><span>Telegram</span><small>проверка, что сообщения доходят</small></button>
      <button type="button" data-go="color"><span>Цвет</span><small>общий для ребёнка и родителя</small></button>
    </nav>
    <p class="note end">Вы вошли как ${escapeHtml(roleLabel(user?.role))}.</p>`;
}

function colorScreen() {
  const current = accentById(state?.settings?.accent || settings?.accent).id;
  const items = ACCENTS.map((item) => `
    <button class="swatch${item.id === current ? ' on' : ''}" type="button" data-accent="${item.id}">
      <i style="background:${item.color}"></i>
      <span>${item.name}</span>
    </button>`).join('');
  return `<section class="block">
      <p class="sentence">Белый фон остаётся. Меняется цвет кнопок, меток и эмблемы.</p>
      <div class="swatches">${items}</div>
      <p class="help">Один цвет у ребёнка и у родителя.</p>
    </section>`;
}

function render() {
  paintChrome();
  const root = $('screen');
  if (screen === 'color') root.innerHTML = colorScreen();
  else if (mode === 'child') root.innerHTML = childScreen();
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
  const payload = {
    childName: readField(form, 'childName', settings.childName),
    timezone: readField(form, 'timezone', settings.timezone),
    remindersEnabled: reminders ? readField(form, 'remindersEnabled', false) : settings.remindersEnabled !== false,
    reminderFirstMinutes: Number(readField(form, 'reminderFirstMinutes', settings.reminderFirstMinutes ?? 15)),
    reminderUrgentMinutes: Number(readField(form, 'reminderUrgentMinutes', settings.reminderUrgentMinutes ?? 30)),
    reminderRepeatMinutes: Number(readField(form, 'reminderRepeatMinutes', settings.reminderRepeatMinutes ?? 15)),
    reminderStopMinutes: Number(readField(form, 'reminderStopMinutes', settings.reminderStopMinutes ?? 60)),
  };
  if (!reminders) {
    syncSchemeDraft(form);
    payload.medications = schemeDraft;
  }
  return payload;
}

function openSheet(slot) {
  if (mode !== 'child' || !state) return;
  pendingSlot = slot;
  const item = planItems().find((entry) => entry.slot === slot);
  const parts = [item?.medicationName, item?.dose].filter(Boolean);
  $('sheetTitle').textContent = item ? `Приём в ${item.time} уже принят?` : 'Лекарство уже принято?';
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

async function chooseAccent(id) {
  const accent = accentById(id).id;
  applyAccent(accent);
  if (state?.settings) state.settings.accent = accent;
  if (settings) settings.accent = accent;
  render();
  if (demo) return;
  try {
    const data = await api('/api/accent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accent }),
    });
    if (state?.settings) state.settings.accent = data.accent;
    if (settings) settings.accent = data.accent;
    applyAccent(data.accent);
  } catch (error) {
    toast(error.message, true);
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
    schemeDraft = null;
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
  applyAccent(state?.settings?.accent || settings?.accent);
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
    telegram?.setHeaderColor?.('#315bd6');
    telegram?.setBackgroundColor?.('#ffffff');
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
      if (go.dataset.go === 'scheme') schemeDraft = null;
      screen = go.dataset.go;
      render();
      return;
    }
    const accent = event.target.closest('[data-accent]');
    if (accent) {
      chooseAccent(accent.dataset.accent);
      return;
    }
    const count = event.target.closest('[data-count]');
    if (count) {
      syncSchemeDraft(count.closest('form'));
      const medication = schemeDraft?.[Number(count.dataset.med)];
      if (medication) setIntakeCount(medication, Number(count.dataset.count));
      render();
      return;
    }
    if (event.target.closest('[data-add-med]')) {
      syncSchemeDraft(event.target.closest('form'));
      if (schemeDraft && schemeDraft.length < 6) {
        schemeDraft.push({ id: newMedId(), name: '', intakes: [{ time: '08:00', dose: '' }, { time: '20:00', dose: '' }] });
      }
      render();
      return;
    }
    const remove = event.target.closest('[data-remove-med]');
    if (remove) {
      syncSchemeDraft(remove.closest('form'));
      schemeDraft?.splice(Number(remove.dataset.removeMed), 1);
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
