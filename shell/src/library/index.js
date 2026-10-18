const steam = require('./steam');
const epic = require('./epic');
const gog = require('./gog');
const artwork = require('./artwork');
const shortcuts = require('./steam-shortcuts');

// Games that aren't Steam games but launch from an .exe: games the user added
// (downloads, installs, game folders) and GOG games. They launch through Steam
// when registered there as non-Steam shortcuts, so Steam Input gives them
// PS4/PS5 controller support.
function exeGames(cfg, gogGames = []) {
  const custom = (cfg.customGames || []).map((g, i) => ({
    id: `custom:${i}:${g.title}`,
    source: 'custom',
    title: g.title,
    exe: g.exe,
    args: g.args || [],
    added: g.added || 0,
    art: { cover: g.cover, hero: g.hero },
  }));
  const customExes = new Set(custom.map((g) => (g.exe || '').toLowerCase()));
  return [...custom, ...gogGames.filter((g) => !customExes.has(g.exe.toLowerCase()))];
}

function decorate(games, cfg, steamIds, onArt) {
  return games.map((g) => {
    const rungameid = cfg.steamInputForAdded !== false && g.exe ? steamIds[g.exe.toLowerCase()] : null;
    const found = !g.art.cover && artwork.lookup(g.title, onArt);
    return {
      ...g,
      uri: rungameid ? `steam://rungameid/${rungameid}` : undefined,
      viaSteam: Boolean(rungameid),
      art: found ? { ...found, ...Object.fromEntries(Object.entries(g.art).filter(([, v]) => v)) } : g.art,
    };
  });
}

/** Everything installed. onArt is called when newly found artwork is ready. */
async function scan(cfg, onArt) {
  const root = await steam.steamRoot();
  const steamIds = root ? shortcuts.registered(root) : {};
  const gogGames = await gog.scan();
  const all = [...(await steam.scan()), ...epic.scan(), ...decorate(exeGames(cfg, gogGames), cfg, steamIds, onArt)];
  const hidden = new Set(cfg.hiddenGames || []);
  return all.filter((g) => !hidden.has(g.id)).sort((a, b) => a.title.localeCompare(b.title));
}

// The games to register in Steam as non-Steam shortcuts.
async function shortcutGames(cfg) {
  return exeGames(cfg, await gog.scan());
}

// Used when not running on Windows (or with --demo) so the UI can be developed anywhere.
function demoGames(cfg, onArt) {
  const list = [
    [1245620, 'ELDEN RING'], [1091500, 'Cyberpunk 2077'], [1086940, "Baldur's Gate 3"],
    [1174180, 'Red Dead Redemption 2'], [730, 'Counter-Strike 2'], [413150, 'Stardew Valley'],
    [1145360, 'Hades'], [570, 'Dota 2'], [271590, 'Grand Theft Auto V'], [292030, 'The Witcher 3: Wild Hunt'],
  ];
  const demo = list.map(([appid, title]) => ({
    id: `steam:${appid}`,
    source: 'steam',
    appid: String(appid),
    title,
    uri: `steam://rungameid/${appid}`,
    storeUri: `steam://store/${appid}`,
    art: artwork.steamArt(appid),
  }));
  return [...demo, ...decorate(exeGames(cfg), cfg, {}, onArt)];
}

module.exports = { scan, demoGames, shortcutGames, steamExe: steam.steamExe, steamRoot: steam.steamRoot };
