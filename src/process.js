'use strict';
const { spawn } = require('node:child_process');

function run(file, args, { timeout = 120000, onOutput, allowedCodes = [0] } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; onOutput?.(chunk); });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error('İşlem zaman aşımına uğradı.'));
      if (!allowedCodes.includes(code)) {
        const error = new Error((stderr || stdout || `İşlem kodu: ${code}`).trim().slice(-1800));
        error.code = code; error.stdout = stdout; return reject(error);
      }
      resolve(stdout);
    });
  });
}
function powershell(script, options) {
  const prefix = "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $ErrorActionPreference = 'Stop'; ";
  return run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(prefix + script, 'utf16le').toString('base64')], options);
}
module.exports = { run, powershell };
