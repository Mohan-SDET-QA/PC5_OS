// Registers games added to PC5 (downloads, Windows apps) as "non-Steam games"
// in Steam, then launches them through Steam. Steam Input then makes PS4/PS5
// (and other) controllers work in games that only understand Xbox controllers.
//
// Steam keeps shortcuts in userdata/<account>/config/shortcuts.vdf (binary
// KeyValues). Entries PC5 manages carry the tag "PC5"; everything else in the
// file is preserved untouched.
const fs = require('fs');
const path = require('path');
const vdf = require('./binvdf');

const TAG = 'PC5';

// ---------------------------------------------------------------- Steam's shortcut IDs
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(str) {
  let c = 0xffffffff;
  for (const byte of Buffer.from(str, 'utf8')) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const quote = (p) => `"${p}"`;

// Steam derives a shortcut's app id from its (quoted) exe and name.
function shortcutAppId(exe, name) {
  return (crc32(quote(exe) + name) | 0x80000000) >>> 0;
}

// The 64-bit id used by steam://rungameid/ for non-Steam shortcuts.
function rungameId(appId) {
  return ((BigInt(appId) << 32n) | 0x02000000n).toString();
}

// ---------------------------------------------------------------- finding Steam users
const STEAM64_BASE = 76561197960265728n;

// Accounts to write to: the most recently signed-in one, else every local one.
function userConfigDirs(steamRoot) {
  const userdata = path.join(steamRoot, 'userdata');
  let ids = [];
  try { ids = fs.readdirSync(userdata).filter((d) => /^\d+$/.test(d) && d !== '0'); } catch { return []; }
  try {
    const login = fs.readFileSync(path.join(steamRoot, 'config', 'loginusers.vdf'), 'utf8');
    const m = /"(\d{17})"\s*\{[^}]*"MostRecent"\s*"1"/i.exec(login);
    if (m) {
      const account = String(BigInt(m[1]) - STEAM64_BASE);
      if (ids.includes(account)) ids = [account];
    }
  } catch { /* no login history yet */ }
  return ids.map((id) => path.join(userdata, id, 'config'));
}

// ---------------------------------------------------------------- reading / writing
function readShortcuts(file) {
  try {
    const root = vdf.parse(fs.readFileSync(file));
    const list = vdf.get(root, 'shortcuts');
    if (Array.isArray(list)) return list.map((e) => e.value);
  } catch { /* missing or unreadable: start fresh */ }
  return [];
}

function writeShortcuts(file, shortcuts) {
  const root = [vdf.map('shortcuts', shortcuts.map((sc, i) => vdf.map(String(i), sc)))];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.pc5-backup`);
  fs.writeFileSync(file, vdf.serialize(root));
}

const tagsOf = (sc) => (vdf.get(sc, 'tags') || []).map((t) => t.value);
const isOurs = (sc) => tagsOf(sc).includes(TAG);

function makeShortcut(game, appId) {
  const startDir = path.dirname(game.exe) + path.sep;
  return [
    vdf.int('appid', appId | 0), // stored as a signed 32-bit int
    vdf.str('AppName', game.title),
    vdf.str('Exe', quote(game.exe)),
    vdf.str('StartDir', quote(startDir)),
    vdf.str('icon', game.icon || ''),
    vdf.str('ShortcutPath', ''),
    vdf.str('LaunchOptions', (game.args || []).join(' ')),
    vdf.int('IsHidden', 0),
    vdf.int('AllowDesktopConfig', 1),
    vdf.int('AllowOverlay', 1),
    vdf.int('OpenVR', 0),
    vdf.int('Devkit', 0),
    vdf.str('DevkitGameID', ''),
    vdf.int('DevkitOverrideAppID', 0),
    vdf.int('LastPlayTime', 0),
    vdf.str('FlatpakAppID', ''),
    vdf.map('tags', [vdf.str('0', TAG)]),
  ];
}

// Only real programs can be Steam shortcuts (not .lnk/.url from Windows Apps).
const eligible = (g) => g && g.exe && /\.exe$/i.test(g.exe);

/**
 * Makes Steam's shortcut list match PC5's added games (dryRun: only report).
 * Returns { changed, ids } where ids maps exe path -> rungameid.
 */
function sync(steamRoot, games, { dryRun = false } = {}) {
  const wanted = games.filter(eligible);
  const ids = {};
  for (const g of wanted) ids[g.exe] = rungameId(shortcutAppId(g.exe, g.title));
  let changed = false;

  for (const dir of userConfigDirs(steamRoot)) {
    const file = path.join(dir, 'shortcuts.vdf');
    const current = readShortcuts(file);
    // Keep the user's own shortcuts; rebuild ours from the PC5 library.
    const theirs = current.filter((sc) => !isOurs(sc));
    const ours = [];
    for (const g of wanted) {
      // Already added to Steam by the user: reuse theirs instead of duplicating it.
      const existing = theirs.find((sc) => (vdf.get(sc, 'Exe') || '').replace(/"/g, '').toLowerCase() === g.exe.toLowerCase());
      if (existing && vdf.get(existing, 'appid') != null) ids[g.exe] = rungameId(vdf.get(existing, 'appid') >>> 0);
      else if (!existing) ours.push(makeShortcut(g, shortcutAppId(g.exe, g.title)));
    }
    const next = [...theirs, ...ours];
    const before = current.filter(isOurs).map((sc) => `${vdf.get(sc, 'AppName')}|${vdf.get(sc, 'Exe')}`).sort().join('\n');
    const after = ours.map((sc) => `${vdf.get(sc, 'AppName')}|${vdf.get(sc, 'Exe')}`).sort().join('\n');
    if (before !== after || !fs.existsSync(file)) {
      if (!dryRun) writeShortcuts(file, next);
      changed = true;
    }
  }
  return { changed, ids };
}

// Shortcuts PC5 has already registered (exe path -> rungameid), from disk.
function registered(steamRoot) {
  const out = {};
  for (const dir of userConfigDirs(steamRoot)) {
    for (const sc of readShortcuts(path.join(dir, 'shortcuts.vdf'))) {
      if (!isOurs(sc)) continue;
      const exe = (vdf.get(sc, 'Exe') || '').replace(/"/g, '');
      const appId = vdf.get(sc, 'appid');
      if (exe && appId != null) out[exe.toLowerCase()] = rungameId(appId >>> 0);
    }
  }
  return out;
}

module.exports = { sync, registered, shortcutAppId, rungameId, crc32, userConfigDirs, readShortcuts };
