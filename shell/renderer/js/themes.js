// PC5 themes: each sets the background, the three colours of the moving glow,
// the accent pair and the glass tint. Applied as CSS variables on :root.
(function () {
  const THEMES = [
    { id: 'midnight', name: 'Midnight', desc: 'Deep blue, the classic', bg: '#02040a', aurora: ['#2054dc', '#4c2cc8', '#008cc8'], accent: ['#2f7bff', '#8a5cff'], glass: '26, 30, 44' },
    { id: 'nebula', name: 'Nebula', desc: 'Violet and magenta', bg: '#07030f', aurora: ['#7a2be2', '#ff3ea5', '#3b2dff'], accent: ['#a26bff', '#ff4fb4'], glass: '34, 24, 48' },
    { id: 'aurora', name: 'Aurora', desc: 'Northern-lights green', bg: '#010807', aurora: ['#00c896', '#008cff', '#5dff6a'], accent: ['#19d3a2', '#2aa3ff'], glass: '18, 34, 34' },
    { id: 'ocean', name: 'Ocean', desc: 'Bright cyan depths', bg: '#010611', aurora: ['#0077ff', '#00d4ff', '#1b3fff'], accent: ['#22a6ff', '#00e0d0'], glass: '18, 30, 46' },
    { id: 'ember', name: 'Ember', desc: 'Warm orange glow', bg: '#0b0302', aurora: ['#ff4d1f', '#ff9a1f', '#b3122e'], accent: ['#ff6a3d', '#ffb02e'], glass: '44, 26, 22' },
    { id: 'sakura', name: 'Sakura', desc: 'Soft pink blossom', bg: '#0b0408', aurora: ['#ff7eb6', '#c86bff', '#ff9fc2'], accent: ['#ff6fae', '#c48bff'], glass: '44, 24, 36' },
    { id: 'synthwave', name: 'Synthwave', desc: 'Neon pink and cyan', bg: '#090214', aurora: ['#ff2bd6', '#00e5ff', '#7a2bff'], accent: ['#ff3bd4', '#18e2ff'], glass: '36, 20, 52' },
    { id: 'prestige', name: 'Prestige', desc: 'Black and gold', bg: '#070502', aurora: ['#c8961e', '#8a5a12', '#f0c75e'], accent: ['#f0b429', '#ff8a3d'], glass: '40, 32, 20' },
    { id: 'oled', name: 'OLED Black', desc: 'Pure black, no glow', bg: '#000000', aurora: ['#1b1d24', '#121318', '#16181e'], accent: ['#c9d1e0', '#8a93a6'], glass: '22, 22, 26', calm: true },
  ];

  function apply(id) {
    const t = THEMES.find((x) => x.id === id) || THEMES[0];
    const r = document.documentElement.style;
    r.setProperty('--bg', t.bg);
    r.setProperty('--aurora-a', t.aurora[0]);
    r.setProperty('--aurora-b', t.aurora[1]);
    r.setProperty('--aurora-c', t.aurora[2]);
    r.setProperty('--theme-accent', t.accent[0]);
    r.setProperty('--accent-2', t.accent[1]);
    r.setProperty('--glass', `rgba(${t.glass}, .52)`);
    r.setProperty('--glass-strong', `rgba(${t.glass.split(',').map((v) => Math.round(v * 0.62)).join(',')}, .9)`);
    r.setProperty('--aurora-opacity', t.calm ? '.35' : '.95');
    return t;
  }

  // A small preview swatch for the theme picker.
  const preview = (t) => `radial-gradient(80% 90% at 75% 15%, ${t.aurora[0]}cc, transparent 60%), radial-gradient(70% 80% at 15% 85%, ${t.aurora[1]}aa, transparent 60%), ${t.bg}`;

  window.Themes = { list: THEMES, apply, preview };
})();
