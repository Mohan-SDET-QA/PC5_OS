// PC5 Shell renderer: home screen, pages, control center and input routing.
(function () {
  const api = window.pc5;
  const { $, h, art, toast, sounds, menu, confirm, busy } = UI;
  const TABS = ['games', 'media'];
  const S = { view: 'games', lastTab: 'games', games: [], cfg: {}, env: {}, info: {}, mouseMode: false, splash: true, pads: 0 };
  // Pages owned by the other modules (downloads-ui.js, files-ui.js).
  const Pages = { downloads: Downloads.page, files: Files.page, apps: Files.appsPage, settings: Settings.page, perf: Perf.page };

  // ---------------------------------------------------------------- background
  let bgFront = 'a';
  let bgUrl = null;
  function setBackground(urls) {
    const list = (urls || []).filter(Boolean);
    const url = list[0] || null;
    if (url === bgUrl) return;
    bgUrl = url;
    const back = bgFront === 'a' ? 'b' : 'a';
    const front = $(`#bg-${bgFront}`);
    const next = $(`#bg-${back}`);
    if (!url) { front.classList.remove('show'); next.classList.remove('show'); return; }
    const probe = new Image();
    probe.onload = () => {
      if (bgUrl !== url) return;
      next.style.backgroundImage = `url("${url}")`;
      next.classList.add('show');
      front.classList.remove('show');
      bgFront = back;
    };
    probe.onerror = () => { if (list.length > 1 && bgUrl === url) { bgUrl = null; setBackground(list.slice(1)); } };
    probe.src = url;
  }

  // ---------------------------------------------------------------- controller glyphs + hints
  const padType = () => (S.cfg.glyphs && S.cfg.glyphs !== 'auto' ? S.cfg.glyphs : Pad.type());
  Icon.setPadSource(padType);
  // A button inside text: becomes the button's icon when it reaches the page.
  const glyph = (a) => Icon.token(a);

  function renderHints() {
    const top = Nav.topModal();
    let hints;
    if (top && top.classList.contains('osk')) hints = [['accept', 'Type'], ['alt', 'Delete'], ['options', 'Done'], ['back', 'Cancel']];
    else if (!top && Viewer.active()) hints = Viewer.hints();
    else if (!top && Browser.active()) hints = Browser.hints();
    else if (!top && Pages[S.view] && Pages[S.view].hints) hints = Pages[S.view].hints();
    else hints = [['accept', 'Select'], ['back', 'Back'], ['options', 'Options'], ['home', 'Control Center']];
    $('#hints').replaceChildren(...hints.map(([a, label]) => h('span', {}, Icon.glyph(a, padType()), label)));
  }
  function updateGlyphs() {
    $('#splash-glyph').replaceChildren(Icon.glyph('home', padType()), ' or ', Icon.glyph('accept', padType()));
    $('#mouse-exit-btn').replaceChildren(Icon.glyph('share', padType()));
  }
  window.addEventListener('padtype', () => { renderHints(); updateGlyphs(); });

  // ---------------------------------------------------------------- views
  function showView(name, { focus = true } = {}) {
    if (S.view !== name && Pages[S.view] && Pages[S.view].leave) Pages[S.view].leave();
    if (TABS.includes(name)) S.lastTab = name;
    S.view = name;
    document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === S.lastTab));
    document.body.classList.toggle('on-page', !TABS.includes(name));
    setBackground(TABS.includes(name) ? homeBg[name] : null);
    const page = Pages[name];
    const rendered = page ? page.render() : null;
    const focusView = () => {
      if (S.view !== name || Nav.inModal()) return;
      const target = (page && page.focusTarget && page.focusTarget()) || $(`#view-${name} [data-nav-group]`);
      if (!target) return;
      if (!target.matches('[data-nav-group]')) Nav.focus(target);
      else Nav.focusGroup(target);
    };
    if (focus) {
      // Never leave focus on something in a hidden view (✕ would press it).
      if (Nav.current() && !Nav.items().includes(Nav.current())) Nav.focus(null);
      focusView();
      // Pages that build their content asynchronously get focus once it exists.
      if (rendered && rendered.then) rendered.then(() => { if (!Nav.items().includes(Nav.current())) focusView(); });
    }
    renderHints();
  }

  // ---------------------------------------------------------------- home rows
  const homeBg = { games: null, media: null };

  function renderHomeRow(name, items) {
    const prefix = name === 'games' ? 'game' : 'media';
    const row = $(`#${prefix}-row`);
    const openBtn = $(name === 'games' ? '#btn-play' : '#btn-media-open');
    const optsBtn = name === 'games' ? $('#btn-game-opts') : null;
    const cur = Nav.current();
    const hadFocus = row.contains(cur);
    const focusKey = hadFocus ? cur.dataset.key : null;

    row.replaceChildren();
    items.forEach((item, i) => {
      const visual = item.cover
        ? art(item.cover, item.title)
        : h('div', { class: 'icon-art', style: `--c:${item.color || '#2a3b6e'}` }, Icon.has(item.icon) ? Icon(item.icon) : h('span', { class: 'icon-letter' }, item.title[0]));
      const tile = h('button', {
        class: `tile${item.cover ? '' : ' special'}`, nav: true, 'data-key': item.key, style: `--i:${i}`,
        onclick: item.onOpen,
        onnavfocus: () => {
          $(`#${prefix}-meta`).textContent = item.meta || '';
          $(`#${prefix}-title`).textContent = item.title;
          $(`#${prefix}-desc`).textContent = item.desc || '';
          showLogo(prefix, item);
          tintFor(item);
          openBtn.textContent = item.openLabel || 'Open';
          openBtn.onclick = item.onOpen;
          if (optsBtn) { optsBtn.hidden = !item.onOptions; optsBtn.onclick = item.onOptions; }
          homeBg[name] = item.bg || null;
          setBackground(item.bg);
        },
      }, h('div', { class: 'art' }, visual), h('div', { class: 'label' }, item.title));
      tile._options = item.onOptions;
      row.append(tile);
    });
    if (hadFocus) Nav.focus([...row.children].find((t) => t.dataset.key === focusKey) || row.firstElementChild);
  }

  // The big title: the game's own logo when it has one, else text.
  function showLogo(prefix, item) {
    const img = $(`#${prefix}-logo`);
    const title = $(`#${prefix}-title`);
    if (!img) return;
    img.hidden = true;
    title.hidden = false;
    if (!item.logo) return;
    const key = item.key;
    img.onload = () => { if (img.dataset.key === key) { img.hidden = false; title.hidden = true; } };
    img.onerror = () => { img.hidden = true; title.hidden = false; };
    img.dataset.key = key;
    img.src = item.logo;
  }

  // UI colour follows the selected game's art (Settings → Appearance).
  function setDyn(color) {
    if (color) S.selectedTint = true;
    if (color && (S.cfg.accent || 'auto') === 'auto') document.documentElement.style.setProperty('--dyn', color);
  }
  let tintKey = null;
  function tintFor(item) {
    tintKey = item.key;
    if (!item.cover) return setDyn(item.color);
    const url = (item.bg || []).find(Boolean) || item.cover.find(Boolean);
    api.artColor(url).then((c) => { if (tintKey === item.key && c) setDyn(c); }).catch(() => {});
  }

  // Recently played first, then newest additions and most recently played.
  function sortedGames() {
    const byId = new Map(S.games.map((g) => [g.id, g]));
    const recent = (S.cfg.recents || []).map((id) => byId.get(id)).filter(Boolean);
    const when = (g) => Math.max(g.lastPlayed || 0, g.added || 0);
    const rest = S.games.filter((g) => !recent.includes(g)).sort((a, b) => when(b) - when(a));
    return [...recent, ...rest];
  }
  const SOURCES = { steam: 'Steam', epic: 'Epic Games', gog: 'GOG', custom: 'Added' };

  function renderGames() {
    const games = sortedGames().slice(0, 12).map((g) => ({
      key: g.id,
      title: g.title,
      meta: `${SOURCES[g.source] || g.source} · ${g.viaSteam ? 'Controller support via Steam' : 'Installed'}`,
      cover: [g.art.cover, g.art.header],
      bg: [g.art.hero, g.art.header],
      logo: g.art.logo,
      openLabel: 'Play',
      onOpen: () => launchGame(g),
      onOptions: () => gameOptions(g),
    }));
    renderHomeRow('games', [
      { key: 'store', title: 'PC5 Store', icon: 'store', color: '#1f4bd8', meta: 'Store', desc: 'Free games, the Steam and Epic stores, and search.', onOpen: () => showView('store') },
      { key: 'free', title: 'Free Games', icon: 'gift', color: '#0f8a5f', meta: 'Store', desc: 'Giveaways from Steam, Epic, GOG and itch.io, plus free-to-play games.', onOpen: () => { showView('store'); Pages.store.focusFree(); } },
      ...games,
      { key: 'library', title: 'Game Library', icon: 'library', color: '#3a3f55', meta: 'Library', desc: `${S.games.length} installed games. Games you download from the internet can be added here.`, onOpen: () => showView('library') },
    ]);
  }

  function renderMedia() {
    const active = Downloads.active();
    const apps = (S.cfg.apps || []).map((a) => ({
      key: `app:${a.id}`, title: a.title, icon: a.icon || a.title[0], color: a.color, meta: 'App',
      desc: a.type === 'web' ? `Opens full screen. Press ${glyph('home')} to come back.` : 'Opens the app.',
      onOpen: () => launchApp(a),
    }));
    renderHomeRow('media', [
      { key: 'browser', title: 'Web Browser', icon: 'globe', color: '#1662c4', meta: 'Internet', desc: 'Browse any site with your controller. Downloads and torrent links go to Downloads.', onOpen: () => Browser.open() },
      { key: 'downloads', title: 'Downloads', icon: 'download', color: '#5b2bd1', meta: active ? `${active} in progress` : 'Downloads', desc: 'Web downloads and torrents. Install or extract them, then add them to your library.', onOpen: () => showView('downloads') },
      { key: 'files', title: 'Files', icon: 'folder', color: '#c98a12', meta: 'PC', desc: 'Browse every drive and folder on this PC.', onOpen: () => showView('files') },
      { key: 'perf', title: 'Performance', icon: 'activity', color: '#1c7c54', meta: 'PC', desc: 'Live CPU, GPU, memory, temperatures and network, plus a task manager and an in-game overlay.', onOpen: () => showView('perf') },
      { key: 'media', title: 'Media Player', icon: 'film', color: '#b3264f', meta: 'Media', desc: 'Your videos, music, pictures and captures, played full screen with the controller.', onOpen: mediaMenu },
      { key: 'winapps', title: 'Windows Apps', icon: 'grid', color: '#0f7d9b', meta: 'PC', desc: 'Every program installed on this PC. The controller becomes a mouse for them.', onOpen: () => showView('apps') },
      ...apps,
      { key: 'desktop', title: 'Desktop Mode', icon: 'desktop', color: '#444b63', meta: 'PC', desc: `The full Windows desktop, with the controller as the mouse. Press ${glyph('home')} to come back.`, onOpen: desktopMode },
    ]);
  }

  function mediaMenu() {
    const go = (place, sub) => () => { showView('files', { focus: false }); Files.goPlace(place, sub); };
    menu('Media Player', [
      ['Videos', go('Videos'), { desc: 'Pick a video to play it full screen' }],
      ['Music', go('Music'), { desc: 'Songs play with the controller: ⟦accept⟧ pause, ⟦left⟧ seek' }],
      ['Pictures', go('Pictures')],
      ['Captures', go('Pictures', 'PC5 Captures'), { desc: 'Your PC5 screenshots' }],
    ]);
  }

  async function screenshot() {
    while (Nav.inModal()) Nav.back();
    await new Promise((r) => setTimeout(r, 450)); // let menus fade out
    try {
      const file = await api.screenshot();
      sounds.notify();
      toast(`Screenshot saved to Pictures › PC5 Captures (${file.split(/[\\/]/).pop()})`, 'camera');
    } catch (err) {
      toast(`Screenshot failed: ${err.message}`, 'alert');
    }
  }

  async function desktopMode() {
    if (await confirm('Open the Windows desktop?', 'Open desktop', `Taskbar and Start menu, with your controller as the mouse. Press ${glyph('home')} (or Ctrl+Alt+H) to come back to PC5.`)) api.openDesktop();
  }

  async function switchToWindows() {
    // App mode: Windows is already running underneath, so just step aside.
    if (!(await api.winset('getConsoleMode').catch(() => true))) {
      if (await confirm('Go to the Windows desktop?', 'Go to desktop', `PC5 keeps running in the background. Press ${glyph('home')} or open PC5 from the taskbar to come back.`)) api.openDesktop();
      return;
    }
    if (!(await confirm('Switch to Windows?', 'Sign out and switch', 'PC5 signs you out. When you sign back in you get the normal Windows desktop. Double-click “Return to PC5” on the desktop to come back.'))) return;
    try {
      const r = await api.switchToWindows();
      if (r && r.demo) toast('Demo mode: would sign out to the Windows desktop');
    } catch (err) {
      toast(err.message, 'alert');
    }
  }

  // ---------------------------------------------------------------- store
  function storeCard(item) {
    const price = h('div', { class: 'price' });
    if (item.discount) price.append(h('span', { class: 'disc' }, `-${item.discount}%`));
    price.append(item.price || '');
    return h('button', { class: 'card', nav: true, onclick: () => storeDetail(item) },
      art([item.image], item.name),
      h('div', { class: 'card-body' }, h('div', { class: 'name' }, item.name), price));
  }

  function storeRow(title, items, key) {
    return h('div', { class: 'store-row', 'data-row': key || title }, h('h3', {}, title),
      h('div', { class: 'card-row', 'data-nav-group': `store-${key || title}` }, items.map(storeCard)));
  }

  let storeLoaded = false;
  Pages.store = {
    async render() {
      if (storeLoaded) return;
      storeLoaded = true;
      const rows = $('#store-rows');
      const [give, epic, f2p, steam] = await Promise.allSettled([api.giveaways(), api.epicFree(), api.steamFree(), api.steamFeatured()]);
      rows.replaceChildren();
      const featured = [...(give.value || []).slice(0, 3), ...(f2p.value || []).slice(0, 1), ...((steam.value && steam.value[0] && steam.value[0].items) || []).slice(0, 2)];
      if (featured.length) startCarousel(featured);
      if (give.status === 'fulfilled' && give.value.length) rows.append(storeRow('Free right now, from every store', give.value, 'free'));
      if (epic.status === 'fulfilled' && epic.value.length) rows.append(storeRow('Free on Epic this week', epic.value, 'epic-free'));
      if (f2p.status === 'fulfilled' && f2p.value.length) rows.append(storeRow('Free to Play on Steam', f2p.value, 'f2p'));
      if (steam.status === 'fulfilled') for (const s of steam.value) rows.append(storeRow(s.title, s.items));
      if (!rows.children.length) {
        storeLoaded = false;
        rows.append(h('p', { class: 'muted' }, 'The store is unavailable. Check your connection in Settings → Network.'));
      }
    },
    focusFree() {
      const tryFocus = (n) => {
        const first = $('#store-rows [data-row="free"] [data-nav]') || $('#store-rows [data-row="f2p"] [data-nav]');
        if (first) Nav.focus(first);
        else if (n > 0) setTimeout(() => tryFocus(n - 1), 300);
      };
      tryFocus(20);
    },
  };

  // The big rotating banner at the top of the store.
  let carouselTimer = null;
  function startCarousel(items) {
    let index = 0;
    const holder = $('#store-feature');
    const show = () => {
      const item = items[index];
      const free = item.store === 'giveaway' || item.free;
      const focused = holder.contains(Nav.current());
      const el = h('button', { class: 'feature', nav: true, onclick: () => storeDetail(item) },
        art([item.image], item.name),
        h('div', { class: 'f-body' },
          h('div', { class: 'f-kicker' }, free ? 'Free right now' : 'Featured'),
          h('div', { class: 'f-title' }, item.name),
          h('div', { class: 'f-sub' }, [item.price, item.platforms].filter(Boolean).join(' · ')),
          h('span', { class: 'f-cta' }, free ? 'Get it free' : 'View')),
        h('div', { class: 'f-dots' }, items.map((_, i) => h('span', { class: i === index ? 'on' : '' }))));
      holder.replaceChildren(el);
      if (focused) Nav.focus(el);
    };
    show();
    clearInterval(carouselTimer);
    carouselTimer = setInterval(() => {
      if (S.view !== 'store' || Nav.inModal()) return;
      index = (index + 1) % items.length;
      show();
    }, 7000);
  }

  async function storeSearch() {
    const term = await OSK.prompt({ title: 'Search Steam' });
    if (!term) return;
    if (S.view !== 'store') showView('store', { focus: false });
    try {
      const results = await api.steamSearch(term);
      const rows = $('#store-rows');
      rows.querySelector('.search-results')?.remove();
      const row = storeRow(`Results for “${term}”`, results, 'search');
      row.classList.add('search-results');
      if (!results.length) row.append(h('p', { class: 'muted' }, 'No results.'));
      rows.prepend(row);
      rows.scrollTop = 0;
      const first = row.querySelector('[data-nav]');
      if (first) Nav.focus(first);
    } catch (err) {
      toast(`Search failed: ${err.message}`, 'alert');
    }
  }

  function storeDetail(item) {
    const buttons = [];
    let info = [item.price || ''];
    const btn = (label, fn, primary) => h('button', { class: `btn${primary ? ' primary' : ''}`, nav: true, 'data-autofocus': primary || null, onclick: fn }, label);
    if (item.store === 'steam') {
      if (item.free) buttons.push(btn('Install free', () => openUri(item.installUri, 'Steam is installing it. It will appear in your library.'), true));
      buttons.push(btn('View in Steam Store', () => openUri(item.storeUri, 'Opening in Steam…'), !item.free));
      if (!item.free) buttons.push(btn('Install (if owned)', () => openUri(item.installUri, 'Steam will start the download')));
    } else if (item.store === 'epic') {
      buttons.push(btn('Get it free on Epic', () => openUri(item.storeUri, 'Opening Epic Games…'), true));
    } else if (item.store === 'giveaway') {
      info = [item.price, item.platforms, item.ends ? `Ends ${item.ends}` : ''];
      buttons.push(btn('Claim in browser', () => { Nav.back(); Browser.open(item.url); }, true));
    }
    buttons.push(btn('Close', () => Nav.back()));
    const el = h('div', { class: 'modal' }, h('div', { class: 'sheet detail' },
      item.image ? h('img', { class: 'detail-img', src: item.image, alt: '' }) : null,
      h('h2', {}, item.name),
      h('div', { class: 'muted' }, info.filter(Boolean).join('  ·  ')),
      item.description ? h('p', { class: 'detail-desc' }, item.description) : null,
      item.instructions ? h('p', { class: 'detail-desc muted' }, item.instructions.replace(/<[^>]+>/g, ' ')) : null,
      h('div', { class: 'row' }, buttons)));
    Nav.openModal(el);
  }

  // ---------------------------------------------------------------- library
  let libFilter = 'all';
  let libSort = 'recent';
  Pages.library = {
    render() {
      const grid = $('#lib-grid');
      const present = new Set(S.games.map((g) => g.source));
      const filters = [['all', 'All'], ['steam', 'Steam'], ['epic', 'Epic'], ['gog', 'GOG'], ['custom', 'Added']].filter(([k]) => k === 'all' || present.has(k));
      const chip = (label, on, fn) => h('button', { class: `chip${on ? ' on' : ''}`, nav: true, onclick: fn }, label);
      $('#lib-filters').replaceChildren(
        ...filters.map(([k, label]) => chip(label, libFilter === k, () => { libFilter = k; Pages.library.render(); })),
        chip(libSort === 'recent' ? 'Sort: Recent' : 'Sort: A–Z', false, () => { libSort = libSort === 'recent' ? 'az' : 'recent'; Pages.library.render(); }),
      );
      let games = libSort === 'recent' ? sortedGames() : [...S.games].sort((a, b) => a.title.localeCompare(b.title));
      if (libFilter !== 'all') games = games.filter((g) => g.source === libFilter);
      $('#lib-count').textContent = `· ${games.length}`;
      grid.replaceChildren(...games.map((g, i) => {
        const item = h('button', { class: 'lib-item', nav: true, onclick: () => launchGame(g), title: g.title, style: `--i:${i}` },
          h('div', { class: 'lib-art' }, art([g.art.cover, g.art.header], g.title), h('span', { class: 'lib-badge' }, SOURCES[g.source] || g.source)),
          h('div', { class: 'lib-name' }, g.title));
        item._options = () => gameOptions(g);
        return item;
      }));
      if (!games.length) grid.append(h('p', { class: 'muted empty' }, 'No games here yet. Get free games from the Store, install one from a file, or put it in a game folder.'));
    },
    focusTarget: () => $('#lib-grid [data-nav]') || $('#btn-install-file'),
  };

  function guessTitle(file) {
    const parts = file.split(/[\\/]/);
    const folder = parts.length > 1 ? parts[parts.length - 2] : parts[0];
    return folder
      .replace(/\.(exe|zip|7z|rar)$/i, '')
      .replace(/[._]+/g, ' ')
      .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
      .replace(/\b(v\d[\w.]*|x64|win64|repack|gog|setup)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'My Game';
  }

  // Adds a downloaded game to the library: finds its .exe, asks for a name.
  async function addGameFrom(target) {
    let exe = /\.exe$/i.test(target || '') ? target : null;
    if (!exe) {
      const found = target ? await api.files.findExe(target) : [];
      const picks = found.slice(0, 8);
      exe = await new Promise((resolve) => {
        menu('Which file starts the game?', [
          ...picks.map((f) => [f.name, () => resolve(f.path), { desc: `${UI.fmtBytes(f.size)} · ${f.path}` }]),
          ['Browse for it…', async () => resolve(await Files.pick({ start: target, filter: /\.exe$/i, title: 'Choose the game .exe' }))],
          ['Cancel', () => resolve(null)],
        ], { subtitle: picks.length ? 'Best guess is first.' : 'No .exe found here. Browse for it.' });
      });
    }
    if (!exe) return;
    const title = await OSK.prompt({ title: 'Name this game', value: guessTitle(exe) });
    if (!title) return;
    const r = await api.addGame({ title, exe });
    S.cfg = await api.getConfig();
    await refreshGames();
    sounds.notify();
    toast(r && r.added === false ? `${title} is already in your library` : `${title} is on your Home screen`, 'gamepad');
  }

  // Install a game from a file: PC5 runs the installer and adds the game itself.
  async function installFlow(file) {
    if (/\.(zip|7z|rar|tar|gz|tgz|xz|bz2)$/i.test(file)) return Downloads.extractAndAdd(file);
    const name = file.split(/[\\/]/).pop();
    let sub = null;
    const el = h('div', { class: 'modal' }, h('div', { class: 'sheet busy' }, h('div', { class: 'spinner' }),
      h('div', { class: 'busy-text' }, h('div', {}, `Installing ${name}`), (sub = h('div', { class: 'busy-sub' }, 'Starting the installer… your controller is a mouse until it finishes.')))));
    Nav.openModal(el, { onBack: () => {} });
    const off = api.onInstallStatus ? api.onInstallStatus((text) => { sub.textContent = text; }) : null;
    let r;
    try {
      r = await api.installGame(file);
    } catch (err) {
      r = { error: err.message };
    }
    if (off) off();
    Nav.closeModal(el);
    if (r && r.demo) return toast('Demo mode: would run the installer and add the game');
    if (r && r.error) return toast(`Install failed: ${r.error}`, 'alert');
    if (r && r.found) {
      sounds.notify();
      toast(r.added === false ? `${r.title} is already in your library` : `${r.title} was installed and added to Home`, 'gamepad');
      await refreshGames();
      return goHome();
    }
    const choose = await confirm('Couldn\u2019t find the installed game', 'Choose its .exe', 'If the install finished, pick the file that starts the game and PC5 adds it to Home.');
    if (choose) {
      const exe = await Files.pick({ start: 'C:\\Program Files', filter: /\.exe$/i, title: 'Choose the game .exe' });
      if (exe) addGameFrom(exe);
    }
  }

  async function installFromFilePicker() {
    const file = await Files.pick({ filter: /\.(exe|msi|iso|zip|7z|rar)$/i, title: 'Choose an installer, disc image or archive' });
    if (file) installFlow(file);
  }

  // ---------------------------------------------------------------- actions
  async function openUri(uri, msg) {
    try {
      await api.openUri(uri);
      if (msg) toast(msg);
    } catch (err) {
      toast(err.message, 'alert');
    }
  }

  async function launchGame(game) {
    const overlay = $('#launch-overlay');
    $('#launch-text').textContent = `Starting ${game.title}…`;
    $('#launch-art').replaceChildren(art([game.art.cover, game.art.header], game.title));
    overlay.hidden = false;
    sounds.select();
    try {
      await api.launchGame(game);
      S.cfg = await api.getConfig();
      if (S.env.web) setTimeout(() => toast(`On your PC, ${game.title} starts here, with your controller ready.`, 'gamepad'), 1500);
    } catch (err) {
      toast(`Couldn't start ${game.title}: ${err.message}`, 'alert');
    }
    setTimeout(() => { overlay.hidden = true; renderGames(); }, 4000);
  }

  async function launchApp(appDef) {
    try {
      await api.launchApp(appDef);
      if (S.env.demo && appDef.type !== 'web') toast(`Demo mode: would open ${appDef.title}`);
    } catch (err) {
      toast(`Couldn't open ${appDef.title}: ${err.message}`, 'alert');
    }
  }

  function gameOptions(game) {
    const entries = [['Play', () => launchGame(game)]];
    if (game.storeUri) entries.push(['View in Steam Store', () => openUri(game.storeUri)]);
    if (game.exe) entries.push(['Show game files', () => { showView('files', { focus: false }); Files.go(game.exe.replace(/[\\/][^\\/]+$/, '')); }]);
    if (game.source === 'custom') {
      entries.push(['Remove from library', async () => {
        const entry = (S.cfg.customGames || []).find((g) => g.exe === game.exe);
        const ignoredFolders = entry && entry.folder ? [...new Set([...(S.cfg.ignoredFolders || []), entry.folder])] : S.cfg.ignoredFolders || [];
        S.cfg = await api.setConfig({ customGames: (S.cfg.customGames || []).filter((g) => g.exe !== game.exe), ignoredFolders });
        await refreshGames();
        toast(`${game.title} removed (its files were kept)`);
      }]);
    } else {
      entries.push(['Hide from library', async () => {
        S.cfg = await api.setConfig({ hiddenGames: [...(S.cfg.hiddenGames || []), game.id] });
        await refreshGames();
        toast(`${game.title} hidden. Unhide it in Settings.`);
      }]);
    }
    menu(game.title, entries);
  }

  function powerMenu() {
    menu('Power', [
      ['Enter Rest Mode', () => api.power('sleep'), { desc: 'Sleep. Press the power button to wake.' }],
      ['Restart PC5', () => api.power('restart')],
      ['Turn Off PC5', () => api.power('shutdown')],
      ['Restart into another OS…', bootMenu, { desc: 'For dual-boot PCs' }],
      ['Desktop Mode', desktopMode, { desc: 'The Windows desktop now, then back with the PS button' }],
      ['Switch to Windows', switchToWindows, { desc: 'Sign out and use normal Windows' }],
    ]);
  }

  async function bootMenu() {
    const done = busy('Reading the boot menu…');
    let entries = [];
    try { entries = await api.bootEntries(); } catch (err) { toast(`Couldn't read the boot menu: ${err.message}`, 'alert'); }
    done();
    menu('Restart into…', [
      ...entries.map((e) => [e.description || e.id, async () => {
        if (await confirm(`Restart into ${e.description}?`, 'Restart', 'Just this once. The next restart comes back to PC5.')) api.restartInto(e.id);
      }]),
      ['UEFI / BIOS settings', async () => { if (await confirm('Restart into the UEFI firmware settings?', 'Restart')) api.restartToFirmware(); }],
    ], { subtitle: entries.length ? null : 'No other operating systems were found in the boot menu.' });
  }

  // ---------------------------------------------------------------- control center
  function controlCenter() {
    let el;
    const close = (fn) => () => { Nav.closeModal(el); fn(); };
    const btn = (icon, label, fn) => h('button', { class: 'cc-btn', nav: true, onclick: close(fn) },
      h('span', { class: 'cc-label' }, label), h('div', { class: 'ico' }, Icon(icon)));
    const card = (icon, title, body, fn, { bg, progress } = {}) => h('button', { class: 'cc-card', nav: true, onclick: close(fn) },
      bg ? h('div', { class: 'cc-bg', style: `background-image:url("${bg}")` }) : null,
      h('div', { class: 'cc-card-title' }, Icon(icon), title),
      h('div', { class: 'cc-card-body' }, body),
      progress != null ? h('div', { class: 'bar' }, h('div', { class: 'fill', style: `width:${Math.round(progress * 100)}%` })) : null);
    const dl = Downloads.summary();
    const last = sortedGames()[0];
    const now = new Date();
    el = h('div', { class: 'modal bottom' }, h('div', { class: 'control-center' },
      h('div', { class: 'cc-cards' },
        last ? card('play', 'Jump back in', last.title, () => launchGame(last), { bg: last.art.hero || last.art.header }) : null,
        card('download', 'Downloads', dl.text, () => showView('downloads'), { progress: dl.progress }),
        card('activity', 'Performance', perfText(), () => showView('perf')),
        card('gift', 'Free games', 'Giveaways from every store', () => { showView('store'); Pages.store.focusFree(); })),
      h('div', { class: 'cc-row' },
        btn('home', 'Home', goHome),
        btn('store', 'Store', () => showView('store')),
        btn('download', 'Downloads', () => showView('downloads')),
        btn('wifi', 'Wi-Fi', wifiMenu),
        btn('gamepad', 'Controllers', controllersMenu),
        btn('camera', 'Screenshot', screenshot),
        btn('activity', S.cfg.overlay ? 'Overlay: On' : 'Overlay: Off', () => Perf.toggleOverlay()),
        btn('mouse', 'Mouse Mode', () => api.setMouseMode(true)),
        btn('desktop', 'Desktop', desktopMode),
        btn('settings', 'Settings', () => showView('settings')),
        btn('power', 'Power', powerMenu),
        h('div', { class: 'cc-time' }, h('b', {}, now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
          now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })))));
    Nav.openModal(el);
    Nav.focus(el.querySelector('.cc-btn'));
  }

  function perfText() {
    const p = Perf.latest();
    if (!p) return 'CPU, GPU, memory and temperatures';
    return `CPU ${Math.round(p.cpu)}% · GPU ${Math.round(p.gpu)}% · RAM ${Math.round(p.ram)}%`;
  }

  function profileMenu() {
    menu(profileName(), [
      ['Change name', async () => {
        const name = await OSK.prompt({ title: 'Your name', value: profileName() });
        if (name) { S.cfg = await api.setConfig({ profileName: name }); applyProfile(); }
      }],
      ['Settings', () => showView('settings')],
      ['Power', powerMenu],
    ]);
  }

  // ---------------------------------------------------------------- hub cards (below the hero)
  function hubCard({ kicker, icon, title, sub, bg, covers, wide, onOpen }) {
    return h('button', { class: `hub-card${wide ? ' wide' : ''}`, nav: true, onclick: onOpen },
      bg ? h('div', { class: 'hc-bg', style: `background-image:url("${bg}")` }) : null,
      !bg && icon ? h('div', { class: 'hc-icon' }, Icon(icon)) : null,
      covers ? h('div', { class: 'hc-covers' }, covers.map((c) => h('img', { src: c, alt: '', onerror: (e) => e.target.remove() }))) : null,
      h('div', { class: 'hc-body' },
        h('div', { class: 'hc-kicker' }, icon && bg ? Icon(icon) : null, kicker),
        h('div', { class: 'hc-title' }, title),
        sub ? h('div', { class: 'hc-sub' }, sub) : null));
  }

  function renderHubs() {
    const cur = Nav.current();
    const hub = cur && cur.closest('.hub-cards');
    const keep = hub ? [...hub.children].indexOf(cur) : -1;
    fillHubs();
    if (hub && keep >= 0 && hub.children[keep]) Nav.focus(hub.children[keep]);
  }

  function fillHubs() {
    const dl = Downloads.summary();
    const free = S.freeGames && S.freeGames[0];
    const covers = sortedGames().slice(0, 3).map((g) => g.art.cover).filter(Boolean);
    $('#games-hub').replaceChildren(
      hubCard({ kicker: 'Free right now', icon: 'gift', title: free ? free.name : 'Free Games', sub: free ? free.price : 'Giveaways from every store', bg: free && free.image, wide: true,
        onOpen: () => { showView('store'); Pages.store.focusFree(); } }),
      hubCard({ kicker: 'Downloads', icon: 'download', title: dl.text, sub: dl.progress != null ? `${Math.round(dl.progress * 100)}% complete` : 'Web downloads and torrents', onOpen: () => showView('downloads') }),
      hubCard({ kicker: 'Game Library', icon: 'library', title: `${S.games.length} games`, sub: 'Everything installed', covers, onOpen: () => showView('library') }),
      hubCard({ kicker: 'Install', icon: 'plus', title: 'Install a game from a file', sub: 'Installer, disc image or archive. PC5 adds it to Home.', onOpen: installFromFilePicker }),
      hubCard({ kicker: 'Tip', icon: 'mouse', title: 'Controller as a mouse', sub: `Hold ${glyph('share')} for 1 second, anywhere`, onOpen: () => api.setMouseMode(true) }),
    );
    $('#media-hub').replaceChildren(...(S.cfg.bookmarks || []).map((b) => hubCard({
      kicker: new URL(b.url).hostname.replace(/^www\./, ''), icon: 'globe', title: b.title, sub: 'Opens in the Web Browser', onOpen: () => Browser.open(b.url),
    })));
  }

  // Pressing down past Play slides the home screen up to show the hub (PS5-style).
  document.addEventListener('navfocus', (e) => {
    for (const home of document.querySelectorAll('.home')) {
      const inHub = home.contains(e.target) && Boolean(e.target.closest('.hub'));
      if (inHub) {
        const hub = home.querySelector('.hub');
        home.style.setProperty('--hub-shift', `${Math.max(0, hub.offsetTop - home.clientHeight * 0.42)}px`);
      }
      home.classList.toggle('hub-mode', inHub);
    }
  });

  async function wifiMenu() {
    let data;
    try { data = await api.wifiList(); } catch (err) { return toast(`Wi-Fi unavailable: ${err.message}`, 'alert'); }
    const bars = (s) => (s > 75 ? '▂▄▆█' : s > 50 ? '▂▄▆' : s > 25 ? '▂▄' : '▂');
    menu('Wi-Fi', [
      ...data.networks.map((n) => [
        `${n.ssid}   ${bars(n.signal)}${n.ssid === data.connected ? '   ✓ Connected' : ''}${/open/i.test(n.auth) ? '   · Open' : ''}`,
        async () => {
          let pwd = '';
          if (!/open/i.test(n.auth)) {
            pwd = await OSK.prompt({ title: `Password for ${n.ssid}`, password: true });
            if (pwd == null) return;
          }
          toast(`Connecting to ${n.ssid}…`, 'wifi');
          try { await api.wifiConnect(n.ssid, pwd, n.auth); toast(`Connected to ${n.ssid}`, 'wifi'); } catch (err) { toast(`Failed: ${err.message}`, 'alert'); }
        },
      ]),
      ['Refresh', wifiMenu],
    ]);
  }

  const describePad = (id) => (/0ce6|0df2|dualsense/i.test(id) ? 'DualSense (PS5)'
    : /054c|dualshock|wireless controller/i.test(id) ? 'DualShock 4 (PS4)' : /xbox|xinput|045e/i.test(id) ? 'Xbox controller' : 'Controller');

  function controllersMenu() {
    const pads = [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean);
    const describe = describePad;
    menu('Controllers', [
      ...pads.map((p, i) => [`${i + 1}. ${describe(p.id)}`, null, { desc: p.id }]),
      ['Pair a Bluetooth controller', pairController, { desc: 'PS5, PS4, Xbox and other wireless controllers' }],
      ['Controller as mouse', () => api.setMouseMode(true), { desc: `For Windows programs. Hold ${glyph('share')} for 1 second any time to switch.` }],
    ], {
      subtitle: `${pads.length ? `${pads.length} connected.` : 'None detected.'} USB controllers work as soon as they're plugged in.`
        + (S.env.inputHelper ? '' : ' The background controller service is not running.'),
    });
  }

  async function pairController() {
    const go = await confirm('Put your controller in pairing mode', 'Search', [
      'PS5 DualSense: hold Create + PS until the light bar flashes.',
      'PS4 DualShock 4: hold Share + PS until the light bar flashes.',
      'Xbox: hold the pair button on top until the Xbox button flashes.',
    ].join('  ·  '));
    if (!go) return;
    const done = busy('Searching for controllers…');
    let found = [];
    try { found = await api.btScan(); } catch (err) { done(); return toast(`Bluetooth search failed: ${err.message}`, 'alert'); }
    done();
    found = (found || []).sort((a, b) => b.controller - a.controller);
    menu('Choose your controller', [
      ...found.map((d) => [d.name, async () => {
        const stop = busy(`Pairing ${d.name}…`);
        try {
          const r = await api.btPair(d.id);
          stop();
          toast(/paired/i.test(r.status) ? `${d.name} paired` : `Pairing: ${r.status}`, 'gamepad');
        } catch (err) {
          stop();
          toast(`Pairing failed: ${err.message}`, 'alert');
        }
      }, { desc: d.controller ? 'Controller' : '' }]),
      ['Search again', pairController],
    ], { subtitle: found.length ? null : 'Nothing found. Make sure the light is flashing, then search again.' });
  }

  // ---------------------------------------------------------------- shared
  async function refreshGames() {
    S.games = await api.listGames();
    renderGames();
    renderHubs();
    if (S.view === 'library') Pages.library.render();
  }

  function goHome() {
    while (Nav.inModal()) Nav.back();
    $('#launch-overlay').hidden = true;
    if (Browser.active()) Browser.close();
    showView('games', { focus: false });
    Nav.focus($('#game-row [data-nav]'));
    setTimeout(firstRun, 900);
  }

  // First launch after Setup: ask once how PC5 should start.
  function firstRun() {
    if (S.cfg.setupDone || S.env.platform !== 'win32') return;
    const choose = (on) => async () => {
      try { await api.winset('setConsoleMode', on); } catch (err) { toast(err.message, 'alert'); }
      S.cfg = await api.setConfig({ setupDone: true });
      toast(on ? 'Done. PC5 starts the next time you sign in.' : 'Done. Open PC5 from the Start menu any time.', 'check');
    };
    menu('Welcome to PC5', [
      ['Console mode', choose(true), { desc: 'PC5 starts instead of the Windows desktop when you sign in, like a console. Recommended for a TV.' }],
      ['App mode', choose(false), { desc: 'Keep the normal Windows desktop and open PC5 from the Start menu or the desktop icon.' }],
    ], { subtitle: 'How should PC5 start? You can change this later in Settings → System.' });
  }

  function cycleTab(step) {
    const i = TABS.indexOf(S.lastTab);
    showView(TABS[(i + step + TABS.length) % TABS.length]);
  }

  const profileName = () => S.cfg.profileName || S.info.user || 'Player';
  function applyProfile() {
    const name = profileName();
    $('#avatar').textContent = name[0].toUpperCase();
    $('#splash-avatar').textContent = name[0].toUpperCase();
    $('#splash-name').textContent = name;
    const c = S.cfg.avatarColor;
    for (const el of [$('#avatar'), $('#splash-avatar')]) el.style.background = c ? `linear-gradient(140deg, ${c}, color-mix(in srgb, ${c} 55%, #8a5cff))` : '';
  }

  // A custom wallpaper: a picture, or a video that loops silently.
  function applyWallpaper(c) {
    const holder = $('#wallpaper');
    const file = c.background === 'wallpaper' ? c.wallpaper : '';
    if (holder.dataset.file === file) return;
    holder.dataset.file = file || '';
    if (!file) { holder.replaceChildren(); return; }
    const url = UI.fileUrl(file);
    holder.replaceChildren(/\.(mp4|webm|m4v|mov|mkv)$/i.test(file)
      ? h('video', { src: url, autoplay: true, muted: true, loop: true, playsinline: true })
      : h('img', { src: url, alt: '' }));
    const v = holder.querySelector('video');
    if (v) { v.muted = true; v.play().catch(() => {}); }
  }

  // Applies everything Settings controls.
  function applyPrefs() {
    const c = S.cfg;
    const root = document.documentElement;
    root.style.setProperty('--ui-scale', String(c.uiScale || 1));
    const theme = Themes.apply(c.theme || 'midnight');
    if (c.accent && c.accent !== 'auto') { root.style.setProperty('--accent', c.accent); root.style.setProperty('--dyn', c.accent); } else {
      root.style.removeProperty('--accent');
      if (!S.selectedTint) root.style.setProperty('--dyn', theme.accent[0]);
    }
    applyWallpaper(c);
    UI.configureSounds({ pack: c.soundPack, volume: c.uiVolume, custom: c.customSounds });
    Music.configure();
    document.body.classList.toggle('reduce-motion', Boolean(c.reduceMotion));
    document.body.classList.toggle('always-hints', Boolean(c.alwaysHints));
    document.body.classList.toggle('glyph-color', c.glyphColors === 'color');
    document.body.classList.toggle('calm-bg', c.background === 'calm');
    document.body.classList.toggle('wallpaper-bg', c.background === 'wallpaper' && Boolean(c.wallpaper));
    UI.setSounds(c.sounds);
    UI.setQuiet(c.notifications === false);
    applyProfile();
    updateGlyphs();
    tickClock();
    renderHints();
  }

  // ---------------------------------------------------------------- input routing
  let lastPadHome = 0;
  let lastFocusAt = 0;
  window.addEventListener('focus', () => { lastFocusAt = Date.now(); });

  // Startup particles: slow blue dust drifting toward the viewer (original effect).
  let particlesOn = true;
  function startParticles() {
    const canvas = $('#splash-particles');
    const ctx = canvas.getContext('2d');
    const dots = Array.from({ length: 140 }, () => ({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random() }));
    function frame() {
      if (!particlesOn) return;
      const w = (canvas.width = canvas.clientWidth);
      const hgt = (canvas.height = canvas.clientHeight);
      ctx.clearRect(0, 0, w, hgt);
      for (const d of dots) {
        d.z -= 0.0022;
        if (d.z <= 0.02) { d.x = Math.random() * 2 - 1; d.y = Math.random() * 2 - 1; d.z = 1; }
        const px = w / 2 + (d.x / d.z) * w * 0.35;
        const py = hgt / 2 + (d.y / d.z) * hgt * 0.35;
        const r = Math.max(0.4, (1 - d.z) * 2.6);
        ctx.beginPath();
        ctx.fillStyle = `rgba(${120 + 80 * (1 - d.z)}, ${170 + 60 * (1 - d.z)}, 255, ${Math.min(1, (1 - d.z) * 1.2)})`;
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
      requestAnimationFrame(frame);
    }
    frame();
  }

  // ---------------------------------------------------------------- music
  // Startup music plays on the welcome screen; Home music loops quietly while
  // PC5 is in front and pauses for games, apps, videos and the browser.
  const Music = {
    startup: null,
    home: null,
    playStartup() {
      const f = S.cfg.startupSound;
      if (!f || f === 'chime' || f === 'none') return;
      this.startup = new Audio(UI.fileUrl(f));
      this.startup.volume = (S.cfg.musicVolume ?? 35) / 100;
      this.startup.play().catch(() => {});
    },
    fadeStartup() {
      const a = this.startup;
      if (!a) return;
      this.startup = null;
      const step = a.volume / 20;
      const t = setInterval(() => { a.volume = Math.max(0, a.volume - step); if (a.volume <= 0.001) { clearInterval(t); a.pause(); } }, 90);
    },
    configure() {
      const f = S.cfg.homeMusic;
      if (!f) { if (this.home) { this.home.pause(); this.home = null; } return; }
      if (!this.home || this.home.dataset.file !== f) {
        if (this.home) this.home.pause();
        this.home = new Audio(UI.fileUrl(f));
        this.home.loop = true;
        this.home.dataset.file = f;
      }
      this.home.volume = (S.cfg.musicVolume ?? 35) / 100;
      this.update();
    },
    update() {
      if (!this.home) return;
      const quiet = S.splash || !document.hasFocus() || Viewer.active() || Browser.active() || !$('#launch-overlay').hidden;
      if (quiet) this.home.pause();
      else this.home.play().catch(() => {});
    },
  };
  window.addEventListener('blur', () => Music.update());
  window.addEventListener('focus', () => Music.update());
  setInterval(() => Music.update(), 2000);

  function dismissSplash() {
    S.splash = false;
    Music.fadeStartup();
    setTimeout(() => Music.update(), 1500);
    setTimeout(() => { particlesOn = false; }, 900);
    if ((S.cfg.startupSound || 'chime') === 'chime') sounds.startup();
    $('#splash').classList.add('gone');
    setTimeout(() => { $('#splash').hidden = true; }, 700);
    showView('games', { focus: false });
    Nav.focus($('#game-row [data-nav]'));
    setTimeout(firstRun, 900);
  }

  // First launch after Setup: ask once how PC5 should start.
  function firstRun() {
    if (S.cfg.setupDone || S.env.platform !== 'win32') return;
    const choose = (on) => async () => {
      try { await api.winset('setConsoleMode', on); } catch (err) { toast(err.message, 'alert'); }
      S.cfg = await api.setConfig({ setupDone: true });
      toast(on ? 'Done. PC5 starts the next time you sign in.' : 'Done. Open PC5 from the Start menu any time.', 'check');
    };
    menu('Welcome to PC5', [
      ['Console mode', choose(true), { desc: 'PC5 starts instead of the Windows desktop when you sign in, like a console. Recommended for a TV.' }],
      ['App mode', choose(false), { desc: 'Keep the normal Windows desktop and open PC5 from the Start menu or the desktop icon.' }],
    ], { subtitle: 'How should PC5 start? You can change this later in Settings → System.' });
  }

  Pad.on((action) => {
    if (S.splash) {
      if (['accept', 'home', 'menu'].includes(action) && !$('#splash-user').hidden) dismissSplash();
      return;
    }
    if (S.mouseMode) return; // the controller is driving the real mouse pointer
    if (action === 'home') lastPadHome = Date.now();
    const modal = Nav.topModal();
    if (modal) {
      const ev = new CustomEvent('padaction', { detail: action, cancelable: true });
      modal.dispatchEvent(ev);
      if (ev.defaultPrevented) return renderHints();
    }
    if (!modal && Viewer.active() && action !== 'home' && Viewer.handle(action)) return renderHints();
    if (!modal && Browser.active() && action !== 'home' && Browser.handle(action)) return renderHints();
    const el = Nav.current();
    switch (action) {
      case 'left': case 'right':
        if (el && el._adjust && !modal) { el._adjust(action === 'left' ? -1 : 1); break; }
        if (Nav.move(action)) sounds.move();
        break;
      case 'up': case 'down':
        if (Nav.move(action)) sounds.move();
        break;
      case 'accept':
        if (el) { sounds.select(); el.click(); }
        break;
      case 'back':
        sounds.back();
        if (Nav.back()) break;
        if (Pages[S.view] && Pages[S.view].onBack && Pages[S.view].onBack()) break;
        if (!TABS.includes(S.view)) showView(S.lastTab);
        else Nav.focusGroup($(`#view-${S.view} .tile-row`));
        break;
      case 'options': case 'menu':
        if (modal) break;
        if (el && el._options) el._options();
        else if (Pages[S.view] && Pages[S.view].options) Pages[S.view].options();
        break;
      case 'alt':
        if (!modal && el && el._alt) el._alt();
        break;
      case 'lb': if (!modal) cycleTab(-1); break;
      case 'rb': if (!modal) cycleTab(1); break;
      case 'home':
        if (modal && modal.classList.contains('bottom')) Nav.back();
        else controlCenter();
        break;
      default:
    }
    renderHints();
  });

  // HOME from the background controller service (PS/Guide pressed anywhere).
  api.onHome(() => {
    if (S.splash) return dismissSplash();
    const cameFromBackground = Date.now() - lastFocusAt < 1500;
    if (cameFromBackground) goHome();
    else if (Date.now() - lastPadHome > 500) Pad.emit('home'); // e.g. the Xbox Guide button, which browsers can't see
  });

  api.onInput((st) => {
    if ('pads' in st) S.pads = st.pads;
    if ('mouseMode' in st) {
      S.mouseMode = st.mouseMode;
      $('#mouse-banner').hidden = !st.mouseMode;
      if (st.mouseMode) Music.update();
      if (st.mouseMode) toast(`Mouse mode: left stick moves, ${glyph('accept')} clicks, ${glyph('alt')} right-clicks, ${glyph('options')} keyboard`, 'mouse');
    }
  });
  api.onToast((msg) => toast(msg));
  if (api.onCaptured) api.onCaptured((file) => { sounds.notify(); toast(`Screenshot saved (${file.split(/[\\/]/).pop()})`, 'camera'); });
  if (api.onLibraryChanged) api.onLibraryChanged(() => refreshGames());
  if (api.onGameAdded) api.onGameAdded(({ title, auto }) => { if (auto) { sounds.notify(); toast(`New game found: ${title}. It's on your Home screen.`, 'gamepad'); } });

  // ---------------------------------------------------------------- boot
  function tickClock() {
    $('#clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: !S.cfg.clock24 });
  }

  async function boot() {
    document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
    $('#btn-profile').addEventListener('click', profileMenu);
    $('#btn-search').addEventListener('click', storeSearch);
    $('#btn-downloads').addEventListener('click', () => showView('downloads'));
    $('#btn-store-search').addEventListener('click', storeSearch);
    $('#btn-store-web').addEventListener('click', () => Browser.bookmarks());
    $('#btn-open-bp').addEventListener('click', () => openUri('steam://open/bigpicture', 'Opening Steam Big Picture…'));
    $('#btn-open-epic').addEventListener('click', () => openUri('com.epicgames.launcher://store', 'Opening Epic Games…'));
    $('#btn-install-file').addEventListener('click', installFromFilePicker);
    $('#btn-add-game').addEventListener('click', async () => {
      const exe = await Files.pick({ filter: /\.exe$/i, title: 'Choose the game .exe' });
      if (exe) addGameFrom(exe);
    });
    $('#btn-rescan').addEventListener('click', async () => { await refreshGames(); toast('Library updated'); });
    // Mouse support (and mouse mode): hovering focuses, clicking activates.
    // Only after real movement, so a resting pointer doesn't steal focus
    // when a menu opens underneath it.
    let lastMove = 0;
    document.addEventListener('mousemove', () => { lastMove = Date.now(); });
    document.addEventListener('mouseover', (e) => {
      const target = e.target.closest('[data-nav]');
      if (target && Date.now() - lastMove < 100 && Nav.items().includes(target)) Nav.focus(target);
    });
    // Right-click = Options, click outside a menu = Back.
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const target = e.target.closest('[data-nav]');
      if (target && Nav.items().includes(target)) Nav.focus(target);
      Pad.emit('options');
    });
    document.addEventListener('mousedown', (e) => {
      if (e.button === 0 && e.target.classList.contains('modal') && !e.target.classList.contains('osk')) Pad.emit('back');
    });
    // Wheel: rows scroll sideways; on Home, down/up moves between the tiles and the cards.
    window.addEventListener('wheel', (e) => {
      const row = e.target.closest('.tile-row, .card-row, .hub-cards');
      if (row && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { row.scrollLeft += e.deltaY; e.preventDefault(); return; }
      const home = e.target.closest('.home');
      if (home && !Nav.inModal()) {
        e.preventDefault();
        const inHub = home.classList.contains('hub-mode');
        if (e.deltaY > 30 && !inHub) Nav.focus(home.querySelector('.hub [data-nav]'));
        else if (e.deltaY < -30 && inHub) Nav.focusGroup(home.querySelector('.tile-row'));
      }
    }, { passive: false });

    tickClock();
    setInterval(tickClock, 15000);
    [S.env, S.cfg, S.info] = await Promise.all([api.env(), api.getConfig(), api.systemInfo()]);
    applyPrefs();
    Downloads.init();
    Viewer.init();
    Perf.init();
    startParticles();
    api.giveaways().then((list) => { S.freeGames = list; renderHubs(); }).catch(() => {});
    renderMedia();
    await refreshGames();
    showView('games', { focus: false });
    renderHints();
    Music.playStartup();
    setTimeout(() => {
      $('#splash-logo').classList.add('up');
      $('#splash-user').hidden = false;
    }, 1400);
    // Pick up games installed while the shell is running.
    setInterval(() => { if (TABS.includes(S.view) && !Nav.inModal()) refreshGames(); }, 120000);
  }

  window.PC5 = {
    api, S, Pages, showView, refreshGames, addGameFrom, renderHints, renderMedia, renderHubs, glyph, goHome, launchApp,
    applyPrefs, profileName, describePad, wifiMenu, pairController, bootMenu, desktopMode, switchToWindows,
    installFlow, installFromFilePicker, sounds, screenshot, Music,
    openSettings(cat) { Settings.open(cat); showView('settings'); },
  };
  boot();
})();
