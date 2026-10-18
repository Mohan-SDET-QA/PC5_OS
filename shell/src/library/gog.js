// GOG games (installed with GOG Galaxy or GOG offline installers) from the registry.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const KEY = 'HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games';

function regQuery() {
  if (process.platform !== 'win32') return Promise.resolve('');
  return new Promise((resolve) => {
    execFile('reg', ['query', KEY, '/s'], { windowsHide: true, maxBuffer: 1 << 24 }, (err, out) => resolve(err ? '' : out.toString()));
  });
}

async function scan() {
  if (process.platform !== 'win32') return [];
  const { parseRegQuery } = require('../installs');
  const entries = parseRegQuery(await regQuery());
  const games = [];
  for (const v of Object.values(entries)) {
    if (!v.gameName || !v.exe) continue;
    const exe = path.isAbsolute(v.exe) ? v.exe : path.join(v.path || '', v.exe);
    if (!fs.existsSync(exe) || v.dependsOn) continue; // dependsOn = DLC
    games.push({ id: `gog:${v.gameID || v.gameName}`, source: 'gog', title: v.gameName, exe, args: v.launchParam ? [v.launchParam] : [], art: {} });
  }
  return games;
}

module.exports = { scan };
