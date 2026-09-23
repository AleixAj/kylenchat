const $ = (id) => document.getElementById(id);

let lang = 'es';
let settings = null;
let lastState = null;
let welcomeShown = false;
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
  barColor: { type: 'color' },
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
// probar uno tras otro sin que queden restos del anterior. Las fuentes van incluidas en la app (fonts.css).
const LOOK_BASE = {
  fontSize: 20, fontFamily: 'Segoe UI', bold: false, textColor: '#ffffff', userColors: true,
  bgColor: '#000000', bgOpacity: 25, barColor: '#9146ff', outline: true, opacity: 100, emoteScale: 1.6,
};
const PRESETS = {
  default: { ...LOOK_BASE },
  twitch: { ...LOOK_BASE, fontFamily: 'Inter', fontSize: 15, bold: false, textColor: '#efeff1', bgColor: '#18181b', bgOpacity: 90, outline: false, barColor: '#9146ff' },
  contrast: { ...LOOK_BASE, fontFamily: 'Atkinson Hyperlegible', fontSize: 19, bold: true, textColor: '#ffe600', bgOpacity: 85, barColor: '#ffe600' },
  big: { ...LOOK_BASE, fontFamily: 'Lilita One', fontSize: 24, bold: false, bgOpacity: 50, emoteScale: 1.8, barColor: '#9146ff' },
  terminal: { ...LOOK_BASE, fontFamily: 'Cascadia Code', fontSize: 15, textColor: '#39ff14', bgColor: '#050805', bgOpacity: 75, outline: false, barColor: '#39ff14' },
  neon: { ...LOOK_BASE, fontFamily: 'Exo 2', fontSize: 18, bold: true, textColor: '#00f0ff', bgColor: '#12002b', bgOpacity: 55, barColor: '#00f0ff' },
  runic: { ...LOOK_BASE, fontFamily: 'Alegreya', fontSize: 20, bold: true, textColor: '#f3dfa2', bgColor: '#2a1a0c', bgOpacity: 70, barColor: '#c9a227' },
  comic: { ...LOOK_BASE, fontFamily: 'Comic Neue', fontSize: 19, bold: true, textColor: '#1b1b1b', userColors: false, bgColor: '#fff1a8', bgOpacity: 92, outline: false, barColor: '#ffb000' },
  glacier: { ...LOOK_BASE, fontFamily: 'Quicksand', fontSize: 18, bold: true, textColor: '#e8f8ff', bgColor: '#0b4a73', bgOpacity: 45, barColor: '#4fc3ff' },
  forest: { ...LOOK_BASE, fontFamily: 'Nunito', fontSize: 18, bold: true, textColor: '#e3ffd6', bgColor: '#123d22', bgOpacity: 60, barColor: '#3ddc84' },
  chalk: { ...LOOK_BASE, fontFamily: 'Patrick Hand', fontSize: 21, bold: false, textColor: '#f4f4f4', bgColor: '#1f3326', bgOpacity: 80, outline: false, barColor: '#9ccc9c' },
  arcade: { ...LOOK_BASE, fontFamily: 'Press Start 2P', fontSize: 12, bold: false, textColor: '#ffffff', bgColor: '#1a0b3d', bgOpacity: 70, emoteScale: 2.2, barColor: '#ff2e97' },
  sakura: { ...LOOK_BASE, fontFamily: 'Space Grotesk', fontSize: 20, bold: true, textColor: '#ffffff', bgColor: '#ff8fc8', bgOpacity: 10, outline: true, barColor: '#ff5fae' },
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
  // La guía sale solo la primera vez que se abre la app: se marca como vista al mostrarla,
  // así no vuelve aunque se cierre la ventana sin pulsar "Empezar".
  if (!settings.onboarded && !welcomeShown) {
    welcomeShown = true;
    $('welcome').classList.add('show');
    api.setSettings({ onboarded: true });
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

// ---------- Fuentes instaladas ----------

// Fuentes que trae la propia app: siempre salen en la lista, las tenga el PC o no.
const BUNDLED_FONTS = ['Space Grotesk', 'Inter', 'Atkinson Hyperlegible', 'Lilita One', 'Cascadia Code', 'Exo 2', 'Alegreya', 'Comic Neue', 'Quicksand', 'Nunito', 'Patrick Hand', 'Press Start 2P'];
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
  const { editMode, visible, testMode, bounds, maxSize, version, shortcutErrors, canAutoStart, whatsNew } = state;
  $('edit').textContent = tr(editMode ? 'editOn' : 'editOff');
  $('edit').classList.toggle('primary', editMode); // morado solo mientras se puede mover
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
  renderUpdate(state);

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

// ---------- Actualización (solo se descarga si el usuario pulsa el botón) ----------

function renderUpdate({ updateAvailable, updateProgress, updateError, updateReady }) {
  const banner = $('update');
  const button = $('installUpdate');
  banner.classList.toggle('show', Boolean(updateAvailable || updateReady));
  button.hidden = updateProgress !== null;
  if (updateReady) {
    $('updateText').textContent = tr('updateReady', { version: updateReady });
    button.textContent = tr('restart');
  } else if (updateProgress !== null) {
    $('updateText').textContent = tr('updateDownloading', { version: updateAvailable, percent: updateProgress });
  } else if (updateAvailable) {
    $('updateText').textContent = tr(updateError ? 'updateError' : 'updateAvailable', { version: updateAvailable });
    button.textContent = tr(updateError ? 'retry' : 'download');
  }
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
$('installUpdate').addEventListener('click', () => {
  if (lastState && lastState.updateReady) api.installUpdate();
  else api.downloadUpdate();
});
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
  $('backupStatus').classList.toggle('bad', result === 'error');
  $('backupStatus').textContent = { ok: tr('exportOk'), error: tr('exportError') }[result] || '';
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
