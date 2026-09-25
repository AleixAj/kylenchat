const {
  app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, screen, shell, session, powerMonitor, dialog, net,
} = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const { t, LANGUAGES, DEFAULT_SHORTCUTS, shortcutLabel } = require('./i18n');

const REPO_URL = 'https://github.com/AleixAj/kylenchat';
const isMac = process.platform === 'darwin';

const DEFAULTS = {
  language: 'es',
  channel: '',
  fontSize: 15,
  fontFamily: 'Segoe UI',
  bold: false,
  textColor: '#ffffff',
  userColors: true,
  bgColor: '#000000',
  bgOpacity: 25,
  barColor: '#9146ff',
  showViewers: true,
  outline: true,
  opacity: 100,
  maxMessages: 20,
  fadeAfter: 0,
  animatedEmotes: true,
  hideBots: false,
  highlightMentions: true,
  keywords: '',
  highlightFirst: true,
  showRedemptions: true,
  showBadges: true,
  timestamps: false,
  mutedUsers: '',
  liveChannels: '',
  liveDuration: 8,
  liveSound: true,
  liveVolume: 70,
  alertBounds: null,
  showDeleted: false,
  shortcuts: { ...DEFAULT_SHORTCUTS },
  align: 'left',
  newestOnTop: false,
  idleHide: 120,
  emoteScale: 1.6,
  autoStart: false,
  bounds: null,
  profiles: [],
  customStyles: [],
  theme: '', // estilo de juego: '', 'wow', 'lol', 'valorant' o 'minecraft'
  themeGameColors: true, // nombres con los colores del juego (o los de Twitch)
  themeTag: '', // texto de la etiqueta del canal; vacío = el del juego
  themeDecor: true, // detalles decorativos del juego (botones, pestañas, casilla de escribir)
  chatVisible: true, // la ventana del chat principal se ve (se puede ocultar y dejar solo los avisos)
  extraChats: [], // otros chats en ventanas aparte: { id, channel, visible, bounds }
  activeProfile: '',
  onboarded: false,
  lastVersion: '',
};

// Lo que guarda un perfil: el aspecto y la posición. El canal, el idioma y los filtros son comunes.
const PROFILE_KEYS = [
  'fontSize', 'fontFamily', 'bold', 'textColor', 'userColors', 'bgColor', 'bgOpacity', 'barColor', 'outline', 'opacity',
  'maxMessages', 'fadeAfter', 'animatedEmotes', 'showBadges', 'timestamps', 'align', 'newestOnTop', 'idleHide',
  'emoteScale', 'theme', 'themeGameColors', 'themeTag', 'themeDecor', 'bounds',
];
// Lo que no se exporta ni se importa: depende de cada PC.
const LOCAL_KEYS = ['autoStart', 'onboarded', 'lastVersion', 'chatVisible', 'extraChats'];

// Qué valores acepta cada ajuste. Lo que no encaje se descarta, venga del disco o de las ventanas.
const isBool = (v) => typeof v === 'boolean';
const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const inRange = (min, max) => (v) => Number.isFinite(v) && v >= min && v <= max;
const isText = (max) => (v) => typeof v === 'string' && v.length <= max && !/[\u0000-\u001f]/.test(v);
// Atajo válido: Ctrl y/o Alt (y opcional Shift) con una letra o número, o una tecla F1-F24 sola o combinada.
const isAccelerator = (v) => {
  const m = typeof v === 'string' && /^(CommandOrControl\+)?(Alt\+)?(Shift\+)?([A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/.exec(v);
  return Boolean(m) && (Boolean(m[1] || m[2]) || m[4].length > 1);
};
const isShortcuts = (v) => v && typeof v === 'object'
  && Object.keys(DEFAULT_SHORTCUTS).every((k) => isAccelerator(v[k]))
  && new Set(Object.keys(DEFAULT_SHORTCUTS).map((k) => v[k])).size === Object.keys(DEFAULT_SHORTCUTS).length;
const SCHEMA = {
  language: (v) => LANGUAGES.includes(v),
  channel: (v) => typeof v === 'string' && /^[a-z0-9_]{0,25}$/.test(v),
  fontSize: inRange(10, 48),
  // Cualquier fuente instalada, pero sin caracteres que puedan romper el CSS.
  fontFamily: (v) => typeof v === 'string' && /^[^"'\\;{}<>\u0000-\u001f]{1,64}$/.test(v),
  bold: isBool,
  textColor: isHex,
  userColors: isBool,
  bgColor: isHex,
  bgOpacity: inRange(0, 100),
  barColor: isHex,
  showViewers: isBool,
  outline: isBool,
  opacity: inRange(10, 100),
  maxMessages: inRange(3, 100),
  fadeAfter: inRange(0, 120),
  animatedEmotes: isBool,
  hideBots: isBool,
  highlightMentions: isBool,
  keywords: isText(300),
  highlightFirst: isBool,
  theme: (v) => ['', 'wow', 'lol', 'valorant', 'minecraft', 'cs2', 'overwatch', 'fortnite', 'rust'].includes(v),
  themeDecor: isBool,
  themeGameColors: isBool,
  themeTag: isText(20),
  chatVisible: isBool,
  showRedemptions: isBool,
  showBadges: isBool,
  timestamps: isBool,
  mutedUsers: isText(1000),
  liveChannels: isText(2700), // 100 canales de hasta 25 letras, separados por comas
  liveDuration: inRange(3, 30),
  liveSound: isBool,
  liveVolume: inRange(0, 100),
  alertBounds: (v) => v === null || (v && ['x', 'y'].every((k) => Number.isFinite(v[k]))
    && inRange(200, 4000)(v.width) && inRange(60, 2000)(v.height)),
  showDeleted: isBool,
  shortcuts: isShortcuts,
  align: (v) => v === 'left' || v === 'right',
  newestOnTop: isBool,
  idleHide: inRange(0, 300),
  emoteScale: inRange(1, 3),
  autoStart: isBool,
  activeProfile: isText(30),
  onboarded: isBool,
  lastVersion: isText(20),
  bounds: (v) => v === null || (v && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(v[k]))),
};

function sanitize(patch) {
  const clean = {};
  if (!patch || typeof patch !== 'object') return clean;
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'profiles') {
      if (Array.isArray(value)) clean.profiles = cleanProfiles(value);
    } else if (key === 'customStyles') {
      if (Array.isArray(value)) clean.customStyles = cleanStyles(value);
    } else if (key === 'extraChats') {
      if (Array.isArray(value)) clean.extraChats = cleanChats(value);
    } else if (key === 'shortcuts') {
      if (isShortcuts(value)) clean.shortcuts = pick(value, Object.keys(DEFAULT_SHORTCUTS));
    } else if (SCHEMA[key] && SCHEMA[key](value)) {
      clean[key] = value;
    }
  }
  return clean;
}

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));
const isProfileName = isText(30);

