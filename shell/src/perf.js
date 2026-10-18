// Performance monitor: CPU, GPU, RAM, VRAM, disk, network, temperatures and
// the busiest processes, sampled every ~1.5 s while someone is watching (the
// Performance page or the in-game overlay).
//
// Windows: one long-running PowerShell reads Windows performance counters
// (Get-Counter) and prints a JSON line per sample; NVIDIA cards add GPU
// temperature and VRAM totals via nvidia-smi. Elsewhere (demo/dev) it uses
// Node's os module plus simulated GPU numbers.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const readline = require('readline');

const isWin = process.platform === 'win32';
const HISTORY = 60;
const KEYS = ['cpu', 'gpu', 'ram', 'vram', 'disk', 'netIn', 'netOut', 'cpuTemp', 'gpuTemp'];

const history = Object.fromEntries(KEYS.map((k) => [k, []]));
let latest = null;
let listeners = new Set();
let child = null;
let timer = null;
let lastCpu = null;
let nvidia = null; // null = unknown, false = none, string = path

const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$cores = [Environment]::ProcessorCount
$c = @('\Processor(_Total)\% Processor Time','\GPU Engine(*engtype_3D)\Utilization Percentage','\GPU Adapter Memory(*)\Dedicated Usage',
       '\PhysicalDisk(_Total)\% Disk Time','\Network Interface(*)\Bytes Received/sec','\Network Interface(*)\Bytes Sent/sec',
       '\Thermal Zone Information(*)\Temperature','\Process(*)\% Processor Time','\Process(*)\Working Set - Private')
