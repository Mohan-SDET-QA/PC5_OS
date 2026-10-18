// Tests Steam non-Steam-shortcut support (binary shortcuts.vdf). Run: npm test
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const os = require('os');
const sc = require('../src/library/steam-shortcuts.js');
const vdf = require('../src/library/binvdf.js');

// 1. CRC-32 reference value
assert.strictEqual(sc.crc32('123456789'), 0xcbf43926); console.log('crc32 reference OK');

// 2. Hand-built shortcuts.vdf, byte by byte (independent of our serializer)
const B = (...parts) => Buffer.concat(parts.map((p) => typeof p === 'string' ? Buffer.from(p + '\0') : Buffer.from(p)));
const i32 = (n) => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };
const userFile = B([0], 'shortcuts', [0], '0',
  [2], 'appid', i32(-123456789), [1], 'AppName', 'My Emulator', [1], 'Exe', '"C:\\Emu\\emu.exe"',
  [1], 'StartDir', '"C:\\Emu\\"', [0], 'tags', [1], '0', 'favorite', [8], [8], [8], [8]);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'steam-'));
const cfg = path.join(root, 'userdata', '424242', 'config'); fs.mkdirSync(cfg, { recursive: true });
fs.mkdirSync(path.join(root, 'config'));
fs.writeFileSync(path.join(root, 'config', 'loginusers.vdf'), `"users"\n{\n "76561197960689970"\n {\n  "AccountName" "p"\n  "MostRecent" "1"\n }\n}`);
fs.mkdirSync(path.join(root, 'userdata', '999', 'config'), { recursive: true }); // another account, must be left alone
fs.writeFileSync(path.join(cfg, 'shortcuts.vdf'), userFile);
const parsed = sc.readShortcuts(path.join(cfg, 'shortcuts.vdf'));
assert.strictEqual(vdf.get(parsed[0], 'AppName'), 'My Emulator'); console.log('parses a hand-built Steam file OK');

// 3. Sync adds PC5 games, keeps the user's shortcut, targets the most recent account only
const games = [{ title: 'MyGame', exe: 'C:\\Games\\MyGame\\MyGame.exe' }, { title: 'Spotify', exe: 'C:\\x\\Spotify.lnk' }];
const r1 = sc.sync(root, games);
assert.ok(r1.changed);
let list = sc.readShortcuts(path.join(cfg, 'shortcuts.vdf'));
assert.deepStrictEqual(list.map((s) => vdf.get(s, 'AppName')), ['My Emulator', 'MyGame']);
assert.strictEqual(vdf.get(list[0], 'appid'), -123456789);
assert.ok(!fs.existsSync(path.join(root, 'userdata', '999', 'config', 'shortcuts.vdf')));
const mine = list[1];
assert.strictEqual(vdf.get(mine, 'Exe'), '"C:\\Games\\MyGame\\MyGame.exe"');
const appid = vdf.get(mine, 'appid') >>> 0;
assert.strictEqual(appid, sc.shortcutAppId(games[0].exe, 'MyGame'));
assert.ok(appid >= 0x80000000, 'high bit set');
assert.strictEqual(r1.ids[games[0].exe], ((BigInt(appid) << 32n) | 0x02000000n).toString());
console.log('sync adds game, keeps user shortcut, skips .lnk OK; rungameid', r1.ids[games[0].exe]);

// 4. Idempotent, and removal only removes PC5 entries
assert.strictEqual(sc.sync(root, games).changed, false); console.log('second sync is a no-op OK');
assert.ok(sc.sync(root, []).changed);
list = sc.readShortcuts(path.join(cfg, 'shortcuts.vdf'));
assert.deepStrictEqual(list.map((s) => vdf.get(s, 'AppName')), ['My Emulator']);
assert.ok(fs.existsSync(path.join(cfg, 'shortcuts.vdf.pc5-backup'))); console.log('removal keeps user shortcut, backup written OK');

// 5. Byte-level round trip of the user's original file
assert.ok(vdf.serialize(vdf.parse(userFile)).equals(userFile)); console.log('byte-identical round trip OK');

// 6. registered() reads ids back
sc.sync(root, games);
assert.strictEqual(sc.registered(root)[games[0].exe.toLowerCase()], r1.ids[games[0].exe]); console.log('registered() OK');