function cleanProfiles(list) {
  return list
    .filter((p) => p && isProfileName(p.name) && p.name.trim())
    .slice(0, 10)
    .map((p) => ({ name: p.name.trim(), data: pick(sanitize(p.data), PROFILE_KEYS) }));
}

// "Mis estilos": aspectos guardados por el usuario, con su nombre y el color de su botón.
// Solo guardan el aspecto (como los estilos rápidos), no la posición ni el tamaño.
const LOOK_KEYS = ['fontSize', 'fontFamily', 'bold', 'textColor', 'userColors', 'bgColor', 'bgOpacity', 'barColor', 'outline', 'opacity', 'emoteScale', 'theme', 'themeGameColors', 'themeTag', 'themeDecor'];
const STYLES_MAX = 20;

function cleanStyles(list) {
  const seen = new Set();
  return list
    .filter((s) => s && isText(24)(s.name) && s.name.trim() && isHex(s.color) && s.data && typeof s.data === 'object')
    .map((s) => ({ name: s.name.trim(), color: s.color, data: pick(sanitize(s.data), LOOK_KEYS) }))
    .filter((s) => !seen.has(s.name.toLowerCase()) && seen.add(s.name.toLowerCase()))
    .slice(0, STYLES_MAX);
}

// Otros chats en ventanas aparte (además del principal), para seguir varios canales a la vez.
const EXTRA_CHATS_MAX = 3;
const isBounds = (v) => v === null || (v && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(v[k])));

function cleanChats(list) {
  const ids = new Set();
  return list
    .filter((c) => c && typeof c.id === 'string' && /^[a-z0-9]{1,16}$/.test(c.id)
      && typeof c.channel === 'string' && /^[a-z0-9_]{1,25}$/.test(c.channel))
    .filter((c) => !ids.has(c.id) && ids.add(c.id))
    .slice(0, EXTRA_CHATS_MAX)
    .map((c) => ({ id: c.id, channel: c.channel, visible: c.visible !== false, bounds: isBounds(c.bounds) ? c.bounds || null : null }));
}

const APP_ICON = path.join(__dirname, 'assets', 'icon.ico');
// Electron elige solo tray@2x.png en pantallas con escalado alto.
const TRAY_ICON = path.join(__dirname, 'assets', 'tray.png');


let settings;
let overlay;
let panel;
let tray;
let editMode = false;
let visible = true; // alguna ventana de chat se ve (se ajusta al cargar los ajustes)
let testMode = false;
let resizing = null; // { win, bounds, min } mientras se cambia el tamaño desde la esquina
// Actualizaciones: primero solo se comprueba (un archivo de 1 KB); la descarga (~100 MB)
// empieza únicamente cuando el usuario pulsa "Descargar", para no subirle el ping en partida.
let updateAvailable = null; // versión nueva publicada, todavía sin descargar
let updateProgress = null;  // 0-100 mientras se descarga; null si no se está descargando
let updateError = false;    // la última descarga falló (se puede reintentar)
let updateReady = null;     // versión ya descargada, lista para instalar
let whatsNew = null; // versión recién actualizada cuyas novedades hay que enseñar
const shortcutErrors = [];

// El chat es solo texto: se pinta con la CPU para no quitarle tarjeta gráfica al juego.
app.disableHardwareAcceleration();
// Une el proceso gráfico al principal: unos 40 MB menos de RAM, mismo consumo de CPU (solo Windows).
if (!isMac) app.commandLine.appendSwitch('in-process-gpu');

// ---------- Registro de errores ----------
// Un error inesperado no debe sacar una ventana en mitad del directo: se apunta en
// error.log (carpeta de datos de la app) para poder revisarlo, y la app sigue.
const LOG_MAX_BYTES = 256 * 1024;

function logError(message) {
  try {
    const file = path.join(app.getPath('userData'), 'error.log');
    if (fs.existsSync(file) && fs.statSync(file).size > LOG_MAX_BYTES) fs.renameSync(file, `${file}.old`);
    fs.appendFileSync(file, `[${new Date().toISOString()}] v${app.getVersion()} ${message}\n`);
  } catch {
    // si ni siquiera se puede escribir el registro, no hay nada más que hacer
  }
}

process.on('uncaughtException', (err) => logError(err && err.stack ? err.stack : String(err)));
process.on('unhandledRejection', (err) => logError(err && err.stack ? err.stack : String(err)));

// ---------- Ajustes guardados en disco ----------

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
// Ignora la marca invisible (BOM) que añaden algunos editores como el Bloc de notas.
const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

// Primera vez: idioma según el de Windows. Castellano para España y sus otras lenguas
// (catalán, gallego, euskera) y para Latinoamérica; inglés para el resto.
function systemLanguage() {
  const code = app.getLocale().toLowerCase().split('-')[0];
  return ['es', 'ca', 'gl', 'eu'].includes(code) ? 'es' : 'en';
}

// ¿La versión a es anterior a la b? ('' cuenta como muy antigua)
function isOlderThan(a, b) {
  const pa = String(a || '0').split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== pb[i]) return (pa[i] || 0) < pb[i];
  }
  return false;
}

function loadSettings() {
  const defaults = { ...DEFAULTS, language: systemLanguage() };
  try {
    return { ...defaults, ...sanitize(readJSON(settingsFile())) };
  } catch {
    return defaults;
  }
}

let saveTimer;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeSettings, 300);
}
// Se escribe en un archivo aparte y luego se renombra: si el PC se apaga a medias, no se corrompe.
function writeSettings() {
  const file = settingsFile();
  try {
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(settings, null, 2));
    fs.renameSync(`${file}.tmp`, file);
  } catch (err) {
    logError(`No se pudieron guardar los ajustes: ${err.message}`);
  }
}

