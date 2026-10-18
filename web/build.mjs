// Builds the PC5 OS website into web/dist: the landing page at / and the live
// interface preview at /play/. Only this folder is deployed, so visitors get
// minified files and never the project's source code.
//
//   npm run build     build web/dist
//   npm run preview   build and serve it on http://localhost:4173
//   npm run deploy    build and publish to Vercel
import { transform } from 'esbuild';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const renderer = path.join(here, '..', 'shell', 'renderer');
const out = path.join(here, 'dist');
const site = JSON.parse(fs.readFileSync(path.join(here, 'site.config.json'), 'utf8'));
// Built by Vercel from GitHub: link to the newest installer on the repo's Releases page.
const { VERCEL_GIT_REPO_OWNER: owner, VERCEL_GIT_REPO_SLUG: repo, VERCEL_GIT_PROVIDER: provider } = process.env;
if (!site.downloadUrl && owner && repo && (provider || 'github') === 'github') {
  site.downloadUrl = `https://github.com/${owner}/${repo}/releases/latest/download/PC5-OS-Setup.exe`;
}
const { version } = JSON.parse(fs.readFileSync(path.join(here, '..', 'shell', 'package.json'), 'utf8'));

const write = (rel, data) => {
  const file = path.join(out, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
};
const copy = (from, rel) => write(rel, fs.readFileSync(from));
const hash = (data) => createHash('sha256').update(data).digest('hex').slice(0, 10);

fs.rmSync(out, { recursive: true, force: true });

// ---------------------------------------------------------------- /play/ (the interface)
const html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
if (!scripts.length) throw new Error('No scripts found in renderer/index.html');

// One bundle, in the page's script order, so the scripts share globals exactly as before.
const siteGlobals = `window.PC5_SITE=${JSON.stringify({ downloadUrl: site.downloadUrl || '' })};`;
const source = [siteGlobals, ...scripts.map((s) => fs.readFileSync(path.join(renderer, s), 'utf8')), fs.readFileSync(path.join(here, 'src', 'preview.js'), 'utf8')]
  .map((code) => `;${code}\n`).join('');
const js = (await transform(source, { minify: true, target: 'es2021', legalComments: 'none', charset: 'utf8' })).code;
const css = (await transform(fs.readFileSync(path.join(renderer, 'css', 'styles.css'), 'utf8'), { loader: 'css', minify: true, legalComments: 'none' })).code;
const jsName = `assets/app.${hash(js)}.js`;
const cssName = `css/styles.${hash(css)}.css`; // stays beside fonts/ so ../fonts/ still resolves
write(`play/${jsName}`, js);
write(`play/${cssName}`, css);

let page = html
  .replace(/\s*<script src="[^"]+"><\/script>/g, '')
  .replace('<link rel="stylesheet" href="css/styles.css">', `<link rel="stylesheet" href="${cssName}">`)
  .replace('</body>', `  <script src="${jsName}"></script>\n</body>`)
  .replace('<title>PC5</title>', [
    '<title>PC5 OS · Live preview</title>',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    '  <meta name="description" content="Try the PC5 OS console interface in your browser. Works with a PlayStation or Xbox controller.">',
    '  <link rel="icon" href="/icon.png">',
  ].join('\n'))
  .replace(/<!--[\s\S]*?-->\s*/g, '');
// The real app loads local files; the website only needs https images.
page = page.replace(/content="default-src[^"]*"/, `content="default-src 'self'; img-src 'self' https: data: blob:; media-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; connect-src 'self'"`);
write('play/index.html', page);
for (const f of fs.readdirSync(path.join(renderer, 'fonts'))) copy(path.join(renderer, 'fonts', f), `play/fonts/${f}`);

// ---------------------------------------------------------------- / (landing page)
const size = site.installerSize || '';
const download = site.downloadUrl || '#install';
if (!site.downloadUrl) console.warn('! No download link yet (set downloadUrl in web/site.config.json, or deploy from GitHub): the Download buttons point at the install section.');
write('index.html', fs.readFileSync(path.join(here, 'site', 'index.html'), 'utf8')
  .replaceAll('{{DOWNLOAD_URL}}', download).replaceAll('{{VERSION}}', version).replaceAll('{{SIZE}}', size));
write('site.css', (await transform(fs.readFileSync(path.join(here, 'site', 'site.css'), 'utf8'), { loader: 'css', minify: true })).code);
for (const f of fs.readdirSync(path.join(here, 'site', 'img'))) copy(path.join(here, 'site', 'img', f), `img/${f}`);
for (const f of ['Inter-Variable.woff2', 'Inter-OFL.txt']) copy(path.join(renderer, 'fonts', f), `fonts/${f}`);
copy(path.join(here, '..', 'shell', 'build', 'icon.png'), 'icon.png');

// ---------------------------------------------------------------- Vercel settings
// The same settings as the repo's root vercel.json, for `npm run deploy` uploads of dist alone.
const rootConfig = JSON.parse(fs.readFileSync(path.join(here, '..', 'vercel.json'), 'utf8'));
write('vercel.json', JSON.stringify({ cleanUrls: rootConfig.cleanUrls, trailingSlash: rootConfig.trailingSlash, headers: rootConfig.headers }, null, 2));

const total = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, d) => n + (d.isDirectory() ? total(path.join(dir, d.name)) : fs.statSync(path.join(dir, d.name)).size), 0);
console.log(`Built web/dist (${(total(out) / 1e6).toFixed(1)} MB): / landing page, /play/ live preview.`);
