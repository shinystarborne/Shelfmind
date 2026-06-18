const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  setTheme: (theme) => ipcRenderer.invoke('set-theme', theme),
  getServerPort: () => ipcRenderer.invoke('get-server-port'),
  isElectron: true,

  // Updater
  checkForUpdates:  () => ipcRenderer.invoke('updater-check'),
  downloadUpdate:   () => ipcRenderer.invoke('updater-download'),
  installUpdate:    () => ipcRenderer.invoke('updater-install'),
  onUpdateAvailable:    (cb) => ipcRenderer.on('update-available',     (_, info)     => cb(info)),
  onUpdateNotAvailable: (cb) => ipcRenderer.on('update-not-available', ()            => cb()),
  onUpdateProgress:     (cb) => ipcRenderer.on('update-progress',      (_, progress) => cb(progress)),
  onUpdateDownloaded:   (cb) => ipcRenderer.on('update-downloaded',    (_, info)     => cb(info)),
  onUpdateError:        (cb) => ipcRenderer.on('update-error',         (_, msg)      => cb(msg)),
  removeUpdateListeners: () => {
    ['update-available', 'update-not-available', 'update-progress', 'update-downloaded', 'update-error']
      .forEach(ch => ipcRenderer.removeAllListeners(ch))
  },
})