function updateSettings(patch) {
  const clean = sanitize(patch);
  delete clean.profiles; // los perfiles solo se tocan con sus propias acciones
  delete clean.extraChats; // las ventanas de chat también tienen sus propias acciones
  delete clean.chatVisible;
  if (!Object.keys(clean).length) return;
  Object.assign(settings, clean);
  if ('autoStart' in clean) applyAutoStart();
  if ('language' in clean) applyLanguage();
  if ('liveChannels' in clean) restartLiveWatch();
  if ('shortcuts' in clean) {
    registerShortcuts();
    updateTrayMenu();
    sendState();
  }
  saveSettings();
  broadcastSettings();
}

function broadcastSettings() {
  for (const win of chatWindows()) win.webContents.send('settings', settings);
  if (panel && !panel.isDestroyed()) panel.webContents.send('settings', settings);
  sendToAlert('settings', settings);
}

const tr = (key, vars) => t(settings.language, key, vars);

function applyLanguage() {
  updateTrayMenu();
  if (panel && !panel.isDestroyed()) panel.setTitle(tr('panelTitle'));
}

// "Iniciar con Windows": arranca escondida en la bandeja, sin abrir los ajustes.
function applyAutoStart() {
  if (!app.isPackaged) return;
  // En Mac no se pueden pasar argumentos: arranca con la ventana de ajustes abierta.
  app.setLoginItemSettings(isMac ? { openAtLogin: settings.autoStart } : { openAtLogin: settings.autoStart, args: ['--hidden'] });
}

// ---------- Ventana del chat (overlay) ----------

function defaultBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  return { width: 380, height: 420, x: wa.x + 20, y: wa.y + Math.round((wa.height - 420) / 2) };
}

// Si la pantalla donde estaba guardado ya no existe, vuelve a la posición por defecto.
function boundsOnScreen(b) {
  if (!b) return null;
  const visibleSomewhere = screen.getAllDisplays().some(({ workArea: wa }) =>
    b.x < wa.x + wa.width && b.x + b.width > wa.x && b.y < wa.y + wa.height && b.y + b.height > wa.y);
  return visibleSomewhere ? b : null;
}

// Crea una ventana de chat transparente. La principal no lleva "win"; las extra llevan su id.
function makeChatWindow(bounds, winId, show) {
  const win = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    focusable: false, // nunca le quita el teclado al juego (salvo al moverla)
    hasShadow: false,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), spellcheck: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  // En Mac, que se vea en todos los escritorios y encima de las apps a pantalla completa.
  if (isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(!editMode); // los clics atraviesan el chat y llegan al juego
  win.setFocusable(editMode); // y nunca le quita el teclado al juego (se reaplica tras lo anterior)
  win.loadFile('overlay.html', winId ? { query: { win: winId } } : undefined);
  win.once('ready-to-show', () => {
    if (!show) return;
    win.showInactive();
    win.setFocusable(editMode); // al mostrarse por primera vez Windows lo reactiva
  });
  // Si el proceso de la ventana se cae (muy raro), se recarga en vez de quedarse en blanco.
  win.webContents.on('render-process-gone', (_e, details) => {
    logError(`Ventana del chat cerrada inesperadamente: ${details.reason}`);
    if (!win.isDestroyed()) win.reload();
  });
  win.webContents.on('did-finish-load', () => {
    if (editMode) win.webContents.send('edit-mode', true);
    if (testMode) win.webContents.send('test-mode', true);
  });
  return win;
}

function createOverlay() {
  overlay = makeChatWindow(boundsOnScreen(settings.bounds) || defaultBounds(), '', settings.chatVisible);
  overlay.on('moved', rememberBounds);
  for (const chat of settings.extraChats) if (chat.visible) openExtraChat(chat);

  // Algunos juegos en modo "sin bordes" se ponen delante; lo volvemos a subir de vez en cuando.
  setInterval(() => {
    for (const win of chatWindows()) if (win.isVisible()) win.setAlwaysOnTop(true, 'screen-saver');
    if (alertWin && !alertWin.isDestroyed() && alertWin.isVisible()) alertWin.setAlwaysOnTop(true, 'screen-saver');
  }, 10000);
}

// ---------- Otros chats en ventanas aparte ----------

const extraWindows = new Map(); // id -> ventana (solo las que se ven; las ocultas no gastan nada)

function chatWindows() {
  return [overlay, ...extraWindows.values()].filter((w) => w && !w.isDestroyed());
}

// Una ventana nueva sale al lado de la principal (y de las anteriores), sin taparlas.
function extraDefaultBounds(index) {
  const main = overlay.getBounds();
  const wa = screen.getDisplayMatching(main).workArea;
  const x = Math.min(main.x + (main.width + 12) * (index + 1), wa.x + wa.width - main.width);
  return { width: main.width, height: main.height, x, y: main.y };
}

function openExtraChat(chat) {
  if (extraWindows.has(chat.id)) return;
  const index = settings.extraChats.indexOf(chat);
  const win = makeChatWindow(boundsOnScreen(chat.bounds) || extraDefaultBounds(index), chat.id, true);
  extraWindows.set(chat.id, win);
  win.on('moved', () => rememberExtraBounds(chat.id));
  win.on('closed', () => { if (extraWindows.get(chat.id) === win) extraWindows.delete(chat.id); });
}

function closeExtraChat(id) {
  const win = extraWindows.get(id);
  extraWindows.delete(id);
  if (win && !win.isDestroyed()) win.destroy();
}

function rememberExtraBounds(id) {
  const chat = settings.extraChats.find((c) => c.id === id);
  const win = extraWindows.get(id);
  if (!chat || !win || win.isDestroyed()) return;
  chat.bounds = win.getBounds();
  saveSettings();
}

function afterChatsChange() {
  saveSettings();
  broadcastSettings();
  sendState();
  updateTrayMenu();
}

function addExtraChat(channel) {
  if (typeof channel !== 'string' || !/^[a-z0-9_]{1,25}$/.test(channel)) return;
  if (settings.extraChats.length >= EXTRA_CHATS_MAX) return;
  const chat = { id: Date.now().toString(36), channel, visible: true, bounds: null };
  settings.extraChats.push(chat);
  openExtraChat(chat);
  afterChatsChange();
}

