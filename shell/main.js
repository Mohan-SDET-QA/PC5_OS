// PC5 Shell main process: owns the fullscreen window, talks to Windows,
// and exposes a small IPC surface to the renderer (see preload.js).
const { app, BrowserWindow, ipcMain, shell, globalShortcut, session, Notification, desktopCapturer, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const config = require('./src/config');
const library = require('./src/library');
const store = require('./src/store');
const system = require('./src/system');
const downloads = require('./src/downloads');
const files = require('./src/files');
const { createInputLink } = require('./src/input');
const steamShortcuts = require('./src/library/steam-shortcuts');
const gameFolders = require('./src/library/folders');
const winsettings = require('./src/winsettings');
const installs = require('./src/installs');
const color = require('./src/color');
const perf = require('./src/perf');

const isWin = process.platform === 'win32';
const devMode = process.argv.includes('--dev');
const demoMode = process.argv.includes('--demo') || !isWin;

let mainWin = null;
let quitting = false;
let input = { available: false, send() {} };
const webWindows = new Set();

// Only these URI schemes may be opened from the UI.
const ALLOWED_SCHEMES = ['steam:', 'com.epicgames.launcher:', 'goggalaxy:', 'https:', 'ms-settings:'];
const BROWSER_PARTITION = 'persist:browser';

const helperPath = (name) => (app.isPackaged
  ? path.join(process.resourcesPath, 'helper', name)
  : path.join(__dirname, 'helper', fs.existsSync(path.join(__dirname, 'helper', 'bin', name)) ? 'bin' : '', name));

const send = (channel, ...args) => { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, ...args); };

function createMainWindow() {
  mainWin = new BrowserWindow({
    icon: app.isPackaged ? path.join(process.resourcesPath, 'icon.ico') : path.join(__dirname, 'build', 'icon.png'),
    width: 1600,
    height: 900,
    fullscreen: !devMode,
    frame: devMode,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      webviewTag: true, // the built-in web browser
    },
  });
  mainWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWin.once('ready-to-show', () => mainWin.show());
  mainWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // As the system shell, closing the window would leave a black screen.
  mainWin.on('close', (e) => { if (!quitting && !devMode) e.preventDefault(); });

  // Lock down the browser <webview>: no Node, no preload, web pages only.
  mainWin.webContents.on('will-attach-webview', (_e, prefs, params) => {
    delete prefs.preload;
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    if (!/^(https?:|about:blank)/.test(params.src || '')) params.src = 'about:blank';
  });
}

function bringHome() {
  for (const w of webWindows) w.close();
  if (!mainWin) return;
  winsettings.closeDesktop().then((closed) => { if (closed) send('toast', 'Closed the Windows desktop'); });
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  // Windows blocks focus stealing from background processes; briefly going
  // topmost is the reliable way back to the foreground.
  mainWin.setAlwaysOnTop(true, 'screen-saver');
  mainWin.focus();
  setTimeout(() => mainWin && mainWin.setAlwaysOnTop(false), 300);
  send('home');
}

function setMouseMode(on) {
  input.send(on ? 'MOUSE ON' : 'MOUSE OFF');
  send('input', { mouseMode: on });
}

function startInput() {
  input = createInputLink({
    exe: helperPath('PC5Input.exe'),
    elevate: config.load().elevateInput !== false,
    isQuitting: () => quitting,
    onLine(line) {
      if (line === 'HOME') bringHome();
      else if (line === 'MOUSE ON' || line === 'MOUSE OFF') send('input', { mouseMode: line === 'MOUSE ON' });
      else if (line.startsWith('PADS ')) send('input', { pads: Number(line.slice(5)) });
      else if (line === 'CAPTURE' && config.load().captureOnShare) takeScreenshot().then((file) => send('captured', file)).catch(() => {});
    },
  });
}

function openWebApp(appDef) {
  const win = new BrowserWindow({
    fullscreen: !devMode,
    frame: devMode,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'webapp-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:webapps',
    },
  });
  if (appDef.userAgent) win.webContents.setUserAgent(appDef.userAgent);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadURL(appDef.url);
  webWindows.add(win);
  win.on('closed', () => { webWindows.delete(win); bringHome(); });
}

function openUri(uri) {
  const scheme = new URL(uri).protocol;
  if (!ALLOWED_SCHEMES.includes(scheme)) throw new Error(`Blocked URI scheme ${scheme}`);
  return shell.openExternal(uri);
}

function launchExe(exe, args = []) {
  if (!fs.existsSync(exe)) throw new Error(`Not installed: ${exe}`);
  spawn(exe, args, { cwd: path.dirname(exe), detached: true, stdio: 'ignore' }).unref();
}

