// Artwork for games that don't come from Steam (added, GOG, found in game
// folders): look the title up on the Steam store and use that game's
// official cover, hero background and logo. Results are cached on disk.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const cdn = (appid, file) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/${file}`;
const file = () => path.join(app.getPath('userData'), 'art-cache.json');
let cache = null;
const pending = new Set();

function load() {
  if (!cache) {
    try { cache = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { cache = {}; }
  }
  return cache;
}

const norm = (s) => s.toLowerCase().replace(/[®™©:'’\-–—_.,!?]/g, ' ').replace(/\s+/g, ' ').trim();

function steamArt(appid) {
  return { cover: cdn(appid, 'library_600x900.jpg'), hero: cdn(appid, 'library_hero.jpg'), header: cdn(appid, 'header.jpg'), logo: cdn(appid, 'logo.png') };
}

// Returns art for a title from the cache, or null; unknown titles are looked
// up in the background and onFound() is called when new art arrives.
function lookup(title, onFound) {
  const key = norm(title);
  const c = load();
  if (key in c) return c[key] ? steamArt(c[key]) : null;
  if (!pending.has(key)) {
    pending.add(key);
    fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&l=english&cc=US`)
      .then((r) => r.json())
      .then((data) => {
        const items = data.items || [];
        const exact = items.find((i) => norm(i.name) === key) || items.find((i) => norm(i.name).startsWith(key) || key.startsWith(norm(i.name)));
        c[key] = exact ? String(exact.id) : null;
        fs.writeFileSync(file(), JSON.stringify(c));
        if (exact && onFound) onFound();
      })
      .catch(() => {}) // offline: try again next time
      .finally(() => pending.delete(key));
  }
  return null;
}

module.exports = { lookup, steamArt };
