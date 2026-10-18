// Tests the install tracker's registry parsing and "what got installed?" logic. Run: npm test
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

// installs.js -> files.js needs Electron; give it a stand-in.
const realLoad = Module._load;
Module._load = (req, ...rest) => (req === 'electron' ? { app: { getPath: () => os.tmpdir() }, shell: {} } : realLoad(req, ...rest));
const installs = require('../src/installs');

const sample = [
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{GAME-1}',
  '    DisplayName    REG_SZ    Hollow Knight',
  '    InstallLocation    REG_SZ    "C:\\Games\\Hollow Knight"',
  '    DisplayIcon    REG_SZ    "C:\\Games\\Hollow Knight\\hollow_knight.exe",0',
  '',
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Old',
  '    DisplayName    REG_SZ    7-Zip 24.09',
].join('\r\n');
const parsed = installs.parseRegQuery(sample);
assert.strictEqual(Object.keys(parsed).length, 2);
assert.strictEqual(parsed['HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{GAME-1}'].DisplayName, 'Hollow Knight');
console.log('parses reg query output OK');

// A real folder so pickExe/diff can look at files.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'game-'));
fs.writeFileSync(path.join(dir, 'unins000.exe'), Buffer.alloc(100));
fs.writeFileSync(path.join(dir, 'Game.exe'), Buffer.alloc(200000));
assert.strictEqual(installs.pickExe({ icon: `"${path.join(dir, 'unins000.exe')}",0`, location: dir }), path.join(dir, 'Game.exe'));
assert.strictEqual(installs.pickExe({ icon: `${path.join(dir, 'Game.exe')},0`, location: '' }), path.join(dir, 'Game.exe'));
console.log('picks the game exe, not the uninstaller OK');

const before = { programs: { a: { name: '7-Zip', icon: '', location: '' } }, shortcuts: new Set(['x.lnk']) };
const after = { programs: { ...before.programs, b: { name: 'My Game', icon: '', location: dir } }, shortcuts: new Set(['x.lnk']) };
assert.deepStrictEqual(installs.diff(before, after), { title: 'My Game', exe: path.join(dir, 'Game.exe') });
const viaShortcut = { programs: before.programs, shortcuts: new Set(['x.lnk', 'C:\\Start\\My Game.lnk', 'C:\\Start\\Uninstall My Game.lnk']) };
assert.deepStrictEqual(installs.diff(before, viaShortcut), { title: 'My Game', exe: 'C:\\Start\\My Game.lnk' });
assert.strictEqual(installs.diff(before, before), null);
console.log('finds what an installer added (registry, then Start menu) OK');
