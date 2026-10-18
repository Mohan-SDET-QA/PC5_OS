// Controller-friendly on-screen keyboard.
// OSK.prompt({ title, value, password, goKey }) resolves to the text, or null if cancelled.
// With goKey, it adds a Go key and resolves to { text, go } instead.
// Shortcuts while open: X/Square = backspace, Y/Triangle = space, Start/Options = done.
(function () {
  const LOWER = '1234567890qwertyuiopasdfghjkl-zxcvbnm.@_';
  const SYMBOLS = '!#$%&*()+=?/\\:;\'",<>[]{}~^|`';

  function prompt({ title = 'Enter text', value = '', password = false, goKey = false } = {}) {
    return new Promise((resolve) => {
      let shift = false;
      let symbols = false;
      const el = document.createElement('div');
      el.className = 'modal osk';
      el.innerHTML = `<div class="sheet"><h2></h2><input class="osk-input" spellcheck="false"><div class="osk-keys"></div></div>`;
      el.querySelector('h2').textContent = title;
      const input = el.querySelector('input');
      input.type = password ? 'password' : 'text';
      input.value = value;
      const keys = el.querySelector('.osk-keys');

      const done = (result, go = false) => {
        window.removeEventListener('keydown', onKey, true);
        Nav.closeModal(el);
        resolve(goKey && result != null ? { text: result, go } : result);
      };
      const type = (ch) => { input.value += shift ? ch.toUpperCase() : ch; if (shift) { shift = false; render(); } };
      const erase = () => { input.value = input.value.slice(0, -1); };

      function key(label, onPress, cls = '') {
        const b = document.createElement('button');
        b.className = `key ${cls}`;
        b.dataset.nav = '';
        b.textContent = label;
        b.addEventListener('click', onPress);
        keys.appendChild(b);
        return b;
      }

      function render() {
        const focusedLabel = Nav.current() && Nav.current().textContent;
        keys.innerHTML = '';
        const chars = symbols ? SYMBOLS : LOWER;
        for (const ch of chars) key(shift ? ch.toUpperCase() : ch, () => type(ch));
        key(shift ? '⇧ ON' : '⇧', () => { shift = !shift; render(); }, 'wide');
        key(symbols ? 'abc' : '#+=', () => { symbols = !symbols; render(); }, 'wide');
        key('Space', () => { input.value += ' '; }, 'wider');
        key('⌫', erase, 'wide');
        key('Cancel', () => done(null), 'wide');
        key('Done', () => done(input.value), 'wide');
        if (goKey) key('Go ↵', () => done(input.value, true), 'wide go');
        for (const s of ['.com', 'https://', 'www.']) key(s, () => { input.value += s; }, 'wide');
        const again = [...keys.children].find((k) => k.textContent === focusedLabel);
        if (Nav.inModal() && Nav.topModal() === el) Nav.focus(again || keys.firstElementChild);
      }

      // Controller shortcuts, delivered by app.js to the top modal.
      el.addEventListener('padaction', (ev) => {
        const a = ev.detail;
        if (a === 'alt') erase();
        else if (a === 'menu') done(input.value, true);
        else if (a === 'options') done(input.value);
        else if (a === 'rb') input.value += ' ';
        else return;
        ev.preventDefault();
      });

      // A physical keyboard, if one is plugged in, types straight into the field.
      function onKey(ev) {
        if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
        if (ev.key.length === 1) input.value += ev.key;
        else if (ev.key === 'Backspace') erase();
        else return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
      }
      window.addEventListener('keydown', onKey, true);

      render();
      Nav.openModal(el, { onBack: () => done(null) });
    });
  }

  window.OSK = { prompt };
})();
