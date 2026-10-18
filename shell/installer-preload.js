// The PC5 OS Installer window's only way to reach the system (see src/installer.js).
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('pc5i', {
  context: call('installer:context'),
  catalog: call('installer:catalog'),
  start: call('installer:start'),
  call: call('installer:call'),
  cancel: call('installer:cancel'),
  installs: call('installer:installs'),
  pickIso: call('installer:pickIso'),
  pickIsoOut: call('installer:pickIsoOut'),
  getWindows: call('installer:getWindows'),
  showFile: call('installer:showFile'),
  openConsole: call('installer:openConsole'),
  consoleMode: call('installer:consoleMode'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onEvent: (fn) => {
    const listener = (_e, ev) => fn(ev);
    ipcRenderer.on('installer:event', listener);
    return () => ipcRenderer.removeListener('installer:event', listener);
  },
});
