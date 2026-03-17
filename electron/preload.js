const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  generateSTL: (params) => ipcRenderer.invoke('generate-stl', params),
  selectFont: (locale) => ipcRenderer.invoke('select-font', locale),
  readFontData: (fontPath) => ipcRenderer.invoke('read-font-data', fontPath),
  getExportDir: () => ipcRenderer.invoke('get-export-dir'),
  selectExportDir: (locale) => ipcRenderer.invoke('select-export-dir', locale),
  onProgress: (callback) => {
    ipcRenderer.on('stl-progress', (_, progress) => callback(progress))
  },
  onComplete: (callback) => {
    ipcRenderer.on('stl-complete', (_, result) => callback(result))
  },
})