function removeExtraChat(id) {
  closeExtraChat(id);
  settings.extraChats = settings.extraChats.filter((c) => c.id !== id);
  afterChatsChange();
}

// Ocultar o mostrar una ventana concreta ("main" es la principal). Se recuerda al reiniciar.
function setChatVisible(id, on) {
  if (id === 'main') {
    settings.chatVisible = on;
    if (on) {
      overlay.showInactive();
      overlay.setFocusable(editMode);
    } else overlay.hide();
  } else {
    const chat = settings.extraChats.find((c) => c.id === id);
    if (!chat) return;
    chat.visible = on;
    if (on) openExtraChat(chat);
    else closeExtraChat(id);
  }
  visible = anyChatVisible();
  if (!visible && editMode) setEditMode(false);
  afterChatsChange();
}

function anyChatVisible() {
  return settings.chatVisible || settings.extraChats.some((c) => c.visible);
}

// Si se desconecta el monitor donde estaba el chat, se trae a la pantalla principal.
function keepOnScreen() {
  if (alertWin && !alertWin.isDestroyed() && !boundsOnScreen(alertWin.getBounds())) {
    alertWin.setBounds(defaultAlertBounds());
    rememberAlertBounds();
  }
  for (const [id, win] of extraWindows) {
    if (!win.isDestroyed() && !boundsOnScreen(win.getBounds())) {
      win.setBounds(extraDefaultBounds(0));
      rememberExtraBounds(id);
    }
  }
  if (!overlay || overlay.isDestroyed()) return;
  if (!boundsOnScreen(overlay.getBounds())) {
    overlay.setBounds(defaultBounds());
    rememberBounds();
  }
}

function rememberBounds() {
  settings.bounds = overlay.getBounds();
  saveSettings();
  sendState();
}

// Mover y cambiar el tamaño: se desbloquean a la vez todas las ventanas de chat que se ven.
function setEditMode(on) {
  if (on && !anyChatVisible()) setChatVisible('main', true);
  editMode = on;
  for (const win of chatWindows()) {
    win.setIgnoreMouseEvents(!on);
    // Después de setIgnoreMouseEvents, que en Windows reescribe los estilos de la ventana.
    win.setFocusable(on);
    // Al fijarla, devuelve el teclado a la ventana de detrás (normalmente el juego).
    if (!on) win.blur();
    win.webContents.send('edit-mode', on);
  }
  sendState();
  updateTrayMenu();
}

// El atajo de ocultar (y el botón "Ocultar chat") muestra u oculta todas las ventanas de chat.
function setVisible(on) {
  if (!on && editMode) setEditMode(false);
  settings.chatVisible = on;
  if (on) {
    overlay.showInactive();
    overlay.setFocusable(editMode);
  } else overlay.hide();
  for (const chat of settings.extraChats) {
    chat.visible = on;
    if (on) openExtraChat(chat);
    else closeExtraChat(chat.id);
  }
  visible = on;
  afterChatsChange();
}

function setTestMode(on) {
  testMode = on;
  if (on && !anyChatVisible()) setChatVisible('main', true);
  for (const win of chatWindows()) win.webContents.send('test-mode', on);
  sendState();
}

const POSITIONS = ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'];

// Coloca una ventana en una esquina, un borde o el centro de su pantalla, a 10 px del borde.
function placedAt(b, pos) {
  const wa = screen.getDisplayMatching(b).workArea;
  const m = 10;
  const [v, h] = pos.split('-');
  const xs = { left: wa.x + m, center: wa.x + Math.round((wa.width - b.width) / 2), right: wa.x + wa.width - b.width - m };
  const ys = { top: wa.y + m, middle: wa.y + Math.round((wa.height - b.height) / 2), bottom: wa.y + wa.height - b.height - m };
  return { ...b, x: xs[h], y: ys[v] };
}

function setPosition(pos) {
  if (!POSITIONS.includes(pos)) return;
  overlay.setBounds(placedAt(overlay.getBounds(), pos));
  rememberBounds();
}

function setSize(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return;
  const b = overlay.getBounds();
  overlay.setBounds({ ...b, width: Math.max(160, Math.round(width)), height: Math.max(80, Math.round(height)) });
  rememberBounds();
}

// ---------- Ventana de ajustes ----------

function createPanel() {
  if (panel) {
    panel.show();
    panel.focus();
    checkForUpdatesSoon();
    return;
  }
  const { workArea } = screen.getPrimaryDisplay();
  panel = new BrowserWindow({
    width: 520,
    height: Math.min(940, workArea.height - 20),
    title: tr('panelTitle'),
    icon: APP_ICON,
    autoHideMenuBar: true,
    backgroundColor: '#18181b',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), spellcheck: false },
  });
  panel.removeMenu(); // sin barra de menú (Alt ya no la hace aparecer al grabar atajos)
  checkForUpdatesSoon();
  panel.loadFile('panel.html');
  // Al cerrarla se destruye (no se esconde) para liberar memoria mientras se juega.
  panel.on('closed', () => {
    panel = null;
    if (app.isQuitting) return;
    // Al cerrar los ajustes se vuelve al chat real y se fija la posición.
    if (editMode) setEditMode(false);
    if (testMode) setTestMode(false);
    if (alertEdit) setAlertEdit(false);
  });
}

