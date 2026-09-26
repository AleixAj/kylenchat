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
  showViewers: { type: 'check' },
  opacity: { type: 'range', show: (v) => `${v} %` },
  align: { type: 'select' },
  newestOnTop: { type: 'boolSelect' },
  highlightMentions: { type: 'check' },
  keywords: { type: 'text' },
  highlightFirst: { type: 'check' },
  showRedemptions: { type: 'check' },
  showBadges: { type: 'check' },
  timestamps: { type: 'check' },
  hideBots: { type: 'check' },
  mutedUsers: { type: 'text' },
  liveDuration: { type: 'range', show: (v) => `${v} s` },
  liveSound: { type: 'check' },
  liveVolume: { type: 'range', show: (v) => `${v} %` },
  showDeleted: { type: 'check' },
  maxMessages: { type: 'range', show: (v) => String(v) },
  fadeAfter: { type: 'range', show: secondsOrNever },
  idleHide: { type: 'range', show: secondsOrNever },
  animatedEmotes: { type: 'check' },
  autoStart: { type: 'check' },
};

// Estilos rápidos: cada uno fija todo el aspecto (fuente, colores, fondo...), así que se pueden
// probar uno tras otro sin que queden restos del anterior. Las fuentes van incluidas en la app (fonts.css).
const LOOK_BASE = {
  fontSize: 15, fontFamily: 'Segoe UI', bold: false, textColor: '#ffffff', userColors: true,
  bgColor: '#000000', bgOpacity: 25, barColor: '#9146ff', outline: true, opacity: 100, emoteScale: 1.6,
  theme: '', themeTag: '', themeDecor: true, // sin estilo de juego
};
const PRESETS = {
  default: { ...LOOK_BASE },
  twitch: { ...LOOK_BASE, fontFamily: 'Inter', fontSize: 15, bold: false, textColor: '#efeff1', bgColor: '#18181b', bgOpacity: 90, outline: false, barColor: '#9146ff' },
  contrast: { ...LOOK_BASE, fontFamily: 'Atkinson Hyperlegible', fontSize: 19, bold: true, textColor: '#ffe600', bgOpacity: 85, barColor: '#ffe600' },
  big: { ...LOOK_BASE, fontFamily: 'Lilita One', fontSize: 20, bold: false, bgOpacity: 50, emoteScale: 1.8, barColor: '#9146ff' },
  terminal: { ...LOOK_BASE, fontFamily: 'Cascadia Code', fontSize: 15, textColor: '#39ff14', bgColor: '#050805', bgOpacity: 75, outline: false, barColor: '#39ff14' },
  neon: { ...LOOK_BASE, fontFamily: 'Exo 2', fontSize: 18, bold: true, textColor: '#00f0ff', bgColor: '#12002b', bgOpacity: 55, barColor: '#00f0ff' },
  runic: { ...LOOK_BASE, fontFamily: 'Alegreya', fontSize: 20, bold: true, textColor: '#f3dfa2', bgColor: '#2a1a0c', bgOpacity: 70, barColor: '#c9a227' },
  comic: { ...LOOK_BASE, fontFamily: 'Comic Neue', fontSize: 19, bold: true, textColor: '#1b1b1b', userColors: false, bgColor: '#fff1a8', bgOpacity: 92, outline: false, barColor: '#ffb000' },
  glacier: { ...LOOK_BASE, fontFamily: 'Quicksand', fontSize: 18, bold: true, textColor: '#e8f8ff', bgColor: '#0b4a73', bgOpacity: 45, barColor: '#4fc3ff' },
  forest: { ...LOOK_BASE, fontFamily: 'Nunito', fontSize: 18, bold: true, textColor: '#e3ffd6', bgColor: '#123d22', bgOpacity: 60, barColor: '#3ddc84' },
  chalk: { ...LOOK_BASE, fontFamily: 'Patrick Hand', fontSize: 21, bold: false, textColor: '#f4f4f4', bgColor: '#1f3326', bgOpacity: 80, outline: false, barColor: '#9ccc9c' },
  arcade: { ...LOOK_BASE, fontFamily: 'Press Start 2P', fontSize: 12, bold: false, textColor: '#ffffff', bgColor: '#1a0b3d', bgOpacity: 70, emoteScale: 2.2, barColor: '#ff2e97' },
  sakura: { ...LOOK_BASE, fontFamily: 'Space Grotesk', fontSize: 15, bold: true, textColor: '#ffffff', bgColor: '#ff8fc8', bgOpacity: 10, outline: true, barColor: '#ff5fae' },
};

