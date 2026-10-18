// Persistent settings in %APPDATA%\PC5Shell\config.json, merged over defaults.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const TV_UA = 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/4.0 Chrome/94.0.4606.31 TV Safari/537.36';

const DEFAULTS = {
  profileName: '',
  setupDone: false,        // first-run "Console mode or App mode?" answered
  avatarColor: '#3d7bff',
  autostartSteam: true,
  // Appearance & accessibility (Settings).
  uiScale: 1,
  accent: 'auto',          // 'auto' = colour of the selected game, or a #hex
  background: 'art',       // 'art' | 'calm'
  clock24: false,
  reduceMotion: false,
  alwaysHints: false,
  notifications: true,
  glyphs: 'auto',          // button prompts: 'auto' | 'ps' | 'xbox'
  glyphColors: 'mono',     // 'mono' (white, like the DualSense) | 'color' (classic colours)
  // Themes, sounds and music.
  theme: 'midnight',
  wallpaper: '',           // image or video file used when background = 'wallpaper'
  soundPack: 'classic',    // classic | crystal | soft | retro | minimal | custom | off
  customSounds: {},        // { move, select, back } audio files for the 'custom' pack
  uiVolume: 60,
  startupSound: 'chime',   // 'chime' | 'none' | path to an audio file
  homeMusic: '',           // audio file looped quietly on Home
  musicVolume: 35,
  // Performance overlay and captures.
  overlay: false,
  overlayPosition: 'top-right',
  captureOnShare: false,   // short press of Create/Share takes a screenshot
  // Extra folders to watch for games installed by hand; folders the user removed.
  gameFolders: [],
  ignoredFolders: [],
  // Register added games in Steam and launch them through it (Steam Input = PS controller support).
  steamInputForAdded: true,
  sounds: true,
  // Start PC5Input elevated so mouse mode works inside admin installers.
  elevateInput: true,
  downloadDir: '',          // default: Downloads\PC5
  gamesDir: '',             // default: C:\Games (archives are extracted here)
  torrentSeed: false,       // keep uploading after a torrent finishes
  homepage: 'https://duckduckgo.com',
  searchUrl: 'https://duckduckgo.com/?q=',
  bookmarks: [
    { title: 'Free games on itch.io', url: 'https://itch.io/games/free' },
    { title: 'Free on GOG', url: 'https://www.gog.com/en/partner/free_games' },
    { title: 'Free on Epic', url: 'https://store.epicgames.com/en-US/free-games' },
    { title: 'GamerPower giveaways', url: 'https://www.gamerpower.com/giveaways/pc' },
    { title: 'Internet Archive software', url: 'https://archive.org/details/software' },
    { title: 'YouTube', url: 'https://www.youtube.com' },
  ],
  // Extra programs to start with the shell: [{ exe, args }]
  autostart: [],
  // Games that aren't in Steam/Epic: [{ title, exe, args, cover, hero }]
  customGames: [],
  hiddenGames: [],
  recents: [],
  apps: [
    { id: 'bigpicture', title: 'Steam Big Picture', type: 'uri', uri: 'steam://open/bigpicture', icon: 'tv', color: '#1b2838' },
    { id: 'epic', title: 'Epic Games', type: 'uri', uri: 'com.epicgames.launcher://store', icon: 'diamond', color: '#2a2a2a' },
    { id: 'gog', title: 'GOG Galaxy', type: 'exe', exe: 'C:\\Program Files (x86)\\GOG Galaxy\\GalaxyClient.exe', icon: 'orbit', color: '#5c2d91' },
    { id: 'youtube', title: 'YouTube', type: 'web', url: 'https://www.youtube.com/tv', userAgent: TV_UA, icon: 'film', color: '#c4302b' },
    { id: 'twitch', title: 'Twitch', type: 'web', url: 'https://www.twitch.tv', icon: 'chat', color: '#6441a5' },
  ],
};

const file = () => path.join(app.getPath('userData'), 'config.json');

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(patch) {
  const next = { ...load(), ...patch };
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(next, null, 2));
  return next;
}

function pushRecent(id) {
  const recents = [id, ...load().recents.filter((r) => r !== id)].slice(0, 20);
  save({ recents });
}

module.exports = { load, save, pushRecent };
