'use strict';
const path = require('node:path');
const { spawn } = require('node:child_process');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const electron = require('electron');
const child = spawn(electron, [path.resolve(__dirname, '..'), ...process.argv.slice(2)], { env, windowsHide: false, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
