// In-game performance overlay: compact bars for CPU, GPU, RAM and VRAM.
(function () {
  const $ = (id) => document.getElementById(id);
  const gb = (b) => (b ? `${(b / 1024 ** 3).toFixed(1)} GB` : '—');
  function set(key, pctValue, text) {
    const bar = $(`b-${key}`);
    const p = Math.max(0, Math.min(100, pctValue || 0));
    bar.style.width = `${p}%`;
    bar.className = p >= 95 ? 'crit' : p >= 85 ? 'warn' : '';
    $(`v-${key}`).textContent = text;
  }
  window.overlay.onPerf((s) => {
    const t = (v) => (v == null ? '' : ` ${Math.round(v)}°`);
    set('cpu', s.cpu, `${Math.round(s.cpu)}%${t(s.cpuTemp)}`);
    set('gpu', s.gpu, `${Math.round(s.gpu)}%${t(s.gpuTemp)}`);
    set('ram', s.ram, `${Math.round(s.ram)}%`);
    set('vram', s.vramTotal ? (s.vramUsed / s.vramTotal) * 100 : 0, gb(s.vramUsed));
  });
})();
