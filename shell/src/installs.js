// "Install from file": runs a game installer (.exe/.msi/.iso), then works out
// what it installed by comparing Windows' list of installed programs (the
// Uninstall registry keys) and the Start menu before and after.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const files = require('./files');

const UNINSTALL_KEYS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
];
const NOT_GAME_EXE = /unins|uninstall|setup|install|update|crash|report|redist|vcredist|dxsetup|helper|launcherpatcher/i;

function run(cmd, args, timeout = 30000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 1 << 26 }, (err, stdout) => resolve(err ? '' : stdout.toString()));
  });
}

// Parses `reg query <key> /s` output into { subkeyPath: { valueName: data } }.
function parseRegQuery(text) {
  const out = {};
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^HKEY_/.test(line)) { cur = out[line.trim()] = {}; continue; }
    const m = /^\s{4}(.+?)\s{4}REG_\w+\s{4}(.*)$/.exec(line);
    if (m && cur) cur[m[1]] = m[2].trim();
  }
  return out;
}

async function installedPrograms() {
  const all = {};
  for (const key of UNINSTALL_KEYS) Object.assign(all, parseRegQuery(await run('reg', ['query', key, '/s'])));
  const programs = {};
  for (const [key, v] of Object.entries(all)) {
    if (!v.DisplayName || v.SystemComponent === '0x1') continue;
    programs[key] = { name: v.DisplayName, location: (v.InstallLocation || '').replace(/^"|"$/g, ''), icon: v.DisplayIcon || '', publisher: v.Publisher || '' };
  }
  return programs;
}

const snapshot = async () => ({
  programs: process.platform === 'win32' ? await installedPrograms() : {},
  shortcuts: new Set(files.startMenuApps().map((a) => a.path)),
});

// The exe a newly installed program should launch, best guess.
function pickExe(program) {
  const icon = program.icon.split(',')[0].replace(/"/g, '').trim();
  if (/\.exe$/i.test(icon) && !NOT_GAME_EXE.test(path.basename(icon)) && fs.existsSync(icon)) return icon;
  if (program.location && fs.existsSync(program.location)) {
    const best = files.findExecutables(program.location).find((e) => e.likely);
    if (best) return best.path;
  }
  return null;
}

function diff(before, after) {
  for (const [key, program] of Object.entries(after.programs)) {
    if (before.programs[key]) continue;
    const exe = pickExe(program);
    if (exe) return { title: program.name, exe };
  }
  // No usable registry entry: fall back to a new Start menu shortcut.
  for (const p of after.shortcuts) {
    if (before.shortcuts.has(p) || /uninstall|readme|manual|website/i.test(p)) continue;
    return { title: p.split(/[\\/]/).pop().replace(/\.(lnk|url)$/i, ''), exe: p };
  }
  return null;
}

const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Start-Process goes through ShellExecute, so installers that need admin rights
// elevate normally; -Wait also waits for the processes the installer starts.
function runAndWait(file) {
  const ext = path.extname(file).toLowerCase();
  const script = ext === '.msi'
    ? `Start-Process msiexec.exe -ArgumentList '/i',${psQuote(`"${file}"`)} -Wait`
    : `Start-Process -FilePath ${psQuote(file)} -WorkingDirectory ${psQuote(path.dirname(file))} -Wait`;
  return run('powershell.exe', ['-NoProfile', '-Command', script], 6 * 60 * 60 * 1000);
}

// Mounts an ISO and returns the setup program on it.
async function mountIso(file) {
  const letter = (await run('powershell.exe', ['-NoProfile', '-Command',
    `(Mount-DiskImage -ImagePath ${psQuote(file)} -PassThru | Get-Volume).DriveLetter`])).trim();
  if (!letter) throw new Error('Could not mount the disc image');
  const root = `${letter}:\\`;
  const autorun = path.join(root, 'autorun.inf');
  if (fs.existsSync(autorun)) {
    const m = /^\s*open\s*=\s*(.+)$/im.exec(fs.readFileSync(autorun, 'utf8'));
    if (m && fs.existsSync(path.join(root, m[1].trim()))) return path.join(root, m[1].trim());
  }
  const setup = fs.readdirSync(root).find((f) => /^(setup|install)\.exe$/i.test(f));
  if (!setup) throw new Error('No setup program found on the disc image');
  return path.join(root, setup);
}

const unmountIso = (file) => run('powershell.exe', ['-NoProfile', '-Command', `Dismount-DiskImage -ImagePath ${psQuote(file)}`]);

/**
 * Runs an installer and returns { title, exe } for what it installed, or null.
 * onStatus(text) reports progress for the UI.
 */
async function install(file, onStatus = () => {}) {
  const before = await snapshot();
  let target = file;
  const iso = /\.iso$/i.test(file);
  if (iso) {
    onStatus('Opening the disc image…');
    target = await mountIso(file);
  }
  onStatus('Installing… finish the installer, then come back here.');
  await runAndWait(target);
  // Some installers hand off to a background process and exit early: keep looking for a while.
  for (let i = 0; i < 24; i++) {
    const found = diff(before, await snapshot());
    if (found) {
      if (iso) await unmountIso(file);
      return found;
    }
    onStatus('Looking for the installed game…');
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (iso) await unmountIso(file);
  return null;
}

module.exports = { install, parseRegQuery, diff, pickExe };
