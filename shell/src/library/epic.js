const fs = require('fs');
const path = require('path');

const MANIFESTS = 'C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests';

function scan() {
  let files = [];
  try { files = fs.readdirSync(MANIFESTS).filter((f) => f.endsWith('.item')); } catch { return []; }
  const games = [];
  for (const f of files) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(MANIFESTS, f), 'utf8'));
      if (!m.DisplayName || m.bIsIncompleteInstall) continue;
      if (Array.isArray(m.AppCategories) && !m.AppCategories.includes('games')) continue;
      const id = `${m.CatalogNamespace}%3A${m.CatalogItemId}%3A${m.AppName}`;
      games.push({
        id: `epic:${m.AppName}`,
        source: 'epic',
        title: m.DisplayName,
        uri: `com.epicgames.launcher://apps/${id}?action=launch&silent=true`,
        art: {},
      });
    } catch { /* skip */ }
  }
  return games;
}

module.exports = { scan };
