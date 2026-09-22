const {
  app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, screen, shell, session, powerMonitor,
} = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

const REPO_URL = 'https://github.com/AleixAj/kylentwitchchat';
const FONTS = ['Segoe UI', 'Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Consolas', 'Impact', 'Comic Sans MS'];

const DEFAULTS = {
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
  autoStart: false,
  bounds: null,
};

// Qué valores acepta cada ajuste. Lo que no encaje se descarta, venga del disco o de las ventanas.
const isBool = (v) => typeof v === 'boolean';
const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const inRange = (min, max) => (v) => Number.isFinite(v) && v >= min && v <= max;
const SCHEMA = {
  channel: (v) => typeof v === 'string' && /^[a-z0-9_]{0,25}$/.test(v),
  fontSize: inRange(10, 48),
  fontFamily: (v) => FONTS.includes(v),
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
  autoStart: isBool,
  bounds: (v) => v === null || (v && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(v[k]))),
};

function sanitize(patch) {
  const clean = {};
  if (!patch || typeof patch !== 'object') return clean;
  for (const [key, value] of Object.entries(patch)) {
    if (SCHEMA[key] && SCHEMA[key](value)) clean[key] = value;
  }
  return clean;
}

const APP_ICON = path.join(__dirname, 'assets', 'icon.ico');
// Electron elige solo tray@2x.png en pantallas con escalado alto.
const TRAY_ICON = path.join(__dirname, 'assets', 'tray.png');

const SHORTCUT_EDIT = 'CommandOrControl+Shift+L';
const SHORTCUT_HIDE = 'CommandOrControl+Shift+H';

let settings;
let overlay;
let panel;
let tray;
let editMode = false;
let visible = true;
let testMode = false;
let resizeStartBounds = null;
let updateReady = null; // versión nueva ya descargada, lista para instalar
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
  if (!Object.keys(clean).length) return;
  Object.assign(settings, clean);
  if ('autoStart' in clean) applyAutoStart();
  saveSettings();
  broadcastSettings();
}

function broadcastSettings() {
  overlay.webContents.send('settings', settings);
  if (panel && !panel.isDestroyed()) panel.webContents.send('settings', settings);
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
    title: 'Kylen Twitch Chat · Ajustes',
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
  };
}
function sendState() {
  if (panel && !panel.isDestroyed()) panel.webContents.send('state', state());
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    ...(updateReady ? [{ label: `Reiniciar para actualizar a v${updateReady}`, click: installUpdate }, { type: 'separator' }] : []),
    { label: 'Ajustes', click: createPanel },
    { label: editMode ? 'Fijar posición' : 'Mover y cambiar tamaño', accelerator: SHORTCUT_EDIT, click: () => setEditMode(!editMode) },
    { label: visible ? 'Ocultar chat' : 'Mostrar chat', accelerator: SHORTCUT_HIDE, click: () => setVisible(!visible) },
    { type: 'separator' },
    { label: 'Salir', click: () => app.quit() },
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

// ---------- Comunicación con las ventanas ----------

ipcMain.handle('get-settings', () => settings);
ipcMain.handle('get-state', () => state());
ipcMain.on('set-settings', (_e, patch) => updateSettings(patch));
ipcMain.on('reset-look', () => {
  const { channel, bounds, autoStart } = settings;
  settings = { ...DEFAULTS, channel, bounds, autoStart };
  saveSettings();
  broadcastSettings();
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
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

    settings = loadSettings();
    applyAutoStart();
    createOverlay();
    if (!process.argv.includes('--hidden')) createPanel();

    tray = new Tray(TRAY_ICON);
    tray.setToolTip('Kylen Twitch Chat');
    tray.on('click', createPanel);
    updateTrayMenu();

    // Si otro programa ya usa el atajo, se avisa en los ajustes.
    if (!globalShortcut.register(SHORTCUT_EDIT, () => setEditMode(!editMode))) shortcutErrors.push('Ctrl+Shift+L');
    if (!globalShortcut.register(SHORTCUT_HIDE, () => setVisible(!visible))) shortcutErrors.push('Ctrl+Shift+H');

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
