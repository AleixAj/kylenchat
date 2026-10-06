// Main Electron process. It creates the windows (chat, settings and live alert),
// the tray icon and the global shortcuts, keeps the settings on disk and checks
// for updates and for channels that go live.
const {
  app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, screen, shell, session, powerMonitor, dialog,
} = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const { t, DEFAULT_SHORTCUTS, shortcutLabel } = require('./i18n');
const {
  DEFAULTS, PROFILE_KEYS, LOCAL_KEYS, PROFILES_MAX, PROFILE_COLOR, EXTRA_CHATS_MAX,
  isHex, isProfileName, pick, sanitize,
} = require('./main/settings-schema');
const { fetchLiveFromTwitch, fetchLiveFromIvr } = require('./main/live-api');

const REPO_URL = 'https://github.com/AleixAj/kylenchat';
const isMac = process.platform === 'darwin';

const APP_ICON = path.join(__dirname, 'assets', 'icon.ico');
// Electron picks tray@2x.png by itself on screens with high scaling.
const TRAY_ICON = path.join(__dirname, 'assets', 'tray.png');

let settings;
let overlay;
let panel;
let tray;
let editMode = false;
let visible = true; // some chat window is shown (set when the settings load)
let testMode = false;
let resizing = null; // { win, bounds, min } while a window is resized from its corner
// Updates: first we only check (a 1 KB file). The download (~100 MB) starts only
// when the user presses "Download", so it never raises their ping mid-game.
let updateAvailable = null; // new version published, not downloaded yet
let updateProgress = null;  // 0-100 while downloading; null when not downloading
let updateError = false;    // the last download failed (it can be retried)
let updateReady = null;     // version already downloaded, ready to install
let whatsNew = null; // version we just updated to, whose changes we have to show
const shortcutErrors = [];

// The chat is just text: draw it with the CPU so we don't take the GPU away from the game.
app.disableHardwareAcceleration();
// Runs the GPU process inside the main one: about 40 MB less RAM, same CPU use (Windows only).
if (!isMac) app.commandLine.appendSwitch('in-process-gpu');

// ---------- Error log ----------
// An unexpected error must not pop up a window in the middle of a stream: it goes to
// error.log (in the app data folder) so it can be checked later, and the app keeps going.
const LOG_MAX_BYTES = 256 * 1024;

function logError(message) {
  try {
    const file = path.join(app.getPath('userData'), 'error.log');
    if (fs.existsSync(file) && fs.statSync(file).size > LOG_MAX_BYTES) fs.renameSync(file, `${file}.old`);
    fs.appendFileSync(file, `[${new Date().toISOString()}] v${app.getVersion()} ${message}\n`);
  } catch {
    // if we can't even write the log, there is nothing else to do
  }
}

process.on('uncaughtException', (err) => logError(err && err.stack ? err.stack : String(err)));
process.on('unhandledRejection', (err) => logError(err && err.stack ? err.stack : String(err)));

// ---------- Settings saved on disk ----------

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
// Ignores the invisible mark (BOM) that some editors like Notepad add at the start.
const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));

// First run: language from the system. Spanish for Spain and its other languages
// (Catalan, Galician, Basque) and for Latin America; English for everyone else.
function systemLanguage() {
  const code = app.getLocale().toLowerCase().split('-')[0];
  return ['es', 'ca', 'gl', 'eu'].includes(code) ? 'es' : 'en';
}

// Is version a older than version b? ('' counts as very old)
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

// Many changes come in a row (for example while dragging a slider), so we wait a bit and save once.
let saveTimer;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeSettings, 300);
}
// Write to a separate file and then rename it: if the PC turns off halfway, the settings don't get corrupted.
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
  delete clean.profiles; // profiles only change through their own actions
  delete clean.extraChats; // and so do the extra chat windows
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

// Used after changing profiles, extra chats or imported settings.
function afterSettingsChange() {
  saveSettings();
  broadcastSettings();
  sendState();
  updateTrayMenu();
}

const tr = (key, vars) => t(settings.language, key, vars);

function applyLanguage() {
  updateTrayMenu();
  if (panel && !panel.isDestroyed()) panel.setTitle(tr('panelTitle'));
}

// "Start with Windows": it starts hidden in the tray, without opening the settings.
function applyAutoStart() {
  if (!app.isPackaged) return;
  // On Mac we can't pass arguments, so it starts with the settings window open.
  app.setLoginItemSettings(isMac ? { openAtLogin: settings.autoStart } : { openAtLogin: settings.autoStart, args: ['--hidden'] });
}