// Programs that aren't games (installers, the desktop) need a pointer:
// switch the controller into mouse mode for them.
async function runWithMouse(file) {
  if (demoMode) return { ok: true, demo: true };
  await files.open(file);
  setMouseMode(true);
  return { ok: true, mouseMode: input.available };
}

function setupBrowserSession() {
  const ses = session.fromPartition(BROWSER_PARTITION);
  downloads.init({
    session: ses,
    getConfig: config.load,
    notify: (list) => send('downloads', list),
    onFinished: (rec) => {
      send('download-done', rec);
      if (Notification.isSupported() && !mainWin.isFocused()) new Notification({ title: 'Download complete', body: rec.name }).show();
    },
  });

  // Links inside the browser: magnets go to the torrent client, pop-ups open in place.
  app.on('web-contents-created', (_e, contents) => {
    if (contents.getType() !== 'webview') return;
    contents.setWindowOpenHandler(({ url }) => {
      if (/^magnet:/i.test(url)) downloads.addTorrent(url);
      else if (/^https?:/i.test(url)) contents.loadURL(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (e, url) => {
      if (/^magnet:/i.test(url)) {
        e.preventDefault();
        downloads.addTorrent(url);
        send('toast', 'Torrent added to Downloads');
      } else if (!/^(https?:|about:)/i.test(url)) {
        e.preventDefault();
      }
    });
  });
}

function registerIpc() {
  const handle = (channel, fn) => ipcMain.handle(channel, (_e, ...args) => fn(...args));

  handle('config:get', () => config.load());
  handle('config:set', (patch) => {
    const next = config.save(patch);
    if ('customGames' in patch || 'steamInputForAdded' in patch) syncSteamShortcuts();
    return next;
  });
  handle('env', () => ({ demo: demoMode, platform: process.platform, inputHelper: input.available }));

  handle('library:list', () => (demoMode ? library.demoGames(config.load(), artFound) : library.scan(config.load(), artFound)));
  handle('library:addGame', (game) => addGame(game));
  handle('library:folders', () => gameFolders.folders(config.load(), files.gamesDir(config.load())));
  handle('library:scanFolders', () => scanGameFolders());
  handle('games:install', (file) => installFromFile(file));
  handle('art:color', (url) => color.dominant(url));
  handle('game:launch', async (game) => {
    config.pushRecent(game.id);
    if (demoMode) return { ok: true, demo: true };
    if (game.uri) await openUri(game.uri);
    else if (/\.(lnk|url)$/i.test(game.exe)) await files.open(game.exe); // added from Windows Apps
    else launchExe(game.exe, game.args);
    return { ok: true };
  });
  handle('app:launch', async (appDef) => {
    if (appDef.type === 'web') return openWebApp(appDef);
    if (demoMode) return { ok: true, demo: true };
    if (appDef.type === 'uri') return openUri(appDef.uri);
    if (appDef.type === 'file') return runWithMouse(appDef.path);
    return launchExe(appDef.exe, appDef.args);
  });
  handle('uri:open', (uri) => (demoMode ? { demo: true } : openUri(uri)));

  handle('store:steamFeatured', () => store.steamFeatured());
  handle('store:steamSearch', (term) => store.steamSearch(term));
  handle('store:epicFree', () => store.epicFree());
  handle('store:steamFree', () => store.steamFreeToPlay());
  handle('store:giveaways', () => store.giveaways());

  handle('downloads:list', () => downloads.list());
  handle('downloads:addUrl', (url) => downloads.addUrl(url));
  handle('downloads:addTorrent', (src) => downloads.addTorrent(src));
  handle('downloads:pause', (id) => downloads.pause(id));
  handle('downloads:resume', (id) => downloads.resume(id));
  handle('downloads:remove', (id, deleteFiles) => downloads.remove(id, deleteFiles));

  handle('files:list', (dir) => files.list(dir, config.load(), downloads.downloadDir()));
  handle('files:open', (file) => (/\.(exe|msi|bat|cmd|lnk)$/i.test(file) ? runWithMouse(file) : files.open(file)));
  handle('files:rename', (file, name) => files.rename(file, name));
  handle('files:remove', (file) => files.remove(file));
  handle('files:mkdir', (dir, name) => files.mkdir(dir, name));
  handle('files:extract', (file) => files.extract(file, config.load()));
  handle('files:findExe', (dir) => files.findExecutables(dir));
  handle('files:apps', () => files.startMenuApps());
  handle('files:icon', (file) => files.icon(file));

  handle('system:info', () => system.info());
  handle('wifi:list', () => (demoMode ? system.demoWifi() : system.wifiList()));
  handle('wifi:connect', (ssid, password, auth) => system.wifiConnect(ssid, password, auth));
  handle('power', (action) => (demoMode ? { demo: true } : system.power(action)));
  handle('boot:entries', () => (demoMode ? [{ id: '{demo}', description: 'Windows 11 (other partition)' }] : system.bootEntries()));
  handle('boot:restartInto', (id) => (demoMode ? { demo: true } : system.restartInto(id)));
  handle('boot:firmware', () => (demoMode ? { demo: true } : system.restartToFirmware()));
  handle('bt:scan', () => (demoMode
    ? [{ id: 'demo1', name: 'DualSense Wireless Controller', controller: true }, { id: 'demo2', name: 'Wireless Controller', controller: true }]
    : system.bluetooth(helperPath('bluetooth.ps1'), 'scan')));
  handle('bt:pair', (id) => (demoMode ? { status: 'Paired' } : system.bluetooth(helperPath('bluetooth.ps1'), 'pair', id)));
  handle('input:mouse', (on) => setMouseMode(on));

  // Settings backed by Windows (see src/winsettings.js).
  const WINSET = ['getVolume', 'setVolume', 'toggleMute', 'audioDevices', 'setAudioDevice', 'getDisplay', 'setDisplay',
    'getBrightness', 'setBrightness', 'getPower', 'setPower', 'timeZones', 'getTimeZone', 'setTimeZone', 'drives', 'systemDetails', 'getConsoleMode', 'setConsoleMode'];
  handle('winset', (name, ...args) => {
    if (!WINSET.includes(name)) throw new Error(`Unknown setting ${name}`);
    return winsettings[name](...args);
  });

  handle('shell:desktop', async () => {
    await winsettings.openDesktop();
    if (isWin) mainWin.hide(); // PS button (or Return to PC5) brings it back
    setMouseMode(true);
  });
  handle('shell:switchToWindows', () => winsettings.switchToWindows());

  // Performance monitor: the Home window and the overlay each subscribe while visible.
  let perfOff = null;
  handle('perf:watch', (on) => {
    if (on && !perfOff) perfOff = perf.subscribe((snap) => send('perf', snap));
    if (!on && perfOff) { perfOff(); perfOff = null; }
  });
  handle('perf:endTask', (name) => perf.endTask(name));
  handle('overlay:set', (opts) => setOverlay(opts));
  handle('capture:screenshot', () => takeScreenshot());
  handle('files:copy', (src, destDir, move) => files.copy(src, destDir, move));
  handle('shell:quit', () => { quitting = true; app.quit(); });

  // Web apps (YouTube TV etc.) ask to go home when the Guide/PS button is pressed.
  ipcMain.on('webapp:home', () => bringHome());
}

// Keeps Steam's non-Steam-game list in line with PC5's added games. A running
// Steam rewrites shortcuts.vdf when it exits, so it's closed first and reopened.
let syncing = Promise.resolve();
function syncSteamShortcuts() {
  syncing = syncing.then(async () => {
    if (demoMode) return;
    const cfg = config.load();
    const root = await library.steamRoot();
    if (!root) return;
    const games = cfg.steamInputForAdded === false ? [] : await library.shortcutGames(cfg);
    if (!steamShortcuts.sync(root, games, { dryRun: true }).changed) return;
    const steamExe = await library.steamExe();
    const wasRunning = await system.isRunning('steam.exe');
    if (wasRunning) {
      send('toast', 'Adding your games to Steam for controller support. Steam restarts for a moment.');
      spawn(steamExe, ['-shutdown'], { detached: true, stdio: 'ignore' }).unref();
      for (let i = 0; i < 60 && (await system.isRunning('steam.exe')); i++) await new Promise((r) => setTimeout(r, 500));
    }
    steamShortcuts.sync(root, games);
    if (wasRunning) launchExe(steamExe, ['-silent']);
    send('library-changed');
  }).catch((err) => console.error('[steam shortcuts]', err.message));
  return syncing;
}

async function autostart() {
  if (demoMode) return;
  const cfg = config.load();
  await syncSteamShortcuts(); // before Steam starts, so no restart is needed
  // With a custom shell, Explorer's Run keys never execute, so the shell
  // starts the launchers itself. Steam must be running for steam:// links.
  if (cfg.autostartSteam) {
    const steamExe = await library.steamExe();
    if (steamExe && !(await system.isRunning('steam.exe'))) launchExe(steamExe, ['-silent']);
  }
  for (const item of cfg.autostart || []) {
    try { launchExe(item.exe, item.args); } catch (err) { console.error(err.message); }
  }
}

// ------------------------------------------------------------------ performance overlay
// A small always-on-top, click-through window with live stats, shown over
// games (borderless/windowed; exclusive fullscreen games draw over it).
let overlayWin = null;
let overlayOff = null;
function setOverlay({ on, position = 'top-right' } = {}) {
  if (!on) {
    if (overlayOff) { overlayOff(); overlayOff = null; }
    if (overlayWin) { overlayWin.destroy(); overlayWin = null; }
    return { on: false };
  }
  const area = screen.getPrimaryDisplay().workArea;
  const w = 330;
  const h = 132;
  const m = 16;
  const x = position.endsWith('left') ? area.x + m : area.x + area.width - w - m;
  const y = position.startsWith('top') ? area.y + m : area.y + area.height - h - m;
  if (!overlayWin) {
    overlayWin = new BrowserWindow({
      x, y, width: w, height: h, frame: false, transparent: true, resizable: false, focusable: false,
      skipTaskbar: true, hasShadow: false, show: false,
      webPreferences: { preload: path.join(__dirname, 'overlay-preload.js'), contextIsolation: true, nodeIntegration: false },
    });
    overlayWin.setAlwaysOnTop(true, 'screen-saver');
    overlayWin.setIgnoreMouseEvents(true);
    overlayWin.setVisibleOnAllWorkspaces(true);
    overlayWin.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
    overlayWin.once('ready-to-show', () => overlayWin && overlayWin.showInactive());
    overlayOff = perf.subscribe((snap) => { if (overlayWin && !overlayWin.isDestroyed()) overlayWin.webContents.send('perf', snap); });
  } else {
    overlayWin.setBounds({ x, y, width: w, height: h });
  }
  return { on: true };
}

// ------------------------------------------------------------------ screenshots
async function takeScreenshot() {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.size;
  const sf = display.scaleFactor;
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(width * sf), height: Math.round(height * sf) } });
  if (!sources.length) throw new Error('No screen to capture');
  const dir = path.join(app.getPath('pictures'), 'PC5 Captures');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const file = path.join(dir, `PC5_${stamp}.png`);
  fs.writeFileSync(file, sources[0].thumbnail.toPNG());
  return file;
}

