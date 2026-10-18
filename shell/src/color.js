// The dominant vivid colour of a piece of game art, used to tint the UI
// (background glow, focus light) to match the selected game.
const { nativeImage } = require('electron');
const fs = require('fs');

const cache = new Map();

async function load(url) {
  if (url.startsWith('file:')) return fs.promises.readFile(decodeURI(url.replace(/^file:\/\/\/?/, process.platform === 'win32' ? '' : '/')));
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  return Buffer.from(await res.arrayBuffer());
}

function pick(bitmap) {
  // BGRA pixels. Weight each pixel by saturation and mid-brightness so the
  // result is the art's accent colour, not muddy grey.
  let r = 0; let g = 0; let b = 0; let w = 0;
  for (let i = 0; i < bitmap.length; i += 4) {
    const B = bitmap[i]; const G = bitmap[i + 1]; const R = bitmap[i + 2];
    const max = Math.max(R, G, B); const min = Math.min(R, G, B);
    const sat = max ? (max - min) / max : 0;
    const light = max / 255;
    const weight = sat * sat * (1 - Math.abs(light - 0.6)) + 0.002;
    r += R * weight; g += G * weight; b += B * weight; w += weight;
  }
  let [R, G, B] = [r / w, g / w, b / w];
  // Lift to a usable brightness for glows on a dark UI.
  const max = Math.max(R, G, B, 1);
  const scale = Math.min(2.2, 210 / max);
  [R, G, B] = [R, G, B].map((v) => Math.round(Math.min(255, v * scale)));
  return `#${[R, G, B].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

async function dominant(url) {
  if (!url) return null;
  if (cache.has(url)) return cache.get(url);
  const task = load(url)
    .then((buf) => {
      const img = nativeImage.createFromBuffer(buf);
      if (img.isEmpty()) return null;
      return pick(img.resize({ width: 32, height: 32, quality: 'good' }).toBitmap());
    })
    .catch(() => null);
  cache.set(url, task);
  return task;
}

module.exports = { dominant, pick };
