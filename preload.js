const { contextBridge, ipcRenderer } = require('electron')

// 暴露安全的API给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  generatePDF: (htmlContent) => ipcRenderer.invoke('generate-pdf', htmlContent)
})