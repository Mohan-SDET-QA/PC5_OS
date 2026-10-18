// A pretend install engine with the same commands and events as the real one
// (windows/engine). Used by `npm run installer-demo`, by the website preview,
// and by tests, so the installer can be tried without touching any disk.
(function (root) {
  const GB = 1024 ** 3;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function createDemoEngine({ speed = 1 } = {}) {
    let cancelled = false;
    const installs = [];
    const disks = [
      {
        number: 0, name: 'Samsung SSD 990 PRO 1TB', size: 1000 * GB, style: 'GPT', largestFree: 0, freeUsable: false,
        partitions: [
          { number: 1, offset: 1048576, size: 0.1 * GB, type: 'System', letter: '', label: '' },
          { number: 2, offset: 0.1 * GB, size: 0.016 * GB, type: 'Reserved', letter: '', label: '' },
          { number: 3, offset: 0.12 * GB, size: 999 * GB, type: 'Basic', letter: 'C', label: 'Windows' },
          { number: 4, offset: 999.1 * GB, size: 0.8 * GB, type: 'Recovery', letter: '', label: '' },
        ],
      },
      {
        number: 1, name: 'WD Black SN770 2TB', size: 2000 * GB, style: 'GPT', largestFree: 180 * GB, freeUsable: true,
        partitions: [{ number: 1, offset: 1048576, size: 1820 * GB, type: 'Basic', letter: 'D', label: 'Games' }],
      },
    ];
    const targets = () => ({
      firmware: 'UEFI', secureBoot: true, locale: 'en-US', timeZone: 'Pacific Standard Time', userName: 'Player', minSizeGB: 40, oscdimg: false,
      drives: [
        { letter: 'C', label: 'Windows', diskNumber: 0, partitionNumber: 3, size: 999 * GB, free: 512 * GB, maxSizeGB: 480, isSystem: true, bitlocker: true, diskName: disks[0].name, usable: true, reason: '' },
        { letter: 'D', label: 'Games', diskNumber: 1, partitionNumber: 1, size: 1820 * GB, free: 37 * GB, maxSizeGB: 0, isSystem: false, bitlocker: false, diskName: disks[1].name, usable: false, reason: 'Needs at least 60 GB free.' },
      ],
      disks,
      usb: [
        { number: 3, name: 'SanDisk Ultra USB 3.0', size: 64 * GB, letters: ['E:'], usable: true },
        { number: 4, name: 'Kingston DataTraveler', size: 4 * GB, letters: ['F:'], usable: false },
      ],
      workDrives: [{ letter: 'C', free: 512 * GB }],
      installs: installs.slice(),
    });
    const info = (iso) => ({
      path: iso, label: 'CCCOMA_X64FRE_EN-US_DV9', format: 'wim',
      images: [
        ['Windows 11 Home', 'Core', 18.9], ['Windows 11 Home N', 'CoreN', 18.2], ['Windows 11 Education', 'Education', 19.4],
        ['Windows 11 Pro', 'Professional', 19.4], ['Windows 11 Pro N', 'ProfessionalN', 18.7], ['Windows 11 Pro for Workstations', 'ProfessionalWorkstation', 19.4],
      ].map(([name, editionId, size], i) => ({ index: i + 1, name, description: name, size: size * GB, version: '10.0.26100.1742', build: 26100, arch: 'x64', editionId, languages: ['en-US'] })),
    });

    async function build(spec, emit) {
      const partition = spec.target === 'partition';
      const steps = partition
        ? [['check', 'Checking this PC', 2], ['media', 'Opening the Windows image', 2], ['partition', 'Making room for PC5 OS', 6], ['apply', 'Installing Windows', 55],
          ['strip', 'Stripping it down', 18], ['pc5', 'Adding PC5', 12], ['boot', 'Adding PC5 OS to the boot menu', 4], ['finish', 'Finishing', 1]]
        : [['check', 'Checking space', 1], ['copy', 'Copying the Windows installer', 8], ['export', 'Extracting your Windows edition', 14], ['mount', 'Opening the image', 6],
          ['strip', 'Stripping it down', 16], ['pc5', 'Adding PC5', 9], ['save', 'Saving the image', 14],
          ...(spec.bypassChecks ? [['bypass', 'Allowing PCs without TPM 2.0', 6]] : []),
          ...(spec.target === 'usb' ? [['usb', 'Preparing the USB drive', 2], ['write', 'Writing to the USB drive', 22]] : [['write', 'Writing the ISO', 14]]),
          ['finish', 'Cleaning up', 1]];
      emit({ kind: 'plan', steps: steps.map(([id, label]) => ({ id, label })) });
      const total = steps.reduce((n, s) => n + s[2], 0);
      let done = 0;
      const removedNames = ['Microsoft.BingNews', 'Microsoft.BingWeather', 'Microsoft.Copilot', 'Microsoft.GetHelp', 'Microsoft.Getstarted', 'Clipchamp.Clipchamp', 'Microsoft.MicrosoftOfficeHub', 'Microsoft.Todos', 'Microsoft.YourPhone', 'MicrosoftCorporationII.QuickAssist'];
      for (const [id, label, weight] of steps) {
        emit({ kind: 'step', id, label, percent: Math.round((1000 * done) / total) / 10 });
        emit({ kind: 'log', level: 'step', text: label });
        const ticks = Math.max(2, Math.round(weight / 2));
        for (let t = 1; t <= ticks; t++) {
          if (cancelled) { cancelled = false; emit({ kind: 'log', level: 'warn', text: 'Undoing: remove the new partition' }); const e = new Error('Cancelled'); e.cancelled = true; throw e; }
          await wait((weight * 90) / ticks / speed);
          const sp = (100 * t) / ticks;
          const detail = id === 'strip' ? removedNames[Math.min(removedNames.length - 1, Math.floor((t / ticks) * removedNames.length))] : '';
          emit({ kind: 'progress', stepPercent: sp, percent: Math.round((1000 * (done + (weight * sp) / 100)) / total) / 10, detail });
          if (id === 'strip' && detail) emit({ kind: 'log', level: 'info', text: `Removed ${detail}` });
        }
        if (id === 'partition') emit({ kind: 'log', level: 'info', text: `PC5 OS partition is drive P: (${spec.partition.sizeGB} GB)` });
        done += weight;
      }
      if (partition) {
        const entry = `{${Math.random().toString(16).slice(2, 10)}-0000-4000-8000-000000000000}`;
        installs.push({ entryId: entry, partitionGuid: '{demo}', sizeGB: spec.partition.sizeGB, created: new Date().toISOString(), sourceLetter: spec.partition.driveLetter || '', letter: 'P', healthy: true });
        return { target: 'partition', entryId: entry, letter: 'P', sizeGB: spec.partition.sizeGB, removed: 23 };
      }
      return { target: spec.target, output: spec.target === 'usb' ? 'E:\\' : spec.isoOut, removed: 23 };
    }

    return {
      demo: true,
      async start() { await wait(400 / speed); return { ok: true, demo: true }; },
      async call(cmd, args = {}, emit = () => {}) {
        switch (cmd) {
          case 'ping': return { pong: true, elevated: true, engine: 1 };
          case 'targets': await wait(700 / speed); return targets();
          case 'info': await wait(1100 / speed); if (!/\.iso$/i.test(args.iso || '')) throw new Error("This isn't Windows install media: there's no sources\\install.wim or install.esd."); return info(args.iso);
          case 'build': return build(args.spec, emit);
          case 'remove': installs.splice(installs.findIndex((i) => i.entryId === args.entryId), 1); return { removed: args.entryId };
          case 'restart': return { restarting: true, demo: true };
          default: throw new Error(`Unknown command ${cmd}`);
        }
      },
      cancel() { cancelled = true; },
      close() {},
    };
  }

  if (typeof module === 'object' && module.exports) module.exports = { createDemoEngine };
  else root.PC5InstallerDemo = { createDemoEngine };
})(typeof window !== 'undefined' ? window : globalThis);
