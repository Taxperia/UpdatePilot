'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { OfficialSources, nodeChannels } = require('../src/official-sources');
const { AppState } = require('../src/app-state');
const { Storage } = require('../src/storage');
const releases = [
  { version: 'v22.23.3', lts: 'Jod', date: '2026-09-23', files: ['win-x64-msi', 'win-x86-msi'] },
  { version: 'v27.0.0-rc1', lts: false, date: '2026-10-10', files: ['win-x64-msi'] },
  { version: 'v24.21.0', lts: 'Krypton', date: '2026-09-07', files: ['win-x64-msi'] },
  { version: 'v26.11.1', lts: false, date: '2026-10-07', files: ['win-x64-msi', 'win-arm64-zip'] }
];
function store(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'updatepilot-official-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new Storage({ dataDir: path.join(dir, 'data'), downloadDir: path.join(dir, 'downloads') });
}
function setup(t, options = {}) {
  return new AppState({ storage: store(t), scanner: async () => [{ name: 'Node.js', version: '22.22.2', architecture: 'x64' }],
    winget: { available: true, error: '', list: async () => [{ name: 'Node.js', id: 'OpenJS.NodeJS.22', version: '22.22.2', latest: '22.23.2' }], latest: async () => '22.23.2' },
    official: new OfficialSources(null, async () => new Response(JSON.stringify(releases))), ...options });
}
test('Node release channels are separate, ordered numerically and exclude prereleases', () => {
  const channels = nodeChannels(releases, '22.22.2');
  assert.deepEqual(channels.map(c => [c.id, c.version]), [['latest', '26.11.1'], ['lts', '24.21.0'], ['series', '22.23.3']]);
  assert.equal(channels[0].major_change, true); assert.equal(channels[2].major_change, false);
});
test('an unavailable installed branch is omitted rather than replaced by another series', () => {
  assert.equal(nodeChannels(releases, '20.1.0').some(c => c.id === 'series'), false);
  assert.throws(() => nodeChannels([], '22.1.0'));
});
test('official Node release takes precedence over stale major-specific WinGet package', async t => {
  const state = setup(t); state.startScan(); await state.idle();
  const row = state.row('Node.js');
  assert.equal(row.latest, '26.11.1'); assert.equal(row.version_source, 'official'); assert.equal(row.status, 'update');
  assert.equal(row.catalog_latest, '22.23.2'); assert.equal(row.channels.find(c => c.id === 'series').version, '22.23.3');
  assert.equal(state.state().rows[0].official_data, undefined);
});
test('official version lookup still works when WinGet is unavailable', async t => {
  const state = setup(t, { winget: { available: false, error: 'offline', list: async () => { throw Error('offline'); } } });
  state.startScan(); await state.idle(); assert.equal(state.row('Node.js').latest, '26.11.1'); assert.equal(state.summary.errors, 0);
});
test('failure of an official API is disclosed instead of pretending catalogue data is official', async t => {
  const state = setup(t, { official: new OfficialSources(null, async () => { throw Error('timeout'); }) });
  state.startScan(); await state.idle(); const row = state.row('Node.js');
  assert.equal(row.latest, '22.23.2'); assert.equal(row.version_source, 'catalog'); assert.match(row.source_error, /timeout/);
  assert.equal(row.official_data, null); assert.deepEqual(row.channels, []);
});
test('catalogue versions older than installed are marked stale and cannot be downloaded', async t => {
  const state = setup(t, {
    scanner: async () => [{ name: 'App', version: '3.0' }],
    winget: { available: true, error: '', list: async () => [{ name: 'App', id: 'Vendor.App', version: '3.0', latest: '' }], latest: async () => '2.0' }
  });
  state.startScan(); await state.idle();
  assert.equal(state.row('App').status, 'catalog-old'); assert.throws(() => state.startDownload('App'), /eski paket/);
});
test('equal catalogue version is labelled as catalogue-only rather than officially current', async t => {
  const state = setup(t, {
    scanner: async () => [{ name: 'App', version: '2.0' }],
    winget: { available: true, error: '', list: async () => [{ name: 'App', id: 'Vendor.App', version: '2.0', latest: '' }], latest: async () => '2.0' }
  });
  state.startScan(); await state.idle(); assert.equal(state.row('App').status, 'catalog-ok');
});
test('Node official MSI is pinned to selected channel and requires a published SHA-256', async () => {
  const hash = 'a'.repeat(64);
  const official = new OfficialSources(null, async url => new Response(hash + '  node-v24.21.0-x64.msi\n'));
  const asset = await official.asset({ architecture: 'x64', official_data: { provider: 'node', channels: nodeChannels(releases, '22.22.2') } }, 'lts');
  assert.equal(asset.url, 'https://nodejs.org/dist/v24.21.0/node-v24.21.0-x64.msi');
  assert.equal(asset.digest, 'sha256:' + hash); assert.equal(asset.version, '24.21.0');
});
test('Node downloads are refused for unavailable architectures and missing checksums', async () => {
  const official = new OfficialSources(null, async () => new Response(''));
  const info = { provider: 'node', channels: nodeChannels(releases, '22.22.2') };
  await assert.rejects(official.asset({ architecture: 'x86', official_data: info }, 'latest'), /mimari/);
  await assert.rejects(official.asset({ architecture: 'x64', official_data: info }, 'latest'), /SHA-256/);
  await assert.rejects(official.asset({ architecture: 'x64', official_data: info }, 'invalid'), /kanalı/);
});
test('selected Node series download uses official file instead of stale WinGet installer', async t => {
  let asset, native = false;
  const hash = 'a'.repeat(64);
  const state = setup(t, { official: new OfficialSources(null, async url => url.endsWith('index.json') ? new Response(JSON.stringify(releases)) : new Response(hash + '  node-v22.23.3-x64.msi\n')),
    download: async value => { asset = value; return 'node-v22.23.3-x64.msi'; } });
  state.winget.download = async () => { native = true; };
  state.startScan(); await state.idle(); state.startDownload('Node.js', 'series'); await state.idle();
  assert.equal(native, false); assert.equal(asset.version, '22.23.3'); assert.equal(state.downloads['Node.js'].version, '22.23.3');
});
test('Cursor and VS Code use release versions, not commit hashes, and correct installation scope', async () => {
  let requested;
  const official = new OfficialSources(null, async url => { requested = url; return new Response(JSON.stringify({ productVersion: '1.141.0', version: 'commit-sha', url: 'https://vscode.download.prss.microsoft.com/path/VSCodeUserSetup.exe', sha256hash: 'b'.repeat(64) })); });
  const info = await official.check({ name: 'Microsoft Visual Studio Code (User)', package_id: 'Microsoft.VisualStudioCode', scope: 'user', architecture: 'x64' });
  assert.equal(info.latest, '1.141.0'); assert.match(requested, /win32-x64-user/); assert.equal(info.asset.digest, 'sha256:' + 'b'.repeat(64));
});
test('untrusted download hosts in publisher responses are refused', async () => {
  const official = new OfficialSources(null, async () => new Response(JSON.stringify({ version: '3.24.12', downloadUrl: 'https://attacker.example/installer.exe' })));
  await assert.rejects(official.check({ name: 'Cursor (User)', architecture: 'x64' }), /sunucusu/);
});
test('Firefox release and ESR channels remain distinct and preserve language', async () => {
  const official = new OfficialSources(null, async () => new Response(JSON.stringify({ LATEST_FIREFOX_VERSION: '157.0.1', FIREFOX_ESR: '140.17.0esr', FIREFOX_ESR_NEXT: '153.4.0esr' })));
  const row = { name: 'Mozilla Firefox ESR (x64 tr)', package_id: 'Mozilla.Firefox.ESR', architecture: 'x64' };
  row.official_data = await official.check(row);
  assert.equal(row.official_data.latest, '153.4.0');
  const asset = await official.asset(row); assert.match(asset.url, /153\.4\.0esr\/win64\/tr\//);
});
test('official APIs are cached only within a single check batch', async () => {
  let requests = 0;
  const official = new OfficialSources(null, async () => { requests++; return new Response(JSON.stringify(releases)); });
  const cache = new Map(); await official.check({ name: 'Node.js', version: '22.0' }, { cache }); await official.check({ name: 'Node.js', version: '24.0' }, { cache });
  assert.equal(requests, 1); await official.check({ name: 'Node.js', version: '22.0' }); assert.equal(requests, 2);
});
test('Chrome uses the official evergreen installer when its catalogue entry is missing or behind', async () => {
  const official = new OfficialSources(null);
  const asset = await official.asset({ architecture: 'x64', official_data: { provider: 'chrome', latest: '156.0.8078.12' }, catalog_latest: '155.0.0.0' });
  assert.equal(new URL(asset.url).hostname, 'dl.google.com'); assert.equal(asset.evergreen, true);
  assert.equal(asset.name, 'googlechromestandaloneenterprise64.msi');
});
test('publisher GitHub releases take priority over older catalogue releases', async () => {
  const official = new OfficialSources({ latest: async () => ({ version: '2.56.0.windows.2', url: 'https://github.com/git-for-windows/git/releases/tag/v2.56.0.windows.2', assets: [{ name: 'Git-2.56.0-32-bit.exe' }, { name: 'Git-2.56.0-64-bit.exe' }] }) });
  const info = await official.check({ package_id: 'Git.Git', architecture: 'x64' });
  assert.equal(info.latest, '2.56.0.2'); assert.equal(info.asset.name, 'Git-2.56.0-64-bit.exe');
});
