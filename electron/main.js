const { app, BrowserWindow, shell, ipcMain, nativeTheme, dialog } = require('electron')
const path = require('path')
const fs   = require('fs')

const isDev = process.env.NODE_ENV === 'development'
const PORT  = 3001

// Last-used window chrome colors, cached so a dark theme doesn't flash light
// window buttons/background on startup (the renderer only syncs colors after
// its preferences fetch lands).
function windowThemeFile() { return path.join(app.getPath('userData'), 'windowTheme.json') }
function loadWindowTheme() {
  try { return JSON.parse(fs.readFileSync(windowThemeFile(), 'utf8')) } catch { return null }
}
function saveWindowTheme(t) {
  try { fs.writeFileSync(windowThemeFile(), JSON.stringify(t)) } catch {}
}

let mainWindow
let serverPort = PORT
let autoUpdater = null

// electron-updater only works in a packaged app, not in dev
if (!isDev) {
  try {
    autoUpdater = require('electron-updater').autoUpdater
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
  } catch {}
}

// ── Crash / bricked-window recovery ─────────────────────────────────────────
// The renderer can brick in ways that leave no working UI (uncaught JS error,
// crashed process, stuck page). A button inside that UI would be useless, so
// recovery lives here in the main process as a native dialog that always works.
let recoveryShown = false

const RELEASES_PAGE = 'https://github.com/shinystarborne/Shelfmind/releases'

function rollbackToPreviousRelease() {
  if (!autoUpdater) {
    // Dev builds have no updater — point the user at manual downloads instead.
    shell.openExternal(RELEASES_PAGE)
    return
  }
  // Target the stable channel and allow moving to a lower version number, so a
  // bricked beta (or bricked stable) can be replaced by the last good release.
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = true

  const cleanup = () => {
    autoUpdater.removeListener('update-available', onAvailable)
    autoUpdater.removeListener('update-downloaded', onDownloaded)
    autoUpdater.removeListener('update-not-available', onNone)
    autoUpdater.removeListener('error', onError)
  }
  const onAvailable = () => autoUpdater.downloadUpdate()
  const onDownloaded = () => { cleanup(); autoUpdater.quitAndInstall(false, true) }
  const fallback = async (msg) => {
    cleanup()
    if (!mainWindow || mainWindow.isDestroyed()) return
    const r = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Manual download needed',
      message: msg,
      detail: 'You can grab an older installer from the releases page — running it installs over the current version. Your library data is stored separately and is not affected.',
      buttons: ['Open releases page', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    if (r.response === 0) shell.openExternal(RELEASES_PAGE)
  }
  const onNone = () => fallback('No older release was found to install automatically.')
  const onError = () => fallback('The rollback download failed (check your internet connection).')

  autoUpdater.on('update-available', onAvailable)
  autoUpdater.on('update-downloaded', onDownloaded)
  autoUpdater.on('update-not-available', onNone)
  autoUpdater.on('error', onError)
  autoUpdater.checkForUpdates()

  if (mainWindow && !mainWindow.isDestroyed()) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Rolling back',
      message: 'Downloading the previous release in the background.',
      detail: 'ShelfMind will restart and install it as soon as the download finishes.',
      buttons: ['OK'],
      noLink: true,
    })
  }
}

