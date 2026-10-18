// The performance overlay only receives stats; it has no other access.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  onPerf: (fn) => ipcRenderer.on('perf', (_e, snap) => fn(snap)),
});
