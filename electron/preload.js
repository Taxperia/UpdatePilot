'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('updatePilot', {
  request: (endpoint, body) => ipcRenderer.invoke('updatepilot:request', endpoint, body),
  exportCsv: kind => ipcRenderer.invoke('updatepilot:export', kind)
});
