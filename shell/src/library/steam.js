const fs = require('fs');
const path = require('path');
const { regQuery } = require('../system');
const vdf = require('./vdf');

// Redistributables, runtimes and tools that show up as "installed apps".
const NOT_GAMES = new Set(['228980', '1070560', '1391110', '1493710', '1628350', '1826330', '250820', '1007']);

const cdn = (appid, file) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/${file}`;

async function steamRoot() {
  const reg = await regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath');
  const candidates = [reg, 'C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'].filter(Boolean);
  return candidates.map((p) => path.normalize(p)).find((p) => fs.existsSync(p)) || null;
}

async function steamExe() {
  const root = await steamRoot();
  const exe = root && path.join(root, 'steam.exe');
  return exe && fs.existsSync(exe) ? exe : null;
}

function libraryFolders(root) {
  const file = path.join(root, 'steamapps', 'libraryfolders.vdf');
  const folders = new Set([root]);
  try {
    const data = vdf.parse(fs.readFileSync(file, 'utf8'));
    const lf = data.libraryfolders || data.LibraryFolders || {};
    for (const v of Object.values(lf)) {
      if (typeof v === 'string') folders.add(v);
      else if (v && v.path) folders.add(v.path);
    }
  } catch { /* single-library install */ }
  return [...folders];
}

function localArt(root, appid) {
  // Steam caches artwork locally; newer clients use a per-app subfolder.
  const cache = path.join(root, 'appcache', 'librarycache');
  const pick = (...names) => {
    for (const n of names) {
      const p = path.join(cache, n);
      if (fs.existsSync(p)) return 'file:///' + p.replace(/\\/g, '/');
    }
    return null;
  };
  return {
    cover: pick(`${appid}_library_600x900.jpg`, `${appid}/library_600x900.jpg`),
    hero: pick(`${appid}_library_hero.jpg`, `${appid}/library_hero.jpg`),
  };
}

async function scan() {
  const root = await steamRoot();
  if (!root) return [];
  const games = [];
  for (const folder of libraryFolders(root)) {
    const apps = path.join(folder, 'steamapps');
    let files = [];
    try { files = fs.readdirSync(apps).filter((f) => /^appmanifest_\d+\.acf$/.test(f)); } catch { continue; }
    for (const f of files) {
      try {
        const manifest = vdf.parse(fs.readFileSync(path.join(apps, f), 'utf8')).AppState;
        if (!manifest || NOT_GAMES.has(manifest.appid)) continue;
        if (/redistributable|proton|steamvr|steamworks/i.test(manifest.name)) continue;
        const local = localArt(root, manifest.appid);
        games.push({
          id: `steam:${manifest.appid}`,
          source: 'steam',
          appid: manifest.appid,
          title: manifest.name,
          uri: `steam://rungameid/${manifest.appid}`,
          storeUri: `steam://store/${manifest.appid}`,
          lastPlayed: Number(manifest.LastPlayed || 0) * 1000,
          art: {
            cover: local.cover || cdn(manifest.appid, 'library_600x900.jpg'),
            hero: local.hero || cdn(manifest.appid, 'library_hero.jpg'),
            header: cdn(manifest.appid, 'header.jpg'),
            logo: cdn(manifest.appid, 'logo.png'),
          },
        });
      } catch { /* skip unreadable manifest */ }
    }
  }
  return games;
}

module.exports = { scan, steamExe, steamRoot, cdn };
