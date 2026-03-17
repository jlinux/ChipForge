const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const fs = require('fs')
const path = require('path')
const { generateSTLFiles } = require('./stl-generator')

let mainWindow
let settings = {
  exportDir: null,
}

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function loadSettings() {
  try {
    settings = {
      ...settings,
      ...JSON.parse(fs.readFileSync(getSettingsPath(), 'utf-8')),
    }
  } catch {
    settings = { exportDir: null }
  }
}

function saveSettings() {
  fs.mkdirSync(path.dirname(getSettingsPath()), { recursive: true })
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2))
}

function isValidDirectory(dirPath) {
  if (!dirPath) return false
  try {
    return fs.statSync(dirPath).isDirectory()
  } catch {
    return false
  }
}

async function selectExportDirectory() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择保存位置',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled) return null

  settings.exportDir = result.filePaths[0]
  saveSettings()
  return settings.exportDir
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  loadSettings()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// IPC: Select font file
ipcMain.handle('select-font', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择字体文件',
    filters: [{ name: '字体文件', extensions: ['ttf', 'otf', 'woff'] }],
    properties: ['openFile'],
  })
  if (result.canceled) return null
  return result.filePaths[0]
})

// IPC: Export directory
ipcMain.handle('get-export-dir', async () => {
  return isValidDirectory(settings.exportDir) ? settings.exportDir : null
})

ipcMain.handle('select-export-dir', async () => {
  return selectExportDirectory()
})

// IPC: Generate STL files
ipcMain.handle('generate-stl', async (event, params) => {
  let outputDir = settings.exportDir
  if (!isValidDirectory(outputDir)) {
    outputDir = await selectExportDirectory()
  }
  if (!outputDir) return { success: false, reason: 'canceled' }

  try {
    const sendProgress = (progress) => {
      mainWindow.webContents.send('stl-progress', progress)
    }
    await generateSTLFiles(params, outputDir, sendProgress)
    mainWindow.webContents.send('stl-complete', { success: true, outputDir })
    return { success: true, outputDir }
  } catch (err) {
    return { success: false, reason: err.message }
  }
})
