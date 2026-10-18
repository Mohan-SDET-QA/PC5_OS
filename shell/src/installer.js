// PC5 OS Installer: the window that turns a Windows ISO into PC5 OS, and its
// link to the install engine (windows/engine/pc5-engine.ps1).
//
// The engine needs administrator rights, so it is started once through a
// Windows permission prompt and then talks to this process over a private
// loopback connection (a random port plus a one-time token).
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');
const { createDemoEngine } = require('../renderer/js/installer-demo');

const isWin = process.platform === 'win32';
const MS_DOWNLOAD = 'https://www.microsoft.com/software-download/windows11';

const windowsDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'windows') : path.join(__dirname, '..', '..', 'windows'));
const engineScript = () => path.join(windowsDir(), 'engine', 'pc5-engine.ps1');
const stateFile = () => path.join(process.env.ProgramData || os.tmpdir(), 'PC5OS', 'installs.json');

// The PC5 app files copied into the new Windows: the installed app itself.
function shellDir() {
  if (app.isPackaged) return path.dirname(process.execPath);
  return path.join(__dirname, '..', 'dist', 'win-unpacked');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

// ------------------------------------------------------------------ real engine
function createEngine({ unelevatedShell } = {}) {
  let sock = null;
  let token = null;
  let nextId = 1;
  let starting = null;
  let currentCancel = null;
  const pending = new Map();

  function launch(port) {
    const script = engineScript();
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Serve', '-Port', String(port), '-Token', token];
    // Tests and development on Linux/macOS: PowerShell 7 without elevation.
    if (unelevatedShell) return spawn(unelevatedShell, args, { stdio: 'ignore', windowsHide: true });
    const quoted = args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ');
    const ps = `Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList '${quoted.replace(/'/g, "''")}'`;
    return spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore', windowsHide: true });
  }

  function connect(port, deadline) {
    return new Promise((resolve, reject) => {
      const attempt = () => {
        const s = net.connect(port, '127.0.0.1');
        s.once('connect', () => resolve(s));
        s.once('error', () => {
          s.destroy();
          if (Date.now() > deadline) reject(new Error('The install engine did not start.'));
          else setTimeout(attempt, 400);
        });
      };
      attempt();
    });
  }

  async function start() {
    if (sock) return { ok: true };
    if (starting) return starting;
    starting = (async () => {
      token = crypto.randomBytes(24).toString('hex');
      const port = await freePort();
      const child = launch(port);
      let denied = false;
      child.once('exit', (code) => { if (code && !unelevatedShell) denied = true; });
      const deadline = Date.now() + 180000; // time to answer the permission prompt
      const s = await Promise.race([
        connect(port, deadline),
        new Promise((_, reject) => {
          const t = setInterval(() => { if (denied) { clearInterval(t); reject(Object.assign(new Error('Administrator permission is needed to install PC5 OS.'), { denied: true })); } }, 250);
        }),
      ]);
      s.setEncoding('utf8');
      s.write(`${token}\n`);
      const lines = readline.createInterface({ input: s });
      await new Promise((resolve, reject) => {
        const onLine = (line) => {
          let msg;
          try { msg = JSON.parse(line); } catch { return; }
          if (msg.type === 'ready') { resolve(); return; }
          const p = pending.get(msg.id);
          if (!p) return;
          if (msg.type === 'event') p.onEvent(msg.event);
          else if (msg.type === 'result') {
            pending.delete(msg.id);
            if (msg.ok) p.resolve(msg.data);
            else p.reject(Object.assign(new Error(msg.error), { cancelled: Boolean(msg.cancelled) }));
          }
        };
        lines.on('line', onLine);
        s.once('close', () => {
          sock = null;
          for (const p of pending.values()) p.reject(new Error('The install engine stopped.'));
          pending.clear();
          reject(new Error('The install engine closed the connection.'));
        });
      });
      sock = s;
      return { ok: true };
    })();
    try { return await starting; } finally { starting = null; }
  }

  async function call(cmd, args = {}, onEvent = () => {}) {
    await start();
    const id = nextId++;
    const req = { id, cmd, args };
    if (cmd === 'build') {
      req.cancelFile = path.join(os.tmpdir(), `pc5-cancel-${token.slice(0, 12)}-${id}`);
      currentCancel = req.cancelFile;
    }
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, onEvent });
      sock.write(`${JSON.stringify(req)}\n`);
    }).finally(() => {
      if (req.cancelFile) { fs.rmSync(req.cancelFile, { force: true }); currentCancel = null; }
    });
  }

  return {
    demo: false,
    start,
    call,
    cancel() { if (currentCancel) fs.writeFileSync(currentCancel, 'cancel'); },
    close() { if (sock) sock.end(); },
  };
}

