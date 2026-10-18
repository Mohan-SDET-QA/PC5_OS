// Downloads page: web downloads and torrents, with one-press actions to
// install, extract and add what you downloaded to the Game Library.
(function () {
  const { $, h, toast, sounds, menu, confirm, busy, fmtBytes } = UI;
  const api = () => window.pc5;
  const ARCHIVE = /\.(zip|7z|rar|tar|gz|tgz|xz|bz2)$/i;
  const INSTALLER = /\.(exe|msi)$/i;
  let items = [];
  const known = new Set();

  const isActive = (i) => ['downloading', 'starting'].includes(i.state);
  const pct = (i) => (i.total ? Math.min(100, Math.floor((i.received / i.total) * 100)) : 0);

  function statusText(i) {
    switch (i.state) {
      case 'starting': return 'Connecting to peers…';
      case 'downloading': {
        const parts = [`${pct(i)}%`, i.total ? `${fmtBytes(i.received)} of ${fmtBytes(i.total)}` : fmtBytes(i.received), `${fmtBytes(i.speed)}/s`];
        if (i.kind === 'torrent') parts.push(`${i.peers || 0} peers`);
        return parts.join(' · ');
      }
      case 'paused': return `Paused · ${pct(i)}%`;
      case 'done': return `Complete · ${fmtBytes(i.total)}`;
      case 'seeding': return `Complete · sharing at ${fmtBytes(i.speed)}/s`;
      case 'interrupted': return 'Interrupted. Select to retry.';
      case 'failed': return `Failed: ${i.error || 'unknown error'}`;
      default: return i.state;
    }
  }

  function update(list) {
    for (const i of list) {
      if (!known.has(i.id)) {
        known.add(i.id);
        toast(`Downloading ${i.name}`, i.kind === 'torrent' ? 'magnet' : 'download');
      }
    }
    items = list;
    const active = items.filter(isActive).length;
    const badge = $('#dl-badge');
    badge.hidden = !active;
    badge.textContent = active;
    if (window.PC5 && PC5.S.view === 'downloads') render();
    if (window.PC5 && PC5.renderHubs) PC5.renderHubs();
  }

  function render() {
    const list = $('#dl-list');
    const cur = Nav.current();
    const focusId = cur && list.contains(cur) ? cur.dataset.id : null;
    if (!items.length) {
      list.replaceChildren(h('p', { class: 'muted empty' }, 'Nothing downloaded yet. Open the Web Browser and select a download link or torrent/magnet link.'));
      return;
    }
    const rows = items.map((i) => {
      const row = h('button', { class: `dl-row state-${i.state}`, nav: true, 'data-id': i.id, onclick: () => actions(i) },
        h('div', { class: 'dl-icon' }, Icon(i.kind === 'torrent' ? 'magnet' : 'download')),
        h('div', { class: 'dl-main' },
          h('div', { class: 'dl-name' }, i.name),
          h('div', { class: 'dl-status' }, statusText(i)),
          isActive(i) || i.state === 'paused' ? h('div', { class: 'bar' }, h('div', { class: 'fill', style: `width:${pct(i)}%` })) : null));
      row._options = () => actions(i);
      return row;
    });
    list.replaceChildren(...rows);
    if (focusId) {
      const again = list.querySelector(`[data-id="${focusId}"]`);
      if (again) Nav.focus(again);
    }
  }

  // Installers go through PC5's install flow, which adds the game to Home afterwards.
  const runInstaller = (file) => PC5.installFlow(file);

  async function extractAndAdd(file) {
    const done = busy('Extracting… large games can take a few minutes');
    let dest;
    try {
      dest = await api().files.extract(file);
    } catch (err) {
      done();
      return toast(`Couldn't extract: ${err.message}`, 'alert');
    }
    done();
    toast(`Extracted to ${dest}`, 'archive');
    const exes = await api().files.findExe(dest);
    const setup = exes.find((e) => /setup|install/i.test(e.name));
    if (setup && !exes.some((e) => e.likely)) {
      menu('This download contains an installer', [
        ['Run the installer', () => runInstaller(setup.path), { desc: 'Then add the installed game from Windows Apps or Files' }],
        ['Add a game from this folder anyway', () => PC5.addGameFrom(dest)],
      ]);
    } else {
      PC5.addGameFrom(dest);
    }
  }

  function showInFiles(i) {
    const file = i.file || '';
    const dir = i.kind === 'http' ? file.replace(/[\\/][^\\/]+$/, '') : i.dir;
    PC5.showView('files', { focus: false });
    Files.go(dir, file);
  }

  function actions(i) {
    const entries = [];
    const file = i.file || '';
    if (isActive(i)) entries.push(['Pause', () => api().downloads.pause(i.id)]);
    if (['paused', 'interrupted', 'failed'].includes(i.state)) entries.push([i.state === 'paused' ? 'Resume' : 'Retry', () => api().downloads.resume(i.id)]);
    if (['done', 'seeding'].includes(i.state)) {
      if (ARCHIVE.test(file)) entries.push(['Extract and add to Game Library', () => extractAndAdd(file), { desc: 'Unpacks it into your Games folder' }]);
      if (INSTALLER.test(file) || /\.iso$/i.test(file)) entries.push(['Install', () => runInstaller(file), { desc: 'PC5 runs the installer and adds the game to Home' }]);
      if (!ARCHIVE.test(file) && !INSTALLER.test(file) && !/\.torrent$/i.test(file)) entries.push(['Add game to Library', () => PC5.addGameFrom(file), { desc: 'Pick the .exe that starts the game' }]);
      if (INSTALLER.test(file)) entries.push(['Add to Game Library (no install needed)', () => PC5.addGameFrom(file)]);
      entries.push(['Show in Files', () => showInFiles(i)]);
      if (i.state === 'seeding') entries.push(['Stop sharing', () => api().downloads.pause(i.id)]);
    }
    entries.push(['Remove from list', () => api().downloads.remove(i.id, false), { desc: 'Keeps the files' }]);
    entries.push(['Delete', async () => {
      if (await confirm(`Delete ${i.name}?`, 'Delete', 'This removes the downloaded files.')) api().downloads.remove(i.id, true);
    }, { cls: 'danger' }]);
    menu(i.name, entries, { subtitle: statusText(i) });
  }

  async function addMagnet() {
    const link = await OSK.prompt({ title: 'Magnet link or .torrent web address' });
    if (!link) return;
    try { await api().downloads.addTorrent(link.trim()); } catch (err) { toast(err.message, 'alert'); }
  }

  async function addUrl() {
    const link = await OSK.prompt({ title: 'Download link (https://…)', value: 'https://' });
    if (!link) return;
    try { await api().downloads.addUrl(link.trim()); } catch (err) { toast(err.message, 'alert'); }
  }

  function init() {
    api().downloads.list().then((list) => { list.forEach((i) => known.add(i.id)); update(list); });
    api().onDownloads(update);
    api().onDownloadDone((rec) => {
      sounds.notify();
      toast(`Download complete: ${rec.name}`, 'check');
    });
    $('#btn-dl-browser').addEventListener('click', () => Browser.open());
    $('#btn-dl-magnet').addEventListener('click', addMagnet);
    $('#btn-dl-url').addEventListener('click', addUrl);
    $('#btn-dl-folder').addEventListener('click', () => { PC5.showView('files', { focus: false }); Files.goPlace('Downloads'); });
  }

  function summary() {
    const active = items.filter(isActive);
    if (active.length) {
      const total = active.reduce((n, i) => n + (i.total || 0), 0);
      const got = active.reduce((n, i) => n + (i.received || 0), 0);
      return { text: `${active[0].name}${active.length > 1 ? ` and ${active.length - 1} more` : ''} · ${statusText(active[0])}`, progress: total ? got / total : 0 };
    }
    if (items.length) return { text: 'All downloads complete', progress: null };
    return { text: 'No downloads', progress: null };
  }

  window.Downloads = {
    init,
    active: () => items.filter(isActive).length,
    summary,
    extractAndAdd,
    runInstaller,
    page: {
      render,
      focusTarget: () => $('#dl-list [data-nav]') || $('#btn-dl-browser'),
      hints: () => [['accept', 'Select'], ['back', 'Back'], ['options', 'Actions'], ['home', 'Control Center']],
    },
  };
})();
