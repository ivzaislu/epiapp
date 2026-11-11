import { ensureTelegramSession } from './auth.js?v=32';
import { childHistoryView } from './history.js?v=32';

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

let prefs = {
  accent: 'blue',
  largeText: false,
  hints: true,
  confirmTake: true,
  compact: false,
  showDate: true,
  emblem: true,
};

function prefsKey() {
  const who = user?.telegramId ? String(user.telegramId) : (mode === 'parent' ? 'parent' : 'child');
  return `epiapp-prefs:${who}`;
}

function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(prefsKey()) || localStorage.getItem(`epiapp-prefs:${mode === 'parent' ? 'parent' : 'child'}`) || '{}');
    prefs = {
      accent: accentById(raw.accent).id,
      largeText: Boolean(raw.largeText),
      hints: raw.hints !== false,
      confirmTake: raw.confirmTake !== false,
      compact: Boolean(raw.compact),
      showDate: raw.showDate !== false,
      emblem: raw.emblem !== false,
    };
  } catch {
    prefs = { accent: 'blue', largeText: false, hints: true, confirmTake: true, compact: false, showDate: true, emblem: true };
  }
  applyPrefs();
}

function savePrefs(patch) {
  prefs = { ...prefs, ...patch };
  localStorage.setItem(prefsKey(), JSON.stringify(prefs));
  applyPrefs();
}

function applyPrefs() {
  applyAccent(prefs.accent);
  const root = document.documentElement;
  root.classList.toggle('text-lg', prefs.largeText);
  root.classList.toggle('no-hints', !prefs.hints);
  root.classList.toggle('compact', prefs.compact);
  root.classList.toggle('no-date', !prefs.showDate);
  root.classList.toggle('no-emblem', !prefs.emblem);
}

let user = null;
let mode = 'child';
let screen = 'today';
let state = null;
let settings = null;
let settingsPack = null;
let stats7 = null;
let stats30 = null;
let parentAlerts = [];
let notificationTab = 'messages';
let monthThrough = '';
let historyExpanded = false;
let pendingSlot = null;
let demo = false;
let saving = false;
let schemeDraft = null;
let editingMedication = null;
let editorBaseline = null;
const zoneLabels = new Map();

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

function statusLegend() {
  return `<p class="legend"><span>Синяя — подтверждено.</span><span>Пустая — нет отметки.</span><span>Светлая — ещё не время.</span></p>`;
}

function weekdayLabel(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('ru-RU', { weekday: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day, 12)))
    .replace('.', '');
}

function mondayIndex(key) {
  const [year, month, day] = key.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return (weekday + 6) % 7;
}

