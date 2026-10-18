// Injected into web apps (YouTube TV, etc.). The page keeps normal gamepad
// input; we only watch for Guide/PS (button 16) or Back+Start to go home.
const { ipcRenderer } = require('electron');

let held = false;
function poll() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let home = false;
  for (const p of pads) {
    if (!p) continue;
    const b = (i) => p.buttons[i] && p.buttons[i].pressed;
    if (b(16) || (b(8) && b(9))) home = true;
  }
  if (home && !held) ipcRenderer.send('webapp:home');
  held = home;
  requestAnimationFrame(poll);
}
window.addEventListener('DOMContentLoaded', () => requestAnimationFrame(poll));
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && e.shiftKey) ipcRenderer.send('webapp:home');
});
