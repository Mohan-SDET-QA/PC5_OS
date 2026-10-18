// Turns controller (and keyboard, for development) input into logical actions:
// up/down/left/right, accept, back, options (Triangle/Y), menu (Options/Start),
// alt (Square/X), lb, rb, home. Stick positions are available via Pad.sticks().
// Uses the W3C "standard" mapping, which Chromium provides for both Xbox
// (XInput) and DualSense/DualShock controllers.
(function () {
  const BUTTONS = { 0: 'accept', 1: 'back', 2: 'alt', 3: 'options', 4: 'lb', 5: 'rb', 8: 'view', 9: 'menu', 12: 'up', 13: 'down', 14: 'left', 15: 'right', 16: 'home' };
  const DIRS = new Set(['up', 'down', 'left', 'right']);
  const REPEAT_DELAY = 380;
  const REPEAT_RATE = 110;
  const held = {};
  const listeners = [];
  let padType = 'ps';
  let sticks = { lx: 0, ly: 0, rx: 0, ry: 0 };

  function emit(action) {
    for (const fn of listeners) fn(action);
  }

  function detectType(id) {
    return /054c|dualsense|dualshock|playstation|wireless controller/i.test(id) ? 'ps' : 'xbox';
  }

  function poll(now) {
    const state = {};
    const next = { lx: 0, ly: 0, rx: 0, ry: 0 };
    for (const p of navigator.getGamepads ? navigator.getGamepads() : []) {
      if (!p || !p.connected) continue;
      const t = detectType(p.id);
      if (t !== padType) { padType = t; window.dispatchEvent(new CustomEvent('padtype', { detail: t })); }
      p.buttons.forEach((b, i) => { if (BUTTONS[i] && (b.pressed || b.value > 0.5)) state[BUTTONS[i]] = true; });
      const [x = 0, y = 0, rx = 0, ry = 0] = p.axes;
      for (const [k, v] of [['lx', x], ['ly', y], ['rx', rx], ['ry', ry]]) if (Math.abs(v) > Math.abs(next[k])) next[k] = v;
      if (x < -0.55) state.left = true;
      if (x > 0.55) state.right = true;
      if (y < -0.55) state.up = true;
      if (y > 0.55) state.down = true;
    }
    // Back+Start together acts as Home for controllers whose Guide button
    // the browser can't see.
    if (state.view && state.menu) { state.home = true; delete state.view; delete state.menu; }
    sticks = next;

    for (const action of new Set([...Object.keys(state), ...Object.keys(held)])) {
      if (state[action] && !held[action]) {
        held[action] = { next: now + REPEAT_DELAY };
        hideCursor();
        emit(action);
      } else if (state[action] && DIRS.has(action) && now >= held[action].next) {
        held[action].next = now + REPEAT_RATE;
        emit(action);
      } else if (!state[action]) {
        delete held[action];
      }
    }
    requestAnimationFrame(poll);
  }
  requestAnimationFrame(poll);

  const KEYS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    Enter: 'accept', Escape: 'back', Backspace: 'back', Tab: 'options', m: 'menu',
    q: 'lb', e: 'rb', h: 'home', x: 'alt',
  };
  window.addEventListener('keydown', (ev) => {
    // Let real typing reach text inputs (the on-screen keyboard has one).
    if (ev.target.tagName === 'INPUT' && !['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(ev.key)) return;
    const action = KEYS[ev.key];
    if (!action) return;
    ev.preventDefault();
    emit(action);
  });

  // ---------------------------------------------------------------- mouse
  // The pointer shows when the mouse (or the controller in mouse mode) moves,
  // and hides after a few idle seconds or as soon as the controller is used.
  let cursorTimer = null;
  let lastX = -1;
  let lastY = -1;
  function hideCursor() {
    clearTimeout(cursorTimer);
    document.body.classList.remove('mouse');
  }
  window.addEventListener('mousemove', (e) => {
    if (Math.abs(e.screenX - lastX) + Math.abs(e.screenY - lastY) < 2) return; // ignore synthetic jitter
    lastX = e.screenX;
    lastY = e.screenY;
    document.body.classList.add('mouse');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(hideCursor, 4000);
  });
  // Mouse "back" side button.
  window.addEventListener('mouseup', (e) => { if (e.button === 3) { e.preventDefault(); emit('back'); } });

  window.Pad = {
    on: (fn) => listeners.push(fn),
    type: () => padType,
    sticks: () => sticks,
    emit, // lets tests and the mouse-hover code inject actions
  };
})();