function state() {
  const bounds = overlay.getBounds();
  const { workArea } = screen.getDisplayMatching(bounds);
  return {
    editMode,
    visible,
    testMode,
    bounds,
    maxSize: { width: workArea.width, height: workArea.height },
    version: app.getVersion(),
    updateAvailable,
    updateProgress,
    updateError,
    updateReady,
    shortcutErrors: [...shortcutErrors],
    defaultShortcuts: DEFAULT_SHORTCUTS,
    canAutoStart: app.isPackaged,
    whatsNew,
    liveNow: Object.fromEntries(liveNow), // canal -> nombre visible
    channelNames: Object.fromEntries(channelNames),
    alertEdit,
    chats: [
      { id: 'main', channel: settings.channel, visible: settings.chatVisible },
      ...settings.extraChats.map((c) => ({ id: c.id, channel: c.channel, visible: c.visible })),
    ],
    extraChatsMax: EXTRA_CHATS_MAX,
  };
}
function sendState() {
  if (panel && !panel.isDestroyed()) panel.webContents.send('state', state());
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    ...(updateReady ? [{ label: tr('trayUpdate', { version: updateReady }), click: installUpdate }, { type: 'separator' }] : []),
    ...(!updateReady && updateAvailable && updateProgress === null
      ? [{ label: tr('trayDownload', { version: updateAvailable }), click: downloadUpdate }, { type: 'separator' }]
      : []),
    { label: tr('traySettings'), click: createPanel },
    { label: tr(editMode ? 'trayEditOn' : 'trayEditOff'), accelerator: settings.shortcuts.edit, click: () => setEditMode(!editMode) },
    { label: tr(visible ? 'trayHide' : 'trayShow'), accelerator: settings.shortcuts.hide, click: () => setVisible(!visible) },
    ...(settings.profiles.length ? [{
      label: tr('trayProfiles'),
      submenu: settings.profiles.map((p) => ({
        label: p.name, type: 'radio', checked: p.name === settings.activeProfile, click: () => loadProfile(p.name),
      })),
    }] : []),
    { type: 'separator' },
    { label: tr('trayQuit'), click: () => app.quit() },
  ]));
}

// ---------- Atajos de teclado (configurables) ----------

// Registra los atajos elegidos. Si otro programa ya usa alguno, se avisa en los ajustes.
function registerShortcuts() {
  globalShortcut.unregisterAll();
  shortcutErrors.length = 0;
  const actions = { edit: () => setEditMode(!editMode), hide: () => setVisible(!visible), profile: nextProfile };
  for (const [name, action] of Object.entries(actions)) {
    const accelerator = settings.shortcuts[name];
    let ok = false;
    try {
      ok = globalShortcut.register(accelerator, action);
    } catch {
      ok = false;
    }
    if (!ok) shortcutErrors.push(shortcutLabel(accelerator));
  }
}

// ---------- Actualizaciones automáticas (desde GitHub Releases) ----------

// Busca versiones nuevas (un archivo de 1 KB). Se llama al arrancar, cada hora y al abrir los
// ajustes, porque la app puede pasar días en la bandeja sin reiniciarse.
let lastUpdateCheck = 0;
function checkForUpdatesSoon() {
  if (!app.isPackaged || updateReady || updateProgress !== null) return;
  if (Date.now() - lastUpdateCheck < 5 * 60 * 1000) return; // como mucho una vez cada 5 minutos
  lastUpdateCheck = Date.now();
  autoUpdater.checkForUpdates().catch(() => {});
}

function setupAutoUpdate() {
  if (!app.isPackaged) return; // solo en la versión instalada, no al programar
  autoUpdater.autoDownload = false;        // nada de descargas por sorpresa
  autoUpdater.autoInstallOnAppQuit = true; // lo ya descargado se instala al cerrar la app
  autoUpdater.on('update-available', (info) => {
    updateAvailable = info.version;
    afterUpdateChange();
  });
  let lastPercent = -1;
  autoUpdater.on('download-progress', (p) => {
    const percent = Math.floor(p.percent);
    if (percent === lastPercent) return; // avisa a la ventana solo cuando cambia el número
    lastPercent = percent;
    updateProgress = percent;
    sendState();
  });
  autoUpdater.on('update-downloaded', (info) => {
    updateReady = info.version;
    updateProgress = null;
    afterUpdateChange();
  });
  autoUpdater.on('error', (err) => {
    logError(`Actualización: ${err.message}`);
    if (updateProgress !== null) {
      updateProgress = null;
      updateError = true;
      afterUpdateChange();
    }
  });
  checkForUpdatesSoon();
  setInterval(checkForUpdatesSoon, 60 * 60 * 1000);
}

function afterUpdateChange() {
  sendState();
  updateTrayMenu();
}

// Solo cuando el usuario lo pide (botón "Descargar" o menú de la bandeja).
// En Mac la app no tiene firma de Apple y macOS no deja que se actualice sola:
// se abre la página de descarga para bajar el .dmg nuevo.
function downloadUpdate() {
  if (isMac) {
    if (updateAvailable) shell.openExternal(`${REPO_URL}/releases/latest`);
    return;
  }
  if (!updateAvailable || updateReady || updateProgress !== null) return;
  updateProgress = 0;
  updateError = false;
  afterUpdateChange();
  autoUpdater.downloadUpdate().catch(() => {}); // los fallos llegan por el evento 'error'
}

// Si no se reinicia a mano, se instala sola al cerrar la app.
function installUpdate() {
  if (!updateReady) return;
  app.isQuitting = true;
  autoUpdater.quitAndInstall(true, true);
}

// ---------- Avisos de directo ----------
// Cada minuto se pregunta qué canales de la lista están en directo: una sola petición
// ligera para todos, sin iniciar sesión en Twitch.
// El aviso sale en un recuadro propio encima del juego (no como notificación de Windows,
// que además Windows suele esconder mientras se juega).

const LIVE_POLL_MS = 60 * 1000;
const LIVE_RECENT_MS = 10 * 60 * 1000; // al arrancar solo se avisa de directos que acaban de empezar
const LIVE_BATCH = 50; // canales por petición a api.ivr.fi (Twitch acepta los 100 de una vez)
let liveTimer = null;
let liveRound = 0; // si se cambia la lista a mitad de una comprobación, la vieja no programa otra
let liveErrorLogged = false;
const liveSeen = new Map(); // canal -> id del directo visto la última vez (null si no estaba en directo)
const liveNow = new Map(); // canal -> nombre visible, de los que están en directo ahora
const channelNames = new Map(); // canal -> nombre tal como lo escribe el streamer ("AlvaroStorm")
const liveNotified = new Set(); // directos (por id) ya avisados, por si la API parpadea