function dotClass(slot) {
  if (!slot?.expected) return 'wait';
  return slot.taken ? 'done' : 'open';
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

function showScreen(next) {
  if (next === 'reminders') { next = 'notifications'; notificationTab = 'settings'; }
  if (next === screen) return;
  if (!leaveEditor()) return;
  if (next === 'today') schemeDraft = null;
  if (next !== 'today' && history.state?.epi && history.state.epi !== 'today') {
    screen = next;
    history.replaceState({ epi: next }, '');
    render();
    syncTelegramBack();
    if (next === 'profile') editorBaseline = editorSnapshot();
    return;
  }
  if (next === 'today' && history.state?.epi && history.state.epi !== 'today') {
    history.back();
    return;
  }
  screen = next;
  if (next === 'today') history.replaceState({ epi: 'today' }, '');
  else history.pushState({ epi: next }, '');
  render();
  syncTelegramBack();
  if (next === 'profile') editorBaseline = editorSnapshot();
}

function syncTelegramBack() {
  const button = window.Telegram?.WebApp?.BackButton;
  if (!button) return;
  if (screen === 'today') button.hide();
  else button.show();
}

window.epiappBack = () => {
  if (screen === 'today') return false;
  goBack();
  return true;
};

function setKicker(text, isDate) {
  const node = $('kicker');
  node.textContent = text;
  node.classList.toggle('is-date', Boolean(isDate));
}

function paintChrome() {
  const zone = state?.settings?.timezone || settings?.timezone || 'Europe/Berlin';
  const name = state?.settings?.childName || settings?.childName || 'EpiApp';
  const home = screen === 'today';
  $('gear').classList.toggle('is-back', !home);
  $('gear').setAttribute('aria-label', home ? 'Настройки' : 'Назад');
  if (screen === 'settings') {
    setKicker(mode === 'child' ? 'Ребёнок' : 'Родитель', false);
    $('title').textContent = 'Настройки';
    $('sub').textContent = '';
    return;
  }
  if (mode === 'child') {
    setKicker(longDate(zone), true);
    $('title').textContent = name;
    $('sub').textContent = '';
    return;
  }
  const titles = {
    today: [`Сегодня · ${longDate(zone)}`, name, '', true],
    scheme: ['Схема', name, '', false],
    medication: ['Препарат', editingMedication === null ? name : schemeDraft?.[editingMedication]?.name || 'Новый препарат', '', false],
    profile: ['Настройки ребёнка', name, '', false],
    month: ['30 дней', name, '', false],
    telegram: ['Семья', name, '', false],
    notifications: ['Уведомления', name, '', false],
  };
  const [kicker, title, sub, isDate] = titles[screen] || titles.today;
  setKicker(kicker, isDate);
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
      <div class="dose-side">
        <time class="when">${escapeHtml(rx.time)}</time>
        ${button}
      </div>
    </article>`;
  }).join('');
}

function fallbackPlan(stats) {
  return stats?.plan?.length ? stats.plan : [
    { slot: 'morning', label: '08:00' },
    { slot: 'evening', label: '20:00' },
  ];
}

function marksBoard(days, plan) {
  const today = state?.today;
  const head = days.map((day) => {
    if (!day) return '<div class="day"></div>';
    const mark = day.localDate === today ? ' is-today' : '';
    return `<div class="day${mark}"><span>${escapeHtml(weekdayLabel(day.localDate))}</span><b>${Number(day.localDate.slice(8))}</b></div>`;
  }).join('');
  const lane = (item) => `<div class="lane"><span class="lane-name">${escapeHtml(item.lane || item.label)}</span>${days.map((day) => {
    if (!day) return '<i class="dot is-empty"></i>';
    return `<i class="dot ${dotClass(day.slots?.[item.slot])}" title="${escapeHtml(item.label)}, ${escapeHtml(day.localDate)}"></i>`;
  }).join('')}</div>`;
  return `<div class="week" style="--days:${days.length}">
      <div class="week-head"><span></span>${head}</div>
      ${plan.map(lane).join('')}
    </div>`;
}

function weeksOf(days) {
  if (!days.length) return [];
  const slots = [...Array(mondayIndex(days[0].localDate)).fill(null), ...days];
  const weeks = [];
  for (let index = 0; index < slots.length; index += 7) {
    const week = slots.slice(index, index + 7);
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  return weeks;
}

function weekBlock() {
  const days = stats7?.days || [];
  if (!days.length) return '<p class="sentence">За 7 дней отметок ещё нет.</p>';
  const sentence = stats7.expected
    ? `За 7 дней отмечено ${stats7.taken} из ${stats7.expected}.`
    : 'За эту неделю время приёма ещё не наступило.';
  return `<p class="sentence">${escapeHtml(sentence)}</p>
    ${marksBoard(days, fallbackPlan(stats7))}
    ${statusLegend()}`;
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

const CITY_NAMES = {
  'Europe/Berlin': 'Берлин', 'Europe/Moscow': 'Москва', 'Europe/Istanbul': 'Стамбул',
  'Europe/Kiev': 'Киев', 'Europe/Kyiv': 'Киев', 'Europe/London': 'Лондон',
  'Europe/Paris': 'Париж', 'Europe/Warsaw': 'Варшава', 'Europe/Minsk': 'Минск',
  'Asia/Dubai': 'Дубай', 'Asia/Almaty': 'Алматы', 'Asia/Tashkent': 'Ташкент',
  'Asia/Bishkek': 'Бишкек', 'Asia/Yekaterinburg': 'Екатеринбург', 'Asia/Novosibirsk': 'Новосибирск',
  'Asia/Vladivostok': 'Владивосток', 'Asia/Tokyo': 'Токио', 'America/New_York': 'Нью-Йорк',
  'America/Los_Angeles': 'Лос-Анджелес', 'UTC': 'Всемирное время',
};

function timezoneLabel(zone) {
  if (!zoneLabels.has(zone)) {
    let offset = '';
    try {
      offset = new Intl.DateTimeFormat('ru-RU', { timeZone: zone, timeZoneName: 'longOffset' })
        .formatToParts(new Date()).find((part) => part.type === 'timeZoneName')?.value || '';
    } catch { /* The server may support a newer timezone database than this WebView. */ }
    zoneLabels.set(zone, [CITY_NAMES[zone], zone, offset.replace('GMT', 'UTC')].filter(Boolean).join(' · '));
  }
  return zoneLabels.get(zone);
}

function timezoneOptions(selected, query = '') {
  const zones = settingsPack?.timezones || (typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []);
  const search = query.trim().toLocaleLowerCase('ru');
  return [...new Set(['UTC', selected, ...zones])].sort().filter((zone) => zone === selected
    || timezoneLabel(zone).toLocaleLowerCase('ru').includes(search))
    .map((zone) => `<option value="${escapeHtml(zone)}"${zone === selected ? ' selected' : ''}>${escapeHtml(timezoneLabel(zone))}</option>`).join('');
}

function schemeScreen() {
  const meds = settings.medications?.length ? settings.medications : ensureSchemeDraft();
  const rows = meds.map((medication, index) => `<button type="button" class="scheme-row" data-edit-med="${index}">
    <span><strong>${escapeHtml(medication.name || 'Препарат без названия')}</strong>
    <small>${medication.intakes.map((item) => `${escapeHtml(item.time)} · ${escapeHtml(item.dose || 'Доза не указана')}`).join('<br>')}</small></span>
    <span class="row-arrow" aria-hidden="true">›</span>
  </button>`).join('');
  return `<button type="button" class="scheme-row profile-row" data-go="profile">
    <span><strong>${escapeHtml(settings.childName)}</strong><small>${escapeHtml(CITY_NAMES[settings.timezone] || settings.timezone)}</small></span>
    <span class="row-arrow" aria-hidden="true">›</span>
  </button>
  <section class="block"><h2 class="block-title">Препараты</h2>
    <div class="scheme-list">${rows}</div>
    ${meds.length < 6 ? '<button class="quiet add-med" type="button" data-add-med>＋ Добавить препарат</button>' : ''}
    <p class="help">Нажмите на препарат, чтобы изменить его приёмы.</p>
  </section><p class="help">${escapeHtml(auditLine())}</p>`;
}

function medicationScreen() {
  const medIndex = editingMedication;
  const medication = schemeDraft?.[medIndex];
  if (!medication) return schemeScreen();
  const count = medication.intakes.length;
  const choices = [1, 2, 3].map((value) => `<button class="count-choice${count === value ? ' on' : ''}" type="button"
    data-count="${value}" data-med="${medIndex}" aria-pressed="${count === value}">${value}</button>`).join('');
  const intakes = medication.intakes.map((intake, index) => `<fieldset class="intake-editor">
    <legend>Приём ${index + 1}</legend><div class="pair">
      <div>${field(`med-time-${medIndex}-${index}`, 'Время', intake.time, 'type="time" required')}</div>
      <div>${field(`med-dose-${medIndex}-${index}`, 'Доза', intake.dose || '', 'maxlength="80" placeholder="1 таблетка" autocomplete="off"')}</div>
    </div></fieldset>`).join('');
  const existing = settings.medications?.some((item) => item.id === medication.id);
  return `<form data-form="medication" class="form editor-form">
    ${field(`med-name-${medIndex}`, 'Название препарата', medication.name || '', 'maxlength="100" required autocomplete="off"')}
    <p class="label-line">Количество приёмов в день</p><div class="count">${choices}</div>
    <div class="intake-list">${intakes}</div>
    <p class="help">Укажите схему, назначенную врачом. Приложение не меняет дозу.</p>
    ${existing && schemeDraft.length > 1 ? `<button class="texty danger" type="button" data-remove-med="${medIndex}">Удалить препарат</button>` : ''}
    <div class="editor-actions"><p class="help" data-editor-status aria-live="polite"></p><button class="primary" type="submit">Сохранить препарат</button></div>
  </form>`;
}

function profileScreen() {
  return `<form data-form="profile" class="form editor-form">
    ${field('childName', 'Имя ребёнка', settings.childName, 'maxlength="50" required autocomplete="name"')}
    <label for="zoneSearch">Поиск часового пояса</label>
    <input id="zoneSearch" type="search" data-zone-search placeholder="Берлин, Москва, Asia…" autocomplete="off">
    <label for="timezone">Часовой пояс</label>
    <select id="timezone" name="timezone" required>${timezoneOptions(settings.timezone)}</select>
    <p class="help">Выберите пояс по местоположению ребёнка. Время приёмов указано в этом поясе; переход на летнее и зимнее время учитывается автоматически.</p>
    <div class="editor-actions"><p class="help" data-editor-status aria-live="polite"></p><button class="primary" type="submit">Сохранить настройки</button></div>
  </form>`;
}

function editorSnapshot() {
  const form = $('screen').querySelector('form');
  if (screen === 'medication') {
    syncSchemeDraft(form);
    return JSON.stringify(schemeDraft?.[editingMedication]);
  }
  if (screen === 'profile' && form) return JSON.stringify({ childName: form.elements.childName.value, timezone: form.elements.timezone.value });
  return null;
}

function editorDirty() {
  return editorBaseline !== null && editorSnapshot() !== editorBaseline;
}

function notificationSettingsDirty(form) {
  const payload = collect(form);
  return ['remindersEnabled', 'telegramRemindersEnabled', 'reminderFirstMinutes', 'reminderUrgentMinutes', 'reminderRepeatMinutes', 'reminderStopMinutes']
    .some((key) => payload[key] !== (settings[key] ?? (key === 'telegramRemindersEnabled' ? true : payload[key])));
}

function leaveEditor() {
  if (saving) return false;
  const notificationsForm = $('screen').querySelector('[data-form=reminders]');
  if (notificationsForm && notificationSettingsDirty(notificationsForm)
    && !window.confirm('Выйти без сохранения настроек уведомлений?')) return false;
  if (editorDirty() && !window.confirm('Выйти без сохранения изменений?')) return false;
  editorBaseline = null;
  editingMedication = null;
  schemeDraft = null;
  return true;
}

function updateEditorStatus() {
  const status = $('screen').querySelector('[data-editor-status]');
  if (status) status.textContent = editorDirty() ? 'Есть несохранённые изменения' : '';
}

function goBack() {
  showScreen(['medication', 'profile'].includes(screen) ? 'scheme' : 'today');
}

function openMedication(index = null) {
  if (!leaveEditor()) return;
  ensureSchemeDraft();
  if (index === null) {
    if (schemeDraft.length >= 6) return;
    schemeDraft.push({ id: newMedId(), name: '', intakes: [{ time: '08:00', dose: '' }, { time: '20:00', dose: '' }] });
    index = schemeDraft.length - 1;
  }
  editingMedication = index;
  screen = 'medication';
  history.replaceState({ epi: screen }, '');
  render();
  editorBaseline = editorSnapshot();
  syncTelegramBack();
}

function remindersScreen() {
  const on = settings.remindersEnabled !== false;
  const number = (name, label, value, min, max) => field(
    name, label, value, `inputmode="numeric" type="number" min="${min}" max="${max}" step="1"`,
  );
  return `<form data-form="reminders" class="form">
    <label class="toggle"><input name="remindersEnabled" type="checkbox"${on ? ' checked' : ''}><span>Напоминать, пока отметки нет</span></label>
    <fieldset id="reminderFields"${on ? '' : ' disabled'}>
      <legend>Когда напоминать</legend>
      <label class="toggle"><input name="telegramRemindersEnabled" type="checkbox"${settings.telegramRemindersEnabled !== false ? ' checked' : ''}><span>Отправлять напоминания в Telegram</span></label>
      ${number('reminderFirstMinutes', 'Первое напоминание, минуты', settings.reminderFirstMinutes ?? 15, 5, 60)}
      ${number('reminderUrgentMinutes', 'Срочное, минуты', settings.reminderUrgentMinutes ?? 30, 10, 120)}
      ${number('reminderRepeatMinutes', 'Повторять каждые, минуты', settings.reminderRepeatMinutes ?? 15, 5, 60)}
      ${number('reminderStopMinutes', 'Повторять не дольше, минуты', settings.reminderStopMinutes ?? 60, 15, 240)}
      <p class="help">Обычно: через 15 минут, срочное через 30, затем каждые 15 минут до часа. Беззвучный режим это не обходит.</p>
    </fieldset>
    <button class="primary" type="submit">Сохранить напоминания</button>
  </form>${parentAppControls()}`;
}

function parentAppControls() {
  const native = window.EpiAppNative;
  if (!native?.parentNotificationStatus) {
    return '<section class="block"><h2 class="block-title">Уведомления в приложении</h2><p class="help">Откройте кабинет в Android-приложении EpiApp 0.7.4 или новее, чтобы получать уведомления на телефоне.</p></section>';
  }
  let status;
  try { status = JSON.parse(native.parentNotificationStatus()); } catch { return ''; }
  return `<section class="block" data-parent-controls>
    <h2 class="block-title">Уведомления на этом телефоне</h2>
    <label class="toggle"><input type="checkbox" data-parent-alerts${status.enabled ? ' checked' : ''}><span>Получать уведомления для родителя</span></label>
    <p class="help">Подтверждения ребёнка и сообщения об отсутствии отметки. В фоне проверяем примерно раз в 15 минут. Android может задерживать проверку.</p>
    <p class="help">${status.permission ? 'Уведомления Android разрешены.' : 'Уведомления Android выключены. Разрешите их в настройках телефона.'}</p>
    ${status.lastCheck ? `<p class="help">Последняя проверка: ${escapeHtml(formatTakenAt(status.lastCheck, settings.timezone))}</p>` : ''}
    <button type="button" class="quiet" data-parent-test${status.enabled && status.permission ? '' : ' disabled'}>Проверить уведомление</button>
    <button type="button" class="texty" data-notification-settings>Настройки уведомлений Android</button>
  </section>`;
}

function notificationsScreen() {
  const rows = [...parentAlerts].reverse().map((item) => `<article class="block">
    <h2 class="block-title">${escapeHtml(item.title)}</h2>
    <p class="sentence">${escapeHtml(item.body)}</p>
    <p class="help">${escapeHtml(formatTakenAt(item.at, state.settings.timezone))}</p>
  </article>`).join('');
  const tabs = `<nav class="notification-tabs" aria-label="Разделы уведомлений">
    <button type="button" data-alert-tab="messages" aria-pressed="${notificationTab === 'messages'}">Сообщения</button>
    <button type="button" data-alert-tab="settings" aria-pressed="${notificationTab === 'settings'}">Настройки</button>
  </nav>`;
  return tabs + (notificationTab === 'settings' ? remindersScreen()
    : `<p class="help">Подтверждения за последние сутки и текущие напоминания.</p>${rows || '<p class="sentence">Новых уведомлений пока нет.</p>'}`);
}

function monthScreen() {
  const stats = stats30;
  const periodForm = demo ? '' : `<form data-form="history-period" class="form">
    <label for="history-through">30 дней по дату</label>
    <input type="date" id="history-through" name="through" max="${escapeHtml(state.today)}" value="${escapeHtml(stats?.periodEnd || state.today)}" required>
    <button class="quiet" type="submit">Показать период</button>
  </form>`;
  const importForm = user?.role === 'admin' ? historyImportForm() : '';
  if (!stats?.days?.length) return `${periodForm}<p class="sentence">За этот период данных нет.</p>${importForm}`;
  const sentence = stats.expected
    ? `За 30 дней отмечено ${stats.taken} из ${stats.expected}.`
    : 'За 30 дней время приёма ещё не наступило.';
  const plan = fallbackPlan(stats);
  const boards = weeksOf(stats.days).map((week) => marksBoard(week, plan)).join('');
  return `${periodForm}<p class="sentence">${escapeHtml(sentence)}</p>
    <p class="split">Полных дней подряд: ${escapeHtml(stats.currentStreak)}.</p>
    <div class="weeks">${boards}</div>
    ${statusLegend()}
    ${importForm}`;
}

function historyImportForm() {
  const plan = planItems();
  const classic = plan.some(({ slot }) => slot === 'morning') && plan.some(({ slot }) => slot === 'evening');
  const options = plan.map(({ slot, label }) => `<option value="${escapeHtml(slot)}">${escapeHtml(label)}</option>`).join('');
  const select = (slot, label) => `<label>${label}
    <select name="${slot}"><option value="">Выберите приём</option>${options}</select></label>`;
  return `<form data-form="import-history" class="form">
    <fieldset>
      <legend>Импорт истории</legend>
      <p class="help">Выберите epiapp.json со старого сервера EpiApp. Из файла будут перенесены отметки о приёме. Уже существующие отметки сохраняются.</p>
      <label>Резервная копия <input type="file" name="backup" accept=".json,application/json" required></label>
      ${classic ? '' : `${select('morning', 'Старый утренний приём')}${select('evening', 'Старый вечерний приём')}`}
    </fieldset>
    <button class="primary" type="submit">Импортировать отметки</button>
  </form>`;
}

function telegramScreen() {
  const ready = Boolean(settingsPack?.telegramConfigured);
  const seats = settingsPack?.family?.length ? settingsPack.family : [
    { title: 'Первый', name: 'Администратор', connected: true },
    { title: 'Второй', name: '', connected: false },
  ];
  const rows = seats.map((seat) => `
    <div class="hist">
      <span class="hist-main"><span>${escapeHtml(seat.title)}</span><small>${escapeHtml(seat.connected ? seat.name : 'не подключён')}</small></span>
      <span>${seat.connected ? 'в Telegram' : 'свободно'}</span>
    </div>`).join('');
  const admin = user?.role === 'admin'
    ? '<p class="help">Второго родителя приглашает администратор кнопкой «Второй родитель» в чате с ботом.</p>'
    : '<p class="help">Второго родителя приглашает администратор в Telegram. Это не обязательно.</p>';
  return `<section class="block">
      <h2 class="block-title">Два родителя</h2>
      ${rows}
      ${admin}
      <p class="sentence">${ready
        ? 'Сообщение об отметке уходит первому родителю и второму, если он подключён.'
        : 'Бот не настроен. Сообщения не отправляются.'}</p>
      <p class="help">Обычное уведомление не содержит название препарата и дозу.</p>
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
    </section>`;
}

function parentToday() {
  return `<section class="block">
      ${doseRows(false)}
      <p class="note">Подтвердить приём может только ребёнок.</p>
    </section>
    <section class="block">${weekBlock()}</section>
    <nav class="menu tiles">
      <button type="button" data-go="scheme"><span>Схема</span><small>препарат и приёмы</small></button>
      <button type="button" data-go="notifications"><span>Уведомления</span><small>сообщения и напоминания</small></button>
      <button type="button" data-go="month"><span>30 дней</span><small>точки за месяц</small></button>
      <button type="button" data-go="telegram"><span>Семья</span><small>второй родитель</small></button>
    </nav>`;
}

function prefSwitch(name, label, hint, on) {
  return `<label class="switch"><span>${label}<small>${hint}</small></span><input type="checkbox" data-pref="${name}"${on ? ' checked' : ''}></label>`;
}

function settingsScreen() {
  const current = prefs.accent;
  const items = ACCENTS.map((item) => `
    <button class="swatch${item.id === current ? ' on' : ''}" type="button" data-accent="${item.id}">
      <i style="background:${item.color}"></i>
      <span>${item.name}</span>
    </button>`).join('');
  const confirm = mode === 'child'
    ? prefSwitch('confirmTake', 'Спрашивать перед отметкой', 'Перед кнопкой «Я принял»', prefs.confirmTake)
    : '';
  return `<section class="block">
      <p class="sentence">Только на этом телефоне. У ребёнка и у родителя свои.</p>
      <p class="label-line">Цвет кнопок и эмблемы</p>
      <div class="swatches">${items}</div>
      <p class="help">Фон остаётся белым.</p>
      ${prefSwitch('largeText', 'Крупный текст', 'Имя, доза и заголовки', prefs.largeText)}
      ${prefSwitch('compact', 'Плотный список', 'Меньше воздуха в карточках и истории', prefs.compact)}
      ${prefSwitch('hints', 'Подсказки', 'Короткие фразы на сегодняшнем экране', prefs.hints)}
      ${prefSwitch('showDate', 'Дата в шапке', 'День под эмблемой. Название экрана остаётся', prefs.showDate)}
      ${prefSwitch('emblem', 'Эмблема', 'Галочка слева в шапке', prefs.emblem)}
      ${confirm}
    </section>`;
}

function render() {
  paintChrome();
  const root = $('screen');
  if (screen === 'settings') root.innerHTML = settingsScreen();
  else if (mode === 'child') root.innerHTML = childScreen();
  else if (screen === 'scheme') root.innerHTML = schemeScreen();
  else if (screen === 'medication') root.innerHTML = medicationScreen();
  else if (screen === 'profile') root.innerHTML = profileScreen();
  else if (screen === 'month') root.innerHTML = monthScreen();
  else if (screen === 'telegram') root.innerHTML = telegramScreen();
  else if (screen === 'notifications') root.innerHTML = notificationsScreen();
  else root.innerHTML = parentToday();
  if (screen === 'profile') $('timezone').value = settings.timezone;
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
    telegramRemindersEnabled: reminders ? readField(form, 'telegramRemindersEnabled', settings.telegramRemindersEnabled !== false) : settings.telegramRemindersEnabled !== false,
    reminderFirstMinutes: Number(readField(form, 'reminderFirstMinutes', settings.reminderFirstMinutes ?? 15)),
    reminderUrgentMinutes: Number(readField(form, 'reminderUrgentMinutes', settings.reminderUrgentMinutes ?? 30)),
    reminderRepeatMinutes: Number(readField(form, 'reminderRepeatMinutes', settings.reminderRepeatMinutes ?? 15)),
    reminderStopMinutes: Number(readField(form, 'reminderStopMinutes', settings.reminderStopMinutes ?? 60)),
  };
  if (form.dataset.form === 'medication') {
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

function chooseAccent(id) {
  savePrefs({ accent: accentById(id).id });
  render();
}

async function save(form, payload = null) {
  const button = form.querySelector('button[type="submit"]');
  if (saving) return;
  saving = true;
  form.inert = true;
  button.disabled = true;
  try {
    const data = await api('/api/parent/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload || collect(form)),
    });
    settings = data.settings;
    settingsPack = { ...settingsPack, ...data, telegramConfigured: settingsPack?.telegramConfigured };
    schemeDraft = null;
    editorBaseline = null;
    editingMedication = null;
    if (['medication', 'profile'].includes(screen)) {
      screen = 'scheme';
      history.replaceState({ epi: screen }, '');
    }
    toast('Сохранено.');
    await refresh();
  } catch (error) {
    toast(error.message, true);
    button.disabled = false;
  } finally {
    form.inert = false;
    saving = false;
  }
}

async function importHistory(form) {
  const button = form.querySelector('button[type="submit"]');
  const file = form.elements.backup.files[0];
  if (!file) return;
  button.disabled = true;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('Резервная копия больше 2 МБ.');
    let backup;
    try {
      backup = JSON.parse(await file.text());
    } catch {
      throw new Error('Не удалось прочитать файл JSON.');
    }
    if (!Array.isArray(backup?.doses) || backup.doses.length > 730) {
      throw new Error('Выберите резервную копию EpiApp со старого сервера.');
    }
    const doses = backup.doses.map((entry) => {
      const { id, slot, localDate, takenAt } = entry ?? {};
      return { id, slot, localDate, takenAt };
    });
    const mapping = Object.fromEntries(['morning', 'evening'].map((slot) => [slot, form.elements[slot]?.value]));
    const { imported, skipped } = await api('/api/parent/stats/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ doses, mapping }),
    });
    form.reset();
    toast(`Добавлено: ${imported}. Уже было: ${skipped}.`);
    await refresh().catch(() => toast('История сохранена. Обновите страницу, чтобы увидеть отметки.'));
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

function monthPath(through) {
  const params = new URLSearchParams({ days: '30' });
  if (through) params.set('through', through);
  return `/api/parent/stats?${params}`;
}

async function showHistoryPeriod(form) {
  const through = form.elements.through.value;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const data = await api(monthPath(through));
    monthThrough = through === state.today ? '' : through;
    stats30 = data.stats;
    if (screen === 'month') render();
  } catch (error) {
    toast(error.message, true);
  } finally {
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

function publishNativeSchedule() {
  const native = window.EpiAppNative;
  if (!native?.syncSchedule || !state?.settings) return;
  const plan = (mode === 'child' ? planItems() : []).map((item) => ({
    slot: item.slot,
    time: item.time,
    dose: item.dose || '',
    medicationName: item.medicationName || '',
    taken: Boolean(state.todayDoses?.[item.slot]),
  }));
  native.syncSchedule(JSON.stringify({
    timezone: state.settings.timezone || 'Europe/Berlin',
    remindersEnabled: state.settings.remindersEnabled !== false,
    reminderFirstMinutes: state.settings.reminderFirstMinutes ?? 15,
    reminderUrgentMinutes: state.settings.reminderUrgentMinutes ?? 30,
    reminderRepeatMinutes: state.settings.reminderRepeatMinutes ?? 15,
    reminderStopMinutes: state.settings.reminderStopMinutes ?? 60,
    childName: state.settings.childName || '',
    plan,
  }));
}

async function refresh() {
  if (mode === 'child') {
    state = await api('/api/state');
  } else {
    const [today, week, month, pack, alerts] = await Promise.all([
      api('/api/state'),
      api('/api/parent/stats?days=7'),
      api(monthPath(monthThrough)),
      api('/api/parent/settings'),
      api('/api/parent/notifications'),
    ]);
    state = today;
    stats7 = week.stats;
    stats30 = month.stats;
    settingsPack = pack;
    settings = pack.settings;
    parentAlerts = alerts.notifications;
  }
  render();
  publishNativeSchedule();
  if (mode === 'parent') window.EpiAppNative?.checkParentNotifications?.();
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
  window.epiappParentNotificationsChanged = () => {
    const controls = $('screen').querySelector('[data-parent-controls]');
    if (controls) controls.outerHTML = parentAppControls();
  };
  const params = new URLSearchParams(location.search);
  const demoName = params.get('demo');
  demo = demoName === '1' || demoName === 'child' || demoName === 'parent';
  paintTelegram();
  if (!history.state?.epi) history.replaceState({ epi: 'today' }, '');
  window.addEventListener('popstate', () => {
    if (!leaveEditor()) { history.pushState({ epi: screen }, ''); return; }
    screen = history.state?.epi && history.state.epi !== 'today' ? history.state.epi : 'today';
    if (screen === 'reminders') { screen = 'notifications'; notificationTab = 'settings'; }
    if (['medication', 'profile'].includes(screen)) screen = 'scheme';
    if (screen === 'today') schemeDraft = null;
    render();
    syncTelegramBack();
  });
  window.addEventListener('beforeunload', (event) => {
    const reminders = $('screen').querySelector('[data-form=reminders]');
    if (editorDirty() || saving || (reminders && notificationSettingsDirty(reminders))) { event.preventDefault(); event.returnValue = ''; }
  });
  window.Telegram?.WebApp?.BackButton?.onClick(goBack);
  $('gear').addEventListener('click', () => {
    if (screen === 'today') showScreen('settings');
    else goBack();
  });
  $('screen').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-alert-tab]');
    if (tab && tab.dataset.alertTab !== notificationTab) {
      if (saving) return;
      const form = $('screen').querySelector('[data-form=reminders]');
      if (form && notificationSettingsDirty(form) && !window.confirm('Выйти без сохранения настроек уведомлений?')) return;
      notificationTab = tab.dataset.alertTab;
      render();
      return;
    }
    if (event.target.closest('[data-parent-test]')) {
      const sent = window.EpiAppNative?.testParentNotification?.();
      toast(sent ? 'Тестовое уведомление отправлено на этот телефон.' : 'Разрешите уведомления в настройках телефона.', !sent);
      return;
    }
    if (event.target.closest('[data-notification-settings]')) {
      window.EpiAppNative?.openNotificationSettings?.();
      return;
    }
    const go = event.target.closest('[data-go]');
    if (go) {
      showScreen(go.dataset.go);
      return;
    }
    const edit = event.target.closest('[data-edit-med]');
    if (edit) { openMedication(Number(edit.dataset.editMed)); return; }
    const accent = event.target.closest('[data-accent]');
    if (accent) {
      chooseAccent(accent.dataset.accent);
      return;
    }
    const count = event.target.closest('[data-count]');
    if (count) {
      syncSchemeDraft(count.closest('form'));
      const medication = schemeDraft?.[Number(count.dataset.med)];
      if (medication) {
        const nextCount = Number(count.dataset.count);
        if (nextCount < medication.intakes.length && !window.confirm('Убрать лишние приёмы из этого препарата?')) return;
        setIntakeCount(medication, nextCount);
      }
      render();
      updateEditorStatus();
      return;
    }
    if (event.target.closest('[data-add-med]')) { openMedication(); return; }
    const remove = event.target.closest('[data-remove-med]');
    if (remove) {
      if (!window.confirm('Удалить препарат из схемы?')) return;
      const index = Number(remove.dataset.removeMed);
      const form = remove.closest('form');
      const payload = collect(form);
      const removed = schemeDraft.splice(index, 1)[0];
      save(form, payload).finally(() => { if (screen === 'medication' && schemeDraft) schemeDraft.splice(index, 0, removed); });
      return;
    }
    const take = event.target.closest('.take');
    if (take) {
      if (prefs.confirmTake) openSheet(take.dataset.slot);
      else {
        pendingSlot = take.dataset.slot;
        confirmTake();
      }
    }
    if (event.target.id === 'historyToggle') {
      historyExpanded = !historyExpanded;
      render();
    }
    if (event.target.id === 'testTelegram') sendTest();
  });
  $('screen').addEventListener('input', (event) => {
    if (event.target.hasAttribute('data-zone-search')) {
      const select = event.target.form.elements.timezone;
      const selected = select.value;
      select.innerHTML = timezoneOptions(selected, event.target.value);
      select.value = selected;
    }
    event.target.setCustomValidity?.('');
    updateEditorStatus();
  });
  $('screen').addEventListener('change', (event) => {
    updateEditorStatus();
    if (event.target.hasAttribute('data-parent-alerts')) {
      window.EpiAppNative?.setParentNotificationsEnabled?.(event.target.checked);
      toast(event.target.checked ? 'Уведомления на этом телефоне включены.' : 'Уведомления на этом телефоне выключены.');
      return;
    }
    const pref = event.target.dataset.pref;
    if (pref) {
      savePrefs({ [pref]: event.target.checked });
      return;
    }
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
    if (event.target.dataset.form === 'history-period') showHistoryPeriod(event.target);
    else if (event.target.dataset.form === 'import-history') importHistory(event.target);
    else {
      if (event.target.dataset.form === 'medication') {
        syncSchemeDraft(event.target);
        const nameInput = event.target.elements[`med-name-${editingMedication}`];
        nameInput.setCustomValidity(nameInput.value.trim() ? '' : 'Введите название препарата.');
        const seen = new Set();
        for (const [index, item] of schemeDraft[editingMedication].intakes.entries()) {
          const input = event.target.elements[`med-time-${editingMedication}-${index}`];
          input.setCustomValidity(seen.has(item.time) ? 'Время приёмов не должно совпадать.' : '');
          seen.add(item.time);
        }
        if (!event.target.reportValidity()) return;
      }
      save(event.target);
    }
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
    loadPrefs();
    applyDemo();
    showApp();
    const requested = params.get('screen');
    if (mode === 'parent' && ['scheme', 'reminders', 'month', 'telegram', 'notifications'].includes(requested)) {
      screen = requested === 'reminders' ? 'notifications' : requested;
      if (requested === 'reminders') notificationTab = 'settings';
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
    loadPrefs();
    showApp();
    try {
      await refresh();
    } catch (error) {
      $('app').hidden = true;
      $('gate').hidden = false;
      throw error;
    }
    setInterval(() => {
      if (['today', 'notifications', 'reminders'].includes(screen) && $('sheet').hidden
        && !$('screen').querySelector('form')) refresh().catch(() => undefined);
    }, 30000);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js?v=11').catch(() => undefined);
  }).catch((error) => {
    $('gateMessage').textContent = error.message || 'Доступ закрыт.';
  });
}