// ------------------------------------------------------------------ adding games
let artTimer = null;
function artFound() {
  clearTimeout(artTimer);
  artTimer = setTimeout(() => send('library-changed'), 800);
}

// Adds a game to the library and puts it first on Home.
function addGame({ title, exe, folder, auto = false }) {
  const cfg = config.load();
  const existing = (cfg.customGames || []).findIndex((g) => (g.exe || '').toLowerCase() === exe.toLowerCase());
  if (existing >= 0) return { added: false, id: `custom:${existing}:${cfg.customGames[existing].title}` };
  const customGames = [...(cfg.customGames || []), { title, exe, folder, auto, added: Date.now() }];
  config.save({ customGames });
  const id = `custom:${customGames.length - 1}:${title}`;
  config.pushRecent(id);
  syncSteamShortcuts();
  send('library-changed');
  send('game-added', { title, auto });
  return { added: true, id };
}

// Games installed by hand into a game folder appear on Home by themselves.
let scanning = false;
async function scanGameFolders() {
  if (scanning) return [];
  scanning = true;
  try {
    const cfg = config.load();
    const known = new Set((cfg.customGames || []).map((g) => g.exe).filter(Boolean));
    for (const g of await library.shortcutGames(cfg)) known.add(g.exe);
    const found = gameFolders.findNewGames(cfg, files.gamesDir(cfg), known);
    for (const g of found) addGame({ ...g, auto: true });
    return found;
  } finally {
    scanning = false;
  }
}

// Runs an installer (or disc image), then adds whatever it installed.
async function installFromFile(file) {
  if (demoMode) return { demo: true };
  setMouseMode(true);
  try {
    const game = await installs.install(file, (text) => send('install-status', text));
    if (!game) return { found: false };
    return { found: true, ...addGame(game), title: game.title };
  } finally {
    setMouseMode(false);
    bringHome();
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', bringHome);
  app.whenReady().then(() => {
    registerIpc();
    setupBrowserSession();
    createMainWindow();
    startInput();
    winsettings.setHelperPath(helperPath('PC5System.exe'));
    const cfg0 = config.load();
    if (cfg0.overlay) setOverlay({ on: true, position: cfg0.overlayPosition });
    autostart().then(scanGameFolders);
    setInterval(scanGameFolders, 2 * 60 * 1000);
    globalShortcut.register('Control+Alt+H', bringHome);
  });
  app.on('before-quit', () => {
    quitting = true;
    setOverlay({ on: false });
    downloads.shutdown();
  });
  app.on('window-all-closed', () => app.quit());
}