// Cada botón de estilo se ve con su propia fuente y colores, como una muestra.
function paintPresetButtons() {
  document.querySelectorAll('[data-preset]').forEach((b) => {
    const p = PRESETS[b.dataset.preset];
    const n = parseInt(p.bgColor.slice(1), 16);
    const alpha = p.bgOpacity ? Math.max(0.6, p.bgOpacity / 100) : 0;
    b.style.fontFamily = `"${p.fontFamily}", "Segoe UI", system-ui, sans-serif`;
    b.style.fontWeight = p.bold ? '700' : '400';
    b.style.color = p.textColor;
    b.style.background = `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
    b.style.textShadow = p.outline ? '0 0 2px #000, 1px 1px 1px #000' : 'none';
  });
}

// ---------- Ventanas de chat (la principal y los otros chats) ----------

const EYE_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.1 4M6.6 6.6A17.3 17.3 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
const EXTRA_CHATS_MAX = 3;
let chatsKey = '';

function renderChats() {
  if (!settings) return;
  const chats = settings.extraChats || [];
  const key = JSON.stringify([lang, chats, settings.chatVisible]);
  if (key === chatsKey) return;
  chatsKey = key;
  const mainEye = $('mainEye');
  mainEye.innerHTML = settings.chatVisible ? EYE_ON : EYE_OFF; // iconos fijos de la app
  mainEye.title = tr(settings.chatVisible ? 'chatHideMain' : 'chatShowMain');
  mainEye.setAttribute('aria-label', mainEye.title);
  mainEye.setAttribute('aria-pressed', String(!settings.chatVisible));
  $('chatList').replaceChildren(...chats.map((chat) => {
    const li = document.createElement('li');
    li.classList.toggle('off', !chat.visible);
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = chat.channel ? `#${chat.channel}` : tr('chatNoChannel');
    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = tr('chatExtra');
    name.append(kind);
    const eye = document.createElement('button');
    eye.className = 'eye';
    eye.innerHTML = chat.visible ? EYE_ON : EYE_OFF; // iconos fijos de la app, sin datos de fuera
    eye.title = tr(chat.visible ? 'chatHide' : 'chatShow');
    eye.setAttribute('aria-label', eye.title);
    eye.setAttribute('aria-pressed', String(!chat.visible));
    eye.addEventListener('click', () => api.setChatVisible(chat.id, !chat.visible));
    li.append(name, eye);
    const remove = document.createElement('button');
    remove.className = 'remove-chat';
    remove.textContent = '×';
    remove.title = tr('chatRemove', { name: `#${chat.channel}` });
    remove.setAttribute('aria-label', remove.title);
    remove.addEventListener('click', () => api.removeChat(chat.id));
    li.append(remove);
    return li;
  }));
  // Con el máximo de chats ya no se ofrece añadir más.
  if (chats.length >= EXTRA_CHATS_MAX) showChatAdd(false);
  $('chatAddToggle').hidden = chats.length >= EXTRA_CHATS_MAX || !$('chatAddRow').hidden;
}

// La casilla para añadir otro chat solo aparece al pulsar "+".
function showChatAdd(on) {
  $('chatAddRow').hidden = !on;
  $('chatAddToggle').hidden = on || (settings && (settings.extraChats || []).length >= EXTRA_CHATS_MAX);
  $('chatAddToggle').setAttribute('aria-expanded', String(on));
  if (!on) {
    $('chatAdd').value = '';
    $('chatAddError').textContent = '';
  } else $('chatAdd').focus();
}