function liveChannelList() {
  const channels = settings.liveChannels
    .toLowerCase()
    .split(/[\s,;]+/)
    .map((c) => c.replace(/^(https?:\/\/)?(www\.|m\.)?twitch\.tv\//, '').replace(/^@/, '').replace(/[/?#].*$/, ''))
    .filter((c) => /^[a-z0-9_]{1,25}$/.test(c));
  return [...new Set(channels)].slice(0, 100);
}

function restartLiveWatch() {
  clearTimeout(liveTimer);
  liveRound++;
  const channels = liveChannelList();
  for (const c of [...liveSeen.keys()]) {
    if (!channels.includes(c)) {
      liveSeen.delete(c);
      liveNow.delete(c);
      channelNames.delete(c);
    }
  }
  sendState();
  if (channels.length) checkLive(liveRound);
}

// Se pregunta a Twitch directamente, con la misma consulta pública que usa su web: se entera
// de un directo nuevo en segundos. api.ivr.fi solo se usa si Twitch no responde, porque a
// veces tarda varios minutos en ver un directo recién empezado.
const TWITCH_GQL = 'https://gql.twitch.tv/gql';
const TWITCH_WEB_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'; // el de la web pública de Twitch
const LIVE_QUERY = 'query($logins:[String!]){users(logins:$logins){login displayName profileImageURL(width:300) '
  + 'broadcastSettings{title} stream{id createdAt type game{displayName}}}}';

async function fetchLiveFromTwitch(channels) {
  const res = await net.fetch(TWITCH_GQL, {
    method: 'POST',
    headers: { 'Client-Id': TWITCH_WEB_CLIENT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: LIVE_QUERY, variables: { logins: channels } }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Twitch HTTP ${res.status}`);
  const body = await res.json();
  const users = body && body.data && body.data.users;
  if (!Array.isArray(users)) throw new Error('respuesta inesperada de Twitch');
  // Mismo formato que api.ivr.fi, para tratar igual las dos fuentes.
  return users.filter(Boolean).map((u) => ({
    login: u.login,
    displayName: u.displayName,
    logo: u.profileImageURL,
    stream: u.stream && {
      id: u.stream.id,
      createdAt: u.stream.createdAt,
      type: u.stream.type,
      title: u.broadcastSettings && u.broadcastSettings.title,
      game: u.stream.game,
    },
  }));
}

async function fetchLiveFromIvr(channels) {
  const users = [];
  for (let i = 0; i < channels.length; i += LIVE_BATCH) {
    const batch = channels.slice(i, i + LIVE_BATCH);
    const res = await net.fetch(`https://api.ivr.fi/v2/twitch/user?login=${batch.join(',')}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`ivr HTTP ${res.status}`);
    const part = await res.json();
    if (!Array.isArray(part)) throw new Error('respuesta inesperada de ivr');
    users.push(...part);
  }
  return users;
}

async function checkLive(round) {
  const channels = liveChannelList();
  try {
    let users;
    try {
      users = await fetchLiveFromTwitch(channels);
    } catch (err) {
      if (!liveErrorLogged) logError(`Avisos de directo (Twitch, se usa ivr): ${err.message}`);
      users = await fetchLiveFromIvr(channels);
    }
    if (round !== liveRound) return; // la lista ha cambiado mientras tanto
    for (const user of users) onLiveStatus(user);
    // Un canal que ya no aparece (baneado, renombrado...) deja de marcarse en directo.
    const answered = new Set(users.map((u) => String((u && u.login) || '').toLowerCase()));
    for (const channel of channels) {
      if (!answered.has(channel)) {
        liveSeen.set(channel, null);
        liveNow.delete(channel);
      }
    }
    liveErrorLogged = false;
    sendState();
  } catch (err) {
    // Sin internet o las dos fuentes caídas: se reintenta en la siguiente vuelta sin llenar el registro.
    if (!liveErrorLogged) logError(`Avisos de directo: ${err.message}`);
    liveErrorLogged = true;
  }
  if (round === liveRound) liveTimer = setTimeout(() => checkLive(round), LIVE_POLL_MS);
}

function onLiveStatus(user) {
  const login = String((user && user.login) || '').toLowerCase();
  if (!/^[a-z0-9_]{1,25}$/.test(login)) return;
  const stream = user.stream && user.stream.type === 'live' ? user.stream : null;
  const name = typeof user.displayName === 'string' && user.displayName ? user.displayName : login;
  channelNames.set(login, name);
  const firstLook = !liveSeen.has(login);
  const previous = liveSeen.get(login);
  liveSeen.set(login, stream ? String(stream.id) : null);
  if (stream) liveNow.set(login, name);
  else liveNow.delete(login);

  if (!stream || liveNotified.has(String(stream.id))) return;
  if (firstLook ? !(Date.now() - Date.parse(stream.createdAt) < LIVE_RECENT_MS) : previous === String(stream.id)) {
    liveNotified.add(String(stream.id)); // ya estaba en directo antes: no se avisa
    return;
  }
  liveNotified.add(String(stream.id));
  announceLive({
    login,
    name,
    logo: typeof user.logo === 'string' && user.logo.startsWith('https://static-cdn.jtvnw.net/') ? user.logo : '',
    title: typeof stream.title === 'string' ? stream.title.slice(0, 140) : '',
    game: stream.game && typeof stream.game.displayName === 'string' ? stream.game.displayName : '',
  });
}

function announceLive(info) {
  queueAlert(info);
}

// ---------- Recuadro del aviso de directo ----------
// Ventana aparte del chat, igual de transparente y sin quitar nunca el teclado al juego.
// Se crea al llegar un aviso (o al moverla) y se cierra en cuanto no tiene nada que enseñar.

let alertWin = null;
let alertReady = false; // la ventana ya ha cargado y tiene los ajustes
let alertEdit = false; // se está moviendo y ajustando con el aviso de ejemplo
const alertQueue = [];
let alertSent = 0; // avisos enviados a la ventana actual (para no cerrarla con uno recién llegado)

function defaultAlertBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  const width = 420;
  const height = 110;
  return { width, height, x: wa.x + Math.round((wa.width - width) / 2), y: wa.y + 40 };
}

function ensureAlertWindow() {
  if (alertWin && !alertWin.isDestroyed()) return;
  alertReady = false;
  alertSent = 0;
  const b = boundsOnScreen(settings.alertBounds) || defaultAlertBounds();
  const win = new BrowserWindow({
    ...b,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required', // el sonido suena sin haber hecho clic antes
    },
  });
  alertWin = win;
  win.setAlwaysOnTop(true, 'screen-saver');
  if (isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(!alertEdit);
  win.setFocusable(alertEdit);
  win.loadFile('alert.html');
  win.on('moved', rememberAlertBounds);
  win.on('closed', () => {
    if (alertWin !== win) return; // ya hay otra ventana nueva
    alertWin = null;
    alertReady = false;
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    logError(`Ventana del aviso cerrada inesperadamente: ${details.reason}`);
    if (!win.isDestroyed()) win.destroy();
  });
}

function sendToAlert(channel, ...args) {
  if (alertReady && alertWin && !alertWin.isDestroyed()) alertWin.webContents.send(channel, ...args);
}

function queueAlert(info) {
  alertQueue.push(info);
  ensureAlertWindow();
  flushAlerts();
}

function flushAlerts() {
  while (alertReady && alertQueue.length) {
    alertSent++;
    sendToAlert('live-alert', alertQueue.shift());
  }
}

function setAlertEdit(on) {
  alertEdit = on;
  if (on) ensureAlertWindow();
  if (alertWin && !alertWin.isDestroyed()) {
    alertWin.setIgnoreMouseEvents(!on);
    alertWin.setFocusable(on);
    if (!on) {
      alertWin.blur();
      rememberAlertBounds();
    }
  }
  sendToAlert('alert-edit', on);
  sendState();
}

function rememberAlertBounds() {
  if (!alertWin || alertWin.isDestroyed()) return;
  settings.alertBounds = alertWin.getBounds();
  saveSettings();
}

// Las flechas y el botón de restablecer enseñan el aviso de ejemplo para ver dónde queda.
function setAlertBounds(b) {
  if (!alertEdit) setAlertEdit(true);
  alertWin.setBounds(b);
  rememberAlertBounds();
}

function setAlertPosition(pos) {
  if (!POSITIONS.includes(pos)) return;
  const current = (alertWin && !alertWin.isDestroyed() && alertWin.getBounds()) || boundsOnScreen(settings.alertBounds) || defaultAlertBounds();
  setAlertBounds(placedAt(current, pos));
}

const fromAlert = (e) => Boolean(alertWin) && !alertWin.isDestroyed() && e.sender === alertWin.webContents;

ipcMain.on('alert-ready', (e) => {
  if (!fromAlert(e)) return;
  alertReady = true;
  if (alertEdit) sendToAlert('alert-edit', true);
  else if (!alertQueue.length) return alertWin.destroy(); // se apagó "Mover" antes de que cargara
  flushAlerts();
});
ipcMain.on('alert-show', (e) => {
  if (!fromAlert(e) || alertWin.isVisible()) return;
  alertWin.showInactive();
  alertWin.setFocusable(alertEdit); // al mostrarse Windows lo reactiva
});
// La ventana dice cuántos avisos ha recibido: si llegó otro mientras tanto, no se cierra.
ipcMain.on('alert-idle', (e, received) => {
  if (fromAlert(e) && !alertEdit && !alertQueue.length && received === alertSent) alertWin.destroy();
});
ipcMain.on('toggle-alert-edit', () => setAlertEdit(!alertEdit));
ipcMain.on('set-alert-position', (_e, pos) => setAlertPosition(pos));
ipcMain.on('reset-alert-bounds', () => setAlertBounds(defaultAlertBounds()));

// ---------- Perfiles (una configuración por juego) ----------

function applyBounds(bounds) {
  const b = boundsOnScreen(bounds);
  if (b) overlay.setBounds(b);
  settings.bounds = overlay.getBounds();
}

function saveProfile(name) {
  if (!isProfileName(name) || !name.trim()) return;
  name = name.trim();
  settings.bounds = overlay.getBounds();
  const data = pick(settings, PROFILE_KEYS);
  const existing = settings.profiles.find((p) => p.name === name);
  if (existing) existing.data = data;
  else if (settings.profiles.length < 10) settings.profiles.push({ name, data });
  else return;
  settings.activeProfile = name;
  afterProfileChange();
}

function loadProfile(name) {
  const profile = settings.profiles.find((p) => p.name === name);
  if (!profile) return;
  const { bounds, ...look } = profile.data;
  Object.assign(settings, look);
  if (bounds) applyBounds(bounds);
  settings.activeProfile = name;
  afterProfileChange();
  overlay.webContents.send('toast', `${tr('profile')}: ${name}`);
}

function deleteProfile(name) {
  settings.profiles = settings.profiles.filter((p) => p.name !== name);
  if (settings.activeProfile === name) settings.activeProfile = '';
  afterProfileChange();
}

// Atajo: pasa al siguiente perfil guardado.
function nextProfile() {
  const { profiles, activeProfile } = settings;
  if (!profiles.length) return;
  const i = profiles.findIndex((p) => p.name === activeProfile);
  loadProfile(profiles[(i + 1) % profiles.length].name);
}

function afterProfileChange() {
  saveSettings();
  broadcastSettings();
  sendState();
  updateTrayMenu();
}

// ---------- Exportar e importar la configuración ----------

async function exportSettings() {
  const { canceled, filePath } = await dialog.showSaveDialog(panel, {
    defaultPath: 'kylen-chat-config.json',
    filters: [{ name: 'Kylen Chat', extensions: ['json'] }],
  });
  if (canceled || !filePath) return 'canceled';
  settings.bounds = overlay.getBounds();
  const data = { app: 'kylen-chat-for-twitch', version: app.getVersion(), settings: { ...settings } };
  for (const key of LOCAL_KEYS) delete data.settings[key];
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return 'ok';
  } catch (err) {
    logError(`No se pudo exportar la configuración: ${err.message}`);
    return 'error';
  }
}

async function importSettings() {
  const { canceled, filePaths } = await dialog.showOpenDialog(panel, {
    properties: ['openFile'],
    filters: [{ name: 'Kylen Chat', extensions: ['json'] }],
  });
  if (canceled || !filePaths.length) return 'canceled';
  try {
    const data = readJSON(filePaths[0]);
    const clean = sanitize(data && data.settings);
    for (const key of LOCAL_KEYS) delete clean[key];
    if (!Object.keys(clean).length) return 'invalid';
    const { bounds, ...rest } = clean;
    Object.assign(settings, rest);
    if (bounds) applyBounds(bounds);
    if ('liveChannels' in rest) restartLiveWatch();
    applyLanguage();
    afterProfileChange();
    return 'ok';
  } catch {
    return 'invalid';
  }
}

// ---------- Comunicación con las ventanas ----------

ipcMain.handle('get-settings', () => settings);
ipcMain.handle('get-state', () => state());
ipcMain.on('set-settings', (_e, patch) => updateSettings(patch));
// Solo vuelve el aspecto a como venía; el canal, los filtros, los perfiles, etc. se mantienen.
ipcMain.on('reset-look', () => {
  Object.assign(settings, pick(DEFAULTS, PROFILE_KEYS.filter((k) => k !== 'bounds')));
  saveSettings();
  broadcastSettings();
});
ipcMain.on('save-profile', (_e, name) => saveProfile(name));
ipcMain.on('load-profile', (_e, name) => loadProfile(name));
ipcMain.on('delete-profile', (_e, name) => deleteProfile(name));
ipcMain.handle('export-settings', exportSettings);
ipcMain.handle('import-settings', importSettings);
ipcMain.on('dismiss-whats-new', () => {
  whatsNew = null;
  sendState();
});
ipcMain.on('install-update', installUpdate);
// Mientras se graba un atajo nuevo en los ajustes, los actuales se sueltan para no dispararse.
ipcMain.on('pause-shortcuts', () => globalShortcut.unregisterAll());
ipcMain.on('resume-shortcuts', () => {
  registerShortcuts();
  sendState();
});
ipcMain.on('download-update', downloadUpdate);
ipcMain.on('test-live-alert', () => announceLive({ login: '', name: 'Kylen Chat', title: tr('liveTestTitle'), game: '', logo: '' }));
ipcMain.on('open-repo', () => shell.openExternal(REPO_URL));
ipcMain.on('toggle-edit', () => setEditMode(!editMode));
ipcMain.on('toggle-visible', () => setVisible(!visible));
ipcMain.on('toggle-test', () => setTestMode(!testMode));
ipcMain.on('add-chat', (_e, channel) => addExtraChat(channel));
ipcMain.on('remove-chat', (_e, id) => removeExtraChat(id));
ipcMain.on('set-chat-visible', (_e, id, on) => { if (typeof on === 'boolean') setChatVisible(id, on); });
ipcMain.on('set-position', (_e, pos) => setPosition(pos));
ipcMain.on('set-size', (_e, w, h) => setSize(w, h));
// Cambiar el tamaño desde la esquina: vale para el chat y para el recuadro del aviso.
ipcMain.on('resize-start', (e) => {
  const chat = chatWindows().find((w) => w.webContents === e.sender);
  if (chat && editMode) resizing = { win: chat, bounds: chat.getBounds(), min: [160, 80] };
  else if (fromAlert(e) && alertEdit) resizing = { win: alertWin, bounds: alertWin.getBounds(), min: [200, 60] };
});
ipcMain.on('resize-move', (_e, dx, dy) => {
  if (!resizing || resizing.win.isDestroyed() || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
  const { win, bounds, min } = resizing;
  win.setBounds({
    ...bounds,
    width: Math.max(min[0], Math.round(bounds.width + dx)),
    height: Math.max(min[1], Math.round(bounds.height + dy)),
  });
  sendState();
});
ipcMain.on('resize-end', () => {
  if (!resizing) return;
  const { win } = resizing;
  resizing = null;
  if (win === overlay) rememberBounds();
  else if (win === alertWin) rememberAlertBounds();
  else for (const [id, w] of extraWindows) if (w === win) rememberExtraBounds(id);
});

// ---------- Seguridad ----------
// Las ventanas solo muestran archivos de la app: no pueden abrir webs, navegar ni pedir permisos.

app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (e) => e.preventDefault());
});

