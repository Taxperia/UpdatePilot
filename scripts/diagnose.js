'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { AppState } = require('../src/app-state');
const { Storage } = require('../src/storage');
const directory = path.resolve(__dirname, '..', '.qa');
const state = new AppState({ storage: new Storage({ dataDir: path.join(directory, 'diagnostic-data'), downloadDir: path.join(directory, 'downloads') }) });
(async () => {
  state.startScan();
  await state.idle();
  const result = state.state();
  fs.writeFileSync(path.join(directory, 'diagnose.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ stats: result.stats, progress: result.progress, summary: result.summary, winget: result.winget,
    updates: result.rows.filter(p => p.status === 'update').map(p => ({ name: p.name, installed: p.version, latest: p.latest, package: p.package_id })),
    errors: result.rows.filter(p => p.status === 'error').map(p => ({ name: p.name, error: p.note })) }, null, 2));
  if (!result.stats.total || !result.winget.available || result.summary?.errors) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
