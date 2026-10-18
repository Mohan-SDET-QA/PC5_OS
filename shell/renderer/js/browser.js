// Built-in web browser driven by the controller: the left stick moves a
// pointer, Cross/A clicks, the right stick scrolls, and text boxes open the
// on-screen keyboard. Downloads and magnet links go to the Downloads page.
(function () {
  const { $, toast, menu } = UI;
  const api = () => window.pc5;
  let wv = null;
  let active = false;
  let raf = null;
  let lastT = 0;
  const cursor = { x: 0, y: 0 };

  function ensure() {
    if (wv) return;
    wv = document.createElement('webview');
    wv.setAttribute('partition', 'persist:browser');
    wv.setAttribute('allowpopups', ''); // pop-ups are reopened in this view by the main process
    wv.className = 'webview';
    $('#browser-stage').prepend(wv);
    const update = () => {
      try { $('#b-url').textContent = wv.getURL(); } catch { /* not ready */ }
    };
    wv.addEventListener('did-start-loading', () => $('#b-loading').classList.add('loading'));
    wv.addEventListener('did-stop-loading', () => { $('#b-loading').classList.remove('loading'); update(); });
    wv.addEventListener('did-navigate', update);
    wv.addEventListener('did-navigate-in-page', update);
    wv.addEventListener('did-fail-load', (e) => { if (e.errorCode !== -3) toast(`Couldn't load the page (${e.errorDescription})`, 'alert'); });
  }

  function open(url) {
    // Web preview: pages can't be embedded on a website, so use a real tab.
    if (PC5.S.env.web) {
      window.open(url || PC5.S.cfg.homepage, '_blank', 'noopener');
      toast('The built-in browser is part of the Windows app. Opened in a new tab.', 'globe');
      return;
    }
    ensure();
    const target = url || (wv.getAttribute('src') ? null : PC5.S.cfg.homepage);
    if (target) navigate(target);
    active = true;
    $('#browser').hidden = false;
    const r = $('#browser-stage').getBoundingClientRect();
    if (!cursor.x) placeCursor(r.width / 2, r.height / 2);
    cancelAnimationFrame(raf);
    lastT = 0;
    raf = requestAnimationFrame(loop);
    $('#b-hints').textContent = 'Left stick: pointer · Right stick: scroll';
    PC5.renderHints();
  }

  function close() {
    active = false;
    $('#browser').hidden = true;
    cancelAnimationFrame(raf);
    PC5.renderHints();
  }

  function navigate(text) {
    const t = text.trim();
    let url;
    if (/^magnet:/i.test(t)) {
      api().downloads.addTorrent(t);
      return toast('Torrent added to Downloads', 'magnet');
    }
    if (/^(https?|about):/i.test(t)) url = t;
    else if (/^[^\s]+\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(t)) url = `https://${t}`;
    else url = (PC5.S.cfg.searchUrl || 'https://duckduckgo.com/?q=') + encodeURIComponent(t);
    if (wv.getAttribute('src')) wv.loadURL(url).catch(() => {});
    else wv.setAttribute('src', url);
    $('#b-url').textContent = url;
  }

  function placeCursor(x, y) {
    const r = $('#browser-stage').getBoundingClientRect();
    cursor.x = Math.max(0, Math.min(r.width - 2, x));
    cursor.y = Math.max(0, Math.min(r.height - 2, y));
    $('#cursor').style.transform = `translate(${cursor.x}px, ${cursor.y}px)`;
  }

  function moveCursor(x, y) {
    placeCursor(x, y);
    try { wv.sendInputEvent({ type: 'mouseMove', x: Math.round(cursor.x), y: Math.round(cursor.y) }); } catch { /* loading */ }
  }

  function scroll(dx, dy) {
    try {
      wv.sendInputEvent({ type: 'mouseWheel', x: Math.round(cursor.x), y: Math.round(cursor.y), deltaX: dx, deltaY: dy, canScroll: true });
    } catch { /* loading */ }
  }

  const curve = (v) => {
    const a = Math.abs(v);
    if (a < 0.15) return 0;
    const n = (a - 0.15) / 0.85;
    return Math.sign(v) * n * n;
  };

  function loop(t) {
    const dt = lastT ? Math.min(50, t - lastT) / 16.67 : 1;
    lastT = t;
    if (!Nav.inModal() && !PC5.S.mouseMode) {
      const s = Pad.sticks();
      const dx = curve(s.lx) * 20 * dt;
      const dy = curve(s.ly) * 20 * dt;
      if (dx || dy) moveCursor(cursor.x + dx, cursor.y + dy);
      const sx = curve(s.rx);
      const sy = curve(s.ry);
      if (sx || sy) scroll(-sx * 40 * dt, -sy * 60 * dt);
    }
    raf = requestAnimationFrame(loop);
  }

  function click(button = 'left') {
    const x = Math.round(cursor.x);
    const y = Math.round(cursor.y);
    wv.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount: 1 });
    wv.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount: 1 });
    const c = $('#cursor');
    c.classList.remove('click');
    void c.offsetWidth;
    c.classList.add('click');
    if (button === 'left') setTimeout(() => typeIntoFocused(false), 200);
  }

  // If the click focused a text box, open the on-screen keyboard for it.
  async function typeIntoFocused(explicit) {
    let info = null;
    try {
      info = await wv.executeJavaScript(`(() => {
        const e = document.activeElement;
        if (!e) return null;
        const t = (e.type || '').toLowerCase();
        const editable = e.isContentEditable || e.tagName === 'TEXTAREA' ||
          (e.tagName === 'INPUT' && !['button','submit','checkbox','radio','range','color','file','image','reset','hidden'].includes(t));
        if (!editable) return null;
        return { type: t, value: e.isContentEditable ? e.innerText : e.value,
                 label: e.getAttribute('aria-label') || e.placeholder || e.name || '' };
      })()`);
    } catch { /* page navigating */ }
    if (!info) {
      if (explicit) toast('Point at a text box and click it first');
      return;
    }
    const res = await OSK.prompt({ title: info.label || 'Type', value: info.value, password: info.type === 'password', goKey: true });
    if (!res) return;
    await wv.executeJavaScript(`(() => {
      const e = document.activeElement;
      const v = ${JSON.stringify(res.text)};
      if (e.isContentEditable) { document.execCommand('selectAll'); document.execCommand('insertText', false, v); return; }
      const proto = e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(e, v);
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    if (res.go) {
      wv.focus();
      wv.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
      wv.sendInputEvent({ type: 'char', keyCode: '\r' });
      wv.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    }
  }

  async function address() {
    let current = '';
    try { current = wv.getURL(); } catch { /* none yet */ }
    const res = await OSK.prompt({ title: 'Search or type a web address', value: current === 'about:blank' ? '' : current, goKey: true });
    if (res && res.text.trim()) navigate(res.text);
  }

  function bookmarks() {
    menu('Bookmarks', (PC5.S.cfg.bookmarks || []).map((b) => [b.title, () => open(b.url), { desc: b.url }]));
  }

  function browserMenu() {
    menu('Browser', [
      ['Search or type an address', address],
      ['Bookmarks', bookmarks],
      ['Reload', () => wv.reload()],
      ['Bookmark this page', async () => {
        const url = wv.getURL();
        const title = wv.getTitle() || url;
        PC5.S.cfg = await api().setConfig({ bookmarks: [...(PC5.S.cfg.bookmarks || []), { title, url }] });
        toast('Bookmarked', 'star');
      }],
      ['Zoom in', () => wv.setZoomLevel(wv.getZoomLevel() + 0.5)],
      ['Zoom out', () => wv.setZoomLevel(wv.getZoomLevel() - 0.5)],
      ['Downloads', () => { close(); PC5.showView('downloads'); }],
      ['Close browser', close],
    ]);
  }

  // Controller actions while the browser is in front. Returns true if handled.
  function handle(action) {
    const s = Pad.sticks();
    const stickMoving = Math.hypot(s.lx, s.ly) > 0.4; // the stick also produces d-pad style actions
    switch (action) {
      case 'accept': click('left'); return true;
      case 'alt': typeIntoFocused(true); return true;
      case 'back': if (wv.canGoBack()) wv.goBack(); else close(); return true;
      case 'lb': if (wv.canGoBack()) wv.goBack(); return true;
      case 'rb': if (wv.canGoForward()) wv.goForward(); return true;
      case 'options': address(); return true;
      case 'menu': browserMenu(); return true;
      case 'up': case 'down':
        if (!stickMoving) scroll(0, action === 'up' ? 300 : -300);
        return true;
      case 'left': case 'right':
        if (!stickMoving) moveCursor(cursor.x + (action === 'left' ? -40 : 40), cursor.y);
        return true;
      default: return false;
    }
  }

  window.Browser = {
    open, close, handle, bookmarks, navigate,
    active: () => active,
    hints: () => [['accept', 'Click'], ['alt', 'Type'], ['options', 'Address'], ['menu', 'Menu'], ['lb', 'Back'], ['back', 'Close']],
    // for tests
    _cursor: cursor, _moveCursor: moveCursor, _webview: () => wv,
  };
})();