function addChat() {
  const channel = normalizeChannel($('chatAdd').value);
  let error = '';
  if (!channel) return;
  if (!/^[a-z0-9_]{1,25}$/.test(channel)) error = tr('channelInvalid');
  else if (channel === settings.channel || (settings.extraChats || []).some((c) => c.channel === channel)) error = tr('chatDuplicate');
  $('chatAddError').textContent = error;
  if (error) return;
  api.addChat(channel);
  showChatAdd(false);
}

// ---------- Estilos de juegos ----------

const GAME_ORDER = ['wow', 'lol', 'valorant', 'minecraft', 'cs2', 'overwatch', 'fortnite', 'rust'];

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Líneas de ejemplo con la misma estructura que el chat de verdad, para que la vista previa sea real.
// Colores de Twitch de los usuarios de ejemplo.
const PREVIEW_COLORS = { kylen: '#FF3B3B', kurkya: '#1FE0C4', anita: '#FF69B4' };

function previewLine(theme, [name, role, text]) {
  const el = document.createElement('div');
  el.className = 'msg';
  const byRole = GameThemes.ROLE_TAG_THEMES.has(theme);
  const who = GameThemes.roleOf(new Set(role ? [role] : []));
  if (byRole) el.classList.add(`ch-${who}`);
  const tag = byRole ? `${GameThemes.WOW_CHANNEL_NUMBER[who]}. ${tr(`role_${who}`)}` : tr(`themeTag_${theme}`);
  const color = PREVIEW_COLORS[name.toLowerCase()] || GameThemes.colorFor(name.toLowerCase());
  if (GameThemes.TIME_THEMES.has(theme)) {
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = `08:${String(21 + name.length).padStart(2, '0')}`;
    el.append(time);
  }
  if (tag) {
    const chan = document.createElement('span');
    chan.className = 'chan';
    chan.textContent = tag;
    if (GameThemes.TAG_LIKE_NAME_THEMES.has(theme)) chan.style.color = color;
    el.append(chan);
  }
  const nameEl = document.createElement('span');
  nameEl.className = 'name';
  nameEl.textContent = name;
  nameEl.style.color = color;
  nameEl.dataset.role = tr(`role_${who}`);
  const sep = document.createElement('span');
  sep.className = 'sep';
  sep.textContent = ': ';
  const textEl = document.createElement('span');
  textEl.className = 'text';
  textEl.textContent = text;
  if (who !== 'user' && GameThemes.RANK_THEMES.has(theme)) {
    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = tr(`role_${who}`);
    if (theme === 'rust') rank.style.color = color;
    el.append(rank);
  }
  el.append(nameEl, sep, textEl);
  const avatar = GameThemes.makeAvatar(theme, name);
  if (avatar) {
    avatar.style.backgroundImage = `url("${GameThemes.samplePicture(name)}")`;
    avatar.classList.add('has-img');
    el.prepend(avatar);
  }
  return el;
}

