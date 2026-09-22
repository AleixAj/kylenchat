const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, ...args) => cb(...args));

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  getState: () => ipcRenderer.invoke('get-state'),
  setSettings: (patch) => ipcRenderer.send('set-settings', patch),
  installUpdate: () => ipcRenderer.send('install-update'),
  toggleEdit: () => ipcRenderer.send('toggle-edit'),
  toggleVisible: () => ipcRenderer.send('toggle-visible'),
  setPosition: (pos) => ipcRenderer.send('set-position', pos),
  setSize: (w, h) => ipcRenderer.send('set-size', w, h),
  testMessage: () => ipcRenderer.send('test-message'),
  resizeStart: () => ipcRenderer.send('resize-start'),
  resizeMove: (dx, dy) => ipcRenderer.send('resize-move', dx, dy),
  resizeEnd: () => ipcRenderer.send('resize-end'),
  onSettings: on('settings'),
  onEditMode: on('edit-mode'),
  onState: on('state'),
  onTestMessage: on('test-message'),
});