// ---------- Transparent windows (chat and live alert) ----------

// Creates a frameless, transparent window that stays on top of the game.
// When it's not "interactive", clicks go through it to the game and it never takes the keyboard.
function createTransparentWindow(bounds, interactive, extraPreferences) {
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
    focusable: false, // never takes the keyboard away from the game (except while moving it)
    hasShadow: false,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), spellcheck: false, ...extraPreferences },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  // On Mac, show it on every desktop and on top of full screen apps.
  if (isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(!interactive);
  // Must go after setIgnoreMouseEvents, which rewrites the window styles on Windows.
  win.setFocusable(interactive);
  return win;
}

// Shows a window without focusing it. Windows makes it focusable again when it appears,
// so we set that back right after.
function showWithoutFocus(win, focusable) {
  win.showInactive();
  win.setFocusable(focusable);
}

// ---------- Chat windows ----------

function defaultBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  return { width: 380, height: 420, x: wa.x + 20, y: wa.y + Math.round((wa.height - 420) / 2) };
}

// If the screen where it was saved doesn't exist anymore, it goes back to the default position.
function boundsOnScreen(b) {
  if (!b) return null;
  const visibleSomewhere = screen.getAllDisplays().some(({ workArea: wa }) =>
    b.x < wa.x + wa.width && b.x + b.width > wa.x && b.y < wa.y + wa.height && b.y + b.height > wa.y);
  return visibleSomewhere ? b : null;
}

// Creates a chat window. The main one has no winId; the extra ones get their id in the URL.
function makeChatWindow(bounds, winId, show) {
  const win = createTransparentWindow(bounds, editMode);
  win.loadFile('overlay.html', winId ? { query: { win: winId } } : undefined);
  win.once('ready-to-show', () => {
    if (show) showWithoutFocus(win, editMode);
  });
  // If the window process crashes (very rare), reload it instead of leaving it blank.
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

  // Some games in "borderless" mode jump in front, so we bring our windows back up from time to time.
  setInterval(() => {
    for (const win of chatWindows()) if (win.isVisible()) win.setAlwaysOnTop(true, 'screen-saver');
    if (alertWin && !alertWin.isDestroyed() && alertWin.isVisible()) alertWin.setAlwaysOnTop(true, 'screen-saver');
  }, 10000);
}

function showMainChat(on) {
  if (on) showWithoutFocus(overlay, editMode);
  else overlay.hide();
}

// ---------- Extra chats in their own windows ----------

const extraWindows = new Map(); // id -> window (only the shown ones; hidden ones don't use anything)

function chatWindows() {
  return [overlay, ...extraWindows.values()].filter((w) => w && !w.isDestroyed());
}

// A new window opens next to the main one (and the previous ones), without covering them.
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

function addExtraChat(channel) {
  if (typeof channel !== 'string' || !/^[a-z0-9_]{1,25}$/.test(channel)) return;
  if (settings.extraChats.length >= EXTRA_CHATS_MAX) return;
  const chat = { id: Date.now().toString(36), channel, visible: true, bounds: null };
  settings.extraChats.push(chat);
  openExtraChat(chat);
  afterSettingsChange();
}

function removeExtraChat(id) {
  closeExtraChat(id);
  settings.extraChats = settings.extraChats.filter((c) => c.id !== id);
  afterSettingsChange();
}

// Hides or shows one chat window ("main" is the main one). It's remembered after a restart.
function setChatVisible(id, on) {
  if (id === 'main') {
    settings.chatVisible = on;
    showMainChat(on);
  } else {
    const chat = settings.extraChats.find((c) => c.id === id);
    if (!chat) return;
    chat.visible = on;
    if (on) openExtraChat(chat);
    else closeExtraChat(id);
  }
  visible = anyChatVisible();
  if (!visible && editMode) setEditMode(false);
  afterSettingsChange();
}

function anyChatVisible() {
  return settings.chatVisible || settings.extraChats.some((c) => c.visible);
}

// If the monitor with a window gets unplugged, the window comes back to the main screen.
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

// Move and resize: every visible chat window is unlocked at the same time.
function setEditMode(on) {
  if (on && !anyChatVisible()) setChatVisible('main', true);
  editMode = on;
  for (const win of chatWindows()) {
    win.setIgnoreMouseEvents(!on);
    // After setIgnoreMouseEvents, which rewrites the window styles on Windows.
    win.setFocusable(on);
    // When locking it, give the keyboard back to the window behind (usually the game).
    if (!on) win.blur();
    win.webContents.send('edit-mode', on);
  }
  sendState();
  updateTrayMenu();
}