while ($true) {
  $s = (Get-Counter -Counter $c -ErrorAction SilentlyContinue).CounterSamples
  $sum = { param($like) ($s | Where-Object { $_.Path -like $like } | Measure-Object -Property CookedValue -Sum).Sum }
  $temps = $s | Where-Object { $_.Path -like '*thermal zone information*' } | ForEach-Object { $_.CookedValue - 273.15 }
  $procs = @{}
  foreach ($p in ($s | Where-Object { $_.Path -like '*\process(*' })) {
    $name = ($p.InstanceName -replace '#\d+$','')
    if ($name -eq '_total' -or $name -eq 'idle') { continue }
    if (-not $procs.ContainsKey($name)) { $procs[$name] = @{ name = $name; cpu = 0; mem = 0 } }
    if ($p.Path -like '*% processor time') { $procs[$name].cpu += $p.CookedValue / $cores } else { $procs[$name].mem += $p.CookedValue }
  }
  $top = $procs.Values | Sort-Object { $_.cpu } -Descending | Select-Object -First 12
  $o = @{
    cpu = & $sum '*processor(_total)*'
    gpu = [Math]::Min(100, (& $sum '*engtype_3d*'))
    vramUsed = & $sum '*dedicated usage*'
    disk = [Math]::Min(100, (& $sum '*physicaldisk(_total)*'))
    netIn = & $sum '*bytes received/sec*'
    netOut = & $sum '*bytes sent/sec*'
    cpuTemp = if ($temps) { ($temps | Measure-Object -Maximum).Maximum } else { $null }
    procs = @($top)
  }
  [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 700
}`;

function push(sample) {
  latest = sample;
  for (const k of KEYS) {
    const arr = history[k];
    arr.push(sample[k] == null ? null : sample[k]);
    if (arr.length > HISTORY) arr.shift();
  }
  const snapshot = { ...sample, history };
  for (const fn of listeners) fn(snapshot);
}

function nvidiaSmi() {
  if (nvidia === null) {
    const p = 'C:\\Windows\\System32\\nvidia-smi.exe';
    nvidia = isWin && fs.existsSync(p) ? p : false;
  }
  if (!nvidia) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(nvidia, ['--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'],
      { windowsHide: true, timeout: 3000 }, (err, out) => {
        if (err) return resolve(null);
        const [name, util, temp, used, total] = out.toString().split('\n')[0].split(',').map((x) => x.trim());
        resolve({ name, util: Number(util), temp: Number(temp), used: Number(used) * 1024 * 1024, total: Number(total) * 1024 * 1024 });
      });
  });
}

function ramSample() {
  const total = os.totalmem();
  const used = total - os.freemem();
  return { ram: (used / total) * 100, ramUsed: used, ramTotal: total };
}

function cpuFromOs() {
  const cpus = os.cpus();
  const t = cpus.reduce((a, c) => { a.idle += c.times.idle; a.total += Object.values(c.times).reduce((x, y) => x + y, 0); return a; }, { idle: 0, total: 0 });
  const prev = lastCpu;
  lastCpu = t;
  if (!prev) return 0;
  const dTotal = t.total - prev.total;
  return dTotal ? (1 - (t.idle - prev.idle) / dTotal) * 100 : 0;
}

let lastNet = null;
function netFromProc() {
  try {
    const lines = fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2).filter(Boolean);
    let rx = 0; let tx = 0;
    for (const l of lines) {
      const [iface, rest] = l.split(':');
      if (iface.trim() === 'lo') continue;
      const f = rest.trim().split(/\s+/).map(Number);
      rx += f[0]; tx += f[8];
    }
    const now = Date.now();
    const prev = lastNet;
    lastNet = { rx, tx, now };
    if (!prev) return { netIn: 0, netOut: 0 };
    const dt = (now - prev.now) / 1000;
    return { netIn: (rx - prev.rx) / dt, netOut: (tx - prev.tx) / dt };
  } catch {
    return { netIn: 0, netOut: 0 };
  }
}

// Simulated GPU and processes for demo mode, so the UI can be built anywhere.
let demoT = 0;
function demoExtras(cpu) {
  demoT += 1;
  const wave = (a, b, p) => a + (b - a) * (0.5 + 0.5 * Math.sin(demoT / p));
  return {
    gpu: wave(35, 92, 7), gpuName: 'Demo GPU', vramUsed: wave(3.1, 6.4, 11) * 1024 ** 3, vramTotal: 8 * 1024 ** 3,
    disk: wave(2, 30, 5), cpuTemp: wave(48, 71, 9), gpuTemp: wave(55, 79, 13),
    procs: [
      { name: 'ELDEN RING', cpu: Math.max(0, cpu * 0.6), mem: 7.2e9 }, { name: 'steamwebhelper', cpu: 3.1, mem: 4.1e8 },
      { name: 'PC5Shell', cpu: 2.2, mem: 3.0e8 }, { name: 'Discord', cpu: 1.4, mem: 5.2e8 }, { name: 'svchost', cpu: 0.6, mem: 9.0e7 },
    ],
  };
}

async function sampleNonWindows() {
  const cpu = cpuFromOs();
  push({ cpu, ...ramSample(), ...netFromProc(), ...demoExtras(cpu), time: Date.now() });
}

function startWindows() {
  child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_SCRIPT], { windowsHide: true });
  readline.createInterface({ input: child.stdout }).on('line', async (line) => {
    let s;
    try { s = JSON.parse(line); } catch { return; }
    const nv = await nvidiaSmi();
    push({
      cpu: s.cpu || 0,
      gpu: nv ? nv.util : s.gpu || 0,
      gpuName: nv ? nv.name : null,
      vramUsed: nv ? nv.used : s.vramUsed || 0,
      vramTotal: nv ? nv.total : null,
      disk: s.disk || 0,
      netIn: s.netIn || 0,
      netOut: s.netOut || 0,
      cpuTemp: s.cpuTemp,
      gpuTemp: nv ? nv.temp : null,
      procs: (s.procs || []).map((p) => ({ name: p.name, cpu: p.cpu, mem: p.mem })),
      ...ramSample(),
      time: Date.now(),
    });
  });
  child.on('exit', () => { child = null; if (listeners.size) setTimeout(start, 2000); });
}

function start() {
  if (isWin) { if (!child) startWindows(); } else if (!timer) {
    sampleNonWindows();
    timer = setInterval(sampleNonWindows, 1500);
  }
}

function stop() {
  if (child) { child.removeAllListeners('exit'); child.kill(); child = null; }
  if (timer) { clearInterval(timer); timer = null; }
}

// Sampling only runs while at least one viewer is subscribed.
function subscribe(fn) {
  listeners.add(fn);
  start();
  if (latest) fn({ ...latest, history });
  return () => {
    listeners.delete(fn);
    if (!listeners.size) stop();
  };
}

// Processes PC5 refuses to end: ending them would crash or lock Windows.
const PROTECTED = /^(system|registry|smss|csrss|wininit|winlogon|services|lsass|lsaiso|svchost|fontdrvhost|dwm|memory compression|secure system|pc5shell|pc5input|electron)$/i;

function endTask(name) {
  if (PROTECTED.test(name)) throw new Error(`${name} is part of Windows and can't be closed`);
  if (!isWin) return Promise.resolve({ demo: true });
  return new Promise((resolve, reject) => {
    execFile('taskkill', ['/f', '/im', `${name}.exe`], { windowsHide: true }, (err, out, errOut) => (err ? reject(new Error((errOut || err.message).toString().trim())) : resolve({ ok: true })));
  });
}

module.exports = { subscribe, endTask, PROTECTED };
