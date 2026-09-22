const $ = (id) => document.getElementById(id);

let lang = 'es';
let settings = null;
let lastState = null;
const tr = (key, vars) => i18n.t(lang, key, vars);
const secondsOrNever = (v) => (Number(v) === 0 ? tr('never') : `${v} s`);

// Cada ajuste: tipo de control y cómo se muestra su valor.
const FIELDS = {
  fontSize: { type: 'range', show: (v) => `${v} px` },
  fontFamily: { type: 'select' },
  bold: { type: 'check' },
  textColor: { type: 'color' },
  userColors: { type: 'check' },
  outline: { type: 'check' },
  emoteScale: { type: 'range', show: (v) => `${Number(v).toFixed(1)}×` },
  bgColor: { type: 'color' },
  bgOpacity: { type: 'range', show: (v) => `${v} %` },
  opacity: { type: 'range', show: (v) => `${v} %` },
  align: { type: 'select' },
  newestOnTop: { type: 'boolSelect' },
  highlightMentions: { type: 'check' },
  keywords: { type: 'text' },
  highlightFirst: { type: 'check' },
  showBadges: { type: 'check' },
  timestamps: { type: 'check' },
  hideBots: { type: 'check' },
  mutedUsers: { type: 'text' },
  maxMessages: { type: 'range', show: (v) => String(v) },
  fadeAfter: { type: 'range', show: secondsOrNever },
  idleHide: { type: 'range', show: secondsOrNever },
  animatedEmotes: { type: 'check' },
  autoStart: { type: 'check' },
};

// Estilos rápidos: cada uno fija todo el aspecto (fuente, colores, fondo...), así que se pueden
// probar uno tras otro sin que queden restos del anterior. Usan fuentes de Windows o incluidas en la app.
const LOOK_BASE = {
  fontSize: 16, fontFamily: 'Segoe UI', bold: false, textColor: '#ffffff', userColors: true,
  bgColor: '#000000', bgOpacity: 35, outline: true, opacity: 100, emoteScale: 1.6,
};
const PRESETS = {
  default: { ...LOOK_BASE },
  minimal: { ...LOOK_BASE, fontFamily: 'Bahnschrift', fontSize: 17, bgOpacity: 0, emoteScale: 1.5 },
  twitch: { ...LOOK_BASE, fontFamily: 'Segoe UI Semibold', fontSize: 14, textColor: '#efeff1', bgColor: '#18181b', bgOpacity: 90, outline: false },
  contrast: { ...LOOK_BASE, fontFamily: 'Verdana', fontSize: 18, bold: true, textColor: '#ffe600', bgOpacity: 85 },
  big: { ...LOOK_BASE, fontFamily: 'Arial Black', fontSize: 24, bgOpacity: 50, emoteScale: 1.8 },
  terminal: { ...LOOK_BASE, fontFamily: 'Consolas', fontSize: 15, textColor: '#39ff14', bgColor: '#050805', bgOpacity: 75, outline: false },
  sakura: { ...LOOK_BASE, fontFamily: 'Space Grotesk', fontSize: 20, bold: true, textColor: '#ffffff', bgColor: '#ff8fc8', bgOpacity: 15, outline: true },
};

