// File manager backend: browse drives and folders, open/rename/delete, extract
// archives, and find a game's .exe after it's been downloaded.
const { app, shell } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const isWin = process.platform === 'win32';

function gamesDir(cfg) {
  const dir = cfg.gamesDir || (isWin ? 'C:\\Games' : path.join(app.getPath('home'), 'Games'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function roots(cfg, downloadDir) {
  const places = [
    { name: 'Downloads', path: downloadDir, icon: 'download' },
    { name: 'Games', path: gamesDir(cfg), icon: 'gamepad' },
    { name: 'Documents', path: app.getPath('documents'), icon: 'file' },
    { name: 'Pictures', path: app.getPath('pictures'), icon: 'image' },
    { name: 'Videos', path: app.getPath('videos'), icon: 'film' },
    { name: 'Music', path: app.getPath('music'), icon: 'music' },
  ];
  const drives = isWin
    ? 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter((l) => fs.existsSync(`${l}:\\`)).map((l) => ({ name: `Drive ${l}:`, path: `${l}:\\`, icon: 'drive' }))
    : [{ name: 'Computer', path: '/', icon: 'drive' }];
  return [...places.filter((p) => fs.existsSync(p.path)), ...drives].map((p) => ({ ...p, dir: true }));
}

function list(dir, cfg, downloadDir) {
  if (!dir) return { path: '', parent: null, entries: roots(cfg, downloadDir) };
  const entries = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.name.startsWith('.') || d.name.startsWith('$') || /^(desktop\.ini|thumbs\.db|ntuser\..*)$/i.test(d.name)) continue;
    const full = path.join(dir, d.name);
    try {
      const st = fs.statSync(full);
      entries.push({ name: d.name, path: full, dir: st.isDirectory(), size: st.size, mtime: st.mtimeMs, ext: path.extname(d.name).toLowerCase() });
    } catch { /* locked or broken link */ }
  }
  entries.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const parent = path.dirname(dir);
  return { path: dir, parent: parent === dir ? '' : parent, entries };
}

async function open(file) {
  const err = await shell.openPath(file);
  if (err) throw new Error(err);
  return { ok: true };
}

function rename(file, newName) {
  if (!newName || /[\\/:*?"<>|]/.test(newName)) throw new Error('That name has characters Windows does not allow');
  const target = path.join(path.dirname(file), newName);
  fs.renameSync(file, target);
  return target;
}

async function remove(file) {
  await shell.trashItem(file); // Recycle Bin, so it can be undone
  return { ok: true };
}

function mkdir(dir, name) {
  const target = path.join(dir, name);
  fs.mkdirSync(target);
  return target;
}

function sevenZip() {
  const candidates = ['C:\\Program Files\\7-Zip\\7z.exe', 'C:\\Program Files (x86)\\7-Zip\\7z.exe', '/usr/bin/7z'];
  return candidates.find((c) => fs.existsSync(c));
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).toString().trim().split('\n').pop()));
      else resolve(stdout);
    });
  });
}

const ARCHIVE = /\.(zip|7z|rar|tar|gz|tgz|xz|bz2|iso)$/i;
const isArchive = (file) => ARCHIVE.test(file);

// Extracts into <Games>\<archive name>\ and returns that folder.
async function extract(archive, cfg) {
  const name = path.basename(archive).replace(/(\.tar)?\.[^.]+$/i, '');
  let dest = path.join(gamesDir(cfg), name);
  for (let i = 2; fs.existsSync(dest); i++) dest = path.join(gamesDir(cfg), `${name} ${i}`);
  const z = sevenZip();
  if (z) await run(z, ['x', '-y', `-o${dest}`, archive]);
  else if (/\.zip$/i.test(archive) && isWin) await run('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}'`]);
  else if (/\.zip$/i.test(archive)) await run('unzip', ['-q', archive, '-d', dest]);
  else throw new Error('Install 7-Zip to extract this kind of archive');
  return dest;
}

// Likely game executables in a folder, best guesses first.
function findExecutables(dir) {
  const out = [];
  const skip = /unins|uninstall|setup|install|redist|vcredist|directx|dxsetup|crash|report|helper|launcherpatcher|ue4prereq|dotnet|easyanticheat_setup/i;
  (function walk(d, depth) {
    if (depth > 4 || out.length > 200) return;
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (/\.exe$/i.test(e.name)) {
        try { out.push({ path: full, name: e.name, size: fs.statSync(full).size, likely: !skip.test(e.name), depth }); } catch { /* skip */ }
      }
    }
  })(fs.statSync(dir).isDirectory() ? dir : path.dirname(dir), 0);
  return out.sort((a, b) => (b.likely - a.likely) || (a.depth - b.depth) || (b.size - a.size));
}

// Installed Windows programs, from the Start menu shortcuts.
function startMenuApps() {
  if (!isWin) return [];
  const dirs = [
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs'),
    path.join(process.env.APPDATA || '', 'Microsoft\\Windows\\Start Menu\\Programs'),
  ];
  const seen = new Map();
  const skip = /uninstall|help|readme|manual|website|documentation|release notes|license|support/i;
  for (const root of dirs) {
    (function walk(d, depth) {
      if (depth > 3) return;
      let entries = [];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full, depth + 1);
        else if (/\.(lnk|url)$/i.test(e.name) && !skip.test(e.name)) {
          const title = e.name.replace(/\.(lnk|url)$/i, '');
          if (!seen.has(title.toLowerCase())) seen.set(title.toLowerCase(), { title, path: full });
        }
      }
    })(root, 0);
  }
  return [...seen.values()].sort((a, b) => a.title.localeCompare(b.title));
}

async function icon(file) {
  try {
    return (await app.getFileIcon(file, { size: 'large' })).toDataURL();
  } catch {
    return null;
  }
}

// Copies (or moves) a file or folder into destDir; never overwrites.
async function copy(src, destDir, move = false) {
  const name = path.basename(src);
  const ext = path.extname(name);
  const base = fs.statSync(src).isDirectory() ? name : path.basename(name, ext);
  let target = path.join(destDir, name);
  for (let i = 2; fs.existsSync(target); i++) target = path.join(destDir, fs.statSync(src).isDirectory() ? `${base} (${i})` : `${base} (${i})${ext}`);
  if (move) {
    try { await fs.promises.rename(src, target); return target; } catch { /* different drive: copy then delete */ }
  }
  await fs.promises.cp(src, target, { recursive: true, errorOnExist: true });
  if (move) await fs.promises.rm(src, { recursive: true, force: true });
  return target;
}

module.exports = {
  copy, list, open, rename, remove, mkdir, extract, isArchive, findExecutables, startMenuApps, icon, gamesDir };
