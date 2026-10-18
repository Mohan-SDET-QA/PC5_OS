// When the UI is opened in a plain browser (no Electron preload), provide a
// stand-in API with demo data so every screen works: the web preview on the
// website and a quick look without Electron. Nothing here touches the PC.
(function () {
  if (window.pc5) return;
  const cdn = (id, f) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/${f}`;
  const steamArt = (id) => ({ cover: cdn(id, 'library_600x900.jpg'), hero: cdn(id, 'library_hero.jpg'), header: cdn(id, 'header.jpg'), logo: cdn(id, 'logo.png') });
  const games = [
    [1245620, 'ELDEN RING'], [1091500, 'Cyberpunk 2077'], [1086940, "Baldur's Gate 3"],
    [1174180, 'Red Dead Redemption 2'], [730, 'Counter-Strike 2'], [413150, 'Stardew Valley'],
    [1145360, 'Hades'], [570, 'Dota 2'], [271590, 'Grand Theft Auto V'], [292030, 'The Witcher 3: Wild Hunt'],
  ].map(([id, title]) => ({
    id: `steam:${id}`, source: 'steam', appid: String(id), title,
    uri: `steam://rungameid/${id}`, storeUri: `steam://store/${id}`, art: steamArt(id),
  }));
  const item = (id, name, price, extra = {}) => ({
    store: 'steam', id: String(id), name, image: cdn(id, 'header.jpg'), price,
    storeUri: `steam://store/${id}`, installUri: `steam://install/${id}`, ...extra,
  });

  // Settings survive a page reload in this browser only.
  const SAVED = 'pc5-preview-config';
  let cfg = {
    profileName: '', setupDone: true, avatarColor: '#3d7bff', uiScale: 1, accent: 'auto', background: 'art', clock24: false,
    reduceMotion: false, alwaysHints: false, notifications: true, glyphs: 'auto', glyphColors: 'mono', theme: 'midnight', wallpaper: '',
    soundPack: 'classic', customSounds: {}, uiVolume: 60, startupSound: 'chime', homeMusic: '', musicVolume: 35,
    overlay: false, overlayPosition: 'top-right', captureOnShare: false, gameFolders: [], ignoredFolders: [],
    steamInputForAdded: true, sounds: true, recents: [], hiddenGames: [], customGames: [],
    homepage: 'https://duckduckgo.com', searchUrl: 'https://duckduckgo.com/?q=',
    bookmarks: [
      { title: 'Free games on itch.io', url: 'https://itch.io/games/free' },
      { title: 'Free on GOG', url: 'https://www.gog.com/en/partner/free_games' },
      { title: 'Free on Epic', url: 'https://store.epicgames.com/en-US/free-games' },
      { title: 'GamerPower giveaways', url: 'https://www.gamerpower.com/giveaways/pc' },
    ],
    apps: [
      { id: 'bigpicture', title: 'Steam Big Picture', type: 'uri', uri: 'steam://open/bigpicture', icon: 'tv', color: '#1b2838' },
      { id: 'epic', title: 'Epic Games', type: 'uri', uri: 'com.epicgames.launcher://store', icon: 'diamond', color: '#2a2a2a' },
      { id: 'youtube', title: 'YouTube', type: 'web', url: 'https://www.youtube.com/tv', icon: 'film', color: '#c4302b' },
      { id: 'twitch', title: 'Twitch', type: 'web', url: 'https://www.twitch.tv', icon: 'chat', color: '#6441a5' },
    ],
  };
  try { cfg = { ...cfg, ...JSON.parse(localStorage.getItem(SAVED) || '{}') }; } catch { /* storage blocked */ }
  const save = () => { try { localStorage.setItem(SAVED, JSON.stringify(cfg)); } catch { /* storage blocked */ } };

  const ok = () => Promise.resolve({ ok: true, demo: true });
  const resolve = (v) => () => Promise.resolve(v);
  const noop = () => {};
  const emitter = () => {
    const fns = new Set();
    return { on: (fn) => { fns.add(fn); return () => fns.delete(fn); }, emit: (...a) => fns.forEach((fn) => fn(...a)) };
  };

  // ---------------------------------------------------------------- Windows settings
  const sys = {
    volume: 60, muted: false, brightness: 80, sleep: 0, screenOff: 30, tz: 'Pacific Standard Time', consoleMode: true,
    devices: [{ id: 'tv', name: 'LG TV (HDMI)', default: true }, { id: 'hp', name: 'Headphones', default: false }],
    display: { width: 1920, height: 1080, hz: 60, modes: [[3840, 2160, 60], [2560, 1440, 120], [1920, 1080, 144], [1920, 1080, 60], [1280, 720, 60]].map(([width, height, hz]) => ({ width, height, hz })) },
  };
  const GB = 1024 ** 3;
  const winset = {
    getVolume: () => ({ volume: sys.volume, muted: sys.muted }),
    setVolume: (v) => { sys.volume = Math.round(v); if (v > 0) sys.muted = false; return { volume: sys.volume, muted: sys.muted }; },
    toggleMute: () => { sys.muted = !sys.muted; return { volume: sys.volume, muted: sys.muted }; },
    audioDevices: () => sys.devices,
    setAudioDevice: (id) => { sys.devices.forEach((d) => { d.default = d.id === id; }); return sys.devices; },
    getDisplay: () => sys.display,
    setDisplay: (width, height, hz) => Object.assign(sys.display, { width, height, hz }),
    getBrightness: () => sys.brightness,
    setBrightness: (v) => (sys.brightness = v),
    getPower: () => ({ sleep: sys.sleep, screenOff: sys.screenOff }),
    setPower: (k, m) => { sys[k] = m; return { sleep: sys.sleep, screenOff: sys.screenOff }; },
    timeZones: () => [
      { id: 'Pacific Standard Time', name: '(UTC-08:00) Pacific Time (US & Canada)' }, { id: 'Eastern Standard Time', name: '(UTC-05:00) Eastern Time (US & Canada)' },
      { id: 'GMT Standard Time', name: '(UTC+00:00) Dublin, Edinburgh, Lisbon, London' }, { id: 'India Standard Time', name: '(UTC+05:30) Chennai, Kolkata, Mumbai, New Delhi' },
    ],
    getTimeZone: () => sys.tz,
    setTimeZone: (id) => (sys.tz = id),
    drives: () => [{ root: 'C:\\', total: 1000 * GB, free: 412 * GB, used: 588 * GB }, { root: 'D:\\', total: 2000 * GB, free: 1310 * GB, used: 690 * GB }],
    systemDetails: () => ({ os: 'Windows 11 Pro (preview)', cpu: 'AMD Ryzen 7 7800X3D', threads: 16, memory: '32 GB', gpu: 'NVIDIA GeForce RTX 4070', pc5: '0.1.0' }),
    getConsoleMode: () => sys.consoleMode,
    setConsoleMode: (on) => (sys.consoleMode = Boolean(on)),
  };

  // ---------------------------------------------------------------- downloads
  const dl = emitter();
  const dlDone = emitter();
  let downloads = [
    { id: 'd1', kind: 'torrent', name: 'Ubuntu 24.04 Desktop', state: 'downloading', received: 2.1 * GB, total: 5.7 * GB, speed: 0, peers: 38, dir: 'C:\\Users\\Player\\Downloads\\PC5' },
    { id: 'd2', kind: 'http', name: 'Celeste-Demo.zip', state: 'done', received: 640e6, total: 640e6, speed: 0, file: 'C:\\Users\\Player\\Downloads\\PC5\\Celeste-Demo.zip' },
  ];
  const listDl = () => downloads.map((d) => ({ ...d }));
  setInterval(() => {
    let changed = false;
    for (const d of downloads) {
      if (d.state !== 'downloading') { d.speed = 0; continue; }
      d.speed = (d.kind === 'torrent' ? 18e6 : 9e6) * (0.7 + Math.random() * 0.6);
      d.received = Math.min(d.total, d.received + d.speed);
      if (d.kind === 'torrent') d.peers = Math.max(4, d.peers + Math.round(Math.random() * 6 - 3));
      if (d.received >= d.total) { d.state = 'done'; d.speed = 0; dlDone.emit({ ...d }); }
      changed = true;
    }
    if (changed) dl.emit(listDl());
  }, 1000);
  const addDl = (kind, name) => {
    const d = { id: `d${Date.now()}`, kind, name, state: 'downloading', received: 0, total: (0.3 + Math.random() * 1.5) * GB, speed: 0, peers: 12, dir: 'C:\\Users\\Player\\Downloads\\PC5' };
    downloads = [d, ...downloads];
    dl.emit(listDl());
    return Promise.resolve({ ok: true, id: d.id });
  };
  const setState = (state) => (id) => {
    const d = downloads.find((x) => x.id === id);
    if (d) { d.state = state; dl.emit(listDl()); }
    return ok();
  };

  // ---------------------------------------------------------------- files
  const P = 'C:\\Users\\Player';
  const f = (name, size) => ({ name, size, dir: false, ext: name.slice(name.lastIndexOf('.')).toLowerCase(), mtime: Date.now() - Math.random() * 9e8 });
  const d = (name) => ({ name, dir: true, mtime: Date.now() - Math.random() * 9e8 });
  const tree = {
    [`${P}\\Downloads\\PC5`]: [f('Celeste-Demo.zip', 640e6), f('SteamSetup.exe', 2.4e6), f('soundtrack.mp3', 8.1e6)],
    'C:\\Games': [d('Celeste'), d('Hollow Knight')],
    'C:\\Games\\Celeste': [f('Celeste.exe', 4.2e6), d('Content')],
    'C:\\Games\\Hollow Knight': [f('hollow_knight.exe', 6.5e5)],
    [`${P}\\Documents`]: [f('notes.txt', 2048)],
    [`${P}\\Pictures`]: [d('PC5 Captures')],
    [`${P}\\Pictures\\PC5 Captures`]: [f('PC5_2026-10-18_21-04.png', 3.1e6)],
    [`${P}\\Videos`]: [f('Highlights.mp4', 210e6)],
    [`${P}\\Music`]: [f('Menu theme.mp3', 6.4e6)],
  };
  const roots = [
    { name: 'Downloads', path: `${P}\\Downloads\\PC5`, icon: 'download' }, { name: 'Games', path: 'C:\\Games', icon: 'gamepad' },
    { name: 'Documents', path: `${P}\\Documents`, icon: 'file' }, { name: 'Pictures', path: `${P}\\Pictures`, icon: 'image' },
    { name: 'Videos', path: `${P}\\Videos`, icon: 'film' }, { name: 'Music', path: `${P}\\Music`, icon: 'music' },
    { name: 'Drive C:', path: 'C:\\', icon: 'drive' },
  ].map((r) => ({ ...r, dir: true }));
  tree['C:\\'] = [d('Games'), d('Program Files'), d('Users'), d('Windows')];
  function listFiles(dir) {
    if (!dir) return Promise.resolve({ path: '', parent: null, entries: roots });
    const parent = dir.replace(/\\[^\\]+$/, '');
    const entries = (tree[dir] || []).map((e) => ({ ...e, path: `${dir.replace(/\\$/, '')}\\${e.name}` }));
    return Promise.resolve({ path: dir, parent: parent === dir || dir === 'C:\\' ? '' : (parent.length === 2 ? `${parent}\\` : parent), entries });
  }

  // ---------------------------------------------------------------- performance
  const perf = emitter();
  const KEYS = ['cpu', 'gpu', 'ram', 'vram', 'disk', 'netIn', 'netOut', 'cpuTemp', 'gpuTemp'];
  const history = Object.fromEntries(KEYS.map((k) => [k, []]));
  let perfTimer = null;
  let t = 0;
  const wave = (a, b, p, j = 0) => a + (b - a) * (0.5 + 0.5 * Math.sin(t / p)) + (Math.random() - 0.5) * j;
  function samplePerf() {
    t += 1;
    const cpu = Math.max(2, Math.min(100, wave(18, 74, 6, 8)));
    const s = {
      cpu, gpu: Math.max(0, Math.min(100, wave(35, 96, 7, 6))), gpuName: 'NVIDIA GeForce RTX 4070',
      ram: wave(42, 61, 15, 1), ramUsed: wave(13.4, 19.5, 15) * GB, ramTotal: 32 * GB,
      vramUsed: wave(3.1, 9.2, 11) * GB, vramTotal: 12 * GB, disk: Math.max(0, wave(2, 30, 5, 6)),
      netIn: Math.max(0, wave(0.2e6, 22e6, 9, 2e6)), netOut: Math.max(0, wave(0.05e6, 1.6e6, 8, 2e5)),
      cpuTemp: wave(48, 71, 9, 1), gpuTemp: wave(55, 79, 13, 1),
      procs: [
        { name: 'ELDEN RING', cpu: cpu * 0.6, mem: 7.2e9 }, { name: 'steamwebhelper', cpu: 3.1, mem: 4.1e8 },
        { name: 'PC5Shell', cpu: 2.2, mem: 3.0e8 }, { name: 'Discord', cpu: 1.4, mem: 5.2e8 }, { name: 'svchost', cpu: 0.6, mem: 9.0e7 },
      ],
      time: Date.now(),
    };
    for (const k of KEYS) {
      history[k].push(s[k] == null ? null : s[k]);
      if (history[k].length > 60) history[k].shift();
    }
    perf.emit({ ...s, history });
  }
  function perfWatch(on) {
    if (on && !perfTimer) { for (let i = 0; i < 60; i++) samplePerf(); perfTimer = setInterval(samplePerf, 1500); }
    if (!on && perfTimer) { clearInterval(perfTimer); perfTimer = null; }
    return ok();
  }

  window.pc5 = {
    env: resolve({ demo: true, platform: 'browser', web: true, inputHelper: false }),
    getConfig: () => Promise.resolve({ ...cfg }),
    setConfig: (p) => { cfg = { ...cfg, ...p }; save(); return Promise.resolve({ ...cfg }); },
    listGames: () => Promise.resolve(games.filter((g) => !(cfg.hiddenGames || []).includes(g.id))),
    addGame: ok, gameFolders: resolve(['C:\\Games', 'D:\\Games']), scanFolders: resolve([]), installGame: ok, artColor: resolve(null),
    winset: (name, ...args) => (winset[name] ? Promise.resolve(winset[name](...args)) : Promise.reject(new Error(`Unknown setting ${name}`))),
    switchToWindows: ok, perfWatch, endTask: ok, setOverlay: ok, screenshot: resolve(`${P}\\Pictures\\PC5 Captures\\PC5_demo.png`),
    launchGame: ok, launchApp: ok, openUri: ok,
    steamFeatured: resolve([
      { title: 'Top Sellers', items: [item(553850, 'HELLDIVERS 2', '$39.99'), item(2050650, 'Resident Evil 4', '$15.99', { discount: 60 }), item(1086940, "Baldur's Gate 3", '$59.99'), item(1623730, 'Palworld', '$29.99')] },
      { title: 'Specials', items: [item(1091500, 'Cyberpunk 2077', '$29.99', { discount: 50 }), item(292030, 'The Witcher 3: Wild Hunt', '$9.99', { discount: 75 }), item(1174180, 'Red Dead Redemption 2', '$19.79', { discount: 67 })] },
    ]),
    steamSearch: (q) => Promise.resolve(games.filter((g) => g.title.toLowerCase().includes(String(q).toLowerCase())).map((g) => item(g.appid, g.title, '$29.99'))),
    steamFree: resolve([item(1172470, 'Apex Legends', 'Free to Play', { free: true }), item(570, 'Dota 2', 'Free to Play', { free: true }), item(730, 'Counter-Strike 2', 'Free to Play', { free: true })]),
    epicFree: resolve([]),
    giveaways: resolve([
      { store: 'giveaway', id: 'g1', name: 'Free weekend: Hades', image: cdn(1145360, 'header.jpg'), price: 'Free · was $24.99', platforms: 'PC, Steam', url: 'https://www.gamerpower.com' },
      { store: 'giveaway', id: 'g2', name: 'Stardew Valley soundtrack', image: cdn(413150, 'header.jpg'), price: 'Free · was $4.99', platforms: 'PC', url: 'https://www.gamerpower.com' },
    ]),
    downloads: {
      list: () => Promise.resolve(listDl()),
      addUrl: (url) => addDl('http', decodeURIComponent(String(url).split('/').pop() || 'download')),
      addTorrent: (src) => addDl('torrent', (/[?&]dn=([^&]+)/.exec(src) || [])[1]?.replace(/\+/g, ' ') || 'Torrent'),
      pause: setState('paused'), resume: setState('downloading'),
      remove: (id) => { downloads = downloads.filter((x) => x.id !== id); dl.emit(listDl()); return ok(); },
    },
    files: {
      list: listFiles, open: ok, rename: ok, remove: ok, mkdir: ok, copy: resolve(`${P}\\copied`), extract: resolve('C:\\Games\\Celeste'),
      findExe: resolve(['C:\\Games\\Celeste\\Celeste.exe']), apps: resolve([]), icon: resolve(null),
    },
    systemInfo: resolve({ user: 'player', host: 'PC5', os: 'Windows 11 (preview)', cpu: 'AMD Ryzen 7 7800X3D', cores: 16, memory: '32 GB', freeMemory: '17 GB', uptimeHours: '1.2' }),
    wifiList: resolve({ connected: 'Living Room 5G', networks: [{ ssid: 'Living Room 5G', signal: 92, auth: 'WPA2-Personal' }, { ssid: 'Upstairs', signal: 54, auth: 'WPA3-Personal' }] }),
    wifiConnect: ok, power: ok, bootEntries: resolve([{ id: '{demo}', description: 'Windows 11 (other partition)' }]), restartInto: ok, restartToFirmware: ok,
    btScan: resolve([{ id: 'demo1', name: 'DualSense Wireless Controller', controller: true }, { id: 'demo2', name: 'Xbox Wireless Controller', controller: true }]),
    btPair: resolve({ status: 'Paired' }), setMouseMode: ok, openDesktop: ok, quitShell: ok,
    onHome: noop, onInput: noop, onDownloads: dl.on, onDownloadDone: dlDone.on, onToast: noop, onLibraryChanged: noop, onGameAdded: noop,
    onInstallStatus: () => noop, onPerf: perf.on, onCaptured: noop,
  };
})();
