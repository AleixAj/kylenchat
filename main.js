const {
  app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, screen, shell, session, powerMonitor, dialog,
} = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const { t, LANGUAGES } = require('./i18n');

const REPO_URL = 'https://github.com/AleixAj/kylentwitchchat';

const DEFAULTS = {
  language: 'es',
  channel: '',
  fontSize: 16,
  fontFamily: 'Segoe UI',
  bold: false,
  textColor: '#ffffff',
  userColors: true,
  bgColor: '#000000',
  bgOpacity: 35,
  outline: true,
  opacity: 100,
  maxMessages: 30,
  fadeAfter: 0,
  animatedEmotes: false,
  hideBots: false,
  highlightMentions: true,
  keywords: '',
  highlightFirst: true,
  showBadges: true,
  timestamps: false,
  mutedUsers: '',
  blockedWords: '',
  align: 'left',
  newestOnTop: false,
  idleHide: 0,
  emoteScale: 1.6,
  showHeader: true,
  autoStart: false,
  bounds: null,
  profiles: [],
  activeProfile: '',
  onboarded: false,
  lastVersion: '',
};

// Lo que guarda un perfil: el aspecto y la posición. El canal, el idioma y los filtros son comunes.
const PROFILE_KEYS = [
  'fontSize', 'fontFamily', 'bold', 'textColor', 'userColors', 'bgColor', 'bgOpacity', 'outline', 'opacity',
  'maxMessages', 'fadeAfter', 'animatedEmotes', 'showBadges', 'timestamps', 'align', 'newestOnTop', 'idleHide',
  'emoteScale', 'showHeader', 'bounds',
];
// Lo que no se exporta ni se importa: depende de cada PC.
const LOCAL_KEYS = ['autoStart', 'onboarded', 'lastVersion'];

// Qué valores acepta cada ajuste. Lo que no encaje se descarta, venga del disco o de las ventanas.
const isBool = (v) => typeof v === 'boolean';
const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const inRange = (min, max) => (v) => Number.isFinite(v) && v >= min && v <= max;
const isText = (max) => (v) => typeof v === 'string' && v.length <= max && !/[\u0000-\u001f]/.test(v);
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
  outline: isBool,
  opacity: inRange(10, 100),
  maxMessages: inRange(3, 100),
  fadeAfter: inRange(0, 120),
  animatedEmotes: isBool,
  hideBots: isBool,
  highlightMentions: isBool,
  keywords: isText(300),
  highlightFirst: isBool,
  showBadges: isBool,
  timestamps: isBool,
  mutedUsers: isText(1000),
  blockedWords: isText(1000),
  align: (v) => v === 'left' || v === 'right',
  newestOnTop: isBool,
  idleHide: inRange(0, 300),
  emoteScale: inRange(1, 3),
  showHeader: isBool,
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

const APP_ICON = path.join(__dirname, 'assets', 'icon.ico');
// Electron elige solo tray@2x.png en pantallas con escalado alto.
const TRAY_ICON = path.join(__dirname, 'assets', 'tray.png');

const SHORTCUT_EDIT = 'CommandOrControl+Shift+L';
const SHORTCUT_HIDE = 'CommandOrControl+Shift+H';
const SHORTCUT_PROFILE = 'CommandOrControl+Alt+P';

let settings;
let overlay;
let panel;
let tray;
let editMode = false;
let visible = true;
let testMode = false;
let resizeStartBounds = null;
let updateReady = null; // versión nueva ya descargada, lista para instalar
let whatsNew = null; // versión recién actualizada cuyas novedades hay que enseñar
const shortcutErrors = [];

// El chat es solo texto: se pinta con la CPU para no quitarle tarjeta gráfica al juego.
app.disableHardwareAcceleration();
// Une el proceso gráfico al principal: unos 40 MB menos de RAM, mismo consumo de CPU.
app.commandLine.appendSwitch('in-process-gpu');

// ---------- Ajustes guardados en disco ----------

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    return { ...DEFAULTS, ...sanitize(JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))) };
  } catch {
    return { ...DEFAULTS };
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
    console.error('No se pudieron guardar los ajustes:', err);
  }
}