async function showRecoveryDialog(reason) {
  if (recoveryShown || !mainWindow || mainWindow.isDestroyed()) return
  recoveryShown = true
  const r = await dialog.showMessageBox(mainWindow, {
    type: 'error',
    title: 'ShelfMind failed to start',
    message: 'ShelfMind didn’t start correctly.',
    detail: `${reason}\n\nYou can restart the app, or install the previous release over this one. Your library data is kept separately and won't be touched either way.`,
    buttons: ['Restart', 'Install previous release', 'Quit'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  })
  if (r.response === 0) { app.relaunch(); app.exit(0) }
  else if (r.response === 1) rollbackToPreviousRelease()
  else app.quit()
}

async function createWindow() {
  const { startServer } = require('../server/index')
  const actualPort = await startServer(PORT)
  serverPort = actualPort

  const wt = loadWindowTheme()

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: wt?.color || '#fdf6f0',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: wt?.color || '#fdf6f0',
      symbolColor: wt?.symbolColor || '#6b4c3b',
      height: 36,
    },
    show: false,
    icon: path.join(__dirname, '../assets/icon.png'),
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())
  setTimeout(() => { if (mainWindow && !mainWindow.isVisible()) mainWindow.show() }, 4000)

  mainWindow.webContents.on('did-fail-load', (event, code, desc, url) => {
    console.error('[LOAD FAIL]', code, desc, url)
    mainWindow.show()
    // -3 = ERR_ABORTED (benign, happens on redirects); anything else means no UI at all.
    if (code !== -3) showRecoveryDialog(`The app window failed to load (${desc}).`)
  })

  // Renderer died outright (crash, OOM) — the window stays but the UI is gone.
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[RENDER GONE]', details.reason)
    if (details.reason !== 'clean-exit' && details.reason !== 'killed') {
      showRecoveryDialog(`The app window crashed (${details.reason}).`)
    }
  })

  mainWindow.webContents.on('unresponsive', () => {
    showRecoveryDialog('The app window stopped responding.')
  })

  // Blank-page watchdog: an uncaught error in the JS bundle (e.g. a bad release)
  // doesn't kill the renderer process — it just leaves #root empty forever.
  // A few seconds after load, check that React actually mounted something.
  mainWindow.webContents.on('did-finish-load', () => {
    setTimeout(async () => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      try {
        const rendered = await mainWindow.webContents.executeJavaScript(
          '!!(document.getElementById("root") && document.getElementById("root").children.length > 0)'
        )
        if (!rendered) showRecoveryDialog('The app window stayed blank after loading.')
      } catch { /* renderer already gone — render-process-gone covers that */ }
    }, 8000)
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    // mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  if (autoUpdater) {
    autoUpdater.on('update-available',     (info)     => mainWindow?.webContents.send('update-available', info))
    autoUpdater.on('update-not-available', ()         => mainWindow?.webContents.send('update-not-available'))
    autoUpdater.on('download-progress',    (progress) => mainWindow?.webContents.send('update-progress', progress))
    autoUpdater.on('update-downloaded',    (info)     => mainWindow?.webContents.send('update-downloaded', info))
    autoUpdater.on('error',                (err)      => mainWindow?.webContents.send('update-error', err.message))
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

ipcMain.handle('updater-check', (_, opts = {}) => {
  if (!autoUpdater) return
  autoUpdater.allowPrerelease = !!opts.beta
  autoUpdater.allowDowngrade = true
  return autoUpdater.checkForUpdates()
})
ipcMain.handle('updater-download', () => autoUpdater?.downloadUpdate())
ipcMain.handle('updater-install',  () => autoUpdater?.quitAndInstall(false, true))

// IPC handlers
ipcMain.handle('get-server-port', () => serverPort)
ipcMain.handle('open-external', (_, url) => shell.openExternal(url))
ipcMain.handle('show-item-in-folder', (_, filePath) => shell.showItemInFolder(filePath))
ipcMain.handle('open-file', (_, filePath) => shell.openPath(filePath))
ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose PDF folder',
    properties: ['openDirectory'],
  })
  return result.canceled ? null : result.filePaths[0]
})
ipcMain.handle('pick-pdf-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Add PDFs',
    filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
    properties: ['openFile', 'multiSelections'],
  })
  return result.canceled ? [] : result.filePaths
})
ipcMain.handle('get-app-version', () => app.getVersion())
ipcMain.handle('get-platform', () => process.platform)

ipcMain.handle('set-theme', (_, theme, colors) => {
  if (!mainWindow) return
  // Renderer passes the active palette's computed colors; fall back to the
  // default palette's hardcoded values when they're missing.
  const fallback = theme === 'dark'
    ? { color: '#1c1410', symbolColor: '#e8c4a8' }
    : { color: '#fdf6f0', symbolColor: '#6b4c3b' }
  const applied = {
    color:       colors?.color       || fallback.color,
    symbolColor: colors?.symbolColor || fallback.symbolColor,
  }
  mainWindow.setTitleBarOverlay({ ...applied, height: 36 })
  saveWindowTheme(applied)   // next launch opens with these colors directly
})
