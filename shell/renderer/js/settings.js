// Settings: categories on the left, live controls on the right. Every row
// does something: toggles flip, sliders move with left/right (or the mouse),
// pickers open a list, actions run.
(function () {
  const { $, h, toast, menu, confirm, busy, fmtBytes } = UI;
  const api = () => window.pc5;
  const cfg = () => PC5.S.cfg;
  let active = 'network';
  let renderToken = 0;

  async function setCfg(patch) {
    PC5.S.cfg = await api().setConfig(patch);
    PC5.applyPrefs();
  }

  // ---------------------------------------------------------------- row builders
  function row({ label, desc, value, control, onClick, cls = '', nav = true }) {
    const el = h('button', { class: `set-row ${cls}`, nav, onclick: onClick || null },
      h('div', { class: 'set-main' }, h('div', { class: 'label' }, label), desc ? h('div', { class: 'desc' }, desc) : null),
      value != null ? h('div', { class: 'value' }, value) : null,
      control || null);
    return el;
  }

  const section = (title) => h('div', { class: 'set-section' }, title);

  function toggle(label, desc, on, set) {
    const sw = h('span', { class: `switch${on ? ' on' : ''}` });
    return row({
      label, desc, control: sw,
      onClick: async () => {
        sw.classList.toggle('on');
        try { await set(sw.classList.contains('on')); } catch (err) { toast(err.message, 'alert'); }
      },
    });
  }

  // value 0..max; onChange is debounced so dragging doesn't spam Windows.
  function slider(label, { value, min = 0, max = 100, step = 5, format = (v) => `${v}%`, onChange, desc }) {
    let v = value;
    const fill = h('div', { class: 'fill' });
    const knob = h('div', { class: 'knob' });
    const track = h('div', { class: 'slider' }, fill, knob);
    const out = h('span', { class: 'slider-value' });
    let timer = null;
    const paint = () => {
      const pct = ((v - min) / (max - min)) * 100;
      fill.style.width = `${pct}%`;
      knob.style.left = `${pct}%`;
      out.textContent = format(v);
    };
    const set = (next) => {
      v = Math.max(min, Math.min(max, Math.round(next / step) * step));
      paint();
      clearTimeout(timer);
      timer = setTimeout(() => Promise.resolve(onChange(v)).catch((err) => toast(err.message, 'alert')), 180);
    };
    track.addEventListener('mousedown', (e) => {
      const r = track.getBoundingClientRect();
      const move = (ev) => set(min + ((ev.clientX - r.left) / r.width) * (max - min));
      move(e);
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
    const el = row({ label, desc, control: h('div', { class: 'value' }, track, out), cls: 'has-slider' });
    el._adjust = (dir) => { set(v + dir * step); PC5.sounds.move(); };
    el.addEventListener('wheel', (e) => { e.preventDefault(); el._adjust(e.deltaY < 0 ? 1 : -1); }, { passive: false });
    paint();
    return el;
  }

  // options: [{ label, value, desc }]
  function choice(label, desc, current, options, onPick) {
    const cur = options.find((o) => o.value === current);
    return row({
      label, desc, value: [cur ? cur.label : '—', Icon('back')].map((x, i) => (i ? h('span', { class: 'chev' }, x) : x)),
      onClick: () => {
        const el = menu(label, options.map((o) => [o.label, async () => {
          try { await onPick(o.value); } catch (err) { toast(err.message, 'alert'); }
          renderPanel(true);
        }, { desc: o.desc, cls: o.value === current ? 'selected' : '' }]));
        el.querySelectorAll('.setting').forEach((b, i) => { b.append(h('span', { class: 'check' }, Icon('check'))); if (options[i].value === current) Nav.focus(b); });
      },
    });
  }

  const action = (label, desc, fn, cls = '') => row({ label, desc, control: h('span', { class: 'chev' }, Icon('back')), onClick: fn, cls });
  const info = (label, value) => row({ label, value, cls: 'info' });

  // ---------------------------------------------------------------- categories
  const CATEGORIES = [
    { id: 'network', icon: 'wifi', title: 'Network', desc: 'Wi-Fi and your internet connection', build: buildNetwork },
    { id: 'sound', icon: 'volume', title: 'Sound', desc: 'Volume and where sound plays', build: buildSound },
    { id: 'display', icon: 'desktop', title: 'Screen and Video', desc: 'Resolution, refresh rate and interface size', build: buildDisplay },
    { id: 'controllers', icon: 'gamepad', title: 'Controllers', desc: 'Pairing, button prompts and mouse mode', build: buildControllers },
    { id: 'library', icon: 'library', title: 'Game Library', desc: 'Where PC5 looks for games', build: buildLibrary },
    { id: 'storage', icon: 'drive', title: 'Storage and Downloads', desc: 'Drives, download and game folders', build: buildStorage },
    { id: 'appearance', icon: 'palette', title: 'Themes', desc: 'Theme, wallpaper, accent colour and clock', build: buildAppearance },
    { id: 'audio', icon: 'music', title: 'Sounds and Music', desc: 'Navigation tones, startup music and Home music', build: buildAudio },
    { id: 'performance', icon: 'activity', title: 'Performance', desc: 'In-game overlay and screenshots', build: buildPerformance },
    { id: 'accessibility', icon: 'eye', title: 'Accessibility', desc: 'Text size, motion and hints', build: buildAccessibility },
    { id: 'notifications', icon: 'bell', title: 'Notifications', desc: 'Pop-ups and sound effects', build: buildNotifications },
    { id: 'power', icon: 'moon', title: 'Power Saving', desc: 'Rest mode and screen timers', build: buildPower },
    { id: 'time', icon: 'clock', title: 'Date and Time', desc: 'Time zone and clock format', build: buildTime },
    { id: 'profile', icon: 'user', title: 'Profile', desc: 'Your name and avatar', build: buildProfile },
    { id: 'system', icon: 'chip', title: 'System', desc: 'About this PC, updates and Windows', build: buildSystem },
  ];

  async function buildNetwork() {
    let wifi = { connected: null, networks: [] };
    try { wifi = await api().wifiList(); } catch { /* no Wi-Fi adapter */ }
    return [
      info('Connection', wifi.connected ? `Wi-Fi · ${wifi.connected}` : 'Wired or not connected'),
      action('Wi-Fi networks', `${wifi.networks.length} nearby`, () => PC5.wifiMenu()),
      action('Test internet connection', 'Checks that the store and downloads can reach the internet', async () => {
        const stop = busy('Testing your connection…');
        try { await api().steamSearch('portal'); stop(); toast('You are online', 'check'); } catch { stop(); toast('No internet connection', 'alert'); }
      }),
    ];
  }

  async function buildSound() {
    const [vol, devices] = await Promise.all([api().winset('getVolume').catch(() => null), api().winset('audioDevices').catch(() => [])]);
    const rows = [];
    if (vol) {
      rows.push(slider('Volume', { value: vol.volume, onChange: (v) => api().winset('setVolume', v) }));
      rows.push(toggle('Mute', null, vol.muted, () => api().winset('toggleMute')));
    } else {
      rows.push(info('Volume', 'Unavailable (PC5System.exe missing)'));
    }
    if (devices.length) {
      const cur = (devices.find((d) => d.default) || devices[0]).id;
      rows.push(choice('Output device', 'TV, speakers or headphones', cur, devices.map((d) => ({ label: d.name, value: d.id })), (id) => api().winset('setAudioDevice', id)));
    }
    rows.push(section('PC5'));
    rows.push(toggle('Navigation sounds', 'Soft clicks when moving around', cfg().sounds, (on) => setCfg({ sounds: on })));
    return rows;
  }

  async function buildDisplay() {
    const [disp, bright] = await Promise.all([api().winset('getDisplay').catch(() => null), api().winset('getBrightness').catch(() => null)]);
    const rows = [];
    if (disp) {
      const sizes = [...new Map(disp.modes.map((m) => [`${m.width}x${m.height}`, m])).values()].sort((a, b) => b.width * b.height - a.width * a.height);
      rows.push(choice('Resolution', null, `${disp.width}x${disp.height}`, sizes.map((m) => ({ label: `${m.width} × ${m.height}`, value: `${m.width}x${m.height}` })), async (val) => {
        const [w, hh] = val.split('x').map(Number);
        const hz = Math.max(...disp.modes.filter((m) => m.width === w && m.height === hh).map((m) => m.hz));
        await changeDisplay(disp, w, hh, hz);
      }));
      const rates = disp.modes.filter((m) => m.width === disp.width && m.height === disp.height).map((m) => m.hz).sort((a, b) => b - a);
      rows.push(choice('Refresh rate', 'Higher is smoother in games', disp.hz, [...new Set(rates)].map((hz) => ({ label: `${hz} Hz`, value: hz })), (hz) => changeDisplay(disp, disp.width, disp.height, hz)));
    } else {
      rows.push(info('Resolution', 'Unavailable (PC5System.exe missing)'));
    }
    if (bright != null) rows.push(slider('Brightness', { value: bright, onChange: (v) => api().winset('setBrightness', v) }));
    rows.push(section('PC5'));
    rows.push(slider('Interface size', { value: Math.round((cfg().uiScale || 1) * 100), min: 80, max: 130, step: 5, onChange: (v) => setCfg({ uiScale: v / 100 }) }));
    return rows;
  }

  // Applies a display mode, then reverts unless the user confirms within 15 s.
  async function changeDisplay(prev, w, hh, hz) {
    await api().winset('setDisplay', w, hh, hz);
    const keep = await new Promise((resolve) => {
      let left = 15;
      let done = false;
      let el = null;
      let timer = null;
      const finish = (value) => {
        if (done) return;
        done = true;
        clearInterval(timer);
        if (el && el.isConnected) Nav.closeModal(el);
        resolve(value);
      };
      el = menu('Keep this display setting?', [['Keep', () => finish(true)], ['Revert', () => finish(false)]], { subtitle: `Reverting in ${left} seconds` });
      timer = setInterval(() => {
        left -= 1;
        const sub = el.querySelector('.sub');
        if (sub) sub.textContent = `Reverting in ${left} seconds`;
        if (left <= 0) finish(false);
      }, 1000);
    });
    if (!keep) await api().winset('setDisplay', prev.width, prev.height, prev.hz);
  }

  async function buildControllers() {
    const pads = [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean);
    return [
      ...(pads.length ? pads.map((p, i) => info(`Controller ${i + 1}`, PC5.describePad(p.id))) : [info('Connected', 'None. Plug one in with USB, or pair it below.')]),
      action('Pair a Bluetooth controller', 'PS5, PS4, Xbox and others', () => PC5.pairController()),
      action('Use the controller as a mouse', `Or hold ${PC5.glyph('share')} for 1 second, anywhere`, () => api().setMouseMode(true)),
      choice('Button prompts', 'Which symbols PC5 shows', cfg().glyphs || 'auto', [
        { label: 'Match my controller', value: 'auto' }, { label: 'PlayStation', value: 'ps' }, { label: 'Xbox', value: 'xbox' },
      ], async (v) => { await setCfg({ glyphs: v }); window.dispatchEvent(new Event('padtype')); }),
      choice('Button colours', 'How the button symbols look', cfg().glyphColors || 'mono', [
        { label: 'White, like the DualSense', value: 'mono' }, { label: 'Classic colours', value: 'color' },
      ], (v) => setCfg({ glyphColors: v })),
      toggle('Controller support for added games', 'Launch added and GOG games through Steam so PS controllers work', cfg().steamInputForAdded !== false, (on) => setCfg({ steamInputForAdded: on })),
    ];
  }

  async function buildLibrary() {
    const folders = await api().gameFolders();
    const hidden = (cfg().hiddenGames || []).length;
    return [
      action('Find new games now', 'Looks in your game folders for games you installed yourself', async () => {
        const found = await api().scanFolders();
        toast(found.length ? `Added ${found.length} game${found.length > 1 ? 's' : ''} to Home` : 'No new games found', found.length ? 'gamepad' : 'info');
      }),
      action('Rescan Steam, Epic and GOG', `${PC5.S.games.length} games now`, async () => { await PC5.refreshGames(); toast('Library updated'); renderPanel(true); }),
      action('Install a game from a file', '.exe, .msi, disc image (.iso) or archive', () => PC5.installFromFilePicker()),
      section('Game folders'),
      ...folders.map((f) => {
        const custom = (cfg().gameFolders || []).includes(f);
        return row({ label: f, desc: custom ? 'Added by you. Select to remove.' : 'Found automatically', control: h('span', { class: 'chev' }, Icon(custom ? 'trash' : 'folder')),
          onClick: custom ? async () => { await setCfg({ gameFolders: cfg().gameFolders.filter((x) => x !== f) }); renderPanel(true); } : null });
      }),
      action('Add a game folder', 'Games installed into it appear on Home by themselves', async () => {
        const dir = await Files.pick({ folder: true, title: 'Choose a folder with games in it' });
        if (dir) { await setCfg({ gameFolders: [...new Set([...(cfg().gameFolders || []), dir])] }); await api().scanFolders(); renderPanel(true); }
      }),
      section('Hidden'),
      action('Hidden games', hidden ? `${hidden} hidden. Select to show them again.` : 'None', async () => {
        await setCfg({ hiddenGames: [] }); await PC5.refreshGames(); renderPanel(true);
      }),
    ];
  }

  async function buildStorage() {
    const drives = await api().winset('drives');
    const pickFolder = (key, title) => async () => {
      const dir = await Files.pick({ folder: true, title });
      if (dir) { await setCfg({ [key]: dir }); renderPanel(true); }
    };
    return [
      ...drives.map((d) => {
        const pct = d.total ? d.used / d.total : 0;
        const el = row({ label: `Drive ${d.root}`, desc: `${fmtBytes(d.free)} free of ${fmtBytes(d.total)}`, cls: 'info',
          control: h('div', { class: 'drive' }, h('div', { class: 'bar' }, h('div', { class: 'fill', style: `width:${Math.round(pct * 100)}%` }))) });
        el.onclick = () => { PC5.showView('files', { focus: false }); Files.go(d.root); };
        return el;
      }),
      section('Folders'),
      action('Download folder', cfg().downloadDir || 'Downloads\\PC5 (default)', pickFolder('downloadDir', 'Where downloads are saved')),
      action('Games folder', cfg().gamesDir || 'C:\\Games (default)', pickFolder('gamesDir', 'Where archives are extracted')),
      toggle('Keep sharing finished torrents', 'Off keeps your upload free for online play', Boolean(cfg().torrentSeed), (on) => setCfg({ torrentSeed: on })),
    ];
  }

  const ACCENTS = [
    { label: 'Game colour (changes with the game)', value: 'auto', color: null },
    { label: 'Cobalt', value: '#2f7bff' }, { label: 'Violet', value: '#8a5cff' }, { label: 'Aqua', value: '#13c2c2' },
    { label: 'Ember', value: '#ff5a3c' }, { label: 'Gold', value: '#f0b429' }, { label: 'Rose', value: '#ff4f9a' }, { label: 'Silver', value: '#c9d1e0' },
  ];

  // A grid of theme cards; selecting one applies it immediately.
  function themeGrid() {
    const current = cfg().theme || 'midnight';
    return h('div', { class: 'theme-grid' }, Themes.list.map((t) => h('button', {
      class: `theme-card${t.id === current ? ' selected' : ''}`, nav: true,
      onclick: async () => { await setCfg({ theme: t.id }); renderPanel(true); },
    }, h('div', { class: 'theme-preview', style: `background:${Themes.preview(t)}` },
      h('span', { class: 'theme-dot', style: `background:${t.accent[0]}` }), h('span', { class: 'theme-dot', style: `background:${t.accent[1]}` }),
      t.id === current ? h('span', { class: 'theme-check' }, Icon('check')) : null),
    h('div', { class: 'theme-name' }, t.name), h('div', { class: 'theme-desc' }, t.desc))));
  }

  const MEDIA_IMAGE = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
  const MEDIA_VIDEO = /\.(mp4|webm|m4v|mov|mkv)$/i;
  const AUDIO = /\.(mp3|m4a|aac|flac|wav|ogg|opus)$/i;
  const fileName = (p) => (p ? p.split(/[\\/]/).pop() : '');

  async function buildAppearance() {
    const c = cfg();
    return [
      section('Theme'),
      themeGrid(),
      section('Background'),
      choice('Home background', null, c.background || 'art', [
        { label: 'Game art', value: 'art', desc: 'The selected game fills the screen' },
        { label: 'Calm', value: 'calm', desc: 'Only the theme’s moving colour glow' },
        { label: 'My wallpaper', value: 'wallpaper', desc: c.wallpaper ? fileName(c.wallpaper) : 'Choose a picture or video below first' },
      ], (v) => setCfg({ background: v })),
      action('Choose a wallpaper', c.wallpaper ? fileName(c.wallpaper) : 'A picture, or a video that loops silently', async () => {
        const f = await Files.pick({ filter: new RegExp(`${MEDIA_IMAGE.source}|${MEDIA_VIDEO.source}`, 'i'), title: 'Choose a picture or video', start: '' });
        if (f) { await setCfg({ wallpaper: f, background: 'wallpaper' }); renderPanel(true); }
      }),
      section('Colour'),
      choice('Accent colour', 'Glow, focus light and background tint', c.accent || 'auto', ACCENTS, (v) => setCfg({ accent: v })),
      toggle('24-hour clock', null, Boolean(c.clock24), (on) => setCfg({ clock24: on })),
    ];
  }

  async function buildAudio() {
    const c = cfg();
    const packs = [...UI.soundPacks().map((p) => ({ label: p.name, value: p.id })), { label: 'My own sounds', value: 'custom', desc: 'Choose files below' }, { label: 'Off', value: 'off' }];
    const pickAudio = async (title) => Files.pick({ filter: AUDIO, title });
    const customRow = (kind, label) => action(label, (c.customSounds || {})[kind] ? fileName(c.customSounds[kind]) : 'Not set (uses the Classic tone)', async () => {
      const f = await pickAudio(`Choose a sound for “${label}”`);
      if (f) { await setCfg({ customSounds: { ...(c.customSounds || {}), [kind]: f }, soundPack: 'custom' }); UI.playFile(f); renderPanel(true); }
    });
    return [
      section('Navigation tones'),
      choice('Tone pack', 'The sounds when you move and select', c.soundPack || 'classic', packs, async (v) => {
        await setCfg({ soundPack: v, sounds: v !== 'off' ? true : c.sounds });
        if (v !== 'off') UI.previewSound(v, 'select');
      }),
      slider('Tone volume', { value: c.uiVolume ?? 60, onChange: (v) => { setCfg({ uiVolume: v }); UI.sounds.move(); } }),
      customRow('move', 'My move sound'), customRow('select', 'My select sound'), customRow('back', 'My back sound'),
      section('Music'),
      choice('Startup sound', 'Plays on the welcome screen', ['chime', 'none'].includes(c.startupSound || 'chime') ? (c.startupSound || 'chime') : 'file', [
        { label: 'PC5 chime', value: 'chime' }, { label: 'None', value: 'none' },
        { label: c.startupSound && !['chime', 'none'].includes(c.startupSound) ? `My music: ${fileName(c.startupSound)}` : 'Choose my own music…', value: 'file' },
      ], async (v) => {
        if (v !== 'file') return setCfg({ startupSound: v });
        const f = await pickAudio('Choose startup music');
        if (f) await setCfg({ startupSound: f });
      }),
      action('Home music', c.homeMusic ? fileName(c.homeMusic) : 'Off. Choose a song to loop quietly on Home.', () => {
        const choose = async () => {
          const f = await pickAudio('Choose Home music');
          if (f) { await setCfg({ homeMusic: f }); renderPanel(true); }
        };
        if (!c.homeMusic) return choose();
        menu('Home music', [
          ['Choose another song', choose],
          ['Turn off Home music', async () => { await setCfg({ homeMusic: '' }); renderPanel(true); }],
        ], { subtitle: fileName(c.homeMusic) });
      }),
      slider('Music volume', { value: c.musicVolume ?? 35, onChange: (v) => setCfg({ musicVolume: v }) }),
    ];
  }

  async function buildPerformance() {
    const c = cfg();
    return [
      action('Open Performance', 'Live CPU, GPU, memory, temperatures, network and a task manager', () => PC5.showView('perf')),
      toggle('Performance overlay', 'Small stats panel on top of your games', Boolean(c.overlay), async (on) => {
        await setCfg({ overlay: on });
        await api().setOverlay({ on, position: cfg().overlayPosition });
      }),
      choice('Overlay position', null, c.overlayPosition || 'top-right', [
        { label: 'Top right', value: 'top-right' }, { label: 'Top left', value: 'top-left' },
        { label: 'Bottom right', value: 'bottom-right' }, { label: 'Bottom left', value: 'bottom-left' },
      ], async (v) => { await setCfg({ overlayPosition: v }); if (cfg().overlay) await api().setOverlay({ on: true, position: v }); }),
      section('Captures'),
      toggle(`${PC5.glyph('share')} button takes a screenshot`, 'A quick press, anywhere (hold it for mouse mode)', Boolean(c.captureOnShare), (on) => setCfg({ captureOnShare: on })),
      action('Take a screenshot now', null, () => PC5.screenshot()),
      action('Open captures', 'Pictures › PC5 Captures', () => { PC5.showView('files', { focus: false }); Files.goPlace('Pictures', 'PC5 Captures'); }),
    ];
  }

  async function buildAccessibility() {
    return [
      slider('Interface size', { value: Math.round((cfg().uiScale || 1) * 100), min: 80, max: 130, step: 5, onChange: (v) => setCfg({ uiScale: v / 100 }) }),
      toggle('Reduce motion', 'Fewer animations and no background drift', Boolean(cfg().reduceMotion), (on) => setCfg({ reduceMotion: on })),
      toggle('Always show button hints', 'Also on the Home screen', Boolean(cfg().alwaysHints), (on) => setCfg({ alwaysHints: on })),
    ];
  }

  async function buildNotifications() {
    return [
      toggle('Show notifications', 'Downloads, new games and tips', cfg().notifications !== false, (on) => setCfg({ notifications: on })),
      toggle('Navigation sounds', null, cfg().sounds, (on) => setCfg({ sounds: on })),
    ];
  }

  async function buildPower() {
    const p = await api().winset('getPower');
    const opts = (list) => list.map((m) => ({ label: m ? (m < 60 ? `After ${m} minutes` : `After ${m / 60} hour${m > 60 ? 's' : ''}`) : 'Never', value: m }));
    return [
      choice('Enter Rest Mode', 'When nothing is happening', p.sleep, opts([0, 15, 30, 60, 120, 180]), (v) => api().winset('setPower', 'sleep', v)),
      choice('Turn off the screen', null, p.screenOff, opts([0, 5, 10, 15, 30, 60]), (v) => api().winset('setPower', 'screenOff', v)),
      section('Now'),
      action('Enter Rest Mode now', null, () => api().power('sleep')),
      action('Restart', null, () => api().power('restart')),
      action('Turn off', null, () => api().power('shutdown')),
    ];
  }

  async function buildTime() {
    const [zones, tz] = await Promise.all([api().winset('timeZones'), api().winset('getTimeZone')]);
    return [
      info('Time', new Date().toLocaleString([], { dateStyle: 'full', timeStyle: 'short' })),
      choice('Time zone', null, tz, zones.map((z) => ({ label: z.name, value: z.id })), (id) => api().winset('setTimeZone', id)),
      toggle('24-hour clock', null, Boolean(cfg().clock24), (on) => setCfg({ clock24: on })),
    ];
  }

  async function buildProfile() {
    const COLORS = ['#3d7bff', '#8a5cff', '#13c2c2', '#ff5a3c', '#f0b429', '#ff4f9a', '#3ccf6e'];
    return [
      action('Name', PC5.profileName(), async () => {
        const name = await OSK.prompt({ title: 'Your name', value: PC5.profileName() });
        if (name) { await setCfg({ profileName: name }); renderPanel(true); }
      }),
      choice('Avatar colour', null, cfg().avatarColor || COLORS[0], COLORS.map((c, i) => ({ label: ['Cobalt', 'Violet', 'Aqua', 'Ember', 'Gold', 'Rose', 'Jade'][i], value: c })), (v) => setCfg({ avatarColor: v })),
    ];
  }

  async function buildSystem() {
    const [d, consoleMode] = await Promise.all([api().winset('systemDetails'), api().winset('getConsoleMode').catch(() => false)]);
    return [
      info('Windows', d.os), info('Processor', `${d.cpu} · ${d.threads} threads`), info('Graphics', d.gpu), info('Memory', d.memory), info('PC5', `Version ${d.pc5}`),
      section('Start-up'),
      toggle('Console mode', 'Start PC5 instead of the Windows desktop when you sign in. Off: open PC5 like any other app.', Boolean(consoleMode), async (on) => {
        try {
          await api().winset('setConsoleMode', on);
          toast(on ? 'PC5 starts when you sign in' : 'Windows starts normally. Open PC5 from the Start menu.');
        } catch (err) { toast(err.message, 'alert'); renderPanel(true); }
      }),
      section('Windows'),
      action('Windows Update', 'Opens Windows Update (the controller works as a mouse)', async () => { await api().openUri('ms-settings:windowsupdate'); api().setMouseMode(true); }),
      action('Desktop Mode', 'The Windows desktop now. Press PS to come back.', () => PC5.desktopMode()),
      action('Switch to Windows', 'Sign out and use normal Windows. A “Return to PC5” icon goes on the desktop.', () => PC5.switchToWindows()),
      action('Restart into another OS', 'Dual boot', () => PC5.bootMenu()),
      action('Exit PC5', 'Close PC5 (Windows keeps running)', async () => { if (await confirm('Exit PC5?', 'Exit')) api().quitShell(); }, 'danger'),
    ];
  }

  // ---------------------------------------------------------------- rendering
  function renderCats() {
    const list = $('#set-cats');
    list.replaceChildren(...CATEGORIES.map((c) => {
      const b = h('button', { class: `set-cat${c.id === active ? ' active' : ''}`, nav: true, 'data-cat': c.id, onclick: () => focusPanel(),
        onnavfocus: () => { if (active !== c.id) { active = c.id; markActive(); renderPanel(); } } },
      Icon(c.icon), c.title);
      return b;
    }));
  }

  function markActive() {
    document.querySelectorAll('.set-cat').forEach((b) => b.classList.toggle('active', b.dataset.cat === active));
  }

  function focusPanel() {
    const first = $('#set-panel [data-nav]');
    if (first) Nav.focus(first);
  }

  // keep: re-render in place and keep focus on the same row.
  async function renderPanel(keep = false) {
    const token = ++renderToken;
    const cat = CATEGORIES.find((c) => c.id === active);
    const panel = $('#set-panel');
    const cur = Nav.current();
    const rows = [...panel.querySelectorAll('[data-nav]')];
    const keepIndex = keep && panel.contains(cur) ? rows.indexOf(cur) : -1;
    const head = h('div', { class: 'set-head' }, h('span', { class: 'row-icon' }, Icon(cat.icon)),
      h('div', {}, h('h3', {}, cat.title), h('p', {}, cat.desc)));
    if (!keep) panel.replaceChildren(head, h('div', { class: 'set-items' }, h('p', { class: 'muted loading-line' }, h('span', { class: 'spinner small' }), 'Loading…')));
    let items;
    try {
      items = await cat.build();
    } catch (err) {
      items = [info('Unavailable', err.message)];
    }
    if (token !== renderToken || PC5.S.view !== 'settings') return;
    const scroller = panel.querySelector('.set-items');
    const scrollTop = keep && scroller ? scroller.scrollTop : 0;
    // A nav group whose first row is the default, so stepping right from the
    // category list always lands on the first control.
    const body = h('div', { class: 'set-items', 'data-nav-group': `set-${cat.id}` }, items);
    const first = body.querySelector('[data-nav]');
    if (first) first.dataset.navDefault = '';
    panel.replaceChildren(head, body);
    body.scrollTop = scrollTop;
    if (keepIndex >= 0) {
      const again = panel.querySelectorAll('[data-nav]')[keepIndex];
      if (again && !Nav.inModal()) Nav.focus(again);
    }
  }

  window.Settings = {
    page: {
      async render() {
        renderCats();
        await renderPanel();
      },
      focusTarget: () => $(`#set-cats [data-cat="${active}"]`),
      onBack() {
        const cur = Nav.current();
        if (cur && $('#set-panel').contains(cur)) { Nav.focus($(`#set-cats [data-cat="${active}"]`)); return true; }
        return false;
      },
      hints: () => {
        const cur = Nav.current();
        if (cur && cur._adjust) return [['left', 'Adjust'], ['back', 'Back'], ['home', 'Control Center']];
        return [['accept', 'Select'], ['back', 'Back'], ['home', 'Control Center']];
      },
    },
    open(id) { active = id; },
  };
})();