function updateSettings(patch) {
  const clean = sanitize(patch);
  delete clean.profiles; // los perfiles solo se tocan con sus propias acciones
  if (!Object.keys(clean).length) return;
  Object.assign(settings, clean);
  if ('autoStart' in clean) applyAutoStart();
  if ('language' in clean) applyLanguage();
  saveSettings();
  broadcastSettings();
}

function broadcastSettings() {
  overlay.webContents.send('settings', settings);
  if (panel && !panel.isDestroyed()) panel.webContents.send('settings', settings);
}

const tr = (key, vars) => t(settings.language, key, vars);

function applyLanguage() {
  updateTrayMenu();
  if (panel && !panel.isDestroyed()) panel.setTitle(tr('panelTitle'));
}

// "Iniciar con Windows": arranca escondida en la bandeja, sin abrir los ajustes.
function applyAutoStart() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: settings.autoStart, args: ['--hidden'] });
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

function createOverlay() {
  const b = boundsOnScreen(settings.bounds) || defaultBounds();
  overlay = new BrowserWindow({
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
    hasShadow: false,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), spellcheck: false },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true); // los clics atraviesan el chat y llegan al juego
  overlay.loadFile('overlay.html');
  overlay.once('ready-to-show', () => overlay.showInactive());
  overlay.on('moved', rememberBounds);

  // Algunos juegos en modo "sin bordes" se ponen delante; lo volvemos a subir de vez en cuando.
  setInterval(() => {
    if (!overlay.isDestroyed() && visible) overlay.setAlwaysOnTop(true, 'screen-saver');
  }, 10000);
}

function rememberBounds() {
  settings.bounds = overlay.getBounds();
  saveSettings();
  sendState();
}

function setEditMode(on) {
  editMode = on;
  overlay.setIgnoreMouseEvents(!on);
  if (on && !visible) setVisible(true);
  overlay.webContents.send('edit-mode', on);
  sendState();
  updateTrayMenu();
}

function setVisible(on) {
  visible = on;
  if (on) overlay.showInactive();
  else {
    if (editMode) setEditMode(false);
    overlay.hide();
  }
  sendState();
  updateTrayMenu();
}

function setTestMode(on) {
  testMode = on;
  if (on && !visible) setVisible(true);
  overlay.webContents.send('test-mode', on);
  sendState();
}

const POSITIONS = ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'];

function setPosition(pos) {
  if (!POSITIONS.includes(pos)) return;
  const b = overlay.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  const m = 10;
  const [v, h] = pos.split('-');
  const xs = { left: wa.x + m, center: wa.x + Math.round((wa.width - b.width) / 2), right: wa.x + wa.width - b.width - m };
  const ys = { top: wa.y + m, middle: wa.y + Math.round((wa.height - b.height) / 2), bottom: wa.y + wa.height - b.height - m };
  overlay.setBounds({ ...b, x: xs[h], y: ys[v] });
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
    return;
  }
  panel = new BrowserWindow({
    width: 460,
    height: 860,
    title: tr('panelTitle'),
    icon: APP_ICON,
    autoHideMenuBar: true,
    backgroundColor: '#18181b',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), spellcheck: false },
  });
  panel.loadFile('panel.html');
  // Al cerrarla se destruye (no se esconde) para liberar memoria mientras se juega.
  panel.on('closed', () => {
    panel = null;
    if (app.isQuitting) return;
    // Al cerrar los ajustes se vuelve al chat real y se fija la posición.
    if (editMode) setEditMode(false);
    if (testMode) setTestMode(false);
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
    updateReady,
    shortcutErrors,
    canAutoStart: app.isPackaged,
    whatsNew,
  };
}
function sendState() {
  if (panel && !panel.isDestroyed()) panel.webContents.send('state', state());
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    ...(updateReady ? [{ label: tr('trayUpdate', { version: updateReady }), click: installUpdate }, { type: 'separator' }] : []),
    { label: tr('traySettings'), click: createPanel },
    { label: tr(editMode ? 'trayEditOn' : 'trayEditOff'), accelerator: SHORTCUT_EDIT, click: () => setEditMode(!editMode) },
    { label: tr(visible ? 'trayHide' : 'trayShow'), accelerator: SHORTCUT_HIDE, click: () => setVisible(!visible) },
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

// ---------- Actualizaciones automáticas (desde GitHub Releases) ----------

function setupAutoUpdate() {
  if (!app.isPackaged) return; // solo en la versión instalada, no al programar
  autoUpdater.on('update-downloaded', (info) => {
    updateReady = info.version;
    sendState();
    updateTrayMenu();
  });
  autoUpdater.on('error', (err) => console.error('Error al buscar actualizaciones:', err));
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 4 * 60 * 60 * 1000);
}