// The hide shortcut (and the "Hide chat" button) shows or hides every chat window.
function setVisible(on) {
  if (!on && editMode) setEditMode(false);
  settings.chatVisible = on;
  showMainChat(on);
  for (const chat of settings.extraChats) {
    chat.visible = on;
    if (on) openExtraChat(chat);
    else closeExtraChat(chat.id);
  }
  visible = on;
  afterSettingsChange();
}

function setTestMode(on) {
  testMode = on;
  if (on && !anyChatVisible()) setChatVisible('main', true);
  for (const win of chatWindows()) win.webContents.send('test-mode', on);
  sendState();
}

const POSITIONS = ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'];

// Places a window in a corner, on an edge or in the center of its screen, 10 px from the edge.
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

// ---------- Settings window ----------

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
  panel.removeMenu(); // no menu bar (so Alt doesn't show it while recording shortcuts)
  checkForUpdatesSoon();
  panel.loadFile('panel.html');
  // When closed it's destroyed (not hidden) to free memory while playing.
  panel.on('closed', () => {
    panel = null;
    if (app.isQuitting) return;
    // Closing the settings goes back to the real chat and locks the position.
    if (editMode) setEditMode(false);
    if (testMode) setTestMode(false);
    if (alertEdit) setAlertEdit(false);
  });
}

// Everything the settings window needs to draw its buttons and notices.
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
    liveNow: Object.fromEntries(liveNow), // channel -> display name
    channelNames: Object.fromEntries(channelNames),
    alertEdit,
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

// ---------- Keyboard shortcuts (can be changed) ----------

// Registers the chosen shortcuts. If another program already uses one, the settings window shows a warning.
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

// ---------- Automatic updates (from GitHub Releases) ----------

// Looks for new versions (a 1 KB file). It runs at startup, every hour and when the
// settings open, because the app can sit in the tray for days without restarting.
let lastUpdateCheck = 0;
function checkForUpdatesSoon() {
  if (!app.isPackaged || updateReady || updateProgress !== null) return;
  if (Date.now() - lastUpdateCheck < 5 * 60 * 1000) return; // at most once every 5 minutes
  lastUpdateCheck = Date.now();
  autoUpdater.checkForUpdates().catch(() => {});
}

