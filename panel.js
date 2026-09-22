const $ = (id) => document.getElementById(id);

let lang = 'es';
let lastState = null;
const tr = (key, vars) => i18n.t(lang, key, vars);

// Traduce todos los textos marcados en el HTML y los que dependen del estado.
function applyLanguage(newLang) {
  lang = newLang;
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = tr(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = tr(el.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = tr(el.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = tr(el.dataset.i18nPlaceholder); });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', tr(el.dataset.i18nAria)));
  document.querySelectorAll('[data-lang]').forEach((b) => b.classList.toggle('active', b.dataset.lang === lang));
  for (const key of Object.keys(FIELDS)) showValue(key);
  if ($('channelError').textContent) $('channelError').textContent = tr('channelInvalid');
  if (lastState) applyState(lastState);
}

// Cada ajuste: tipo de control y cómo se muestra su valor.
const FIELDS = {
  fontSize: { type: 'range', show: (v) => `${v} px` },
  fontFamily: { type: 'select' },
  bold: { type: 'check' },
  textColor: { type: 'color' },
  userColors: { type: 'check' },
  outline: { type: 'check' },
  bgColor: { type: 'color' },
  bgOpacity: { type: 'range', show: (v) => `${v} %` },
  opacity: { type: 'range', show: (v) => `${v} %` },
  maxMessages: { type: 'range', show: (v) => String(v) },
  animatedEmotes: { type: 'check' },
  hideBots: { type: 'check' },
  showHeader: { type: 'check' },
  highlightMentions: { type: 'check' },
  keywords: { type: 'text' },
  highlightFirst: { type: 'check' },
  showBadges: { type: 'check' },
  timestamps: { type: 'check' },
  autoStart: { type: 'check' },
  fadeAfter: { type: 'range', show: (v) => (Number(v) === 0 ? tr('never') : `${v} s`) },
};

function readField(el, type) {
  if (type === 'check') return el.checked;
  if (type === 'range') return Number(el.value);
  return el.value;
}

function showValue(key) {
  const f = FIELDS[key];
  if (f.show) $(`${key}Val`).textContent = f.show($(key).value);
}

// Rellena los controles con los ajustes (al abrir y tras "Restablecer aspecto").
function fillFields(settings) {
  if (settings.language !== lang) applyLanguage(settings.language);
  if (document.activeElement !== $('channel')) $('channel').value = settings.channel;
  for (const [key, { type }] of Object.entries(FIELDS)) {
    const el = $(key);
    if (el === document.activeElement && type === 'text') continue; // no pisar lo que se está escribiendo
    if (type === 'check') el.checked = settings[key];
    else el.value = settings[key];
    showValue(key);
  }
}

// Acepta "nombre", "#nombre" o el enlace completo de twitch.tv.
function normalizeChannel(value) {
  return value.trim()
    .replace(/^https?:\/\/(www\.|m\.)?twitch\.tv\//i, '')
    .replace(/^#/, '')
    .split(/[/?]/)[0]
    .toLowerCase();
}

function connect() {
  const channel = normalizeChannel($('channel').value);
  if (channel && !/^[a-z0-9_]{1,25}$/.test(channel)) {
    $('channelError').textContent = tr('channelInvalid');
    return;
  }
  $('channelError').textContent = '';
  $('channel').value = channel;
  api.setSettings({ channel });
}

function applyState(state) {
  lastState = state;
  const { editMode, visible, testMode, bounds, maxSize, version, updateReady, shortcutErrors, canAutoStart } = state;
  $('edit').textContent = tr(editMode ? 'editOn' : 'editOff');
  $('visible').textContent = tr(visible ? 'hideChat' : 'showChat');
  $('test').textContent = tr(testMode ? 'testOn' : 'testOff');
  $('test').classList.toggle('primary', testMode);

  $('width').max = maxSize.width;
  $('height').max = maxSize.height;
  $('width').value = bounds.width;
  $('height').value = bounds.height;
  $('widthVal').textContent = `${bounds.width} px`;
  $('heightVal').textContent = `${bounds.height} px`;

  $('version').textContent = `v${version}`;
  $('update').classList.toggle('show', Boolean(updateReady));
  if (updateReady) $('updateText').textContent = tr('updateReady', { version: updateReady });

  $('shortcutWarn').textContent = shortcutErrors.length
    ? tr('shortcutWarn', { keys: shortcutErrors.join(tr('and')) })
    : '';
  $('startupSection').hidden = !canAutoStart; // solo tiene sentido en la versión instalada
}

for (const [key, { type }] of Object.entries(FIELDS)) {
  const el = $(key);
  el.addEventListener('input', () => {
    showValue(key);
    api.setSettings({ [key]: readField(el, type) });
  });
}

$('connect').addEventListener('click', connect);
$('channel').addEventListener('keydown', (e) => e.key === 'Enter' && connect());
$('installUpdate').addEventListener('click', () => api.installUpdate());
$('edit').addEventListener('click', () => api.toggleEdit());
$('visible').addEventListener('click', () => api.toggleVisible());
$('test').addEventListener('click', () => api.toggleTest());
$('reset').addEventListener('click', () => api.resetLook());
$('repo').addEventListener('click', () => api.openRepo());
document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => api.setSettings({ language: b.dataset.lang })));
document.querySelectorAll('[data-pos]').forEach((b) => b.addEventListener('click', () => api.setPosition(b.dataset.pos)));

const sendSize = () => api.setSize(Number($('width').value), Number($('height').value));
$('width').addEventListener('input', sendSize);
$('height').addEventListener('input', sendSize);

applyLanguage(lang); // textos en español mientras llegan los ajustes guardados

api.onSettings(fillFields);
api.onState(applyState);
api.getSettings().then(fillFields);
api.getState().then(applyState);
