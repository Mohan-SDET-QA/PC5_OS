// PC5's own line-icon set (24x24, drawn with currentColor) and controller
// button glyphs. Icon(name) returns an <svg> element; Icon.html(name) a string.
(function () {
  const P = {
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    download: '<path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 20h14"/>',
    settings: '<path d="M10.3 3h3.4l.5 2.4a7 7 0 0 1 1.9 1.1l2.3-.8 1.7 2.9-1.8 1.6a7 7 0 0 1 0 2.2l1.8 1.6-1.7 2.9-2.3-.8a7 7 0 0 1-1.9 1.1l-.5 2.4h-3.4l-.5-2.4a7 7 0 0 1-1.9-1.1l-2.3.8-1.7-2.9 1.8-1.6a7 7 0 0 1 0-2.2L3.9 8.6l1.7-2.9 2.3.8a7 7 0 0 1 1.9-1.1z"/><circle cx="12" cy="12" r="3"/>',
    power: '<path d="M12 3v8.5"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/>',
    user: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5c1.4-3.9 4.3-5.8 7.5-5.8s6.1 1.9 7.5 5.8"/>',
    home: '<path d="M4 11.2L12 4.5l8 6.7V20h-5.2v-5.5H9.2V20H4z"/>',
    store: '<path d="M5 8.5h14l-1.1 11.5H6.1z"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/>',
    gift: '<rect x="4" y="9.5" width="16" height="10.5" rx="1.6"/><path d="M3 9.5h18M12 9.5V20"/><path d="M12 9.5C11 6.4 7.3 5.6 7.3 7.8S12 9.5 12 9.5zM12 9.5c1-3.1 4.7-3.9 4.7-1.7S12 9.5 12 9.5z"/>',
    library: '<path d="M5 4.5h3.2v15H5zM10.4 4.5h3.2v15h-3.2z"/><path d="M15.6 5.6l3-.8 3 14.6-3 .8z"/>',
    grid: '<rect x="4" y="4" width="6.6" height="6.6" rx="1.6"/><rect x="13.4" y="4" width="6.6" height="6.6" rx="1.6"/><rect x="4" y="13.4" width="6.6" height="6.6" rx="1.6"/><rect x="13.4" y="13.4" width="6.6" height="6.6" rx="1.6"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.4 2.4 3.5 5.4 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.4-3.5-8.5s1.1-6.1 3.5-8.5z"/>',
    folder: '<path d="M3.5 7.2a2 2 0 0 1 2-2h3.8l2.1 2.2h7.1a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
    desktop: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16v4"/>',
    wifi: '<path d="M2.8 9.2a13.5 13.5 0 0 1 18.4 0"/><path d="M5.8 12.6a9 9 0 0 1 12.4 0"/><path d="M8.8 15.9a4.6 4.6 0 0 1 6.4 0"/><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/>',
    gamepad: '<path d="M7.2 8h9.6a4 4 0 0 1 3.9 3.1l1 4.7a2.4 2.4 0 0 1-4 2.2L15.5 16h-7l-2.2 2a2.4 2.4 0 0 1-4-2.2l1-4.7A4 4 0 0 1 7.2 8z"/><path d="M8 10.8v3.4M6.3 12.5h3.4"/><circle cx="15.6" cy="11.4" r=".9" fill="currentColor" stroke="none"/><circle cx="17.4" cy="13.4" r=".9" fill="currentColor" stroke="none"/>',
    mouse: '<rect x="6.5" y="3" width="11" height="18" rx="5.5"/><path d="M12 6.8v3.2"/>',
    magnet: '<path d="M6 4v7a6 6 0 0 0 12 0V4h-4v7a2 2 0 0 1-4 0V4z"/><path d="M6 8h4M14 8h4"/>',
    archive: '<rect x="3.5" y="4" width="17" height="4.5" rx="1.2"/><path d="M5 8.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5"/><path d="M10 12.5h4"/>',
    file: '<path d="M6.5 3h7.5l4 4v14h-11.5z"/><path d="M14 3v4h4"/>',
    app: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 12h6M12 9v6"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17.5l5-4.5 4 3.5 3-2.5 4 3.5"/>',
    film: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M10.2 9.4v5.2l4.3-2.6z" fill="currentColor"/>',
    music: '<path d="M9 18V6.2l10-2v11.6"/><circle cx="6.6" cy="18" r="2.4"/><circle cx="16.6" cy="15.8" r="2.4"/>',
    drive: '<rect x="3.5" y="13" width="17" height="6.5" rx="1.6"/><path d="M5.6 13l2.4-8h8l2.4 8"/><circle cx="16.6" cy="16.3" r=".9" fill="currentColor" stroke="none"/>',
    play: '<path d="M8 5.4v13.2l10.6-6.6z" fill="currentColor" stroke="none"/>',
    more: '<circle cx="6" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.6 4.4v4.3h-4.3"/>',
    check: '<path d="M5 12.6l4.4 4.4L19 7.4"/>',
    alert: '<path d="M12 3.8l9.2 16H2.8z"/><path d="M12 10v4.4"/><circle cx="12" cy="17.2" r=".8" fill="currentColor" stroke="none"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.4"/><circle cx="12" cy="7.9" r=".9" fill="currentColor" stroke="none"/>',
    star: '<path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.7l-5.1 2.7 1-5.6-4.1-4 5.7-.8z"/>',
    bluetooth: '<path d="M7 7.6l10 8.9L12 21V3l5 4.5-10 8.9"/>',
    trash: '<path d="M4.5 7h15"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 13h9l1-13"/>',
    edit: '<path d="M4 20h4L19.2 8.8l-4-4L4 16z"/>',
    tv: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20.5h6"/><path d="M10.4 8.4v4.2l3.6-2.1z" fill="currentColor"/>',
    chat: '<path d="M4 5h16v11H9.5L4 20z"/><path d="M9 9.5v3M15 9.5v3"/>',
    diamond: '<path d="M12 3l8 9-8 9-8-9z"/>',
    orbit: '<circle cx="12" cy="12" r="2.8"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(-25 12 12)"/>',
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
    lightning: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
    moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
    restart: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.4 4.4v4.3h4.3"/>',
    chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2.5v3.5M15 2.5v3.5M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5"/>',
    volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    exit: '<path d="M14 4.5H6.5v15H14"/><path d="M10.5 12H20M16.5 8.5L20 12l-3.5 3.5"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/>',
    pause: '<rect x="7" y="5.5" width="3.4" height="13" rx="1" fill="currentColor" stroke="none"/><rect x="13.6" y="5.5" width="3.4" height="13" rx="1" fill="currentColor" stroke="none"/>',
    prev: '<path d="M6.5 6v12"/><path d="M18 6.5L9.5 12l8.5 5.5z" fill="currentColor"/>',
    next: '<path d="M17.5 6v12"/><path d="M6 6.5l8.5 5.5L6 17.5z" fill="currentColor"/>',
    camera: '<path d="M4 8.5a2 2 0 0 1 2-2h2.2l1.6-2h4.4l1.6 2H18a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.6" r="3.4"/>',
    activity: '<path d="M3 12h4l2.5-6.5 4.5 13 2.5-6.5H21"/>',
    palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 1.9-.9 1.6-2-.4-1.4.5-2.6 2-2.6h1.6a3.3 3.3 0 0 0 3.3-3.3A9 9 0 0 0 12 3.5z"/><circle cx="7.8" cy="11.2" r="1.1" fill="currentColor" stroke="none"/><circle cx="10.4" cy="7.4" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="7.6" r="1.1" fill="currentColor" stroke="none"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
    cut: '<circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/><path d="M8.3 15.7L18 4M15.7 15.7L6 4"/>',
    paste: '<rect x="5" y="5" width="14" height="15.5" rx="2"/><path d="M9 5V3.8h6V5"/><path d="M9 11h6M9 15h4"/>',
    layers: '<path d="M12 4l8.5 4.5L12 13 3.5 8.5z"/><path d="M3.5 12.5L12 17l8.5-4.5"/><path d="M3.5 16.5L12 21l8.5-4.5"/>',
  };

  // Controller face-button symbols, drawn here as plain vector shapes in the
  // style of the DualSense. They only tell the player which button to press.
  const G = {
    cross: '<path d="M7.6 7.6l8.8 8.8M16.4 7.6l-8.8 8.8"/>',
    circle: '<circle cx="12" cy="12" r="5.1"/>',
    square: '<rect x="7.3" y="7.3" width="9.4" height="9.4" rx=".7"/>',
    triangle: '<path d="M12 6.6l5.7 9.8H6.3z"/>',
    menu: '<path d="M8.2 9h7.6M8.2 12h7.6M8.2 15h7.6"/>',
  };

  function svg(inner, cls = 'ico-svg') {
    return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  }

  function Icon(name) {
    const t = document.createElement('template');
    t.innerHTML = Icon.html(name);
    return t.content.firstElementChild;
  }
  Icon.html = (name) => svg(P[name] || P.app);
  Icon.has = (name) => Boolean(P[name]);

  // Glyph for an action, styled for the connected controller type.
  Icon.glyph = (action, padType) => {
    const ps = { accept: 'cross', back: 'circle', alt: 'square', options: 'triangle', menu: 'menu' };
    const xb = { accept: 'A', back: 'B', alt: 'X', options: 'Y' };
    const el = document.createElement('span');
    el.className = `glyph g-${action} pad-${padType}`;
    if (action === 'home') { el.textContent = padType === 'ps' ? 'PS' : '⊗'; el.classList.add('pill'); }
    else if (action === 'left') { el.textContent = '◀ ▶'; el.classList.add('pill'); }
    else if (action === 'lb' || action === 'rb') { el.textContent = padType === 'ps' ? (action === 'lb' ? 'L1' : 'R1') : action.toUpperCase(); el.classList.add('pill', 'bumper'); }
    else if (action === 'share') { el.textContent = padType === 'ps' ? 'Create' : 'View'; el.classList.add('pill'); }
    else if (padType === 'ps' || action === 'menu') { el.innerHTML = svg(G[ps[action]], 'glyph-svg'); el.classList.add(`s-${ps[action]}`); }
    else { el.textContent = xb[action]; el.classList.add(`x-${xb[action]}`); }
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', { cross: 'Cross', circle: 'Circle', square: 'Square', triangle: 'Triangle' }[ps[action]] || el.textContent || action);
    return el;
  };

  // Text anywhere in the UI can carry a button as a token, e.g. "Press ⟦accept⟧":
  // it is swapped for the real button icon as soon as it reaches the page.
  Icon.token = (action) => `⟦${action}⟧`;
  const TOKEN = /⟦(\w+)⟧/;
  let currentPad = () => 'ps';
  Icon.setPadSource = (fn) => { currentPad = fn; };
  function swapTokens(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.data.includes('⟦') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const parts = node.data.split(TOKEN);
      const frag = document.createDocumentFragment();
      parts.forEach((part, i) => {
        if (i % 2) { const g = Icon.glyph(part, currentPad()); g.classList.add('inline'); frag.append(g); } else if (part) frag.append(part);
      });
      node.replaceWith(frag);
    }
  }
  Icon.swapTokens = swapTokens;
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') { if (r.target.data.includes('⟦') && r.target.parentNode) swapTokens(r.target.parentNode); continue; }
      for (const n of r.addedNodes) {
        if (n.nodeType === 3 ? n.data.includes('⟦') : n.nodeType === 1 && n.textContent.includes('⟦')) swapTokens(n.nodeType === 3 ? n.parentNode || n : n);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  window.Icon = Icon;
})();