function renderGameCards() {
  const grid = $('gameGrid');
  if (!grid.children.length || grid.dataset.lang !== lang) {
    grid.dataset.lang = lang;
    grid.replaceChildren(...GAME_ORDER.map((theme) => {
      const look = GameThemes.GAME_THEMES[theme].look;
      const card = document.createElement('button');
      card.className = 'game-card';
      card.dataset.game = theme;
      const preview = document.createElement('div');
      preview.className = `game-preview themed theme-${theme}`;
      preview.style.setProperty('--fs', '11px');
      preview.style.setProperty('--val-broadcast', JSON.stringify(`(${tr('valBroadcast')}) `));
      preview.style.setProperty('--color', look.textColor);
      preview.style.setProperty('--bg', hexToRgba(look.bgColor, look.bgOpacity / 100));
      const bar = document.createElement('div');
      bar.className = 'bar';
      const brand = document.createElement('span');
      brand.className = 'bar-brand';
      const logo = document.createElement('img');
      logo.src = 'assets/tray@2x.png';
      logo.alt = '';
      brand.append(logo, 'Kylen Chat');
      const tab = document.createElement('span');
      tab.className = 'bar-tab';
      tab.textContent = '#kylen';
      bar.append(brand, tab);
      const frame = document.createElement('div');
      frame.className = 'frame';
      const notice = document.createElement('div');
      notice.className = 'msg notice';
      const title = document.createElement('div');
      title.className = 'notice-title';
      title.textContent = tr('gamePreviewNotice');
      notice.append(title);
      frame.append(...tr('gamePreviewLines').split('|').map((line) => previewLine(theme, line.split('~'))), notice);
      const decor = document.createElement('div');
      decor.className = 'decor';
      GameThemes.buildDecor(decor, theme, tr(`themeTag_${theme}`), tr);
      preview.append(bar, frame, decor);
      const label = document.createElement('span');
      label.className = 'game-name';
      const heading = document.createElement('span');
      heading.className = 'game-title';
      const text = document.createElement('span');
      text.textContent = tr(`game_${theme}`);
      heading.append(GameThemes.makeBadge(theme), text);
      const check = document.createElement('span');
      check.className = 'game-check';
      label.append(heading, check);
      card.append(preview, label);
      card.addEventListener('click', () => api.setSettings({ ...LOOK_BASE, ...look, theme }));
      return card;
    }));
  }
  for (const card of grid.children) {
    const active = settings && settings.theme === card.dataset.game;
    card.classList.toggle('active', active);
    card.setAttribute('aria-pressed', String(active));
    card.querySelector('.game-check').textContent = active ? tr('gameActive') : '';
  }
  renderGameOptions();
}

// Opciones del estilo de juego activo: se guardan en los mismos ajustes que el resto del aspecto.
function renderGameOptions() {
  const theme = settings && settings.theme;
  $('gameOptions').hidden = !theme;
  $('gameNone').hidden = Boolean(theme);
  if (!theme) return;
  const set = (id, value) => { if (document.activeElement !== $(id)) $(id).value = String(value); };
  set('gTextColor', settings.textColor);
  set('gFontSize', settings.fontSize);
  set('gBgOpacity', settings.bgOpacity);
  set('gTag', settings.themeTag);
  $('gDecor').checked = settings.themeDecor !== false;
  $('gTag').placeholder = GameThemes.ROLE_TAG_THEMES.has(theme) ? tr('gameTagRoles') : tr(`themeTag_${theme}`) || tr('gameTagNone');
  $('gFontSizeVal').textContent = `${settings.fontSize} px`;
  $('gBgOpacityVal').textContent = `${settings.bgOpacity} %`;
}

// ---------- Mis estilos ----------

const LOOK_KEYS = Object.keys(LOOK_BASE);
const STYLES_MAX = 20;

// Texto blanco o negro según lo claro que sea el color del botón.
function readableOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111' : '#fff';
}

let stylesKey = '';

function renderCustomStyles() {
  if (!settings) return;
  const styles = settings.customStyles || [];
  const key = JSON.stringify([lang, styles]);
  if (key === stylesKey) return;
  stylesKey = key;
  $('customStyles').replaceChildren(...styles.map((style) => {
    const chip = document.createElement('span');
    chip.className = 'style-chip';
    chip.style.background = style.color;
    const apply = document.createElement('button');
    apply.className = 'apply';
    apply.textContent = style.name;
    apply.style.color = readableOn(style.color);
    apply.style.fontFamily = `"${style.data.fontFamily || 'Segoe UI'}", "Segoe UI", system-ui, sans-serif`;
    apply.style.fontWeight = style.data.bold ? '700' : '400';
    apply.addEventListener('click', () => api.setSettings({ ...LOOK_BASE, ...style.data }));
    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '×';
    del.style.color = readableOn(style.color);
    del.title = tr('styleDelete', { name: style.name });
    del.setAttribute('aria-label', del.title);
    del.addEventListener('click', () => {
      api.setSettings({ customStyles: (settings.customStyles || []).filter((s) => s.name !== style.name) });
    });
    chip.append(apply, del);
    return chip;
  }));
  $('customEmpty').hidden = styles.length > 0;
}

