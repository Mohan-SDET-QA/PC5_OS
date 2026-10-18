// Full-screen media player for videos, music and pictures, driven by the
// controller: ✕ play/pause, ◀ ▶ seek 10 s (or previous/next picture),
// ▲ ▼ volume, L1/R1 previous/next file in the folder, ○ close.
(function () {
  const { $, h, toast } = UI;
  const VIDEO = /\.(mp4|m4v|webm|mkv|mov|ogv)$/i;
  const AUDIO = /\.(mp3|m4a|aac|flac|wav|ogg|opus)$/i;
  const IMAGE = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;
  const kindOf = (f) => (VIDEO.test(f) ? 'video' : AUDIO.test(f) ? 'audio' : IMAGE.test(f) ? 'image' : null);

  let list = [];
  let index = 0;
  let media = null;
  let active = false;
  let hideTimer = null;
  let volume = 0.8;

  const fmt = (t) => (Number.isFinite(t) ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : '0:00');
  const name = (f) => f.split(/[\\/]/).pop();

  function poke() {
    const el = $('#viewer');
    el.classList.add('show-ui');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (media && !media.paused) el.classList.remove('show-ui'); }, 3200);
  }

  function render() {
    const file = list[index];
    const kind = kindOf(file);
    const stage = $('#viewer-stage');
    if (media) { media.pause(); media.removeAttribute('src'); media.load && media.load(); }
    media = null;
    let node;
    if (kind === 'image') {
      node = h('img', { class: 'v-image', src: UI.fileUrl(file), alt: '' });
    } else {
      media = h(kind, { class: kind === 'video' ? 'v-video' : 'v-audio', src: UI.fileUrl(file), autoplay: true });
      media.volume = volume;
      media.addEventListener('timeupdate', progress);
      media.addEventListener('ended', () => { if (index < list.length - 1) step(1); });
      media.addEventListener('error', () => toast(`Can't play ${name(file)} (unsupported format)`, 'alert'));
      media.addEventListener('play', () => { $('#v-play').replaceChildren(Icon('pause')); });
      media.addEventListener('pause', () => { $('#v-play').replaceChildren(Icon('play')); poke(); });
      node = kind === 'audio'
        ? h('div', { class: 'v-music' }, h('div', { class: 'v-disc' }, Icon('music')), media)
        : media;
    }
    stage.replaceChildren(node);
    $('#v-title').textContent = name(file);
    $('#v-count').textContent = list.length > 1 ? `${index + 1} of ${list.length}` : '';
    $('#viewer').dataset.kind = kind;
    progress();
    poke();
  }

  function progress() {
    const bar = $('#v-progress-fill');
    if (!media) { bar.style.width = '0%'; $('#v-time').textContent = ''; return; }
    bar.style.width = `${media.duration ? (media.currentTime / media.duration) * 100 : 0}%`;
    $('#v-time').textContent = `${fmt(media.currentTime)} / ${fmt(media.duration)}`;
  }

  function step(dir) {
    if (list.length < 2) return;
    index = (index + dir + list.length) % list.length;
    render();
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (media) media.volume = volume;
    toast(`Volume ${Math.round(volume * 100)}%`, 'volume');
  }

  /** Opens a file; siblings (paths) lets L1/R1 move through the folder. */
  function open(file, siblings = []) {
    const kind = kindOf(file);
    if (!kind) return false;
    list = siblings.filter((f) => kindOf(f) === kind);
    if (!list.includes(file)) list = [file];
    index = list.indexOf(file);
    active = true;
    $('#viewer').hidden = false;
    document.body.classList.add('viewing');
    render();
    PC5.renderHints();
    return true;
  }

  function close() {
    if (media) media.pause();
    media = null;
    active = false;
    $('#viewer').hidden = true;
    $('#viewer-stage').replaceChildren();
    document.body.classList.remove('viewing');
    PC5.renderHints();
  }

  function handle(action) {
    poke();
    const image = !media;
    switch (action) {
      case 'accept': if (media) { if (media.paused) media.play(); else media.pause(); } return true;
      case 'left': case 'right': {
        const dir = action === 'left' ? -1 : 1;
        if (image) step(dir);
        else media.currentTime = Math.max(0, Math.min(media.duration || 0, media.currentTime + dir * 10));
        return true;
      }
      case 'up': setVolume(volume + 0.1); return true;
      case 'down': setVolume(volume - 0.1); return true;
      case 'lb': step(-1); return true;
      case 'rb': step(1); return true;
      case 'back': close(); return true;
      default: return true; // swallow everything else while playing
    }
  }

  function init() {
    $('#v-play').addEventListener('click', () => handle('accept'));
    $('#v-prev').addEventListener('click', () => step(-1));
    $('#v-next').addEventListener('click', () => step(1));
    $('#v-close').addEventListener('click', close);
    $('#v-progress').addEventListener('click', (e) => {
      if (!media || !media.duration) return;
      const r = e.currentTarget.getBoundingClientRect();
      media.currentTime = ((e.clientX - r.left) / r.width) * media.duration;
    });
    $('#viewer').addEventListener('mousemove', poke);
  }

  window.Viewer = {
    init, open, close, handle, kindOf,
    active: () => active,
    hints: () => (media
      ? [['accept', 'Play / pause'], ['left', 'Seek'], ['lb', 'Previous / next'], ['back', 'Close']]
      : [['left', 'Previous / next'], ['back', 'Close']]),
  };
})();