// PC5 OS installs this PC knows about (readable without administrator rights).
function readInstalls() {
  try {
    const v = JSON.parse(fs.readFileSync(stateFile(), 'utf8').replace(/^﻿/, ''));
    return Array.isArray(v) ? v : [v];
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------ window
function createInstaller({ demo, devMode, onOpenConsole, winsettings }) {
  let win = null;
  const useDemo = demo || (!isWin && !process.env.PC5_ENGINE_PWSH);
  const engine = useDemo ? createDemoEngine({ speed: Number(process.env.PC5_DEMO_SPEED) || 1 }) : createEngine({ unelevatedShell: isWin ? null : process.env.PC5_ENGINE_PWSH });
  const send = (ch, ...a) => { if (win && !win.isDestroyed()) win.webContents.send(ch, ...a); };

  const handle = (ch, fn) => ipcMain.handle(ch, async (_e, ...a) => fn(...a));
  handle('installer:context', () => ({
    version: app.getVersion(), demo: engine.demo, platform: process.platform,
    shellDir: shellDir(), canBuild: engine.demo || fs.existsSync(path.join(shellDir(), 'PC5Shell.exe')),
  }));
  handle('installer:catalog', () => JSON.parse(fs.readFileSync(path.join(windowsDir(), 'engine', 'strip-catalog.json'), 'utf8')));
  handle('installer:start', async () => {
    try { return await engine.start(); } catch (err) { return { ok: false, denied: Boolean(err.denied), error: err.message }; }
  });
  handle('installer:call', async (cmd, args) => {
    if (!['targets', 'info', 'build', 'remove', 'restart', 'ping'].includes(cmd)) throw new Error(`Unknown command ${cmd}`);
    if (cmd === 'build') args = { spec: { ...args.spec, shellDir: shellDir(), version: app.getVersion() } };
    try {
      return { ok: true, data: await engine.call(cmd, args, (ev) => send('installer:event', ev)) };
    } catch (err) {
      return { ok: false, error: err.message, cancelled: Boolean(err.cancelled) };
    }
  });
  handle('installer:cancel', () => engine.cancel());
  handle('installer:installs', () => (engine.demo ? null : readInstalls()));
  handle('installer:pickIso', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose a Windows ISO', properties: ['openFile'], filters: [{ name: 'Windows disc image', extensions: ['iso'] }] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('installer:pickIsoOut', async () => {
    const r = await dialog.showSaveDialog(win, { title: 'Save PC5 OS ISO', defaultPath: path.join(app.getPath('downloads'), 'PC5-OS.iso'), filters: [{ name: 'Disc image', extensions: ['iso'] }] });
    return r.canceled ? null : r.filePath;
  });
  handle('installer:getWindows', () => shell.openExternal(MS_DOWNLOAD));
  handle('installer:showFile', (p) => { if (p) shell.showItemInFolder(p); });
  handle('installer:openConsole', () => onOpenConsole());
  handle('installer:consoleMode', async (on) => {
    if (typeof on === 'boolean') await winsettings.setConsoleMode(on);
    return winsettings.getConsoleMode();
  });

  return {
    open() {
      if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.focus(); return win; }
      win = new BrowserWindow({
        width: 1240, height: 820, minWidth: 980, minHeight: 680, show: false,
        title: 'PC5 OS Installer', backgroundColor: '#070a14', autoHideMenuBar: true,
        icon: app.isPackaged ? path.join(process.resourcesPath, 'icon.ico') : path.join(__dirname, '..', 'build', 'icon.png'),
        webPreferences: { preload: path.join(__dirname, '..', 'installer-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
      });
      win.loadFile(path.join(__dirname, '..', 'renderer', 'installer.html'));
      win.once('ready-to-show', () => win.show());
      if (devMode) win.webContents.openDevTools({ mode: 'detach' });
      win.on('closed', () => { win = null; engine.close(); });
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      return win;
    },
    window: () => win,
  };
}

module.exports = { createInstaller, createEngine, readInstalls };
