// Windows settings used by the Settings page: sound, display, brightness,
// power timers, time zone, storage, system details, and switching between
// PC5 and the normal Windows desktop. Off Windows (demo/dev) it returns
// plausible fake data so the UI can be built and tested anywhere.
const { app } = require('electron');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const isWin = process.platform === 'win32';
const WINLOGON = 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon';

function run(cmd, args, { timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || stdout || err.message).toString().trim().split('\n').pop()));
      else resolve(stdout.toString());
    });
  });
}

const ps = (script) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]);

// ------------------------------------------------------------------ PC5System.exe (sound, display)
let helperExe = null;
function setHelperPath(p) { helperExe = p; }

async function helper(...args) {
  if (!helperExe || !fs.existsSync(helperExe)) throw new Error('PC5System.exe is missing. Run npm run build:helper.');
  const out = JSON.parse((await run(helperExe, args.map(String))).trim());
  if (out && out.error) throw new Error(out.error);
  return out;
}

// Demo state so sliders and pickers behave when not on Windows.
const demo = {
  volume: 60, muted: false,
  devices: [{ id: 'tv', name: 'LG TV (HDMI)', default: true }, { id: 'hp', name: 'Headphones', default: false }],
  display: { width: 1920, height: 1080, hz: 60, modes: [[3840, 2160, 60], [2560, 1440, 120], [1920, 1080, 144], [1920, 1080, 60], [1280, 720, 60]].map(([width, height, hz]) => ({ width, height, hz })) },
  brightness: 80, sleep: 0, screenOff: 30, tz: 'Pacific Standard Time', consoleMode: false,
};

async function getVolume() { return isWin ? helper('volume', 'get') : { volume: demo.volume, muted: demo.muted }; }
async function setVolume(v) {
  if (isWin) return helper('volume', 'set', Math.round(v));
  demo.volume = Math.round(v); if (v > 0) demo.muted = false;
  return getVolume();
}
async function toggleMute() {
  if (isWin) return helper('volume', 'mute', 'toggle');
  demo.muted = !demo.muted;
  return getVolume();
}
async function audioDevices() { return isWin ? helper('audio', 'list') : demo.devices; }
async function setAudioDevice(id) {
  if (isWin) return helper('audio', 'set', id);
  demo.devices.forEach((d) => { d.default = d.id === id; });
  return demo.devices;
}

async function getDisplay() { return isWin ? helper('display', 'get') : demo.display; }
async function setDisplay(w, h, hz) {
  if (isWin) return helper('display', 'set', w, h, hz);
  Object.assign(demo.display, { width: w, height: h, hz });
  return demo.display;
}

