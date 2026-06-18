const { app, BrowserWindow, shell, ipcMain, nativeTheme } = require('electron')
const path = require('path')
const { startServer } = require('../server/index')

const isDev = process.env.NODE_ENV === 'development'
const PORT = 3001

let mainWindow
let serverPort = PORT

async function createWindow() {
  const actualPort = await startServer(PORT)
  serverPort = actualPort

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
    backgroundColor: '#fdf6f0',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#fdf6f0',
      symbolColor: '#6b4c3b',
      height: 36,
    },
    show: false,
    icon: path.join(__dirname, '../assets/icon.png'),
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    // mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// IPC handlers
ipcMain.handle('get-server-port', () => serverPort)
ipcMain.handle('open-external', (_, url) => shell.openExternal(url))
ipcMain.handle('show-item-in-folder', (_, filePath) => shell.showItemInFolder(filePath))
ipcMain.handle('open-file', (_, filePath) => shell.openPath(filePath))
ipcMain.handle('get-app-version', () => app.getVersion())
ipcMain.handle('get-platform', () => process.platform)

ipcMain.handle('set-theme', (_, theme) => {
  if (!mainWindow) return
  if (theme === 'dark') {
    mainWindow.setTitleBarOverlay({ color: '#1c1410', symbolColor: '#e8c4a8', height: 36 })
  } else {
    mainWindow.setTitleBarOverlay({ color: '#fdf6f0', symbolColor: '#6b4c3b', height: 36 })
  }
})
