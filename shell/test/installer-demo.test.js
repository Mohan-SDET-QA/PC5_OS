// The demo install engine must speak the same event protocol as the real one,
// because the installer window, the website preview and the UI tests use it.
const assert = require('assert');
const { createDemoEngine } = require('../renderer/js/installer-demo');

(async () => {
  const engine = createDemoEngine({ speed: 200 });
  const targets = await engine.call('targets');
  assert.ok(targets.drives.length && targets.usb.length && targets.disks.length, 'targets lists drives, disks and USB');
  const info = await engine.call('info', { iso: 'C:\\Win11.iso' });
  assert.ok(info.images.some((i) => i.name === 'Windows 11 Pro'), 'info lists editions');
  await assert.rejects(engine.call('info', { iso: 'C:\\notes.txt' }), /install media/, 'info rejects non-ISO files');
  console.log('targets and info OK');

  for (const target of ['partition', 'usb', 'iso']) {
    const events = [];
    const spec = { target, imageIndex: 4, items: [], userName: 'Player', partition: { mode: 'shrink', driveLetter: 'C', sizeGB: 120 }, usb: { diskNumber: 3 }, isoOut: 'C:\\x.iso' };
    const result = await engine.call('build', { spec }, (e) => events.push(e));
    assert.strictEqual(events[0].kind, 'plan', `${target}: plan comes first`);
    const percents = events.filter((e) => e.percent != null).map((e) => e.percent);
    assert.ok(percents.every((p, i) => i === 0 || p >= percents[i - 1]), `${target}: progress never goes backwards`);
    assert.ok(Math.abs(percents[percents.length - 1] - 100) < 0.01, `${target}: progress ends at 100%`);
    const steps = events.filter((e) => e.kind === 'step').map((e) => e.id);
    assert.deepStrictEqual(steps, events[0].steps.map((s) => s.id), `${target}: every planned step runs, in order`);
    assert.strictEqual(result.target, target);
    console.log(`${target} build OK (${steps.length} steps)`);
  }
  const after = await engine.call('targets');
  assert.strictEqual(after.installs.length, 1, 'a partition build is listed as installed');

  const slow = createDemoEngine({ speed: 20 });
  const run = slow.call('build', { spec: { target: 'partition', partition: { sizeGB: 80 } } });
  setTimeout(() => slow.cancel(), 100);
  await assert.rejects(run, (err) => err.cancelled === true, 'cancel stops the build');
  console.log('cancel OK');
})().catch((err) => { console.error(err); process.exit(1); });