// Laptop / built-in panels only; external monitors usually don't expose this.
async function getBrightness() {
  if (!isWin) return demo.brightness;
  try {
    const out = await ps('(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1).CurrentBrightness');
    const n = parseInt(out, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
async function setBrightness(v) {
  if (!isWin) { demo.brightness = v; return v; }
  await ps(`(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Select-Object -First 1) | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{Timeout=1; Brightness=${Math.round(v)}}`);
  return v;
}

// ------------------------------------------------------------------ power (minutes; 0 = never)
async function powerIndex(sub, setting) {
  const out = await run('powercfg', ['/q', 'SCHEME_CURRENT', sub, setting]);
  const m = /Current AC Power Setting Index:\s*0x([0-9a-f]+)/i.exec(out);
  return m ? Math.round(parseInt(m[1], 16) / 60) : 0;
}
async function getPower() {
  if (!isWin) return { sleep: demo.sleep, screenOff: demo.screenOff };
  const [sleep, screenOff] = await Promise.all([powerIndex('SUB_SLEEP', 'STANDBYIDLE'), powerIndex('SUB_VIDEO', 'VIDEOIDLE')]);
  return { sleep, screenOff };
}
async function setPower(key, minutes) {
  if (!isWin) { demo[key] = minutes; return getPower(); }
  const setting = key === 'sleep' ? 'standby-timeout-ac' : 'monitor-timeout-ac';
  await run('powercfg', ['/change', setting, String(minutes)]);
  return getPower();
}

// ------------------------------------------------------------------ time zone
async function timeZones() {
  if (!isWin) return [{ id: 'Pacific Standard Time', name: '(UTC-08:00) Pacific Time (US & Canada)' }, { id: 'Eastern Standard Time', name: '(UTC-05:00) Eastern Time (US & Canada)' }, { id: 'India Standard Time', name: '(UTC+05:30) Chennai, Kolkata, Mumbai, New Delhi' }, { id: 'GMT Standard Time', name: '(UTC+00:00) Dublin, Edinburgh, Lisbon, London' }];
  const out = await run('tzutil', ['/l']);
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const zones = [];
  for (let i = 0; i + 1 < lines.length; i += 2) zones.push({ name: lines[i], id: lines[i + 1] });
  return zones;
}
async function getTimeZone() { return isWin ? (await run('tzutil', ['/g'])).trim() : demo.tz; }
async function setTimeZone(id) {
  if (!isWin) { demo.tz = id; return id; }
  await run('tzutil', ['/s', id]);
  return id;
}

// ------------------------------------------------------------------ storage
function drives() {
  const roots = isWin
    ? 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:\\`).filter((r) => fs.existsSync(r))
    : ['/'];
  return roots.map((root) => {
    try {
      const st = fs.statfsSync(root);
      const total = st.blocks * st.bsize;
      const free = st.bavail * st.bsize;
      return { root, total, free, used: total - free };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

// ------------------------------------------------------------------ system details
let detailsCache = null;
async function systemDetails() {
  if (detailsCache) return detailsCache;
  const base = {
    os: `${os.type()} ${os.release()}`,
    cpu: ((os.cpus()[0] || {}).model || 'Unknown').replace(/\s+/g, ' ').trim(),
    threads: os.cpus().length,
    memory: `${Math.round(os.totalmem() / 1024 ** 3)} GB`,
    gpu: 'Unknown',
    host: os.hostname(),
    pc5: app.getVersion(),
  };
  if (isWin) {
    try {
      const out = JSON.parse(await ps('$o=Get-CimInstance Win32_OperatingSystem; $g=(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join ", "; @{os=$o.Caption + " " + $o.Version; gpu=$g} | ConvertTo-Json -Compress'));
      base.os = out.os || base.os;
      base.gpu = out.gpu || base.gpu;
    } catch { /* keep basics */ }
  } else {
    base.gpu = 'Demo GPU';
  }
  detailsCache = base;
  return base;
}

// ------------------------------------------------------------------ PC5 <-> Windows desktop
// Where PC5 is installed (the value Windows runs as the shell).
// The running copy wins, so the Setup.exe install (in AppData) and an older
// install-shell.ps1 copy (in Program Files) never point at each other.
function shellExe() {
  if (app.isPackaged) return process.execPath;
  const installed = 'C:\\Program Files\\PC5Shell\\PC5Shell.exe';
  return fs.existsSync(installed) ? installed : null;
}

async function getShell() {
  try {
    const out = await run('reg', ['query', WINLOGON, '/v', 'Shell']);
    const m = /Shell\s+REG_SZ\s+(.+)/.exec(out);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}
const setShell = (value) => run('reg', ['add', WINLOGON, '/v', 'Shell', '/t', 'REG_SZ', '/d', value, '/f']);
const clearShell = () => run('reg', ['delete', WINLOGON, '/v', 'Shell', '/f']).catch(() => {});

let desktopStarted = false;

// Console mode: Windows starts PC5 instead of the desktop when this user signs in.
// Off, PC5 is an ordinary app opened from the Start menu or desktop.
async function getConsoleMode() {
  if (!isWin) return Boolean(demo.consoleMode);
  return /PC5Shell\.exe/i.test((await getShell()) || '');
}
async function setConsoleMode(on) {
  if (!isWin) { demo.consoleMode = Boolean(on); return demo.consoleMode; }
  if (on) {
    const exe = shellExe();
    if (!exe) throw new Error('Install PC5 OS with the Setup program first.');
    await setShell(`"${exe}"`);
  } else {
    await clearShell();
  }
  return getConsoleMode();
}

async function explorerRunning() {
  const out = await run('tasklist', ['/fi', 'imagename eq explorer.exe', '/nh']).catch(() => '');
  return /explorer\.exe/i.test(out);
}

// The full Windows desktop (taskbar, Start) in this session. Explorer only
// becomes the desktop if it is the registered shell when it starts, so the
// setting is flipped to Explorer for a moment and then put back.
async function openDesktop() {
  if (!isWin) return { demo: true };
  // App mode: the desktop is already there, so PC5 just steps aside.
  if (await explorerRunning()) return { ok: true, alreadyOpen: true };
  const previous = await getShell();
  await setShell('explorer.exe');
  spawn('explorer.exe', [], { detached: true, stdio: 'ignore' }).unref();
  desktopStarted = true;
  await new Promise((r) => setTimeout(r, 4000));
  if (previous && !/explorer\.exe$/i.test(previous)) await setShell(previous);
  else await clearShell();
  return { ok: true };
}

// Closes the desktop opened by openDesktop() when the user comes back to PC5.
async function closeDesktop() {
  if (!isWin || !desktopStarted) return false;
  desktopStarted = false;
  await run('taskkill', ['/im', 'explorer.exe', '/f']).catch(() => {});
  return true;
}

function desktopFolder() {
  return path.join(os.homedir(), 'Desktop');
}

// Switch to normal Windows: sign out, sign back in to the regular desktop,
// with a "Return to PC5" icon on it.
async function switchToWindows() {
  if (!isWin) return { demo: true };
  const exe = shellExe();
  if (!exe) throw new Error('Install PC5 OS with the Setup program first.');
  const dir = path.join(app.getPath('userData'));
  const cmd = path.join(dir, 'return-to-pc5.cmd');
  fs.writeFileSync(cmd, [
    '@echo off',
    `reg add "${WINLOGON}" /v Shell /t REG_SZ /d "${exe}" /f >nul`,
    'shutdown /l',
    '',
  ].join('\r\n'));
  const lnk = `${desktopFolder()}\\Return to PC5.lnk`.replace(/'/g, "''");
  await ps([
    `$desk = [Environment]::GetFolderPath('Desktop')`,
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desk 'Return to PC5.lnk'))`,
    `$s.TargetPath = '${cmd.replace(/'/g, "''")}'`,
    `$s.WindowStyle = 7`,
    `$s.IconLocation = '${exe.replace(/'/g, "''")},0'`,
    `$s.Description = 'Sign out and go back to PC5'`,
    `$s.Save()`,
  ].join('; ')).catch(() => fs.writeFileSync(lnk.replace(/\.lnk$/, '.cmd'), fs.readFileSync(cmd)));
  await clearShell();
  await run('shutdown', ['/l']);
  return { ok: true };
}

module.exports = {
  setHelperPath, getVolume, setVolume, toggleMute, audioDevices, setAudioDevice,
  getDisplay, setDisplay, getBrightness, setBrightness, getPower, setPower,
  timeZones, getTimeZone, setTimeZone, drives, systemDetails,
  openDesktop, closeDesktop, switchToWindows, shellExe, getConsoleMode, setConsoleMode,
};