function setupAutoUpdate() {
  if (!app.isPackaged) return; // only in the installed app, not while developing
  autoUpdater.autoDownload = false;        // no surprise downloads
  autoUpdater.autoInstallOnAppQuit = true; // an update already downloaded installs when the app closes
  autoUpdater.on('update-available', (info) => {
    updateAvailable = info.version;
    afterUpdateChange();
  });
  let lastPercent = -1;
  autoUpdater.on('download-progress', (p) => {
    const percent = Math.floor(p.percent);
    if (percent === lastPercent) return; // only tell the window when the number changes
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

// Only when the user asks for it ("Download" button or tray menu).
// On Mac the app isn't signed by Apple and macOS won't let it update itself,
// so we open the download page to get the new .dmg.
function downloadUpdate() {
  if (isMac) {
    if (updateAvailable) shell.openExternal(`${REPO_URL}/releases/latest`);
    return;
  }
  if (!updateAvailable || updateReady || updateProgress !== null) return;
  updateProgress = 0;
  updateError = false;
  afterUpdateChange();
  autoUpdater.downloadUpdate().catch(() => {}); // failures arrive through the 'error' event
}

// If the user doesn't restart by hand, it installs when the app closes.
function installUpdate() {
  if (!updateReady) return;
  app.isQuitting = true;
  autoUpdater.quitAndInstall(true, true);
}

// ---------- Live alerts ----------
// Every minute we ask which channels of the list are live: one light request for
// all of them, without logging in to Twitch.
// The alert shows in its own box on top of the game (not as a Windows notification,
// which Windows usually hides while you play).

const LIVE_POLL_MS = 60 * 1000;
const LIVE_RECENT_MS = 10 * 60 * 1000; // at startup we only alert about streams that just started
let liveTimer = null;
let liveRound = 0; // if the list changes during a check, the old check doesn't schedule another one
let liveErrorLogged = false;
const liveSeen = new Map(); // channel -> id of the stream seen last time (null if it wasn't live)
const liveNow = new Map(); // channel -> display name, for the ones that are live now
const channelNames = new Map(); // channel -> name as the streamer writes it ("AlvaroStorm")
const liveNotified = new Set(); // streams (by id) we already alerted about, in case the API flickers

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
    if (round !== liveRound) return; // the list changed in the meantime
    for (const user of users) onLiveStatus(user);
    // A channel that doesn't show up anymore (banned, renamed...) is no longer marked as live.
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
    // No internet or both sources down: try again next round without filling the log.
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
  liveNotified.add(String(stream.id));
  // The first time we see a channel, only alert if the stream started a few minutes ago.
  // After that, only alert if it's a different stream from last time.
  const alreadyLive = firstLook
    ? !(Date.now() - Date.parse(stream.createdAt) < LIVE_RECENT_MS)
    : previous === String(stream.id);
  if (alreadyLive) return;
  queueAlert({
    login,
    name,
    logo: typeof user.logo === 'string' && user.logo.startsWith('https://static-cdn.jtvnw.net/') ? user.logo : '',
    title: typeof stream.title === 'string' ? stream.title.slice(0, 140) : '',
    game: stream.game && typeof stream.game.displayName === 'string' ? stream.game.displayName : '',
  });
}

// ---------- Live alert box ----------
// A window apart from the chat, just as transparent, and it never takes the keyboard from the game.
// It's created when an alert arrives (or when moving it) and closed as soon as it has nothing to show.

let alertWin = null;
let alertReady = false; // the window has loaded and has the settings
let alertEdit = false; // it's being moved and resized with the sample alert
const alertQueue = [];
let alertSent = 0; // alerts sent to the current window (so we don't close it with a new one inside)

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
  // The sound plays without a click first.
  const win = createTransparentWindow(b, alertEdit, { autoplayPolicy: 'no-user-gesture-required' });
  alertWin = win;
  win.loadFile('alert.html');
  win.on('moved', rememberAlertBounds);
  win.on('closed', () => {
    if (alertWin !== win) return; // there is already a newer window
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

// The arrows and the reset button show the sample alert, so the user sees where it ends up.
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
  else if (!alertQueue.length) return alertWin.destroy(); // "Move" was turned off before it loaded
  flushAlerts();
});
ipcMain.on('alert-show', (e) => {
  if (!fromAlert(e) || alertWin.isVisible()) return;
  showWithoutFocus(alertWin, alertEdit);
});
// The window tells us how many alerts it got: if another one arrived meanwhile, we don't close it.
ipcMain.on('alert-idle', (e, received) => {
  if (fromAlert(e) && !alertEdit && !alertQueue.length && received === alertSent) alertWin.destroy();
});
ipcMain.on('toggle-alert-edit', () => setAlertEdit(!alertEdit));
ipcMain.on('set-alert-position', (_e, pos) => setAlertPosition(pos));
ipcMain.on('reset-alert-bounds', () => setAlertBounds(defaultAlertBounds()));

// ---------- Profiles (one setup per game) ----------

function applyBounds(bounds) {
  const b = boundsOnScreen(bounds);
  if (b) overlay.setBounds(b);
  settings.bounds = overlay.getBounds();
}

function saveProfile(name, color) {
  if (!isProfileName(name) || !name.trim()) return;
  name = name.trim();
  if (!isHex(color)) color = PROFILE_COLOR;
  settings.bounds = overlay.getBounds();
  const data = pick(settings, PROFILE_KEYS);
  const existing = settings.profiles.find((p) => p.name === name);
  if (existing) Object.assign(existing, { color, data });
  else if (settings.profiles.length < PROFILES_MAX) settings.profiles.push({ name, color, data });
  else return;
  settings.activeProfile = name;
  afterSettingsChange();
}

function loadProfile(name) {
  const profile = settings.profiles.find((p) => p.name === name);
  if (!profile) return;
  const { bounds, ...look } = profile.data;
  Object.assign(settings, look);
  if (bounds) applyBounds(bounds);
  settings.activeProfile = name;
  afterSettingsChange();
  overlay.webContents.send('toast', `${tr('profile')}: ${name}`);
}

function deleteProfile(name) {
  settings.profiles = settings.profiles.filter((p) => p.name !== name);
  if (settings.activeProfile === name) settings.activeProfile = '';
  afterSettingsChange();
}

// Shortcut: switch to the next saved profile.
function nextProfile() {
  const { profiles, activeProfile } = settings;
  if (!profiles.length) return;
  const i = profiles.findIndex((p) => p.name === activeProfile);
  loadProfile(profiles[(i + 1) % profiles.length].name);
}

// ---------- Export and import the settings ----------

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
    afterSettingsChange();
    return 'ok';
  } catch {
    return 'invalid';
  }
}