function saveCustomStyle() {
  const name = $('styleName').value.trim();
  const styles = settings.customStyles || [];
  const existing = styles.find((s) => s.name.toLowerCase() === name.toLowerCase());
  let error = '';
  if (!name) error = tr('styleNameMissing');
  else if (!existing && styles.length >= STYLES_MAX) error = tr('styleFull', { max: STYLES_MAX });
  $('styleError').textContent = error;
  if (error) return;
  const style = { name, color: $('styleColor').value, data: Object.fromEntries(LOOK_KEYS.map((k) => [k, settings[k]])) };
  // Con el mismo nombre se actualiza el que ya había, en su sitio.
  const next = existing ? styles.map((s) => (s === existing ? style : s)) : [...styles, style];
  api.setSettings({ customStyles: next });
  $('styleName').value = '';
}

// La lista de estilos rápidos se puede plegar; se recuerda en este PC.
let presetsHidden = false;
try { presetsHidden = localStorage.getItem('presetsHidden') === '1'; } catch { /* sin almacenamiento */ }

function applyPresetsHidden() {
  $('presetList').hidden = presetsHidden;
  $('presetsToggle').textContent = tr(presetsHidden ? 'presetsShow' : 'presetsHide');
  $('presetsToggle').setAttribute('aria-expanded', String(!presetsHidden));
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
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    el.textContent = tr(i18n.isMac && `${key}Mac` in i18n.STRINGS.es ? `${key}Mac` : key);
  });
  if ($('presetsToggle')) applyPresetsHidden();
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = tr(el.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = tr(el.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = tr(el.dataset.i18nPlaceholder); });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', tr(el.dataset.i18nAria)));
  document.querySelectorAll('[data-lang]').forEach((b) => b.classList.toggle('active', b.dataset.lang === lang));
  for (const key of Object.keys(FIELDS)) showValue(key);
  if ($('channelError').textContent) $('channelError').textContent = tr('channelInvalid');
  $('backupStatus').textContent = '';
  if (settings) {
    renderProfiles();
    renderShortcuts();
  }
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
  renderShortcuts();
  // La guía sale solo la primera vez que se abre la app: se marca como vista al mostrarla,
  // así no vuelve aunque se cierre la ventana sin pulsar "Empezar".
  if (!settings.onboarded && !welcomeShown) {
    welcomeShown = true;
    $('welcome').classList.add('show');
    api.setSettings({ onboarded: true });
  }
  renderLiveList();
  renderCustomStyles();
  renderChats();
  renderGameCards();
}

