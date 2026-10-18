// Link to PC5Input.exe (global PS/Guide button, PlayStation HID support, mouse mode).
// The helper connects back over localhost TCP with a one-time token. It's
// started elevated when possible, so mouse mode can also click inside
// installers that run as administrator.
const net = require('net');
const crypto = require('crypto');
const fs = require('fs');
const { spawn } = require('child_process');

function createInputLink({ exe, onLine, isQuitting, elevate = true }) {
  if (process.platform !== 'win32' || !fs.existsSync(exe)) {
    return { available: false, send() {} };
  }
  const token = crypto.randomBytes(16).toString('hex');
  let socket = null;
  let fallbackTimer = null;

  const server = net.createServer((s) => {
    let buf = '';
    let authed = false;
    s.setEncoding('utf8');
    s.on('error', () => {});
    s.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!authed) {
          // Wrong token, or a second helper while one is already connected.
          if (line !== `HELLO ${token}` || socket) { s.destroy(); return; }
          authed = true;
          socket = s;
          clearTimeout(fallbackTimer);
          continue;
        }
        onLine(line);
      }
    });
    s.on('close', () => {
      if (socket !== s) return;
      socket = null;
      if (!isQuitting()) setTimeout(launch, 2000);
    });
  });

  function launch() {
    const port = String(server.address().port);
    if (elevate) {
      const quoted = exe.replace(/'/g, "''");
      const ps = `Start-Process -FilePath '${quoted}' -ArgumentList '${port}','${token}' -Verb RunAs -WindowStyle Hidden`;
      spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps], { windowsHide: true });
    }
    // If elevation was refused or is slow, run it unelevated instead.
    clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(() => {
      if (!socket) spawn(exe, [port, token], { windowsHide: true });
    }, elevate ? 8000 : 0);
  }

  server.listen(0, '127.0.0.1', launch);

  return {
    available: true,
    send(line) { if (socket) socket.write(`${line}\n`); },
    connected: () => Boolean(socket),
  };
}

module.exports = { createInputLink };
