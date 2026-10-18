// One download queue for everything: web downloads (from the built-in browser
// or a typed URL) and torrents (magnet links / .torrent files, via WebTorrent).
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const items = new Map();    // id -> record (what the UI shows; persisted)
const handles = new Map();  // id -> Electron DownloadItem or WebTorrent torrent
let session = null;
let notify = () => {};
let onFinished = () => {};
let getConfig = () => ({});
let client = null;
let saveTimer = null;

const stateFile = () => path.join(app.getPath('userData'), 'downloads.json');

function downloadDir() {
  const dir = getConfig().downloadDir || path.join(app.getPath('downloads'), 'PC5');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const keep = [...items.values()].map(({ speed, peers, ...rest }) => rest);
    fs.writeFileSync(stateFile(), JSON.stringify(keep, null, 2));
  }, 500);
}

function changed(rec) {
  rec.updated = Date.now();
  persist();
  notify(list());
}

function uniquePath(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let candidate = path.join(dir, name);
  for (let i = 1; fs.existsSync(candidate); i++) candidate = path.join(dir, `${base} (${i})${ext}`);
  return candidate;
}

// ------------------------------------------------------------------ web downloads
function onWillDownload(_event, item) {
  const file = uniquePath(downloadDir(), item.getFilename() || 'download');
  item.setSavePath(file);
  const rec = {
    id: newId(), kind: 'http', name: path.basename(file), url: item.getURL(), file,
    state: 'downloading', received: 0, total: item.getTotalBytes(), speed: 0, added: Date.now(),
  };
  items.set(rec.id, rec);
  handles.set(rec.id, item);
  let lastBytes = 0;
  let lastTime = Date.now();
  item.on('updated', (_e, state) => {
    const now = Date.now();
    rec.received = item.getReceivedBytes();
    rec.total = item.getTotalBytes();
    rec.speed = now > lastTime ? ((rec.received - lastBytes) * 1000) / (now - lastTime) : 0;
    lastBytes = rec.received;
    lastTime = now;
    rec.state = state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'downloading';
    changed(rec);
  });
  item.once('done', (_e, state) => {
    handles.delete(rec.id);
    rec.speed = 0;
    if (state === 'completed') {
      rec.state = 'done';
      rec.received = rec.total = fs.existsSync(file) ? fs.statSync(file).size : rec.total;
      if (/\.torrent$/i.test(file)) addTorrent(file);
      onFinished(rec);
    } else if (state === 'cancelled') {
      items.delete(rec.id);
    } else {
      rec.state = 'failed';
      rec.error = 'Download interrupted';
    }
    changed(rec);
  });
  changed(rec);
}

function addUrl(url) {
  if (/^magnet:/i.test(url)) return addTorrent(url);
  if (!/^https?:\/\//i.test(url)) throw new Error('Enter a link starting with http://, https:// or magnet:');
  session.downloadURL(url);
  return { ok: true };
}

// ------------------------------------------------------------------ torrents
async function torrentClient() {
  if (!client) {
    const { default: WebTorrent } = await import('webtorrent');
    client = new WebTorrent();
    client.on('error', (err) => console.error('[torrent]', err.message));
  }
  return client;
}

function addTorrent(source) {
  const rec = {
    id: newId(), kind: 'torrent', name: torrentName(source), source,
    dir: downloadDir(), file: null, state: 'starting', received: 0, total: 0, speed: 0, peers: 0, added: Date.now(),
  };
  items.set(rec.id, rec);
  changed(rec);
  startTorrent(rec);
  return { ok: true, id: rec.id };
}

function torrentName(source) {
  const dn = /[?&]dn=([^&]+)/.exec(source);
  if (dn) return decodeURIComponent(dn[1].replace(/\+/g, ' '));
  return /^magnet:/i.test(source) ? 'Torrent' : path.basename(source).replace(/\.torrent$/i, '');
}

async function startTorrent(rec) {
  try {
    const c = await torrentClient();
    const source = /^magnet:|^https?:/i.test(rec.source) ? rec.source : fs.readFileSync(rec.source);
    const t = c.add(source, { path: rec.dir });
    handles.set(rec.id, t);
    rec.state = 'downloading';
    t.on('metadata', () => {
      rec.name = t.name;
      rec.total = t.length;
      rec.file = path.join(rec.dir, t.name);
      changed(rec);
    });
    t.on('done', () => {
      rec.state = 'done';
      rec.received = rec.total = t.length;
      rec.speed = 0;
      rec.file = path.join(rec.dir, t.name);
      if (!getConfig().torrentSeed) {
        handles.delete(rec.id);
        t.destroy();
      } else {
        rec.state = 'seeding';
      }
      onFinished(rec);
      changed(rec);
    });
    t.on('error', (err) => {
      rec.state = 'failed';
      rec.error = err.message;
      handles.delete(rec.id);
      changed(rec);
    });
    changed(rec);
  } catch (err) {
    rec.state = 'failed';
    rec.error = err.message;
    changed(rec);
  }
}

// Torrent progress isn't event-driven, so sample it once a second.
function tick() {
  let any = false;
  for (const [id, h] of handles) {
    const rec = items.get(id);
    if (!rec || rec.kind !== 'torrent') continue;
    rec.received = h.downloaded || 0;
    rec.total = h.length || rec.total;
    rec.speed = rec.state === 'seeding' ? h.uploadSpeed : h.downloadSpeed;
    rec.peers = h.numPeers;
    any = true;
  }
  if (any) notify(list());
}

// ------------------------------------------------------------------ controls
function pause(id) {
  const rec = items.get(id);
  const h = handles.get(id);
  if (!rec) return;
  if (rec.kind === 'http' && h) h.pause();
  if (rec.kind === 'torrent') {
    if (h) h.destroy(); // keeps downloaded data; resuming re-checks it
    handles.delete(id);
    rec.speed = 0;
    rec.state = 'paused';
  }
  changed(rec);
}

function resume(id) {
  const rec = items.get(id);
  if (!rec) return;
  const h = handles.get(id);
  if (rec.kind === 'torrent') {
    if (!h) startTorrent(rec);
  } else if (h && h.canResume()) {
    h.resume();
  } else {
    // Interrupted before a restart: start again from the same link.
    items.delete(id);
    session.downloadURL(rec.url);
  }
  changed(rec);
}

function remove(id, deleteFiles) {
  const rec = items.get(id);
  if (!rec) return;
  const h = handles.get(id);
  if (h) {
    if (rec.kind === 'http') h.cancel();
    else h.destroy();
  }
  handles.delete(id);
  items.delete(id);
  if (deleteFiles && rec.file) fs.rmSync(rec.file, { recursive: true, force: true });
  persist();
  notify(list());
}

function list() {
  return [...items.values()].sort((a, b) => b.added - a.added);
}

function init(opts) {
  session = opts.session;
  notify = opts.notify;
  onFinished = opts.onFinished || onFinished;
  getConfig = opts.getConfig;
  session.on('will-download', onWillDownload);
  try {
    for (const rec of JSON.parse(fs.readFileSync(stateFile(), 'utf8'))) {
      items.set(rec.id, rec);
      if (rec.kind === 'http' && rec.state !== 'done') rec.state = 'interrupted';
      if (rec.kind === 'torrent' && ['downloading', 'starting', 'seeding'].includes(rec.state)) startTorrent(rec);
    }
  } catch { /* first run */ }
  setInterval(tick, 1000);
}

function shutdown() {
  if (client) client.destroy();
}

module.exports = { init, addUrl, addTorrent, pause, resume, remove, list, downloadDir, shutdown };
