// Thin wrappers over Windows built-ins (reg, netsh, shutdown, tasklist).
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout: 20000 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || stdout || err.message).trim()));
      else resolve(stdout);
    });
  });
}

async function regQuery(key, value) {
  if (process.platform !== 'win32') return null;
  try {
    const out = await run('reg', ['query', key, '/v', value]);
    const m = out.match(new RegExp(`${value}\\s+REG_\\w+\\s+(.+)`));
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

async function isRunning(image) {
  try {
    const out = await run('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/NH']);
    return out.toLowerCase().includes(image.toLowerCase());
  } catch {
    return false;
  }
}

function power(action) {
  switch (action) {
    case 'shutdown': return run('shutdown', ['/s', '/t', '0']);
    case 'restart': return run('shutdown', ['/r', '/t', '0']);
    // Sleeps (or hibernates if hibernation is enabled; firstboot disables it).
    case 'sleep': return run('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']);
    case 'signout': return run('shutdown', ['/l']);
    default: throw new Error(`Unknown power action ${action}`);
  }
}

// netsh output is localized; this parser expects an English install.
async function wifiList() {
  const out = await run('netsh', ['wlan', 'show', 'networks', 'mode=bssid']);
  const nets = [];
  let cur = null;
  for (const line of out.split(/\r?\n/)) {
    const ssid = line.match(/^SSID \d+ : (.*)$/);
    if (ssid) {
      cur = { ssid: ssid[1].trim(), signal: 0, auth: '' };
      if (cur.ssid) nets.push(cur);
      continue;
    }
    if (!cur) continue;
    const auth = line.match(/^\s+Authentication\s+: (.*)$/);
    if (auth) cur.auth = auth[1].trim();
    const sig = line.match(/^\s+Signal\s+: (\d+)%/);
    if (sig) cur.signal = Math.max(cur.signal, Number(sig[1]));
  }
  let connected = null;
  try {
    const iface = await run('netsh', ['wlan', 'show', 'interfaces']);
    const m = iface.match(/^\s+SSID\s+: (.*)$/m);
    if (m) connected = m[1].trim();
  } catch { /* no adapter */ }
  return { connected, networks: nets.sort((a, b) => b.signal - a.signal) };
}

const xmlEscape = (s) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

async function wifiConnect(ssid, password, auth = '') {
  const open = !password || /open/i.test(auth);
  const wpa3 = /WPA3/i.test(auth);
  const security = open
    ? '<authEncryption><authentication>open</authentication><encryption>none</encryption><useOneX>false</useOneX></authEncryption>'
    : `<authEncryption><authentication>${wpa3 ? 'WPA3SAE' : 'WPA2PSK'}</authentication><encryption>AES</encryption><useOneX>false</useOneX></authEncryption>
       <sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>${xmlEscape(password)}</keyMaterial></sharedKey>`;
  const xml = `<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
  <name>${xmlEscape(ssid)}</name>
  <SSIDConfig><SSID><name>${xmlEscape(ssid)}</name></SSID></SSIDConfig>
  <connectionType>ESS</connectionType>
  <connectionMode>auto</connectionMode>
  <MSM><security>${security}</security></MSM>
</WLANProfile>`;
  const file = path.join(os.tmpdir(), `orbit-wifi-${Date.now()}.xml`);
  fs.writeFileSync(file, xml);
  try {
    await run('netsh', ['wlan', 'add', 'profile', `filename=${file}`, 'user=current']);
  } finally {
    fs.rmSync(file, { force: true });
  }
  await run('netsh', ['wlan', 'connect', `name=${ssid}`]);
  return { ok: true };
}

function demoWifi() {
  return {
    connected: 'Living Room 5G',
    networks: [
      { ssid: 'Living Room 5G', signal: 92, auth: 'WPA2-Personal' },
      { ssid: 'Neighbor', signal: 41, auth: 'WPA3-Personal' },
      { ssid: 'Cafe Guest', signal: 22, auth: 'Open' },
    ],
  };
}

function info() {
  const gb = (n) => `${(n / 1024 ** 3).toFixed(1)} GB`;
  return {
    user: os.userInfo().username,
    host: os.hostname(),
    os: `${os.type()} ${os.release()}`,
    cpu: (os.cpus()[0] || {}).model || 'Unknown',
    cores: os.cpus().length,
    memory: gb(os.totalmem()),
    freeMemory: gb(os.freemem()),
    uptimeHours: (os.uptime() / 3600).toFixed(1),
  };
}

// Runs a PowerShell script as administrator (silent when UAC prompts are off,
// as on PC5 OS) and returns what it wrote to the output file passed as $args[0].
async function runElevated(script) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ps1 = path.join(os.tmpdir(), `pc5-elevated-${stamp}.ps1`);
  const out = path.join(os.tmpdir(), `pc5-elevated-${stamp}.txt`);
  fs.writeFileSync(ps1, `$out = $args[0]\n${script}`);
  try {
    const cmd = `Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','"${ps1}"','"${out}"'`;
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd]);
    return fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  } finally {
    fs.rmSync(ps1, { force: true });
    fs.rmSync(out, { force: true });
  }
}

// Other operating systems in the boot menu (dual boot), so the user can
// restart straight into one with the controller.
async function bootEntries() {
  const text = await runElevated(
    "bcdedit /enum osloader /v | Out-File $out -Encoding utf8\n" +
    "'#CURRENT#' | Out-File $out -Append -Encoding utf8\n" +
    "bcdedit /enum '{current}' /v | Out-File $out -Append -Encoding utf8");
  const [all, current = ''] = text.replace(/^\uFEFF/, '').split('#CURRENT#');
  const currentId = (current.match(/identifier\s+(\{[0-9a-f-]+\})/i) || [])[1];
  return all.split(/\r?\n\s*\r?\n/).map((block) => ({
    id: (block.match(/identifier\s+(\{[0-9a-f-]+\})/i) || [])[1],
    description: ((block.match(/description\s+(.+)/i) || [])[1] || '').trim(),
  })).filter((e) => e.id && e.id.toLowerCase() !== (currentId || '').toLowerCase());
}

async function restartInto(id) {
  if (!/^\{[0-9a-f-]+\}$/i.test(id)) throw new Error('Bad boot entry id');
  await runElevated(`bcdedit /bootsequence ${id}\nshutdown /r /t 0`);
}

const restartToFirmware = () => runElevated('shutdown /r /fw /t 0');

// Bluetooth pairing goes through helper/bluetooth.ps1 (WinRT, Windows PowerShell 5.1).
async function bluetooth(script, action, id) {
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, action];
  if (id) args.push(id);
  const outText = await new Promise((resolve, reject) => {
    execFile('powershell.exe', args, { windowsHide: true, timeout: 60000 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim()));
      else resolve(stdout);
    });
  });
  return JSON.parse(outText.trim() || 'null');
}

module.exports = {
  regQuery, isRunning, power, wifiList, wifiConnect, demoWifi, info,
  runElevated, bootEntries, restartInto, restartToFirmware, bluetooth,
};
