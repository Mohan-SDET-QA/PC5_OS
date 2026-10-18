// Shared UI helpers for PC5 Shell (exposed as window.UI).
(function () {
  const $ = (sel) => document.querySelector(sel);

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'nav') el.dataset.nav = '';
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'style') el.style.cssText = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
    return el;
  }

  function hashColor(str) {
    let n = 0;
    for (const c of str) n = (n * 31 + c.charCodeAt(0)) >>> 0;
    return [`hsl(${n % 360} 55% 38%)`, `hsl(${(n >>> 8) % 360} 50% 14%)`];
  }

  function placeholder(title, icon) {
    const [a, b] = hashColor(title);
    return h('div', { class: 'placeholder', style: `--ph1:${a};--ph2:${b}` }, icon ? h('span', { class: 'ph-icon' }, Icon(icon)) : null, title);
  }

  // <img> that falls back through several URLs, then to a generated placeholder.
  function art(urls, title) {
    const list = (urls || []).filter(Boolean);
    if (!list.length) return placeholder(title);
    const img = h('img', { alt: '', loading: 'lazy' });
    let i = 0;
    img.src = list[0];
    img.addEventListener('error', () => {
      i += 1;
      if (i < list.length) img.src = list[i];
      else img.replaceWith(placeholder(title));
    });
    return img;
  }

  let toastTimer;
  let quiet = false;
  function toast(msg, icon = 'info') {
    if (quiet && icon !== 'alert') return; // Settings → Notifications off: errors only
    const t = $('#toast');
    t.replaceChildren(h('span', { class: 'toast-icon' }, Icon(icon)), h('span', {}, msg));
    t.hidden = false;
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
  }

  // ---------------------------------------------------------------- sounds
  // Navigation tones come from a pack (synthesized, so no audio files ship
  // with PC5) or from the user's own audio files.
  let audio;
  let soundsOn = true;
  let volume = 0.6;
  let pack = 'classic';
  let custom = {};

  function tone(freqs, { dur = 0.08, gain = 0.03, gap = 0.07, type = 'sine' } = {}) {
    try {
      audio = audio || new AudioContext();
      freqs.forEach((f, i) => {
        const t0 = audio.currentTime + i * gap;
        const o = audio.createOscillator();
        const g = audio.createGain();
        o.type = type;
        o.frequency.value = f;
        g.gain.setValueAtTime(Math.max(0.0001, gain * volume * 1.6), t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g).connect(audio.destination);
        o.start(t0);
        o.stop(t0 + dur + 0.02);
      });
    } catch { /* audio unavailable */ }
  }

  const PACKS = {
    classic: {
      name: 'Classic', move: [[660], { dur: 0.05, gain: 0.02 }], select: [[880, 1320], { dur: 0.09, gap: 0.05 }], back: [[520, 390], { dur: 0.07, gap: 0.05 }],
      notify: [[988, 1319], { dur: 0.12, gap: 0.09 }], startup: [[392, 523, 659, 784, 1046], { dur: 0.6, gain: 0.025, gap: 0.12, type: 'triangle' }],
    },
    crystal: {
      name: 'Crystal', move: [[1568, 2349], { dur: 0.07, gain: 0.012, gap: 0.012 }], select: [[1319, 1976, 2637], { dur: 0.16, gap: 0.04, gain: 0.016 }],
      back: [[1175, 880], { dur: 0.1, gap: 0.05, gain: 0.014 }], notify: [[1568, 2093, 2637], { dur: 0.25, gap: 0.08, gain: 0.015 }],
      startup: [[784, 1175, 1568, 2349, 3136], { dur: 0.9, gain: 0.012, gap: 0.1 }],
    },
    soft: {
      name: 'Soft', move: [[330], { dur: 0.06, gain: 0.035, type: 'triangle' }], select: [[392, 523], { dur: 0.1, gap: 0.05, type: 'triangle', gain: 0.035 }],
      back: [[349, 262], { dur: 0.09, gap: 0.05, type: 'triangle', gain: 0.03 }], notify: [[523, 659, 784], { dur: 0.16, gap: 0.08, type: 'triangle', gain: 0.03 }],
      startup: [[262, 330, 392, 523], { dur: 1.1, gain: 0.03, gap: 0.18, type: 'triangle' }],
    },
    retro: {
      name: 'Retro', move: [[880], { dur: 0.035, gain: 0.008, type: 'square' }], select: [[660, 990], { dur: 0.06, gap: 0.05, type: 'square', gain: 0.008 }],
      back: [[440, 330], { dur: 0.06, gap: 0.05, type: 'square', gain: 0.008 }], notify: [[784, 988, 1175], { dur: 0.08, gap: 0.07, type: 'square', gain: 0.008 }],
      startup: [[523, 659, 784, 1046, 784, 1046], { dur: 0.12, gain: 0.01, gap: 0.1, type: 'square' }],
    },
    minimal: {
      name: 'Minimal', move: [[1800], { dur: 0.018, gain: 0.008 }], select: [[1400], { dur: 0.04, gain: 0.012 }], back: [[900], { dur: 0.04, gain: 0.01 }],
      notify: [[1200, 1600], { dur: 0.08, gap: 0.06, gain: 0.012 }], startup: [[660, 990], { dur: 0.5, gain: 0.015, gap: 0.2 }],
    },
  };

  const fileUrl = (p) => (/^(https?|file|data):/.test(p) ? p : `file:///${encodeURI(p.replace(/\\/g, '/').replace(/^\/+/, '')).replace(/#/g, '%23').replace(/\?/g, '%3F')}`);

  function playFile(file) {
    try {
      const a = new Audio(fileUrl(file));
      a.volume = Math.min(1, volume);
      a.play().catch(() => {});
    } catch { /* bad file */ }
  }

  function play(kind) {
    if (!soundsOn || pack === 'off') return;
    if (pack === 'custom' && custom[kind]) return playFile(custom[kind]);
    const p = PACKS[pack] || PACKS.classic;
    const def = p[kind] || PACKS.classic[kind];
    if (def) tone(def[0], def[1]);
  }

  const sounds = {
    move: () => play('move'),
    select: () => play('select'),
    back: () => play('back'),
    notify: () => play('notify'),
    startup: () => play('startup'),
  };

  function fmtBytes(n) {
    if (!n) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return `${(n / 1024 ** i).toFixed(i >= 2 ? 1 : 0)} ${u[i]}`;
  }

  // A list of choices. entries: [label, fn, { desc, cls }]
  function menu(title, entries, { subtitle } = {}) {
    const el = h('div', { class: 'modal' }, h('div', { class: 'sheet' }, h('h2', {}, title),
      subtitle ? h('p', { class: 'muted sub' }, subtitle) : null,
      h('div', { class: 'list' }, entries.map(([label, fn, opts = {}]) =>
        h('button', { class: `setting ${opts.cls || ''}`, nav: true, onclick: () => { Nav.closeModal(el); if (fn) fn(); } },
          h('div', {}, h('div', {}, label), opts.desc ? h('div', { class: 'desc' }, opts.desc) : null))))));
    Nav.openModal(el);
    return el;
  }

  function confirm(title, yesLabel = 'OK', subtitle) {
    return new Promise((resolve) => {
      const el = menu(title, [[yesLabel, () => resolve(true)], ['Cancel', () => resolve(false)]], { subtitle });
      const mo = new MutationObserver(() => { if (!el.isConnected) { mo.disconnect(); resolve(false); } });
      mo.observe(document.getElementById('modals'), { childList: true });
    });
  }

  function busy(text) {
    const el = h('div', { class: 'modal' }, h('div', { class: 'sheet busy' }, h('div', { class: 'spinner' }), h('div', {}, text)));
    Nav.openModal(el, { onBack: () => {} });
    return () => Nav.closeModal(el);
  }

  // Static markup uses <i data-icon="name"> placeholders.
  document.querySelectorAll('[data-icon]').forEach((el) => el.replaceChildren(Icon(el.dataset.icon)));

  window.UI = {
    $, h, art, placeholder, toast, sounds, fmtBytes, menu, confirm, busy,
    setSounds: (on) => { soundsOn = on; },
    configureSounds: (opts) => { pack = opts.pack || 'classic'; volume = (opts.volume == null ? 60 : opts.volume) / 100; custom = opts.custom || {}; },
    soundPacks: () => Object.entries(PACKS).map(([id, p]) => ({ id, name: p.name })),
    previewSound: (packId, kind = 'select') => { const prev = pack; pack = packId; const on = soundsOn; soundsOn = true; play(kind); soundsOn = on; pack = prev; },
    playFile,
    fileUrl,
    setQuiet: (on) => { quiet = on; },
  };
})();
