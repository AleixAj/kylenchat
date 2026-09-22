const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, screen } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

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
  bounds: null,
};

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

// El chat es solo texto: se pinta con la CPU para no quitarle tarjeta gráfica al juego.
app.disableHardwareAcceleration();

// ---------- Ajustes guardados en disco ----------

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

let saveTimer;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeSettings, 300);
}
function writeSettings() {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('No se pudieron guardar los ajustes:', err);
  }
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
    if (overlay && !overlay.isDestroyed() && visible) overlay.setAlwaysOnTop(true, 'screen-saver');
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

function setPosition(pos) {
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
    height: 820,
    title: 'Kylen Twitch Chat · Ajustes',
    icon: APP_ICON,
    autoHideMenuBar: true,
    backgroundColor: '#18181b',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
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
  return { editMode, visible, testMode, bounds: overlay.getBounds(), version: app.getVersion(), updateReady };
}
function sendState() {
  if (panel && !panel.isDestroyed()) panel.webContents.send('state', state());
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    ...(updateReady ? [{ label: `Reiniciar para actualizar a v${updateReady}`, click: installUpdate }, { type: 'separator' }] : []),
    { label: 'Ajustes', click: createPanel },
    { label: editMode ? 'Bloquear posición' : 'Mover / redimensionar', accelerator: SHORTCUT_EDIT, click: () => setEditMode(!editMode) },
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
  app.isQuitting = true;
  autoUpdater.quitAndInstall(true, true);
}

// ---------- Comunicación con las ventanas ----------

ipcMain.handle('get-settings', () => settings);
ipcMain.handle('get-state', () => state());
ipcMain.on('set-settings', (_e, patch) => {
  Object.assign(settings, patch);
  saveSettings();
  overlay.webContents.send('settings', settings);
});
ipcMain.on('install-update', installUpdate);
ipcMain.on('toggle-edit', () => setEditMode(!editMode));
ipcMain.on('toggle-visible', () => setVisible(!visible));
ipcMain.on('set-position', (_e, pos) => setPosition(pos));
ipcMain.on('set-size', (_e, w, h) => setSize(w, h));
ipcMain.on('toggle-test', () => setTestMode(!testMode));
ipcMain.on('resize-start', () => { resizeStartBounds = overlay.getBounds(); });
ipcMain.on('resize-move', (_e, dx, dy) => {
  if (!resizeStartBounds) return;
  overlay.setBounds({
    ...resizeStartBounds,
    width: Math.max(160, Math.round(resizeStartBounds.width + dx)),
    height: Math.max(80, Math.round(resizeStartBounds.height + dy)),
  });
  sendState();
});
ipcMain.on('resize-end', () => {
  resizeStartBounds = null;
  rememberBounds();
});

// ---------- Arranque ----------

app.setAppUserModelId('com.kylen.twitchchat');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', createPanel);

  app.whenReady().then(() => {
    settings = loadSettings();
    createOverlay();
    createPanel();

    tray = new Tray(TRAY_ICON);
    tray.setToolTip('Kylen Twitch Chat');
    tray.on('click', createPanel);
    updateTrayMenu();

    globalShortcut.register(SHORTCUT_EDIT, () => setEditMode(!editMode));
    globalShortcut.register(SHORTCUT_HIDE, () => setVisible(!visible));

    setupAutoUpdate();
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
    clearTimeout(saveTimer);
    if (overlay && !overlay.isDestroyed()) settings.bounds = overlay.getBounds();
    writeSettings();
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => {}); // sigue viva en la bandeja
}
