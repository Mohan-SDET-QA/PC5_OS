// In a plain browser (the website preview, tests) the installer runs on the
// demo engine: same screens and events, nothing touches a disk.
(function () {
  if (window.pc5i) return;
  const engine = PC5InstallerDemo.createDemoEngine({ speed: Number(new URLSearchParams(location.search).get('speed')) || 1 });
  const listeners = new Set();
  let consoleMode = false;
  window.pc5i = {
    context: async () => ({ version: window.PC5_VERSION || '', demo: true, platform: 'browser', canBuild: true, web: true }),
    catalog: async () => (await fetch('strip-catalog.json')).json(),
    start: () => engine.start(),
    call: async (cmd, args) => {
      try { return { ok: true, data: await engine.call(cmd, args, (ev) => listeners.forEach((fn) => fn(ev))) }; } catch (err) { return { ok: false, error: err.message, cancelled: Boolean(err.cancelled) }; }
    },
    cancel: async () => engine.cancel(),
    installs: async () => null,
    pickIso: async () => 'C:\\Users\\Player\\Downloads\\Win11_24H2_English_x64.iso',
    pickIsoOut: async () => 'C:\\Users\\Player\\Downloads\\PC5-OS.iso',
    getWindows: async () => window.open('https://www.microsoft.com/software-download/windows11', '_blank', 'noopener'),
    showFile: async () => {},
    openConsole: async () => { location.href = '../play/'; },
    consoleMode: async (on) => { if (typeof on === 'boolean') consoleMode = on; return consoleMode; },
    pathForFile: (f) => `C:\\Users\\Player\\Downloads\\${f.name}`,
    onEvent: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
})();
