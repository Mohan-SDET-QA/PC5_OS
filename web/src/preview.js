// Website-only additions to the PC5 interface: a "web preview" pill with the
// download link, and a one-time card explaining the controls.
(function () {
  const CFG = window.PC5_SITE || {};
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v));
    n.append(...kids);
    return n;
  };

  const style = el('style', {}, `
    .pv-pill { position: fixed; z-index: 9000; top: 1.3rem; left: 50%; translate: -50% 0; display: flex; align-items: center; gap: .7rem;
      padding: .45rem .5rem .45rem .95rem; border-radius: 99rem; font: 600 .8rem/1 Inter, system-ui, sans-serif; color: #fff;
      background: rgba(10, 14, 28, .62); backdrop-filter: blur(18px) saturate(1.4); box-shadow: inset 0 0 0 1px rgba(255,255,255,.12), 0 .8rem 2.4rem rgba(0,0,0,.4); }
    .pv-pill .dot { width: .5rem; height: .5rem; border-radius: 50%; background: #3ccf6e; box-shadow: 0 0 .6rem #3ccf6e; }
    .pv-pill a { color: #fff; text-decoration: none; padding: .45rem .8rem; border-radius: 99rem; background: linear-gradient(140deg, #2f7bff, #8a5cff); }
    .pv-pill a.ghost { background: rgba(255,255,255,.1); }
    .pv-pill a:hover { filter: brightness(1.15); }
    .pv-card { position: fixed; z-index: 9001; inset: 0; display: grid; place-items: center; background: rgba(3, 5, 12, .55); backdrop-filter: blur(6px);
      font-family: Inter, system-ui, sans-serif; color: #fff; animation: pv-in .5s cubic-bezier(.2,.8,.2,1) both; }
    .pv-card .box { width: min(34rem, calc(100vw - 2rem)); padding: 2rem 2rem 1.6rem; border-radius: 1.6rem; background: rgba(16, 20, 38, .92);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.1), 0 2rem 6rem rgba(0,0,0,.6); }
    .pv-card h2 { margin: 0 0 .4rem; font-size: 1.5rem; letter-spacing: -.02em; }
    .pv-card p { margin: 0 0 1.2rem; color: rgba(255,255,255,.7); line-height: 1.5; font-size: .95rem; }
    .pv-card ul { list-style: none; margin: 0 0 1.4rem; padding: 0; display: grid; gap: .55rem; font-size: .92rem; }
    .pv-card li { display: flex; justify-content: space-between; gap: 1rem; padding: .6rem .8rem; border-radius: .8rem; background: rgba(255,255,255,.05); }
    .pv-card kbd { font: 600 .8rem/1 Inter, system-ui, sans-serif; padding: .3rem .5rem; border-radius: .4rem; background: rgba(255,255,255,.12); margin-left: .25rem; }
    .pv-card button { width: 100%; padding: .9rem; border: 0; border-radius: 99rem; font: 650 1rem Inter, system-ui, sans-serif; color: #000; background: #fff; cursor: pointer; }
    @keyframes pv-in { from { opacity: 0; } }
    @media (max-width: 700px) { .pv-pill span.txt { display: none; } }
    .pv-card .tip { margin: -.4rem 0 1.2rem; font-size: .85rem; color: #fab219; }
  `);
  document.head.append(style);

  // ?embed: the silent, auto-playing copy shown on the landing page.
  if (new URLSearchParams(location.search).has('embed')) {
    document.head.append(el('style', {}, 'body, body * { cursor: none !important; } #hints { opacity: 0; }'));
    const start = setInterval(() => {
      if (!document.getElementById('splash-user')?.hidden && window.Pad) { clearInterval(start); Pad.emit('accept'); attract(); }
    }, 300);
    // Glide along the game row like a console's attract mode.
    function attract() {
      let step = 0;
      setInterval(() => {
        if (document.hidden || !window.PC5 || PC5.S.view !== 'games' || Nav.inModal()) return;
        step = (step + 1) % 12;
        Pad.emit(step < 7 ? 'right' : 'left');
      }, 3200);
    }
    return;
  }

  const download = CFG.downloadUrl || '/#download';
  document.body.append(el('div', { class: 'pv-pill' },
    el('span', { class: 'dot' }), el('span', { class: 'txt' }, 'Web preview'),
    el('a', { class: 'ghost', href: '/' }, 'About'),
    el('a', { href: download }, 'Download for Windows')));

  let seen = false;
  try { seen = sessionStorage.getItem('pc5-preview-help') === '1'; } catch { /* storage blocked */ }
  if (seen) return;
  const row = (what, ...keys) => el('li', {}, el('span', {}, what), el('span', {}, ...keys.map((k) => el('kbd', {}, k))));
  const ok = el('button', { type: 'button' }, 'Start the preview');
  const card = el('div', { class: 'pv-card' }, el('div', { class: 'box' },
    el('h2', {}, 'Try PC5 OS in your browser'),
    el('p', {}, 'This is the real PC5 interface with demo data. Plug in a PlayStation or Xbox controller and press any button, or use the keyboard and mouse.'),
    innerWidth < innerHeight ? el('p', { class: 'tip' }, 'PC5 is made for a TV or monitor. Turn your phone sideways, or open this page on a computer.') : '',
    el('ul', {},
      row('Move', '←', '↑', '→', '↓'), row('Select', 'Enter'), row('Back', 'Esc'),
      row('Options', 'Tab'), row('Switch tabs', 'Q', 'E'), row('PS / Home button', 'H')),
    ok));
  const close = (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    card.remove();
    window.removeEventListener('keydown', onKey, true);
    try { sessionStorage.setItem('pc5-preview-help', '1'); } catch { /* storage blocked */ }
  };
  const onKey = (e) => { if (['Enter', 'Escape', ' '].includes(e.key)) close(e); };
  ok.addEventListener('click', close);
  window.addEventListener('keydown', onKey, true);
  document.body.append(card);
  // A controller press dismisses the card too.
  (function poll() {
    if (!card.isConnected) return;
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    if (pads.some((p) => p.buttons.some((b) => b.pressed))) return close();
    requestAnimationFrame(poll);
  })();
})();