// Acepta "nombre", "#nombre", "@nombre" o el enlace completo de twitch.tv.
function normalizeChannel(value) {
  return value.trim()
    .replace(/^(https?:\/\/)?(www\.|m\.)?twitch\.tv\//i, '')
    .replace(/^[#@]/, '')
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
  const keys = (action) => i18n.shortcutLabel(settings ? settings.shortcuts[action] : state.defaultShortcuts[action]);
  $('edit').textContent = tr(editMode ? 'editOn' : 'editOff', { keys: keys('edit') });
  $('edit').classList.toggle('primary', editMode); // morado solo mientras se puede mover
  $('visible').textContent = tr(visible ? 'hideChat' : 'showChat', { keys: keys('hide') });
  $('profilesNote').textContent = tr('profilesNote', { keys: keys('profile') });
  $('liveMove').textContent = tr(state.alertEdit ? 'liveMoveOn' : 'liveMove');
  $('liveMove').classList.toggle('primary', Boolean(state.alertEdit));
  renderLiveList();
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

// ---------- Atajos configurables ----------
// Se hace clic en un atajo y se pulsa la combinación nueva. Mientras tanto, los atajos
// actuales se sueltan para que no se disparen.

let recording = null; // acción cuyo atajo se está grabando

function renderShortcuts() {
  document.querySelectorAll('[data-shortcut]').forEach((b) => {
    const action = b.dataset.shortcut;
    b.textContent = recording === action ? tr('shortcutRecord') : i18n.shortcutLabel(settings.shortcuts[action]);
    b.classList.toggle('recording', recording === action);
  });
}

// Traduce la tecla pulsada al formato de Electron ("CommandOrControl+Shift+L").
function shortcutFromEvent(e) {
  let key = null;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.code)) key = e.code;
  if (!key) return null;
  const isFKey = key.length > 1;
  const cmd = i18n.isMac ? e.metaKey : e.ctrlKey; // en Mac, Cmd hace de Ctrl
  if (!isFKey && !cmd && !e.altKey) return 'invalid';
  const mods = [cmd && 'CommandOrControl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean);
  return [...mods, key].join('+');
}

function startRecording(action) {
  if (recording) api.resumeShortcuts();
  recording = action;
  $('shortcutError').textContent = '';
  api.pauseShortcuts();
  renderShortcuts();
}

function stopRecording() {
  if (!recording) return;
  recording = null;
  api.resumeShortcuts();
  renderShortcuts();
}

window.addEventListener('keydown', (e) => {
  if (!recording) return;
  e.preventDefault();
  if (e.key === 'Escape') {
    stopRecording();
    return;
  }
  if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(e.key)) return; // falta la tecla principal
  const accelerator = shortcutFromEvent(e);
  if (!accelerator) return;
  if (accelerator === 'invalid') {
    $('shortcutError').textContent = tr('shortcutInvalid');
    return;
  }
  const action = recording;
  const taken = Object.entries(settings.shortcuts).some(([k, v]) => k !== action && v === accelerator);
  if (taken) {
    $('shortcutError').textContent = tr('shortcutDuplicate');
    return;
  }
  recording = null;
  api.setSettings({ shortcuts: { ...settings.shortcuts, [action]: accelerator } });
  api.resumeShortcuts();
  renderShortcuts();
});
window.addEventListener('blur', stopRecording);

// ---------- Avisos de directo ----------
// La lista se guarda como texto ("canal1, canal2") y aquí se muestra como una lista
// con un botón para quitar cada canal y un punto rojo en los que están en directo.

const LIVE_MAX = 100;

function liveList() {
  if (!settings) return [];
  const channels = settings.liveChannels.split(/[\s,;]+/).map(normalizeChannel).filter((c) => /^[a-z0-9_]{1,25}$/.test(c));
  return [...new Set(channels)];
}

function saveLiveList(list) {
  api.setSettings({ liveChannels: list.join(', ') });
}

let liveListKey = '';

function renderLiveList() {
  if (!settings) return;
  const live = (lastState && lastState.liveNow) || {};
  const names = (lastState && lastState.channelNames) || {};
  const list = liveList();
  // El estado llega muy a menudo (p. ej. al redimensionar): solo se redibuja si algo cambia.
  const key = JSON.stringify([lang, list, live, names]);
  if (key === liveListKey) return;
  liveListKey = key;
  const ul = $('liveList');
  ul.replaceChildren(...list.map((channel) => {
    const li = document.createElement('li');
    li.classList.toggle('on', channel in live);
    const dot = document.createElement('span');
    dot.className = 'dot';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = channelLabel(channel, names[channel] || live[channel]);
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = tr('liveOn');
    const remove = document.createElement('button');
    remove.className = 'remove';
    remove.textContent = '×';
    remove.title = tr('liveRemove', { name: channelLabel(channel, names[channel] || live[channel]) });
    remove.setAttribute('aria-label', remove.title);
    remove.addEventListener('click', () => saveLiveList(liveList().filter((c) => c !== channel)));
    li.append(dot, name, tag, remove);
    return li;
  }));
  $('liveEmpty').hidden = list.length > 0;
}

// Como lo escribe el propio streamer ("AlvaroStorm"). Si su nombre visible está en otro
// alfabeto, se añade el nombre de usuario para que se sepa qué canal es.
function channelLabel(channel, displayName) {
  if (!displayName) return channel;
  return displayName.toLowerCase() === channel ? displayName : `${displayName} (${channel})`;
}

function addLiveChannel() {
  const input = $('liveAdd');
  const channel = normalizeChannel(input.value);
  const list = liveList();
  let error = '';
  if (!channel) return;
  if (!/^[a-z0-9_]{1,25}$/.test(channel)) error = tr('channelInvalid');
  else if (list.includes(channel)) error = tr('liveDuplicate');
  else if (list.length >= LIVE_MAX) error = tr('liveFull', { max: LIVE_MAX });
  $('liveAddError').textContent = error;
  if (error) return;
  saveLiveList([...list, channel]);
  input.value = '';
  input.focus();
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
$('liveTest').addEventListener('click', () => api.testLiveAlert());
$('liveMove').addEventListener('click', () => api.toggleAlertEdit());
$('liveReset').addEventListener('click', () => api.resetAlertBounds());
document.querySelectorAll('[data-alert-pos]').forEach((b) => b.addEventListener('click', () => api.setAlertPosition(b.dataset.alertPos)));
$('liveAddBtn').addEventListener('click', addLiveChannel);
$('liveAdd').addEventListener('keydown', (e) => { if (e.key === 'Enter') addLiveChannel(); });
$('liveAdd').addEventListener('input', () => { $('liveAddError').textContent = ''; });
$('installUpdate').addEventListener('click', () => {
  if (lastState && lastState.updateReady) api.installUpdate();
  else api.downloadUpdate();
});
$('whatsNewOk').addEventListener('click', () => api.dismissWhatsNew());
$('edit').addEventListener('click', () => api.toggleEdit());
$('visible').addEventListener('click', () => api.toggleVisible());
$('test').addEventListener('click', () => api.toggleTest());
$('reset').addEventListener('click', () => api.resetLook());
document.querySelectorAll('[data-shortcut]').forEach((b) => b.addEventListener('click', () => startRecording(b.dataset.shortcut)));
$('shortcutsReset').addEventListener('click', () => {
  stopRecording();
  $('shortcutError').textContent = '';
  if (lastState) api.setSettings({ shortcuts: { ...lastState.defaultShortcuts } });
});
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
$('styleSave').addEventListener('click', saveCustomStyle);
$('gTextColor').addEventListener('input', (e) => api.setSettings({ textColor: e.target.value }));
$('gFontSize').addEventListener('input', (e) => { $('gFontSizeVal').textContent = `${e.target.value} px`; api.setSettings({ fontSize: Number(e.target.value) }); });
$('gBgOpacity').addEventListener('input', (e) => { $('gBgOpacityVal').textContent = `${e.target.value} %`; api.setSettings({ bgOpacity: Number(e.target.value) }); });
$('gTag').addEventListener('input', (e) => api.setSettings({ themeTag: e.target.value.trim() }));
$('gDecor').addEventListener('change', (e) => api.setSettings({ themeDecor: e.target.checked }));
$('gameOff').addEventListener('click', () => api.setSettings(PRESETS.default));
$('chatAddBtn').addEventListener('click', addChat);
$('chatAdd').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addChat();
  if (e.key === 'Escape') showChatAdd(false);
});
$('chatAddToggle').addEventListener('click', () => showChatAdd(true));
$('mainEye').addEventListener('click', () => api.setChatVisible('main', !settings.chatVisible));
$('chatAdd').addEventListener('input', () => { $('chatAddError').textContent = ''; });
$('styleName').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveCustomStyle(); });
$('styleName').addEventListener('input', () => { $('styleError').textContent = ''; });
$('presetsToggle').addEventListener('click', () => {
  presetsHidden = !presetsHidden;
  try { localStorage.setItem('presetsHidden', presetsHidden ? '1' : '0'); } catch { /* da igual */ }
  applyPresetsHidden();
});
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

const sendSize = () => api.setSize(Number($('width').value), Number($('height').value));
$('width').addEventListener('input', sendSize);
$('height').addEventListener('input', sendSize);

// ---------- Inicio ----------

let savedTab = 'look';
try { savedTab = localStorage.getItem('tab') || 'look'; } catch { /* sin almacenamiento */ }
showTab(document.querySelector(`[data-tab="${savedTab}"]`) ? savedTab : 'look');
paintPresetButtons();
applyPresetsHidden();
applyLanguage(lang); // textos en español mientras llegan los ajustes guardados

api.onSettings(fillFields);
api.onState(applyState);
api.getSettings().then(fillFields).then(loadFonts);
api.getState().then(applyState);