// ---------- Arranque ----------

app.setAppUserModelId('com.kylen.twitchchat');
// En Mac vive solo en la barra de menú (arriba), sin icono en el Dock.
if (isMac && app.dock) app.dock.hide();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', createPanel);

  app.whenReady().then(() => {
    // Solo se permite leer la lista de fuentes instaladas, y solo a la ventana de ajustes.
    const allowFonts = (wc, perm) => perm === 'local-fonts' && Boolean(panel) && wc === panel.webContents;
    session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(allowFonts(wc, perm)));
    session.defaultSession.setPermissionCheckHandler((wc, perm) => allowFonts(wc, perm));

    const hadSettings = fs.existsSync(settingsFile());
    settings = loadSettings();
    // Tras actualizar se enseñan las novedades una vez. En una instalación nueva, no.
    if (hadSettings && settings.lastVersion !== app.getVersion()) whatsNew = app.getVersion();
    // Hasta la 1.1.2 los emotes animados venían apagados; al pasar a la 1.1.3 se encienden
    // una vez para todos. Después, cada uno puede volver a apagarlos y se respeta.
    if (hadSettings && isOlderThan(settings.lastVersion, '1.1.3')) settings.animatedEmotes = true;
    settings.lastVersion = app.getVersion();
    saveSettings();
    applyAutoStart();
    visible = anyChatVisible();
    createOverlay();
    restartLiveWatch();
    if (!process.argv.includes('--hidden')) createPanel();

    // Sin menú de aplicación, en Mac no funcionarían Cmd+C / Cmd+V en los campos de texto.
    if (isMac) Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]));

    tray = new Tray(TRAY_ICON);
    tray.setToolTip('Kylen Chat for Twitch');
    tray.on('click', createPanel);
    updateTrayMenu();

    registerShortcuts();

    // Al volver de suspensión la conexión suele quedar muerta: se reconecta al momento.
    powerMonitor.on('resume', () => { for (const win of chatWindows()) win.webContents.send('reconnect'); });
    screen.on('display-removed', keepOnScreen);
    screen.on('display-metrics-changed', keepOnScreen);

    setupAutoUpdate();
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
    clearTimeout(saveTimer);
    if (overlay && !overlay.isDestroyed()) settings.bounds = overlay.getBounds();
    for (const [id, win] of extraWindows) {
      const chat = settings.extraChats.find((c) => c.id === id);
      if (chat && !win.isDestroyed()) chat.bounds = win.getBounds();
    }
    if (settings) writeSettings();
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => {}); // sigue viva en la bandeja
}
