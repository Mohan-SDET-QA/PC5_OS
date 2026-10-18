// PC5 OS Installer: pick a Windows ISO, choose what to strip, choose where
// PC5 OS goes (a new partition next to Windows, a USB drive, or an ISO file),
// then watch the engine build it. See src/installer.js and windows/engine.
(function () {
  const api = window.pc5i;
  const GB = 1024 ** 3;
  const $ = (s) => document.querySelector(s);

  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
    return el;
  }
  const icon = (name) => Icon(name);
  const gb = (bytes) => `${Math.round(bytes / GB)} GB`;
  const tb = (bytes) => (bytes >= 1000 * GB ? `${(bytes / 1000 / GB).toFixed(bytes >= 10000 * GB ? 0 : 1)} TB` : gb(bytes));

  const MODES = {
    partition: { title: 'Install next to Windows', short: 'Next to Windows', icon: 'drive', button: 'Install PC5 OS' },
    usb: { title: 'Make an install USB', short: 'Install USB', icon: 'download', button: 'Make the USB' },
    iso: { title: 'Save a PC5 OS ISO', short: 'ISO file', icon: 'archive', button: 'Create the ISO' },
  };
  const STEPS = [
    { id: 'windows', label: 'Windows' },
    { id: 'strip', label: 'Strip down' },
    { id: 'where', label: 'Where' },
    { id: 'account', label: 'Account' },
    { id: 'review', label: 'Review' },
  ];

  const S = {
    ctx: {}, catalog: null, engine: 'off', targets: null, targetsError: null, installs: [],
    mode: null, step: 0,
    iso: null, info: null, infoError: null, reading: false, imageIndex: null,
    preset: 'balanced', items: new Set(),
    where: null, sizeGB: 120, makeDefault: false, usbDisk: null, isoOut: null, bypass: false,
    userName: '', consent: false,
    plan: [], stepId: null, percent: 0, detail: '', log: [], started: 0, showLog: false, result: null, error: null, cancelled: false,
  };

  // ---------------------------------------------------------------- engine
  async function ensureEngine() {
    if (S.engine === 'ready') return true;
    S.engine = 'starting';
    render();
    const r = await api.start();
    if (!r || !r.ok) {
      S.engine = r && r.denied ? 'denied' : 'failed';
      S.engineError = (r && r.error) || 'The install engine did not start.';
      render();
      return false;
    }
    S.engine = 'ready';
    loadTargets();
    return true;
  }

  async function call(cmd, args) {
    const r = await api.call(cmd, args);
    if (!r.ok) throw Object.assign(new Error(r.error), { cancelled: r.cancelled });
    return r.data;
  }

  async function loadTargets() {
    try {
      S.targets = await call('targets');
      S.installs = S.targets.installs || [];
      if (!S.userName) S.userName = cleanName(S.targets.userName);
    } catch (err) { S.targetsError = err.message; }
    render();
  }

  function cleanName(n) {
    const v = String(n || '').replace(/[\\/[\]:;|=,+*?<>@"]/g, '').trim().slice(0, 20);
    return validName(v) ? v : 'Player';
  }
  function validName(n) {
    if (!n || n.length > 20 || /[\\/[\]:;|=,+*?<>@"]/.test(n) || n.endsWith('.') || n.trim() !== n) return false;
    return !['administrator', 'guest', 'defaultaccount', 'wdagutilityaccount', 'system', 'none'].includes(n.toLowerCase());
  }

  // ---------------------------------------------------------------- navigation
  function startMode(mode) {
    Object.assign(S, { mode, step: 0, where: null, usbDisk: null, consent: false, result: null, error: null });
    applyPreset(S.preset);
    render();
    ensureEngine();
  }
  function goHome() { S.mode = null; S.result = null; S.error = null; render(); }
  function go(step) { S.step = Math.max(0, Math.min(STEPS.length - 1, step)); S.consent = false; render(); $('#screen').focus(); }

  function canContinue() {
    switch (STEPS[S.step].id) {
      case 'windows': return Boolean(S.info && S.imageIndex);
      case 'strip': return true;
      case 'where':
        if (S.mode === 'partition') return Boolean(S.where && S.sizeGB >= minSize() && S.sizeGB <= maxSize() && firmwareOk());
        if (S.mode === 'usb') return S.usbDisk != null;
        return Boolean(S.isoOut);
      case 'account': return validName(S.userName);
      case 'review': return S.consent || S.mode === 'iso';
      default: return false;
    }
  }
  const firmwareOk = () => !S.targets || S.targets.firmware === 'UEFI';
  const minSize = () => (S.targets && S.targets.minSizeGB) || 40;
  function maxSize() {
    if (!S.where || !S.targets) return 0;
    if (S.where.kind === 'drive') return S.where.drive.maxSizeGB;
    return Math.floor(S.where.disk.largestFree / GB);
  }

  // ---------------------------------------------------------------- strip choices
  function applyPreset(name) {
    S.preset = name;
    if (name !== 'custom' && S.catalog) S.items = new Set(S.catalog.presets[name].items);
  }
  function allItems() { return S.catalog ? S.catalog.groups.flatMap((g) => g.items) : []; }

  // ---------------------------------------------------------------- screens
  function render() {
    const screen = $('#screen');
    const top = $('#top-right');
    top.replaceChildren(
      S.ctx.demo ? h('span', { class: 'pill' }, icon('info'), S.ctx.web ? 'Preview: nothing is installed' : 'Demo mode') : null,
      S.ctx.version ? h('span', {}, `Version ${S.ctx.version}`) : null,
    );
    if (S.result || S.error) return screen.replaceChildren(resultScreen());
    if (S.plan.length && !S.result && !S.error) return screen.replaceChildren(progressScreen());
    if (!S.mode) return screen.replaceChildren(homeScreen());
    if (S.engine === 'starting') return screen.replaceChildren(waiting('Waiting for permission', 'Windows asks once whether PC5 OS Installer may make changes. Choose Yes to continue.'));
    if (S.engine === 'denied' || S.engine === 'failed') {
      return screen.replaceChildren(h('div', { class: 'waiting fade-in' }, h('div', { class: 'r-ico' }, icon('alert')),
        h('h2', {}, S.engine === 'denied' ? 'PC5 OS Installer needs permission' : "The installer couldn't start"),
        h('p', {}, S.engine === 'denied' ? 'Installing Windows on a partition, a USB drive or an ISO needs administrator rights. Nothing has been changed.' : S.engineError),
        h('div', { class: 'r-actions', style: 'display:flex;gap:12px;margin-top:14px' },
          h('button', { class: 'btn', onclick: goHome }, 'Back'),
          h('button', { class: 'btn primary', onclick: () => { S.engine = 'off'; ensureEngine(); } }, 'Try again'))));
    }
    screen.replaceChildren(wizard());
  }

  function waiting(title, text) {
    return h('div', { class: 'waiting fade-in' }, h('div', { class: 'spin' }), h('h2', {}, title), h('p', {}, text));
  }

  function homeScreen() {
    const mode = (id, featured, tag, desc) => h('button', { class: `mode${featured ? ' featured' : ''}`, 'data-mode': id, onclick: () => startMode(id) },
      tag ? h('span', { class: 'tag' }, tag) : null,
      h('span', { class: 'm-ico' }, icon(MODES[id].icon)),
      h('h2', {}, MODES[id].title), h('p', {}, desc),
      h('span', { class: 'go' }, 'Start ', icon('forward')));
    const installs = (S.installs || []).filter(Boolean);
    return h('div', { class: 'home scroll fade-in' },
      h('h1', {}, 'Turn this PC into ', h('em', {}, 'a console.')),
      h('p', { class: 'lede' }, 'PC5 OS is Windows, stripped down, that starts straight into the PC5 console. Bring a Windows 10 or 11 ISO from Microsoft and the installer does the rest.'),
      h('div', { class: 'modes' },
        mode('partition', true, 'Recommended', 'PC5 OS gets its own partition. Each time the PC starts, pick PC5 OS or your usual Windows. Your files and apps stay as they are.'),
        mode('usb', false, '', 'A USB stick that installs PC5 OS on any PC, including one you want to use only as a console.'),
        mode('iso', false, '', 'A ready-made PC5 OS ISO for virtual machines, Ventoy, or burning to a USB stick later.')),
      h('div', { class: 'home-foot' },
        installs.length ? h('div', { class: 'installed' }, h('h3', {}, 'PC5 OS on this PC'),
          installs.map((i) => h('div', { class: 'inst-row' }, h('span', { class: 'm-ico' }, icon('drive')),
            h('div', { class: 'grow' }, h('b', {}, `PC5 OS${i.letter ? ` · drive ${i.letter}:` : ''}`), h('span', {}, `${i.sizeGB} GB · installed ${new Date(i.created).toLocaleDateString()}`)),
            h('button', { class: 'btn small primary', onclick: () => restartInto(i) }, icon('restart'), 'Restart into PC5 OS'),
            h('button', { class: 'btn small danger', onclick: () => removeInstall(i) }, icon('trash'), 'Remove')))) : h('div'),
        h('div', { class: 'side-links' },
          h('button', { class: 'btn link', onclick: () => api.openConsole() }, icon('play'), 'Preview the console on this PC'),
          h('button', { class: 'btn link', onclick: consoleModeDialog }, icon('desktop'), 'Use PC5 on this Windows instead'))));
  }

  function wizard() {
    const step = STEPS[S.step];
    const rail = h('nav', { class: 'rail' },
      h('div', { class: 'mode-title' }, MODES[S.mode].title),
      STEPS.map((s, i) => h('button', {
        class: `rail-step${i === S.step ? ' current' : ''}${i < S.step ? ' done' : ''}`,
        disabled: i > S.step, onclick: () => go(i), 'aria-current': i === S.step ? 'step' : null,
      }, h('span', { class: 'num' }, i < S.step ? icon('check') : String(i + 1)), s.label)),
      h('button', { class: 'btn link back-home', onclick: goHome }, icon('back'), 'Start over'));
    const body = { windows: stepWindows, strip: stepStrip, where: stepWhere, account: stepAccount, review: stepReview }[step.id]();
    const isLast = S.step === STEPS.length - 1;
    const foot = h('div', { class: 'pane-foot' },
      h('div', { class: 'hint' }, footHint()),
      h('div', { style: 'display:flex;gap:10px' },
        S.step > 0 ? h('button', { class: 'btn', onclick: () => go(S.step - 1) }, 'Back') : null,
        isLast
          ? h('button', { class: 'btn primary', id: 'btn-build', disabled: !canContinue() || !S.ctx.canBuild, onclick: build }, MODES[S.mode].button)
          : h('button', { class: 'btn primary', id: 'btn-next', disabled: !canContinue(), onclick: () => go(S.step + 1) }, 'Continue', icon('forward'))));
    return h('div', { class: 'wizard fade-in' }, rail, h('section', { class: 'pane' }, h('div', { class: 'pane-body scroll' }, body), foot));
  }

  function footHint() {
    const id = STEPS[S.step].id;
    if (id === 'windows' && S.reading) return 'Reading the Windows image…';
    if (id === 'strip') return `${countRemovals()} items selected`;
    if (id === 'review' && !S.ctx.canBuild) return 'Build the app first (npm run dist): the PC5 files to install are missing.';
    return '';
  }
  function countRemovals() { return S.items.size; }

  // ---- step 1: Windows
  function stepWindows() {
    const drop = h('div', { class: `drop${S.dragOver ? ' over' : ''}`, id: 'drop' },
      h('div', { class: 'd-ico' }, icon(S.info ? 'check' : 'archive')),
      h('div', { class: 'grow' },
        h('b', {}, S.iso ? fileName(S.iso) : 'Drop your Windows ISO here'),
        h('div', { class: 'path' }, S.iso ? S.iso : 'Windows 10 or 11, 64-bit, the original ISO from Microsoft')),
      h('button', { class: 'btn', id: 'btn-browse', onclick: browseIso }, S.iso ? 'Change…' : 'Browse…'));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); if (!S.dragOver) { S.dragOver = true; drop.classList.add('over'); } });
    drop.addEventListener('dragleave', () => { S.dragOver = false; drop.classList.remove('over'); });
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      S.dragOver = false;
      const f = e.dataTransfer.files[0];
      if (f) readIso(api.pathForFile(f));
    });
    const parts = [
      h('h2', {}, 'Which Windows?'),
      h('p', { class: 'sub' }, 'PC5 OS is built from your own copy of Windows, so it stays a genuine Windows that gets updates and activates with your licence.'),
      drop,
      h('div', { class: 'get-win' }, "Don't have one? ", h('button', { onclick: () => api.getWindows() }, 'Download the Windows 11 ISO from Microsoft'), ' (free; choose "Download Windows 11 Disk Image (ISO)").'),
    ];
    if (S.reading) parts.push(h('div', { class: 'note' }, h('span', { class: 'spin' }), 'Reading the editions in this image…'));
    if (S.infoError) parts.push(h('div', { class: 'note danger' }, h('span', { class: 'n-ico' }, icon('alert')), S.infoError));
    if (S.info) {
      parts.push(h('div', { class: 'section-label' }, 'Edition'));
      parts.push(h('div', { class: 'grid' }, S.info.images.map((img) => {
        const ok = img.arch === 'x64' || img.arch === 'arm64';
        return h('button', { class: `choice${S.imageIndex === img.index ? ' sel' : ''}`, disabled: !ok, onclick: () => { S.imageIndex = img.index; render(); } },
          /Pro$/.test(img.name) ? h('span', { class: 'badge' }, 'Best for gaming PCs') : null,
          h('b', {}, img.name), h('span', { class: 'meta' }, `Build ${img.build || img.version} · ${img.arch} · ${gb(img.size)} installed`),
          ok ? null : h('span', { class: 'why' }, 'Not for 64-bit PCs'));
      })));
      parts.push(h('div', { class: 'note' }, h('span', { class: 'n-ico' }, icon('info')), 'Pick the edition your Windows licence is for. On a PC that already runs Windows 10 or 11, the same edition activates on its own.'));
    }
    return parts;
  }

  async function browseIso() {
    const p = await api.pickIso();
    if (p) readIso(p);
  }
  async function readIso(path) {
    Object.assign(S, { iso: path, info: null, infoError: null, imageIndex: null, reading: true });
    render();
    if (!(await ensureEngine())) return;
    try {
      S.info = await call('info', { iso: path });
      const x64 = S.info.images.filter((i) => i.arch === 'x64' || i.arch === 'arm64');
      const pick = x64.find((i) => /Pro$/.test(i.name)) || x64.find((i) => /Pro/.test(i.name)) || x64[0];
      S.imageIndex = pick ? pick.index : null;
    } catch (err) { S.infoError = err.message; }
    S.reading = false;
    render();
  }
  const fileName = (p) => String(p).split(/[\\/]/).pop();

  // ---- step 2: strip down
  function stepStrip() {
    const presets = S.catalog.presets;
    const seg = h('div', { class: 'segmented', role: 'radiogroup' },
      [...Object.keys(presets), 'custom'].map((k) => h('button', {
        class: S.preset === k ? 'sel' : '', role: 'radio', 'aria-checked': String(S.preset === k), 'data-preset': k,
        onclick: () => { applyPreset(k); render(); },
      }, k === 'custom' ? 'Custom' : presets[k].title)));
    const desc = S.preset === 'custom' ? 'Your own selection.' : presets[S.preset].desc;
    return [
      h('h2', {}, 'Strip it down'),
      h('p', { class: 'sub' }, 'Choose what PC5 OS leaves out. Everything here can be reinstalled later from the Microsoft Store or Windows Settings.'),
      seg, h('p', { class: 'preset-desc' }, desc),
      S.catalog.groups.map((g) => h('div', { class: 'group' }, h('h3', {}, g.title), h('div', { class: 'checks' }, g.items.map((it) => {
        const input = h('input', { type: 'checkbox', checked: S.items.has(it.id), 'data-item': it.id });
        input.addEventListener('change', () => {
          if (input.checked) S.items.add(it.id); else S.items.delete(it.id);
          S.preset = matchPreset();
          render();
        });
        return h('label', { class: 'check' }, input, h('span', { class: 'box' }),
          h('span', {}, h('div', { class: 't' }, it.title), it.desc ? h('div', { class: 'd' }, it.desc) : null, it.warn ? h('div', { class: 'w' }, it.warn) : null));
      })))),
    ];
  }
  function matchPreset() {
    for (const [k, p] of Object.entries(S.catalog.presets)) {
      if (p.items.length === S.items.size && p.items.every((i) => S.items.has(i))) return k;
    }
    return 'custom';
  }

  // ---- step 3: where
  function stepWhere() {
    if (!S.targets) {
      if (S.targetsError) return [h('h2', {}, 'Where'), h('div', { class: 'note danger' }, h('span', { class: 'n-ico' }, icon('alert')), S.targetsError)];
      return [h('h2', {}, 'Where'), h('div', { class: 'note' }, h('span', { class: 'spin' }), 'Looking at the drives in this PC…')];
    }
    if (S.mode === 'usb') return whereUsb();
    if (S.mode === 'iso') return whereIso();
    return wherePartition();
  }

  function wherePartition() {
    const t = S.targets;
    const out = [h('h2', {}, 'Where should PC5 OS go?'),
      h('p', { class: 'sub' }, 'PC5 OS takes free space from one of your drives and becomes its own partition. Nothing on the drive is deleted.')];
    if (t.firmware !== 'UEFI') {
      out.push(h('div', { class: 'note danger' }, h('span', { class: 'n-ico' }, icon('alert')), h('span', {}, h('b', {}, 'This PC starts in legacy BIOS mode. '), 'Installing next to Windows needs UEFI. Make an install USB instead, or switch the PC to UEFI in its firmware settings.')));
      return out;
    }
    const cards = [];
    for (const d of t.drives) {
      const sel = S.where && S.where.kind === 'drive' && S.where.drive.letter === d.letter;
      cards.push(h('button', {
        class: `choice${sel ? ' sel' : ''}`, disabled: !d.usable, 'data-drive': d.letter,
        onclick: () => { S.where = { kind: 'drive', drive: d }; S.sizeGB = clampSize(S.sizeGB); render(); },
      }, d.isSystem ? h('span', { class: 'badge' }, 'Windows') : null,
      h('b', {}, `Drive ${d.letter}:${d.label ? ` · ${d.label}` : ''}`),
      h('span', { class: 'meta' }, `${tb(d.free)} free of ${tb(d.size)} · ${d.diskName}`),
      d.usable ? h('span', { class: 'meta' }, `PC5 OS can use up to ${d.maxSizeGB} GB`) : h('span', { class: 'why' }, d.reason)));
    }
    for (const disk of t.disks.filter((x) => x.freeUsable)) {
      const sel = S.where && S.where.kind === 'free' && S.where.disk.number === disk.number;
      cards.push(h('button', {
        class: `choice${sel ? ' sel' : ''}`, 'data-free': disk.number,
        onclick: () => { S.where = { kind: 'free', disk }; S.sizeGB = clampSize(S.sizeGB); render(); },
      }, h('span', { class: 'badge' }, 'Unused space'), h('b', {}, `Free space on disk ${disk.number}`), h('span', { class: 'meta' }, `${gb(disk.largestFree)} not in any partition · ${disk.name}`)));
    }
    out.push(h('div', { class: 'grid' }, cards));
    if (!S.where) return out;

    const max = maxSize();
    const min = minSize();
    const slider = h('input', { type: 'range', min, max, step: 5, value: S.sizeGB, 'aria-label': 'PC5 OS size in GB', id: 'size' });
    const setFill = () => slider.style.setProperty('--fill', `${((S.sizeGB - min) / Math.max(1, max - min)) * 100}%`);
    setFill();
    slider.addEventListener('input', () => {
      S.sizeGB = Number(slider.value);
      setFill();
      $('#size-val').firstChild.textContent = String(S.sizeGB);
      const bar = $('#disk-bar');
      if (bar) bar.replaceWith(diskBar());
    });
    out.push(h('div', { class: 'section-label' }, 'Size'),
      h('div', { class: 'size-row' }, h('div', { class: 'val', id: 'size-val' }, String(S.sizeGB), h('small', {}, 'GB')), slider),
      h('div', { class: 'size-scale' }, h('span', {}, `${min} GB minimum`), h('span', {}, `${max} GB maximum`)),
      diskBar(),
      h('div', { class: 'disk-legend' }, h('span', {}, '■ Your Windows and files'), h('span', { style: 'color:#9fb6ff' }, '■ PC5 OS')),
      h('div', { class: 'note' }, h('span', { class: 'n-ico' }, icon('info')), h('span', {}, 'Windows itself needs about 25 GB. Games go here too, so ', h('b', {}, '150 GB or more'), ' is comfortable. Games on your other drives also work.')));
    if (S.where.kind === 'drive' && S.where.drive.bitlocker) {
      out.push(h('div', { class: 'note warn' }, h('span', { class: 'n-ico' }, icon('alert')), h('span', {}, h('b', {}, 'BitLocker is on for this drive. '), 'The installer pauses it for the next two restarts so the boot change does not ask for your recovery key. Keep your recovery key at hand anyway.')));
    }
    const def = h('input', { type: 'checkbox', checked: S.makeDefault, id: 'make-default' });
    def.addEventListener('change', () => { S.makeDefault = def.checked; });
    out.push(h('label', { class: 'toggle-row' }, h('span', {}, h('div', { class: 't' }, 'Start PC5 OS by default'), h('div', { class: 'd' }, 'When the PC turns on, a menu offers PC5 OS and Windows for 5 seconds, then starts the default.')), def, h('span', { class: 'switch' })));
    return out;
  }
  function clampSize(v) {
    const max = maxSize();
    const want = v || 150;
    return Math.max(minSize(), Math.min(max, Math.round(Math.min(want, Math.max(minSize(), max)) / 5) * 5));
  }

  // The disk as it will look: the source drive shrinks and PC5 OS appears after it.
  function diskBar() {
    const t = S.targets;
    const w = S.where;
    const disk = t.disks.find((d) => d.number === (w.kind === 'drive' ? w.drive.diskNumber : w.disk.number));
    if (!disk) return h('div', { id: 'disk-bar' });
    const segs = [];
    const size = S.sizeGB * GB;
    const parts = disk.partitions.slice().sort((a, b) => a.offset - b.offset);
    let pos = 0;
    let freeUsed = false;
    for (const p of parts) {
      if (p.offset - pos > GB) segs.push(seg('p-free', p.offset - pos, '', ''));
      if (w.kind === 'drive' && p.letter === w.drive.letter) {
        segs.push(seg('p-win', p.size - size, `${p.letter}:`, tb(p.size - size)));
        segs.push(seg('p-pc5', size, 'PC5 OS', `${S.sizeGB} GB`));
      } else {
        segs.push(seg(p.letter ? 'p-win' : 'p-sys', p.size, p.letter ? `${p.letter}:` : '', p.letter ? tb(p.size) : ''));
      }
      pos = p.offset + p.size;
    }
    if (disk.size - pos > GB) {
      if (w.kind === 'free' && !freeUsed) {
        segs.push(seg('p-pc5', size, 'PC5 OS', `${S.sizeGB} GB`));
        if (disk.size - pos - size > GB) segs.push(seg('p-free', disk.size - pos - size, '', ''));
        freeUsed = true;
      } else segs.push(seg('p-free', disk.size - pos, 'Free', ''));
    }
    function seg(cls, bytes, name, sub) {
      return h('div', { class: cls, style: `flex-grow:${Math.max(bytes, disk.size * 0.004)}`, title: `${name} ${sub}`.trim() }, name ? h('b', {}, name) : null, sub ? h('span', {}, sub) : null);
    }
    return h('div', { class: 'disk-bar', id: 'disk-bar', 'aria-hidden': 'true' }, segs);
  }

  function whereUsb() {
    const t = S.targets;
    const out = [h('h2', {}, 'Which USB drive?'), h('p', { class: 'sub' }, 'The USB drive becomes a PC5 OS installer. Start any PC from it to install PC5 OS there.')];
    if (!t.usb.length) {
      out.push(h('div', { class: 'note' }, h('span', { class: 'n-ico' }, icon('info')), 'Plug in a USB drive of 8 GB or more, then refresh.'),
        h('button', { class: 'btn', style: 'margin-top:14px', onclick: () => { S.targets = null; render(); loadTargets(); } }, icon('refresh'), 'Refresh'));
      return out;
    }
    out.push(h('div', { class: 'grid' }, t.usb.map((u) => h('button', {
      class: `choice${S.usbDisk === u.number ? ' sel' : ''}`, disabled: !u.usable, 'data-usb': u.number,
      onclick: () => { S.usbDisk = u.number; render(); },
    }, h('b', {}, u.name), h('span', { class: 'meta' }, `${gb(u.size)}${u.letters.length ? ` · ${u.letters.join(' ')}` : ''}`), u.usable ? null : h('span', { class: 'why' }, 'Too small: needs 8 GB')))));
    out.push(h('div', { class: 'note danger' }, h('span', { class: 'n-ico' }, icon('alert')), h('span', {}, h('b', {}, 'Everything on the USB drive is erased. '), 'Copy off anything you want to keep first.')));
    out.push(bypassToggle());
    return out;
  }

  function whereIso() {
    const out = [h('h2', {}, 'Where to save the ISO?'), h('p', { class: 'sub' }, 'The ISO starts the PC5 OS installer in a virtual machine, from Ventoy, or once written to a USB drive.')];
    out.push(h('div', { class: 'drop' }, h('div', { class: 'd-ico' }, icon('archive')),
      h('div', { class: 'grow' }, h('b', {}, S.isoOut ? fileName(S.isoOut) : 'PC5-OS.iso'), h('div', { class: 'path' }, S.isoOut || 'Choose a folder with about 8 GB free')),
      h('button', { class: 'btn', id: 'btn-iso-out', onclick: async () => { const p = await api.pickIsoOut(); if (p) { S.isoOut = p; render(); } } }, S.isoOut ? 'Change…' : 'Choose…')));
    out.push(bypassToggle());
    return out;
  }

  function bypassToggle() {
    const box = h('input', { type: 'checkbox', checked: S.bypass, id: 'bypass' });
    box.addEventListener('change', () => { S.bypass = box.checked; });
    return h('label', { class: 'toggle-row' }, h('span', {}, h('div', { class: 't' }, 'Allow PCs without TPM 2.0 or Secure Boot'), h('div', { class: 'd' }, 'Lets Windows 11 install on older gaming PCs that Microsoft does not officially support.')), box, h('span', { class: 'switch' }));
  }

  // ---- step 4: account
  function stepAccount() {
    const input = h('input', { id: 'user', value: S.userName, maxlength: 20, autocomplete: 'off', spellcheck: 'false' });
    const err = h('div', { class: 'err' }, S.userName && !validName(S.userName) ? 'Up to 20 letters, numbers or spaces; not a name Windows reserves.' : '');
    input.addEventListener('input', () => {
      S.userName = input.value;
      err.textContent = S.userName && !validName(S.userName) ? 'Up to 20 letters, numbers or spaces; not a name Windows reserves.' : '';
      const next = $('#btn-next');
      if (next) next.disabled = !canContinue();
    });
    const t = S.targets || {};
    return [
      h('h2', {}, 'Your console account'),
      h('p', { class: 'sub' }, 'PC5 OS signs in to this account by itself, with no password, like a console. You can add a password or a Microsoft account later in Windows settings.'),
      h('div', { class: 'field' }, h('label', { for: 'user' }, 'Player name'), input, err),
      h('dl', { class: 'facts' },
        h('dt', {}, 'Language and region'), h('dd', {}, t.locale || 'Same as this PC'),
        h('dt', {}, 'Time zone'), h('dd', {}, t.timeZone || 'Same as this PC')),
    ];
  }

  // ---- step 5: review
  function stepReview() {
    const img = S.info.images.find((i) => i.index === S.imageIndex);
    const row = (k, v, sub, stepIdx) => h('div', { class: 'row' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v, sub ? h('small', {}, sub) : null),
      stepIdx != null ? h('button', { class: 'btn link small', onclick: () => go(stepIdx) }, 'Change') : h('span'));
    let where;
    let consentText = null;
    if (S.mode === 'partition') {
      if (S.where.kind === 'drive') {
        where = row('Where', `New ${S.sizeGB} GB partition on disk ${S.where.drive.diskNumber}`, `Drive ${S.where.drive.letter}: shrinks from ${tb(S.where.drive.size)} to ${tb(S.where.drive.size - S.sizeGB * GB)}. Nothing on it is deleted.`, 2);
        consentText = `I understand drive ${S.where.drive.letter}: will give up ${S.sizeGB} GB, and the PC's boot menu will list PC5 OS. I have a backup of anything important.`;
      } else {
        where = row('Where', `New ${S.sizeGB} GB partition on disk ${S.where.disk.number}`, 'Uses space that is not in any partition.', 2);
        consentText = `I understand a ${S.sizeGB} GB partition is created on disk ${S.where.disk.number} and the PC's boot menu will list PC5 OS.`;
      }
    } else if (S.mode === 'usb') {
      const u = S.targets.usb.find((x) => x.number === S.usbDisk);
      where = row('USB drive', u.name, `${gb(u.size)}. Everything on it is erased.`, 2);
      consentText = `I understand everything on ${u.name} (${gb(u.size)}) will be erased.`;
    } else where = row('Save as', fileName(S.isoOut), S.isoOut, 2);
    const consent = h('input', { type: 'checkbox', checked: S.consent, id: 'consent' });
    consent.addEventListener('change', () => { S.consent = consent.checked; $('#btn-build').disabled = !canContinue() || !S.ctx.canBuild; });
    return [
      h('h2', {}, 'Ready'),
      h('p', { class: 'sub' }, S.mode === 'partition' ? 'This takes 15 to 30 minutes. You can keep using the PC meanwhile.' : 'This takes 20 to 40 minutes and about 15 GB of temporary space.'),
      h('div', { class: 'summary' },
        row('Windows', img.name, `Build ${img.build || img.version} · ${fileName(S.iso)}`, 0),
        row('Stripped', S.preset === 'custom' ? 'Custom' : S.catalog.presets[S.preset].title, `${countRemovals()} items`, 1),
        where,
        S.mode === 'partition' ? row('At start-up', S.makeDefault ? 'PC5 OS starts by default' : 'Windows starts by default', 'A menu offers both for 5 seconds', 2) : row('Older PCs', S.bypass ? 'Allowed (no TPM 2.0 check)' : 'Windows 11 requirements apply', null, 2),
        row('Account', S.userName, 'Signs in automatically', 3)),
      consentText ? h('label', { class: 'confirm' }, consent, h('span', {}, consentText)) : null,
    ];
  }

  // ---------------------------------------------------------------- build
  async function build() {
    if (!canContinue()) return;
    const spec = {
      target: S.mode, iso: S.iso, imageIndex: S.imageIndex, items: [...S.items], userName: S.userName,
      locale: (S.targets && S.targets.locale) || 'en-US', timeZone: (S.targets && S.targets.timeZone) || 'Pacific Standard Time',
      bypassChecks: S.bypass,
    };
    if (S.mode === 'partition') {
      spec.partition = S.where.kind === 'drive'
        ? { mode: 'shrink', driveLetter: S.where.drive.letter, sizeGB: S.sizeGB, makeDefault: S.makeDefault }
        : { mode: 'free', diskNumber: S.where.disk.number, sizeGB: S.sizeGB, makeDefault: S.makeDefault };
    }
    if (S.mode === 'usb') spec.usb = { diskNumber: S.usbDisk };
    if (S.mode === 'iso') spec.isoOut = S.isoOut;
    Object.assign(S, { plan: [{ id: 'start', label: 'Starting' }], stepId: 'start', percent: 0, detail: '', log: [], started: Date.now(), result: null, error: null, cancelled: false, doneSteps: new Set() });
    render();
    try {
      S.result = await call('build', { spec });
    } catch (err) {
      S.error = err.message;
      S.cancelled = Boolean(err.cancelled) || /cancel/i.test(err.message);
    }
    render();
    if (S.result && S.result.target === 'partition') loadTargets();
  }

  api.onEvent((ev) => {
    if (!S.plan.length) return;
    switch (ev.kind) {
      case 'plan': S.plan = ev.steps; break;
      case 'step':
        if (S.stepId) S.doneSteps.add(S.stepId);
        S.stepId = ev.id; S.detail = ''; S.percent = ev.percent; break;
      case 'progress': S.percent = ev.percent; if (ev.detail != null) S.detail = ev.detail; break;
      case 'log': S.log.push(ev); if (S.log.length > 600) S.log.shift(); break;
      default: break;
    }
    updateProgress();
  });

  function progressScreen() {
    const title = { partition: 'Installing PC5 OS', usb: 'Making your PC5 OS USB', iso: 'Creating the PC5 OS ISO' }[S.mode];
    return h('div', { class: 'progress-screen fade-in' },
      h('div', { class: 'big' },
        h('div', { class: 'eyebrow' }, title),
        h('div', { class: 'pct', id: 'pct' }, '0', h('small', {}, '%')),
        h('div', { class: 'bar' }, h('div', { id: 'bar', style: 'width:0%' })),
        h('div', { class: 'now', id: 'now' }, 'Starting'),
        h('div', { class: 'now-detail', id: 'now-detail' }),
        h('div', { class: 'timing' }, h('span', {}, 'Elapsed ', h('b', { id: 'elapsed' }, '0:00')), h('span', {}, 'Remaining ', h('b', { id: 'remaining' }, 'estimating…'))),
        h('div', { class: 'p-actions' }, h('button', { class: 'btn', id: 'btn-cancel', onclick: confirmCancel }, 'Cancel'))),
      h('aside', { class: 'steps-card' }, h('h3', {}, 'Steps'), h('ol', { class: 'steplist', id: 'steplist' }),
        h('div', { class: 'log-toggle' }, h('button', { class: 'btn link small', id: 'btn-log', onclick: () => { S.showLog = !S.showLog; updateProgress(); } }, S.showLog ? 'Hide details' : 'Show details')),
        h('div', { class: 'log', id: 'log', hidden: !S.showLog })));
  }

  function updateProgress() {
    const pct = $('#pct');
    if (!pct) return;
    pct.firstChild.textContent = String(Math.floor(S.percent));
    $('#bar').style.width = `${S.percent}%`;
    const cur = S.plan.find((s) => s.id === S.stepId);
    $('#now').textContent = cur ? cur.label : 'Starting';
    $('#now-detail').textContent = S.detail || '';
    $('#steplist').replaceChildren(...S.plan.map((s) => {
      const state = S.doneSteps.has(s.id) ? 'done' : s.id === S.stepId ? 'active' : '';
      return h('li', { class: state }, h('span', { class: 's-ico' }, state === 'done' ? icon('check') : state === 'active' ? h('span', { class: 'spin' }) : h('span', { class: 'dot' })), s.label);
    }));
    const log = $('#log');
    log.hidden = !S.showLog;
    $('#btn-log').textContent = S.showLog ? 'Hide details' : 'Show details';
    if (S.showLog) {
      log.replaceChildren(...S.log.slice(-300).map((l) => h('div', { class: `l-${l.level}` }, l.text)));
      log.scrollTop = log.scrollHeight;
    }
  }

  setInterval(() => {
    if (!$('#elapsed') || !S.started) return;
    const secs = (Date.now() - S.started) / 1000;
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    $('#elapsed').textContent = fmt(secs);
    $('#remaining').textContent = S.percent > 3 && secs > 20 ? `about ${Math.max(1, Math.round((secs * (100 - S.percent)) / S.percent / 60))} min` : 'estimating…';
  }, 1000);

  function modal(title, text, actions) {
    const root = $('#modal-root');
    const close = () => root.replaceChildren();
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'box' }, h('h3', {}, title), h('p', {}, text),
      h('div', { class: 'acts' }, actions.map(([label, cls, fn]) => h('button', { class: `btn ${cls}`, onclick: () => { close(); if (fn) fn(); } }, label)))));
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    root.replaceChildren(box);
    box.querySelector('.btn:last-child').focus();
  }
  function confirmCancel() {
    modal('Stop?', 'The installer stops and puts everything back the way it was.', [['Keep going', ''], ['Stop', 'danger', () => { api.cancel(); $('#btn-cancel').disabled = true; $('#now-detail').textContent = 'Stopping and undoing changes…'; }]]);
  }

  function resultScreen() {
    if (S.error) {
      const back = () => { S.plan = []; S.error = null; render(); };
      return h('div', { class: 'result bad fade-in' }, h('div', { class: 'r-ico' }, icon(S.cancelled ? 'info' : 'alert')),
        h('h2', {}, S.cancelled ? 'Stopped' : 'That didn’t work'),
        h('p', {}, S.cancelled ? 'Everything was put back the way it was.' : 'The installer undid its changes. Your Windows and files are as they were.'),
        S.cancelled ? null : h('div', { class: 'err-box' }, S.error),
        h('div', { class: 'r-actions' },
          h('button', { class: 'btn', onclick: () => { S.plan = []; S.error = null; goHome(); } }, 'Start over'),
          S.cancelled ? null : h('button', { class: 'btn', onclick: () => navigator.clipboard.writeText(`${S.error}\n\n${S.log.map((l) => l.text).join('\n')}`) }, icon('copy'), 'Copy details'),
          h('button', { class: 'btn primary', onclick: back }, 'Back to review')));
    }
    const r = S.result;
    const finish = () => { S.plan = []; S.result = null; goHome(); };
    if (r.target === 'partition') {
      return h('div', { class: 'result fade-in' }, h('div', { class: 'r-ico' }, icon('check')),
        h('h2', {}, 'PC5 OS is installed'),
        h('p', {}, `It's on its own ${r.sizeGB} GB partition${r.letter ? ` (drive ${r.letter}:)` : ''}, with ${r.removed} apps and features left out.`),
        h('ol', {},
          h('li', {}, 'Restart. The boot menu shows ', h('b', {}, 'PC5 OS'), ' and ', h('b', {}, 'Windows'), '.'),
          h('li', {}, 'The first start takes a few minutes while Windows sets itself up, then PC5 opens by itself.'),
          h('li', {}, 'Back in this Windows any time: PC5 → Settings → System → Restart into another OS.')),
        h('div', { class: 'r-actions' },
          h('button', { class: 'btn', onclick: finish }, 'Later'),
          r.entryId ? h('button', { class: 'btn primary', onclick: () => restartInto({ entryId: r.entryId }) }, icon('restart'), 'Restart into PC5 OS') : null));
    }
    if (r.target === 'usb') {
      return h('div', { class: 'result fade-in' }, h('div', { class: 'r-ico' }, icon('check')),
        h('h2', {}, 'Your USB drive is ready'),
        h('ol', {},
          h('li', {}, 'Plug it into the PC that should run PC5 OS and turn the PC on.'),
          h('li', {}, 'Open its boot menu (usually ', h('b', {}, 'F12'), ', ', h('b', {}, 'F11'), ' or ', h('b', {}, 'Esc'), ' right after power-on) and choose the USB drive.'),
          h('li', {}, 'Pick the disk or partition for PC5 OS. Everything after that is automatic.')),
        h('div', { class: 'r-actions' }, h('button', { class: 'btn primary', onclick: finish }, 'Done')));
    }
    return h('div', { class: 'result fade-in' }, h('div', { class: 'r-ico' }, icon('check')),
      h('h2', {}, 'Your PC5 OS ISO is ready'), h('p', {}, r.output),
      h('div', { class: 'r-actions' }, h('button', { class: 'btn', onclick: finish }, 'Done'), h('button', { class: 'btn primary', onclick: () => api.showFile(r.output) }, icon('folder'), 'Show in folder')));
  }

  // ---------------------------------------------------------------- installed copies
  async function restartInto(i) {
    modal('Restart into PC5 OS?', 'Save your work first. The PC restarts in a few seconds and starts PC5 OS once; after that the boot menu works as usual.', [['Cancel', ''], ['Restart', 'primary', async () => {
      if (!(await ensureEngine())) return;
      try { await call('restart', { entryId: i.entryId }); } catch (err) { modal("Couldn't restart", err.message, [['OK', 'primary']]); }
    }]]);
  }
  async function removeInstall(i) {
    modal('Remove PC5 OS?', `PC5 OS, its partition and everything on it are deleted, and the space goes back to drive ${i.sourceLetter || 'it came from'}${i.sourceLetter ? ':' : ''}.`, [['Cancel', ''], ['Remove', 'danger', async () => {
      if (!(await ensureEngine())) return;
      try { await call('remove', { entryId: i.entryId }); await loadTargets(); } catch (err) { modal("Couldn't remove it", err.message, [['OK', 'primary']]); }
      render();
    }]]);
  }
  async function consoleModeDialog() {
    const on = await api.consoleMode();
    modal(on ? 'PC5 replaces the desktop' : 'Use PC5 on this Windows?',
      on ? 'This Windows starts PC5 instead of the desktop when you sign in. Turn that off to get the normal desktop back.' : 'Without installing PC5 OS, this Windows can start PC5 instead of the desktop when you sign in. Nothing is stripped, and you can switch back in PC5 Settings → System.',
      on ? [['Keep', ''], ['Turn off', 'danger', () => api.consoleMode(false)]] : [['Cancel', ''], ['Use PC5 at sign-in', 'primary', () => api.consoleMode(true)]]);
  }

  // ---------------------------------------------------------------- start
  (async () => {
    [S.ctx, S.catalog] = await Promise.all([api.context(), api.catalog()]);
    applyPreset('balanced');
    const local = await api.installs();
    if (local) S.installs = local;
    render();
  })();
  window.PC5Installer = { S, render, startMode, readIso, go };
})();
