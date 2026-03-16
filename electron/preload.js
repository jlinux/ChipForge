const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  generateSTL: (params) => ipcRenderer.invoke('generate-stl', params),
  selectFont: () => ipcRenderer.invoke('select-font'),
  onProgress: (callback) => {
    ipcRenderer.on('stl-progress', (_, progress) => callback(progress))
  },
  onComplete: (callback) => {
    ipcRenderer.on('stl-complete', (_, result) => callback(result))
  },
})