// Si no se reinicia a mano, se instala sola al cerrar la app.
function installUpdate() {
  if (!updateReady) return;
  app.isQuitting = true;
  autoUpdater.quitAndInstall(true, true);
}

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
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return 'ok';
}

async function importSettings() {
  const { canceled, filePaths } = await dialog.showOpenDialog(panel, {
    properties: ['openFile'],
    filters: [{ name: 'Kylen Chat', extensions: ['json'] }],
  });
  if (canceled || !filePaths.length) return 'canceled';
  try {
    const data = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    const clean = sanitize(data && data.settings);
    for (const key of LOCAL_KEYS) delete clean[key];
    if (!Object.keys(clean).length) return 'invalid';
    const { bounds, ...rest } = clean;
    Object.assign(settings, rest);
    if (bounds) applyBounds(bounds);
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
ipcMain.on('open-repo', () => shell.openExternal(REPO_URL));
ipcMain.on('toggle-edit', () => setEditMode(!editMode));
ipcMain.on('toggle-visible', () => setVisible(!visible));
ipcMain.on('toggle-test', () => setTestMode(!testMode));
ipcMain.on('set-position', (_e, pos) => setPosition(pos));
ipcMain.on('set-size', (_e, w, h) => setSize(w, h));
ipcMain.on('resize-start', () => {
  if (editMode) resizeStartBounds = overlay.getBounds();
});
ipcMain.on('resize-move', (_e, dx, dy) => {
  if (!resizeStartBounds || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
  overlay.setBounds({
    ...resizeStartBounds,
    width: Math.max(160, Math.round(resizeStartBounds.width + dx)),
    height: Math.max(80, Math.round(resizeStartBounds.height + dy)),
  });
  sendState();
});
ipcMain.on('resize-end', () => {
  if (!resizeStartBounds) return;
  resizeStartBounds = null;
  rememberBounds();
});

// ---------- Seguridad ----------
// Las ventanas solo muestran archivos de la app: no pueden abrir webs, navegar ni pedir permisos.

app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (e) => e.preventDefault());
});

// ---------- Arranque ----------

app.setAppUserModelId('com.kylen.twitchchat');

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
    settings.lastVersion = app.getVersion();
    saveSettings();
    applyAutoStart();
    createOverlay();
    if (!process.argv.includes('--hidden')) createPanel();

    tray = new Tray(TRAY_ICON);
    tray.setToolTip('Kylen Chat for Twitch');
    tray.on('click', createPanel);
    updateTrayMenu();

    // Si otro programa ya usa el atajo, se avisa en los ajustes.
    if (!globalShortcut.register(SHORTCUT_EDIT, () => setEditMode(!editMode))) shortcutErrors.push('Ctrl+Shift+L');
    if (!globalShortcut.register(SHORTCUT_HIDE, () => setVisible(!visible))) shortcutErrors.push('Ctrl+Shift+H');
    if (!globalShortcut.register(SHORTCUT_PROFILE, nextProfile)) shortcutErrors.push('Ctrl+Alt+P');

    // Al volver de suspensión la conexión suele quedar muerta: se reconecta al momento.
    powerMonitor.on('resume', () => overlay.webContents.send('reconnect'));

    setupAutoUpdate();
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
    clearTimeout(saveTimer);
    if (overlay && !overlay.isDestroyed()) settings.bounds = overlay.getBounds();
    if (settings) writeSettings();
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => {}); // sigue viva en la bandeja
}
