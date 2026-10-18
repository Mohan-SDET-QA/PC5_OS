// Watches game folders (C:\Games, D:\Games, GOG Games, ... plus any the user
// adds) and finds games installed there by hand, so they appear on Home by
// themselves.
const fs = require('fs');
const path = require('path');
const files = require('../files');

const SKIP = /^(steamapps|steamlibrary|steam library|epic games|xboxgames|windowsapps|common|\$recycle\.bin|system volume information)$/i;

function defaultFolders(gamesDir) {
  const out = new Set([gamesDir]);
  if (process.platform === 'win32') {
    for (const l of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      for (const sub of ['Games', 'GOG Games', 'Program Files (x86)\\GOG Galaxy\\Games', 'Program Files\\GOG Galaxy\\Games']) {
        const p = `${l}:\\${sub}`;
        if (fs.existsSync(p)) out.add(p);
      }
    }
  }
  return [...out].filter((p) => p && fs.existsSync(p));
}

function folders(cfg, gamesDir) {
  return [...new Set([...defaultFolders(gamesDir), ...(cfg.gameFolders || [])])].filter((p) => fs.existsSync(p));
}

const cleanTitle = (name) => name
  .replace(/[._]+/g, ' ')
  .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
  .replace(/\b(v\d[\w.]*|x64|win64|repack|gog|setup)\b/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * Game folders that aren't in the library yet: [{ title, exe, folder }].
 * known: exe paths already in the library (any source). ignored: folders the
 * user removed, which are never suggested again.
 */
function findNewGames(cfg, gamesDir, known) {
  const knownDirs = [...known].map((e) => path.dirname(e).toLowerCase());
  const ignored = new Set((cfg.ignoredFolders || []).map((f) => f.toLowerCase()));
  const found = [];
  for (const root of folders(cfg, gamesDir)) {
    let subs = [];
    try { subs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !SKIP.test(d.name)); } catch { continue; }
    for (const d of subs) {
      const folder = path.join(root, d.name);
      const lower = folder.toLowerCase();
      if (ignored.has(lower) || knownDirs.some((k) => k === lower || k.startsWith(lower + path.sep))) continue;
      const best = files.findExecutables(folder).find((e) => e.likely && e.size > 512 * 1024);
      if (best) found.push({ title: cleanTitle(d.name) || d.name, exe: best.path, folder });
    }
  }
  return found;
}

module.exports = { findNewGames, folders, cleanTitle };
