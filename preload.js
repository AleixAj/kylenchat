const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, ...args) => cb(...args));

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  getState: () => ipcRenderer.invoke('get-state'),
  setSettings: (patch) => ipcRenderer.send('set-settings', patch),
  resetLook: () => ipcRenderer.send('reset-look'),
  installUpdate: () => ipcRenderer.send('install-update'),
  openRepo: () => ipcRenderer.send('open-repo'),
  toggleEdit: () => ipcRenderer.send('toggle-edit'),
  toggleVisible: () => ipcRenderer.send('toggle-visible'),
  toggleTest: () => ipcRenderer.send('toggle-test'),
  setPosition: (pos) => ipcRenderer.send('set-position', pos),
  setSize: (w, h) => ipcRenderer.send('set-size', w, h),
  resizeStart: () => ipcRenderer.send('resize-start'),
  resizeMove: (dx, dy) => ipcRenderer.send('resize-move', dx, dy),
  resizeEnd: () => ipcRenderer.send('resize-end'),
  onSettings: on('settings'),
  onEditMode: on('edit-mode'),
  onState: on('state'),
  onTestMode: on('test-mode'),
  onReconnect: on('reconnect'),
});
