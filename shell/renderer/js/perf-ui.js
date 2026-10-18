// Performance page: live stat tiles (value + sparkline + meter) and a
// controller-friendly task manager. Each tile is one series, so no legend; the
// line is the theme accent at 2px with a 10% wash. Thresholds use the status
// colours (warning / critical) and always come with a text label.
(function () {
  const { $, h, toast, confirm, fmtBytes, menu } = UI;
  const api = () => window.pc5;
  const STATUS = { warning: '#fab219', critical: '#d03b3b' };
  let snap = null;
  let off = null;
  let built = false;

  const pct = (v) => (v == null ? '—' : `${Math.round(v)}%`);
  const rate = (v) => `${fmtBytes(v || 0)}/s`;
  const temp = (v) => (v == null ? null : `${Math.round(v)}°C`);

  function tempStatus(t) {
    if (t == null) return null;
    if (t >= 85) return { color: STATUS.critical, label: 'Hot' };
    if (t >= 75) return { color: STATUS.warning, label: 'Warm' };
    return null;
  }
  function loadStatus(v) {
    if (v >= 95) return { color: STATUS.critical, label: 'Maxed out' };
    if (v >= 85) return { color: STATUS.warning, label: 'High' };
    return null;
  }

  // ---------------------------------------------------------------- sparkline (SVG)
  const W = 300;
  const H = 64;
  function sparkline(values, max) {
    const pts = values.map((v, i) => (v == null ? null : [(i / 59) * W, H - 2 - (Math.min(v, max) / max) * (H - 6)]));
    const line = pts.filter(Boolean).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const first = pts.find(Boolean);
    const last = [...pts].reverse().find(Boolean);
    const area = first ? `M${first[0]},${H} L${line.replace(/ /g, ' L')} L${last[0]},${H} Z` : '';
    return { line, area };
  }

  function tile(key, label, icon) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.classList.add('spark');
    svg.innerHTML = `<line class="grid" x1="0" x2="${W}" y1="${H - 1}" y2="${H - 1}"/><path class="area"/><polyline class="line"/><line class="cross" y1="0" y2="${H}" visibility="hidden"/><circle class="dot" r="4" visibility="hidden"/>`;
    const el = h('div', { class: 'perf-tile', 'data-key': key },
      h('div', { class: 'pt-head' }, h('span', { class: 'pt-icon' }, Icon(icon)), h('span', { class: 'pt-label' }, label), h('span', { class: 'pt-status' })),
      h('div', { class: 'pt-value' }, '—'),
      h('div', { class: 'pt-sub' }),
      h('div', { class: 'pt-meter', hidden: true }, h('div', { class: 'fill' })),
      svg,
      h('div', { class: 'pt-tip', hidden: true }));
    // Hover: crosshair + the value at that moment.
    svg.addEventListener('mousemove', (e) => {
      if (!snap) return;
      const r = svg.getBoundingClientRect();
      const i = Math.max(0, Math.min(59, Math.round(((e.clientX - r.left) / r.width) * 59)));
      const values = seriesFor(key).values;
      const n = values.length;
      const idx = i - (60 - n);
      const v = idx >= 0 ? values[idx] : null;
      const tip = el.querySelector('.pt-tip');
      const cross = svg.querySelector('.cross');
      const dot = svg.querySelector('.dot');
      if (v == null) { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); return; }
      const { max, fmt } = seriesFor(key);
      const x = (i / 59) * W;
      const y = H - 2 - (Math.min(v, max) / max) * (H - 6);
      cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('visibility', 'visible');
      const ago = Math.round((59 - i) * 1.5);
      tip.textContent = `${fmt(v)} · ${ago ? `${ago}s ago` : 'now'}`;
      tip.style.left = `${Math.min(r.width - 90, Math.max(0, e.clientX - r.left - 45))}px`;
      tip.hidden = false;
    });
    svg.addEventListener('mouseleave', () => {
      el.querySelector('.pt-tip').hidden = true;
      svg.querySelector('.cross').setAttribute('visibility', 'hidden');
      svg.querySelector('.dot').setAttribute('visibility', 'hidden');
    });
    return el;
  }

  // History values padded to 60 samples from the left.
  function seriesFor(key) {
    const hist = snap.history;
    const pad = (arr) => arr;
    switch (key) {
      case 'cpu': return { values: pad(hist.cpu), max: 100, fmt: pct };
      case 'gpu': return { values: pad(hist.gpu), max: 100, fmt: pct };
      case 'ram': return { values: pad(hist.ram), max: 100, fmt: pct };
      case 'vram': {
        const total = snap.vramTotal || Math.max(...hist.vram.filter(Boolean), 1);
        return { values: hist.vram.map((v) => (v == null ? null : (v / total) * 100)), max: 100, fmt: pct };
      }
      case 'disk': return { values: pad(hist.disk), max: 100, fmt: pct };
      case 'net': {
        const both = hist.netIn.map((v, i) => (v || 0) + (hist.netOut[i] || 0));
        return { values: both, max: Math.max(64 * 1024, ...both), fmt: rate };
      }
      default: return { values: [], max: 100, fmt: pct };
    }
  }

  function update(el, { value, sub, meter, status }) {
    const { line, area } = sparkline(padLeft(seriesFor(el.dataset.key).values), seriesFor(el.dataset.key).max);
    el.querySelector('.line').setAttribute('points', line);
    el.querySelector('.area').setAttribute('d', area);
    el.querySelector('.pt-value').textContent = value;
    el.querySelector('.pt-sub').textContent = sub || '';
    const m = el.querySelector('.pt-meter');
    m.hidden = meter == null;
    if (meter != null) {
      const fill = m.querySelector('.fill');
      fill.style.width = `${Math.min(100, meter)}%`;
      fill.style.background = (loadStatus(meter) || {}).color || '';
    }
    const st = el.querySelector('.pt-status');
    st.textContent = status ? status.label : '';
    st.style.setProperty('--st', status ? status.color : 'transparent');
    st.classList.toggle('on', Boolean(status));
  }

  const padLeft = (arr) => [...Array(Math.max(0, 60 - arr.length)).fill(null), ...arr];

  function build() {
    $('#perf-tiles').replaceChildren(
      tile('cpu', 'Processor', 'chip'), tile('gpu', 'Graphics', 'tv'), tile('ram', 'Memory', 'layers'),
      tile('vram', 'Video memory', 'grid'), tile('disk', 'Disk', 'drive'), tile('net', 'Network', 'wifi'),
    );
    built = true;
  }

  function renderSnap() {
    if (!snap || PC5.S.view !== 'perf') return;
    const tiles = Object.fromEntries([...document.querySelectorAll('.perf-tile')].map((t) => [t.dataset.key, t]));
    const worst = (...s) => s.filter(Boolean).sort((a, b) => (a.color === STATUS.critical ? -1 : 1))[0] || null;
    update(tiles.cpu, { value: pct(snap.cpu), sub: [temp(snap.cpuTemp), `${navigator.hardwareConcurrency} threads`].filter(Boolean).join(' · '), status: worst(tempStatus(snap.cpuTemp), loadStatus(snap.cpu)) });
    update(tiles.gpu, { value: pct(snap.gpu), sub: [temp(snap.gpuTemp), snap.gpuName].filter(Boolean).join(' · ') || 'Graphics load', status: worst(tempStatus(snap.gpuTemp), loadStatus(snap.gpu)) });
    update(tiles.ram, { value: pct(snap.ram), sub: `${fmtBytes(snap.ramUsed)} of ${fmtBytes(snap.ramTotal)}`, meter: snap.ram, status: loadStatus(snap.ram) });
    const vramPct = snap.vramTotal ? (snap.vramUsed / snap.vramTotal) * 100 : null;
    update(tiles.vram, { value: fmtBytes(snap.vramUsed), sub: snap.vramTotal ? `of ${fmtBytes(snap.vramTotal)}` : 'In use', meter: vramPct, status: vramPct != null ? loadStatus(vramPct) : null });
    update(tiles.disk, { value: pct(snap.disk), sub: 'Active time', status: loadStatus(snap.disk) });
    update(tiles.net, { value: rate(snap.netIn), sub: `↓ ${rate(snap.netIn)}   ↑ ${rate(snap.netOut)}` });
    renderProcs();
  }

  function renderProcs() {
    const list = $('#perf-procs');
    const cur = Nav.current();
    const keep = cur && list.contains(cur) ? cur.dataset.name : null;
    const procs = (snap.procs || []).slice(0, 10);
    list.replaceChildren(...procs.map((p) => {
      const row = h('button', { class: 'proc-row', nav: true, 'data-name': p.name, onclick: () => procMenu(p) },
        h('span', { class: 'proc-name' }, p.name),
        h('span', { class: 'proc-bar' }, h('span', { class: 'fill', style: `width:${Math.min(100, p.cpu)}%` })),
        h('span', { class: 'proc-cpu' }, `${p.cpu.toFixed(1)}%`),
        h('span', { class: 'proc-mem' }, fmtBytes(p.mem)));
      row._options = () => procMenu(p);
      return row;
    }));
    if (keep) {
      const again = list.querySelector(`[data-name="${CSS.escape(keep)}"]`);
      if (again && !Nav.inModal()) Nav.focus(again);
    }
  }

  function procMenu(p) {
    menu(p.name, [
      ['End task', async () => {
        if (!(await confirm(`End ${p.name}?`, 'End task', 'Unsaved work in it will be lost.'))) return;
        try { const r = await api().endTask(p.name); toast(r && r.demo ? `Demo mode: would end ${p.name}` : `${p.name} was closed`, 'check'); } catch (err) { toast(err.message, 'alert'); }
      }, { cls: 'danger' }],
    ], { subtitle: `CPU ${p.cpu.toFixed(1)}% · Memory ${fmtBytes(p.mem)}` });
  }

  function renderHead() {
    const c = PC5.S.cfg;
    $('#perf-overlay').replaceChildren(Icon('activity'), ` Overlay: ${c.overlay ? 'On' : 'Off'}`);
    $('#perf-overlay').classList.toggle('on', Boolean(c.overlay));
  }

  async function toggleOverlay() {
    const on = !PC5.S.cfg.overlay;
    PC5.S.cfg = await api().setConfig({ overlay: on });
    await api().setOverlay({ on, position: PC5.S.cfg.overlayPosition });
    renderHead();
    toast(on ? 'Performance overlay on. It stays on top of your games.' : 'Performance overlay off', 'activity');
  }

  window.Perf = {
    toggleOverlay,
    page: {
      render() {
        if (!built) build();
        renderHead();
        if (!off) {
          api().perfWatch(true);
          off = api().onPerf((s) => { snap = s; renderSnap(); });
        }
      },
      leave() {
        if (off) { off(); off = null; api().perfWatch(false); }
      },
      focusTarget: () => $('#perf-overlay'),
      hints: () => [['accept', 'Select'], ['options', 'End task'], ['back', 'Back'], ['home', 'Control Center']],
    },
    latest: () => snap,
    init() {
      $('#perf-overlay').addEventListener('click', toggleOverlay);
      $('#perf-overlay-pos').addEventListener('click', () => PC5.openSettings('performance'));
      $('#perf-capture').addEventListener('click', () => PC5.screenshot());
    },
  };
})();