// ---------- Messages from the windows ----------

ipcMain.handle('get-settings', () => settings);
ipcMain.handle('get-state', () => state());
ipcMain.on('set-settings', (_e, patch) => updateSettings(patch));
// Only resets the look; the channel, filters, profiles, etc. stay the same.
ipcMain.on('reset-look', () => {
  Object.assign(settings, pick(DEFAULTS, PROFILE_KEYS.filter((k) => k !== 'bounds')));
  saveSettings();
  broadcastSettings();
});
ipcMain.on('save-profile', (_e, name, color) => saveProfile(name, color));
ipcMain.on('load-profile', (_e, name) => loadProfile(name));
ipcMain.on('delete-profile', (_e, name) => deleteProfile(name));
ipcMain.handle('export-settings', exportSettings);
ipcMain.handle('import-settings', importSettings);
ipcMain.on('dismiss-whats-new', () => {
  whatsNew = null;
  sendState();
});
ipcMain.on('install-update', installUpdate);
// While a new shortcut is being recorded in the settings, the current ones are released so they don't fire.
ipcMain.on('pause-shortcuts', () => globalShortcut.unregisterAll());
ipcMain.on('resume-shortcuts', () => {
  registerShortcuts();
  sendState();
});
ipcMain.on('download-update', downloadUpdate);
ipcMain.on('test-live-alert', () => queueAlert({ login: '', name: 'Kylen Chat', title: tr('liveTestTitle'), game: '', logo: '' }));
ipcMain.on('open-repo', () => shell.openExternal(REPO_URL));
ipcMain.on('toggle-edit', () => setEditMode(!editMode));
ipcMain.on('toggle-visible', () => setVisible(!visible));
ipcMain.on('toggle-test', () => setTestMode(!testMode));
ipcMain.on('add-chat', (_e, channel) => addExtraChat(channel));
ipcMain.on('remove-chat', (_e, id) => removeExtraChat(id));
ipcMain.on('set-chat-visible', (_e, id, on) => { if (typeof on === 'boolean') setChatVisible(id, on); });
ipcMain.on('set-position', (_e, pos) => setPosition(pos));
ipcMain.on('set-size', (_e, w, h) => setSize(w, h));
// Resizing from the corner: works for the chat windows and for the alert box.
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

// ---------- Security ----------
// The windows only show the app's own files: they can't open websites, navigate or ask for permissions.

app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (e) => e.preventDefault());
});

// ---------- Startup ----------

app.setAppUserModelId('com.kylen.twitchchat');
// On Mac it only lives in the menu bar (top of the screen), with no Dock icon.
if (isMac && app.dock) app.dock.hide();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', createPanel);

  app.whenReady().then(() => {
    // Only reading the list of installed fonts is allowed, and only for the settings window.
    const allowFonts = (wc, perm) => perm === 'local-fonts' && Boolean(panel) && wc === panel.webContents;
    session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(allowFonts(wc, perm)));
    session.defaultSession.setPermissionCheckHandler((wc, perm) => allowFonts(wc, perm));

    const hadSettings = fs.existsSync(settingsFile());
    settings = loadSettings();
    // After an update, the changes are shown once. Not on a fresh install.
    if (hadSettings && settings.lastVersion !== app.getVersion()) whatsNew = app.getVersion();
    // Up to 1.1.2 animated emotes came turned off; when moving to 1.1.3 they are turned on
    // once for everybody. After that, each user can turn them off again and we respect it.
    if (hadSettings && isOlderThan(settings.lastVersion, '1.1.3')) settings.animatedEmotes = true;
    settings.lastVersion = app.getVersion();
    saveSettings();
    applyAutoStart();
    visible = anyChatVisible();
    createOverlay();
    restartLiveWatch();
    if (!process.argv.includes('--hidden')) createPanel();

    // Without an app menu, Cmd+C / Cmd+V wouldn't work in text fields on Mac.
    if (isMac) Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]));

    tray = new Tray(TRAY_ICON);
    tray.setToolTip('Kylen Chat for Twitch');
    tray.on('click', createPanel);
    updateTrayMenu();

    registerShortcuts();

    // After sleep the connection is usually dead, so the chats reconnect right away.
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
  app.on('window-all-closed', () => {}); // keeps running in the tray
}