// Cada botón de estilo se ve con su propia fuente y colores, como una muestra.
function paintPresetButtons() {
  document.querySelectorAll('[data-preset]').forEach((b) => {
    const p = PRESETS[b.dataset.preset];
    const n = parseInt(p.bgColor.slice(1), 16);
    const alpha = p.bgOpacity ? Math.max(0.6, p.bgOpacity / 100) : 0;
    b.style.fontFamily = `"${p.fontFamily}", "Segoe UI", sans-serif`;
    b.style.fontWeight = p.bold ? '700' : '400';
    b.style.color = p.textColor;
    b.style.background = `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
    b.style.textShadow = p.outline ? '0 0 2px #000, 1px 1px 1px #000' : 'none';
  });
}

function readField(el, type) {
  if (type === 'check') return el.checked;
  if (type === 'range') return Number(el.value);
  if (type === 'boolSelect') return el.value === 'true';
  return el.value;
}

function writeField(el, type, value) {
  if (type === 'check') el.checked = value;
  else el.value = String(value);
}

function showValue(key) {
  const f = FIELDS[key];
  if (f.show) $(`${key}Val`).textContent = f.show($(key).value);
}

// ---------- Idioma ----------

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
  $('backupStatus').textContent = '';
  if (settings) renderProfiles();
  if (lastState) applyState(lastState);
}

// ---------- Ajustes ----------

// Rellena los controles con los ajustes (al abrir, tras un perfil, una importación, etc.).
function fillFields(newSettings) {
  settings = newSettings;
  if (settings.language !== lang) applyLanguage(settings.language);
  if (document.activeElement !== $('channel')) $('channel').value = settings.channel;
  ensureFontOption(settings.fontFamily);
  for (const [key, { type }] of Object.entries(FIELDS)) {
    const el = $(key);
    if (el === document.activeElement && type === 'text') continue; // no pisar lo que se está escribiendo
    writeField(el, type, settings[key]);
    showValue(key);
  }
  renderProfiles();
  $('welcome').classList.toggle('show', !settings.onboarded);
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

// ---------- Fuentes instaladas ----------

// Fuentes que trae la propia app: siempre salen en la lista, las tenga el PC o no.
const BUNDLED_FONTS = ['Space Grotesk'];
const BASIC_FONTS = [...BUNDLED_FONTS, 'Segoe UI', 'Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Consolas', 'Impact', 'Comic Sans MS'];

function fillFontList(families) {
  const select = $('fontFamily');
  select.replaceChildren(...families.map((f) => {
    const opt = document.createElement('option');
    opt.value = opt.textContent = f;
    return opt;
  }));
  if (settings) {
    ensureFontOption(settings.fontFamily);
    select.value = settings.fontFamily;
  }
}

function ensureFontOption(family) {
  const select = $('fontFamily');
  if (![...select.options].some((o) => o.value === family)) {
    const opt = document.createElement('option');
    opt.value = opt.textContent = family;
    select.prepend(opt);
  }
}

// Pide a Windows la lista de fuentes; si no se puede, se queda con las básicas.
async function loadFonts() {
  fillFontList(BASIC_FONTS);
  try {
    const fonts = await window.queryLocalFonts();
    const families = [...new Set([...BUNDLED_FONTS, ...fonts.map((f) => f.family)])]
      .filter((f) => /^[^"'\\;{}<>]{1,64}$/.test(f))
      .sort((a, b) => a.localeCompare(b));
    if (families.length) fillFontList(families);
  } catch {
    // sin permiso o sin soporte: lista básica
  }
}

// ---------- Perfiles ----------

function renderProfiles() {
  const list = $('profileList');
  const { profiles, activeProfile } = settings;
  if (!profiles.length) {
    const opt = document.createElement('option');
    opt.textContent = tr('noProfiles');
    list.replaceChildren(opt);
  } else {
    list.replaceChildren(...profiles.map((p) => {
      const opt = document.createElement('option');
      opt.value = opt.textContent = p.name;
      return opt;
    }));
    if (activeProfile) list.value = activeProfile;
  }
  list.disabled = !profiles.length;
  $('profileLoad').disabled = !profiles.length;
  $('profileDelete').disabled = !profiles.length;
}

function saveProfile() {
  const name = $('profileName').value.trim();
  if (!name) {
    $('profileName').focus();
    return;
  }
  api.saveProfile(name);
  $('profileName').value = '';
}

// ---------- Estado (botones, versión, avisos) ----------

function applyState(state) {
  lastState = state;
  const { editMode, visible, testMode, bounds, maxSize, version, updateReady, shortcutErrors, canAutoStart, whatsNew } = state;
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

  const notes = whatsNew && ((i18n.CHANGELOG[lang] || {})[whatsNew] || (i18n.CHANGELOG.es || {})[whatsNew]);
  $('whatsNew').classList.toggle('show', Boolean(notes));
  if (notes) {
    $('whatsNewTitle').textContent = tr('whatsNewTitle', { version: whatsNew });
    $('whatsNewList').replaceChildren(...notes.map((n) => {
      const li = document.createElement('li');
      li.textContent = n;
      return li;
    }));
  }

  $('shortcutWarn').textContent = shortcutErrors.length
    ? tr('shortcutWarn', { keys: shortcutErrors.join(tr('and')) })
    : '';
  $('startupSection').hidden = !canAutoStart; // solo tiene sentido en la versión instalada
}

// ---------- Pestañas ----------

function showTab(name) {
  document.querySelectorAll('[data-tab]').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === name);
    b.setAttribute('aria-selected', String(b.dataset.tab === name));
  });
  document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== name; });
  try { localStorage.setItem('tab', name); } catch { /* sin almacenamiento: da igual */ }
}

// ---------- Eventos ----------

for (const [key, { type }] of Object.entries(FIELDS)) {
  const el = $(key);
  el.addEventListener(type === 'select' || type === 'boolSelect' ? 'change' : 'input', () => {
    showValue(key);
    api.setSettings({ [key]: readField(el, type) });
  });
}

$('connect').addEventListener('click', connect);
$('channel').addEventListener('keydown', (e) => e.key === 'Enter' && connect());
$('installUpdate').addEventListener('click', () => api.installUpdate());
$('whatsNewOk').addEventListener('click', () => api.dismissWhatsNew());
$('edit').addEventListener('click', () => api.toggleEdit());
$('visible').addEventListener('click', () => api.toggleVisible());
$('test').addEventListener('click', () => api.toggleTest());
$('reset').addEventListener('click', () => api.resetLook());
$('repo').addEventListener('click', () => api.openRepo());
$('welcomeStart').addEventListener('click', () => {
  $('welcome').classList.remove('show');
  api.setSettings({ onboarded: true });
  $('channel').focus();
});
$('profileSave').addEventListener('click', saveProfile);
$('profileName').addEventListener('keydown', (e) => e.key === 'Enter' && saveProfile());
$('profileLoad').addEventListener('click', () => api.loadProfile($('profileList').value));
$('profileDelete').addEventListener('click', () => api.deleteProfile($('profileList').value));
$('exportSettings').addEventListener('click', async () => {
  const result = await api.exportSettings();
  $('backupStatus').classList.remove('bad');
  $('backupStatus').textContent = result === 'ok' ? tr('exportOk') : '';
});
$('importSettings').addEventListener('click', async () => {
  const result = await api.importSettings();
  $('backupStatus').classList.toggle('bad', result === 'invalid');
  $('backupStatus').textContent = { ok: tr('importOk'), invalid: tr('importInvalid') }[result] || '';
});
document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => api.setSettings({ language: b.dataset.lang })));
document.querySelectorAll('[data-pos]').forEach((b) => b.addEventListener('click', () => api.setPosition(b.dataset.pos)));
document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => api.setSettings(PRESETS[b.dataset.preset])));
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

const sendSize = () => api.setSize(Number($('width').value), Number($('height').value));
$('width').addEventListener('input', sendSize);
$('height').addEventListener('input', sendSize);

// ---------- Inicio ----------

let savedTab = 'look';
try { savedTab = localStorage.getItem('tab') || 'look'; } catch { /* sin almacenamiento */ }
showTab(document.querySelector(`[data-tab="${savedTab}"]`) ? savedTab : 'look');
paintPresetButtons();
applyLanguage(lang); // textos en español mientras llegan los ajustes guardados

api.onSettings(fillFields);
api.onState(applyState);
api.getSettings().then(fillFields).then(loadFonts);
api.getState().then(applyState);
