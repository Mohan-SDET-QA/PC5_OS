// Files page (browse the whole PC), a file picker, and the Windows Apps page.
(function () {
  const { $, h, toast, menu, confirm, busy, fmtBytes } = UI;
  const api = () => window.pc5;
  let listing = { path: '', parent: null, entries: [] };
  let loaded = false;
  let selectPath = null;
  let clipboard = null; // { path, move } from Copy / Cut

  const TYPES = [
    [/\.(exe|msi|bat|cmd|lnk)$/i, 'app'], [/\.(zip|7z|rar|tar|gz|tgz|xz|bz2|iso)$/i, 'archive'], [/\.torrent$/i, 'magnet'],
    [/\.(png|jpe?g|gif|webp|bmp)$/i, 'image'], [/\.(mp4|mkv|avi|mov|webm)$/i, 'film'], [/\.(mp3|flac|wav|ogg|m4a)$/i, 'music'],
  ];
  const iconFor = (e) => e.icon || (e.dir ? 'folder' : (TYPES.find(([re]) => re.test(e.name)) || [null, 'file'])[1]);
  const metaFor = (e) => (e.dir ? (e.mtime ? 'Folder' : '') : e.mtime ? `${fmtBytes(e.size)} · ${new Date(e.mtime).toLocaleDateString()}` : '');

  function row(e, onclick) {
    return h('button', { class: 'file-row', nav: true, 'data-path': e.path, onclick },
      h('span', { class: 'f-icon' }, Icon(iconFor(e))),
      h('span', { class: 'f-name' }, e.name),
      h('span', { class: 'f-meta' }, metaFor(e)));
  }

  async function go(dir, select) {
    try {
      listing = await api().files.list(dir || '');
      loaded = true;
    } catch (err) {
      toast(`Can't open that folder: ${err.message}`, 'alert');
      return;
    }
    selectPath = select || null;
    draw();
  }

  async function goPlace(name, sub) {
    const roots = await api().files.list('');
    const place = roots.entries.find((e) => e.name === name);
    if (!place) return go('');
    if (sub) {
      const inside = await api().files.list(place.path).catch(() => null);
      const target = inside && inside.entries.find((e) => e.dir && e.name === sub);
      if (target) return go(target.path);
      UI.toast(`No ${sub} yet`, 'info');
    }
    go(place.path);
  }

  async function paste() {
    if (!clipboard || !listing.path) return;
    const { path: src, move } = clipboard;
    const stop = UI.busy(`${move ? 'Moving' : 'Copying'} ${src.split(/[\\/]/).pop()}…`);
    try {
      const target = await api().files.copy(src, listing.path, move);
      if (move) clipboard = null;
      stop();
      go(listing.path, target);
    } catch (err) {
      stop();
      toast(`Couldn't ${move ? 'move' : 'copy'} it: ${err.message}`, 'alert');
    }
  }

  function draw() {
    $('#files-path').textContent = listing.path || 'This PC';
    const list = $('#file-list');
    const rows = listing.entries.map((e) => {
      const r = row(e, () => openEntry(e));
      if (listing.path) r._options = () => entryOptions(e);
      return r;
    });
    list.replaceChildren(...(rows.length ? rows : [h('p', { class: 'muted empty' }, 'This folder is empty.')]));
    list.scrollTop = 0;
    if (PC5.S.view === 'files' && !Nav.inModal()) {
      const target = (selectPath && list.querySelector(`[data-path="${CSS.escape(selectPath)}"]`)) || list.querySelector('[data-nav]');
      if (target) Nav.focus(target);
    }
  }

  async function openEntry(e) {
    if (e.dir) return go(e.path);
    if (Viewer.kindOf(e.name)) return Viewer.open(e.path, listing.entries.filter((x) => !x.dir).map((x) => x.path));
    if (/\.torrent$/i.test(e.name)) {
      await api().downloads.addTorrent(e.path);
      return toast('Torrent added to Downloads', 'magnet');
    }
    if (/\.(zip|7z|rar|tar|gz|tgz|xz|bz2)$/i.test(e.name)) {
      return menu(e.name, [
        ['Extract and add to Game Library', () => Downloads.extractAndAdd(e.path)],
        ['Open with the default app', () => openFile(e.path)],
      ]);
    }
    if (/\.(exe|msi|iso)$/i.test(e.name)) {
      return menu(e.name, [
        ['Install this game', () => PC5.installFlow(e.path), { desc: 'Runs the installer, then adds the game to Home' }],
        ...(/\.exe$/i.test(e.name) ? [['Add to Game Library', () => PC5.addGameFrom(e.path), { desc: 'Already installed or no install needed' }]] : []),
        ['Just open it', () => openFile(e.path)],
      ]);
    }
    openFile(e.path);
  }

  async function openFile(file) {
    try {
      const r = await api().files.open(file);
      if (r && r.mouseMode) toast(`Opened. Your controller is a mouse now. Press ${PC5.glyph('home')} to come back.`, 'mouse');
      else if (r && r.demo) toast('Demo mode: would open the file');
    } catch (err) {
      toast(`Couldn't open it: ${err.message}`, 'alert');
    }
  }

  function entryOptions(e) {
    const entries = [['Open', () => openEntry(e)]];
    if (/\.exe$/i.test(e.name)) entries.push(['Add to Game Library', () => PC5.addGameFrom(e.path)]);
    if (e.dir) entries.push(['Find a game in this folder', () => PC5.addGameFrom(e.path)]);
    entries.push(['Copy', () => { clipboard = { path: e.path, move: false }; toast(`Copied. Open a folder and choose “Paste here”.`, 'copy'); }]);
    entries.push(['Cut', () => { clipboard = { path: e.path, move: true }; toast(`Cut. Open a folder and choose “Paste here”.`, 'cut'); }]);
    if (clipboard) entries.push([`Paste here: ${clipboard.path.split(/[\\/]/).pop()}`, paste, { desc: clipboard.move ? 'Moves it into this folder' : 'Copies it into this folder' }]);
    entries.push(['Rename', async () => {
      const name = await OSK.prompt({ title: 'New name', value: e.name });
      if (!name || name === e.name) return;
      try { const p = await api().files.rename(e.path, name); go(listing.path, p); } catch (err) { toast(err.message, 'alert'); }
    }]);
    entries.push(['New folder here', async () => {
      const name = await OSK.prompt({ title: 'Folder name', value: 'New folder' });
      if (!name) return;
      try { const p = await api().files.mkdir(listing.path, name); go(listing.path, p); } catch (err) { toast(err.message, 'alert'); }
    }]);
    entries.push(['Move to Recycle Bin', async () => {
      if (!(await confirm(`Move ${e.name} to the Recycle Bin?`, 'Move'))) return;
      try { await api().files.remove(e.path); go(listing.path); } catch (err) { toast(err.message, 'alert'); }
    }, { cls: 'danger' }]);
    menu(e.name, entries, { subtitle: e.path });
  }

  // A modal file picker: resolves to a file path, or null if cancelled.
  // With folder: true it picks a folder ("Use this folder" at the top).
  function pick({ start, filter = /.*/, title = 'Choose a file', folder = false } = {}) {
    return new Promise((resolve) => {
      let current = { path: '', parent: null, entries: [] };
      const pathEl = h('div', { class: 'muted sub' });
      const listEl = h('div', { class: 'list file-list picker-list' });
      const el = h('div', { class: 'modal' }, h('div', { class: 'sheet picker' }, h('h2', {}, title), pathEl, listEl));
      let finished = false;
      const finish = (value) => {
        if (finished) return;
        finished = true;
        Nav.closeModal(el);
        resolve(value);
      };
      async function show(dir) {
        try { current = await api().files.list(dir || ''); } catch { current = await api().files.list(''); }
        pathEl.textContent = current.path || 'This PC';
        const entries = current.entries.filter((e) => e.dir || (!folder && filter.test(e.name)));
        listEl.replaceChildren(...entries.map((e) => row(e, () => (e.dir ? show(e.path) : finish(e.path)))));
        if (folder && current.path) listEl.prepend(row({ name: 'Use this folder', path: current.path, dir: false, icon: 'check', size: 0, mtime: 0 }, () => finish(current.path)));
        if (!entries.length) listEl.append(h('p', { class: 'muted empty' }, 'Nothing to choose here.'));
        listEl.scrollTop = 0;
        Nav.focus(listEl.querySelector('[data-nav]') || el);
      }
      Nav.openModal(el, { onBack: () => (current.path ? show(current.parent) : finish(null)) });
      const startDir = start && /\.[a-z0-9]{1,5}$/i.test(start) ? start.replace(/[\\/][^\\/]+$/, '') : start;
      show(startDir || '');
    });
  }

  // ---------------------------------------------------------------- Windows Apps
  let appsLoaded = false;
  const appsPage = {
    async render() {
      if (appsLoaded) return;
      appsLoaded = true;
      const grid = $('#win-apps');
      const apps = await api().files.apps();
      if (!apps.length) {
        grid.replaceChildren(h('p', { class: 'muted empty' }, 'No Windows apps found (this list is read from the Start menu).'));
        return;
      }
      grid.replaceChildren(...apps.map((a) => {
        const icon = h('div', { class: 'win-app-icon' }, Icon('app'));
        const tile = h('button', { class: 'win-app', nav: true, onclick: () => PC5.launchApp({ type: 'file', path: a.path, title: a.title }) },
          icon, h('div', { class: 'win-app-name' }, a.title));
        tile._options = () => menu(a.title, [
          ['Open', () => tile.click()],
          ['Add to Game Library', async () => {
            const cfg = await api().getConfig();
            PC5.S.cfg = await api().setConfig({ customGames: [...(cfg.customGames || []), { title: a.title, exe: a.path }] });
            await PC5.refreshGames();
            toast(`${a.title} added to your Game Library`, 'gamepad');
          }],
        ]);
        api().files.icon(a.path).then((url) => { if (url) icon.replaceChildren(h('img', { src: url, alt: '' })); });
        return tile;
      }));
      if (PC5.S.view === 'apps' && !Nav.inModal()) Nav.focus(grid.querySelector('[data-nav]'));
    },
    focusTarget: () => $('#win-apps [data-nav]'),
    hints: () => [['accept', 'Open'], ['back', 'Back'], ['options', 'Add to Library'], ['home', 'Control Center']],
  };

  window.Files = {
    page: {
      async render() { if (!loaded) await go(''); },
      onBack() {
        if (listing.path) { go(listing.parent, listing.path); return true; }
        return false;
      },
      focusTarget: () => $('#file-list [data-nav]'),
      options() {
        if (!listing.path) return;
        menu(listing.path.split(/[\\/]/).pop() || listing.path, [
          ...(clipboard ? [[`Paste here: ${clipboard.path.split(/[\\/]/).pop()}`, paste]] : []),
          ['New folder here', async () => {
            const name = await OSK.prompt({ title: 'Folder name', value: 'New folder' });
            if (name) { try { const p = await api().files.mkdir(listing.path, name); go(listing.path, p); } catch (err) { toast(err.message, 'alert'); } }
          }],
        ]);
      },
      hints: () => [['accept', 'Open'], ['back', listing.path ? 'Up one folder' : 'Back'], ['options', 'File options'], ['home', 'Control Center']],
    },
    appsPage,
    go,
    goPlace,
    pick,
  };
})();
