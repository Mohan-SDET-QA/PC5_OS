// Spatial focus navigation. Any element with [data-nav] is focusable; the
// directional input picks the nearest visible element in that direction.
// Containers marked [data-nav-group] remember their last focused child, so
// moving down and back up returns you to the same tile (like a console UI).
(function () {
  const memory = new WeakMap();
  const stack = []; // open modals; the top one is the nav scope
  let current = null;

  const visible = (el) => {
    if (!el.getClientRects().length) return false;
    for (let n = el; n; n = n.parentElement) if (n.hidden) return false;
    return true;
  };
  const group = (el) => el && el.closest('[data-nav-group]');
  const scope = () => (stack.length ? stack[stack.length - 1].el : document.getElementById('app'));
  const items = () => [...scope().querySelectorAll('[data-nav]')].filter(visible);

  function scrollIntoView(el) {
    // Rows/grids are overflow:hidden; scroll them programmatically.
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflow === 'visible' && cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const pr = p.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const pad = 24;
      if (p.scrollWidth > p.clientWidth) {
        if (r.left < pr.left + pad) p.scrollBy({ left: r.left - pr.left - pad, behavior: 'smooth' });
        else if (r.right > pr.right - pad) p.scrollBy({ left: r.right - pr.right + pad + 240, behavior: 'smooth' });
      }
      if (p.scrollHeight > p.clientHeight) {
        if (r.top < pr.top + pad) p.scrollBy({ top: r.top - pr.top - pad, behavior: 'smooth' });
        else if (r.bottom > pr.bottom - pad) p.scrollBy({ top: r.bottom - pr.bottom + pad, behavior: 'smooth' });
      }
    }
  }

  function focus(el) {
    if (!el) {
      if (current) current.classList.remove('focused');
      current = null;
      return;
    }
    if (current) current.classList.remove('focused');
    current = el;
    el.classList.add('focused');
    el.focus({ preventScroll: true });
    const g = group(el);
    if (g) memory.set(g, el);
    // Let the focus-size transition start before measuring scroll position.
    requestAnimationFrame(() => scrollIntoView(el));
    el.dispatchEvent(new CustomEvent('navfocus', { bubbles: true }));
  }

  function move(dir) {
    const list = items();
    if (!current || !list.includes(current)) return focus(list[0]), true;
    const r = current.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let best = null;
    let bestScore = Infinity;
    for (const el of list) {
      if (el === current) continue;
      const b = el.getBoundingClientRect();
      let main;
      let cross;
      if (dir === 'left') { main = r.left - b.right; cross = Math.abs(b.top + b.height / 2 - cy); if (b.left + b.width / 2 >= cx) continue; }
      if (dir === 'right') { main = b.left - r.right; cross = Math.abs(b.top + b.height / 2 - cy); if (b.left + b.width / 2 <= cx) continue; }
      if (dir === 'up') { main = r.top - b.bottom; cross = Math.abs(b.left + b.width / 2 - cx); if (b.top + b.height / 2 >= cy) continue; }
      if (dir === 'down') { main = b.top - r.bottom; cross = Math.abs(b.left + b.width / 2 - cx); if (b.top + b.height / 2 <= cy) continue; }
      const horizontal = dir === 'left' || dir === 'right';
      const score = horizontal ? Math.max(main, 0) + cross * 4 : Math.max(main, 0) * 2 + cross;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (!best) return false;
    const target = group(best);
    if (target && target !== group(current)) {
      // Entering a group: go back to where we were, else to its default item.
      const remembered = memory.get(target);
      const preferred = target.querySelector('[data-nav-default]');
      if (remembered && remembered.isConnected && visible(remembered)) best = remembered;
      else if (preferred && visible(preferred)) best = preferred;
    }
    focus(best);
    return true;
  }

  function openModal(el, { onBack } = {}) {
    document.getElementById('modals').appendChild(el);
    stack.push({ el, onBack, returnTo: current });
    const first = el.querySelector('[data-autofocus]') || items()[0];
    focus(first);
    return () => closeModal(el);
  }

  function closeModal(el) {
    const i = stack.findIndex((m) => m.el === el);
    if (i < 0) return;
    const [m] = stack.splice(i, 1);
    el.remove();
    if (m.returnTo && m.returnTo.isConnected) focus(m.returnTo);
    else focus(items()[0]);
  }

  function back() {
    const top = stack[stack.length - 1];
    if (!top) return false;
    if (top.onBack) top.onBack();
    else closeModal(top.el);
    return true;
  }

  window.Nav = {
    focus, move, openModal, closeModal, back, items,
    current: () => current,
    inModal: () => stack.length > 0,
    topModal: () => (stack.length ? stack[stack.length - 1].el : null),
    focusGroup(g) {
      const remembered = memory.get(g);
      focus(remembered && remembered.isConnected && visible(remembered) ? remembered : g.querySelector('[data-nav]'));
    },
  };
})();
