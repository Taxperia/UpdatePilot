'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { compare } = require('../src/versioning');
const { parseList, parseShow, matchPackage, Winget } = require('../src/winget');
const { pickAsset, repoName } = require('../src/github');
const { safeFilename, httpsUrl, downloadFile } = require('../src/download');
const { Storage } = require('../src/storage');
const { AppState } = require('../src/app-state');
function temp(t) { const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'updatepilot-test-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true })); return directory; }
function storage(t) { const directory = temp(t); return new Storage({ dataDir: path.join(directory, 'data'), downloadDir: path.join(directory, 'downloads') }); }
function table(headers, rows) { return headers.map((v, i) => v.padEnd([36, 30, 18, 18][i])).join('') + '\n' + '-'.repeat(102) + '\n' + rows.map(row => row.map((v, i) => v.padEnd([36, 30, 18, 18][i])).join('')).join('\n'); }

test('numeric versions, zero padding, prereleases and build metadata', () => {
  assert.equal(compare('v1.10.0', '1.9.9'), 1);
  assert.equal(compare('1.2', '1.2.0.0'), 0);
  assert.equal(compare('1.2.0-beta2', '1.2.0-beta10'), -1);
  assert.equal(compare('1.2.0-rc1', '1.2.0'), -1);
  assert.equal(compare('1.2.0+build.8', '1.2.0+build.2'), 0);
  assert.equal(compare('Unknown', '1.0'), null);
  assert.equal(compare('< 1.0', '1.0'), null);
});
test('English and Turkish WinGet tables preserve available and unknown versions', () => {
  const text = table(['Name', 'Id', 'Version', 'Available'], [['GitHub CLI', 'GitHub.cli', '2.96.0', '2.102.0'], ['Example', 'Vendor.Example', '< 19.6.0.238', '19.6.0.238'], ['Current', 'Vendor.Current', '1.0', '']]);
  const rows = parseList(text);
  assert.equal(rows.length, 3); assert.equal(rows[0].latest, '2.102.0'); assert.equal(rows[1].version, '< 19.6.0.238'); assert.equal(rows[2].latest, '');
  const turkish = table(['Ad', 'Kimlik', 'Sürüm', 'Kullanılabilir'], [['Örnek Program', 'Vendor.Program', '1.0', '2.0']]);
  assert.equal(parseList(turkish)[0].latest, '2.0');
});
test('WinGet source column is not mistaken for an update', () => {
  const text = table(['Name', 'Id', 'Version', 'Source'], [['App', 'Vendor.App', '1.2', 'winget']]);
  assert.equal(parseList(text)[0].latest, '');
});
test('WinGet identifiers containing plus signs are parsed without confusing version numbers', () => {
  const text = table(['Name', 'Id', 'Version', 'Available'], [['Visual C++', 'Microsoft.VCRedist.2015+.x86', '14.44.35211', '14.50.35719']]);
  const rows = parseList(text);
  assert.equal(rows[0].name, 'Visual C++');
  assert.equal(rows[0].id, 'Microsoft.VCRedist.2015+.x86');
  assert.equal(rows[0].latest, '14.50.35719');
});
test('long names with a single space before the package id retain the correct application identity', () => {
  const text = table(['Name', 'Id', 'Version', 'Available'], []) + 'Microsoft Visual C++ 2015-2022 Redistributable (x86) - 14.44.35211 Microsoft.VCRedist.2015+.x86            14.44.35211.0 14.51.36247.0\n';
  const row = parseList(text)[0];
  assert.equal(row.id, 'Microsoft.VCRedist.2015+.x86');
  assert.equal(row.name, 'Microsoft Visual C++ 2015-2022 Redistributable (x86) - 14.44.35211');
  assert.equal(row.version, '14.44.35211.0'); assert.equal(row.latest, '14.51.36247.0');
});
test('version numbers inside application names are not parsed as package identifiers', () => {
  const text = table(['Name', 'Id', 'Version', 'Available'], [['Everything 1.4.1.1032 (x86)', 'voidtools.Everything', '1.4.1.1032', ''], ['Tool v1.2.3', 'Vendor.Tool', '1.2.3', '2.0']]);
  const rows = parseList(text);
  assert.equal(rows.length, 2); assert.equal(rows[0].id, 'voidtools.Everything'); assert.equal(rows[1].id, 'Vendor.Tool');
});
test('WinGet catalogue version is read from show output', () => {
  assert.equal(parseShow('Found App [Vendor.App]\nVersion: 2.3.4\nPublisher: Vendor'), '2.3.4');
  assert.equal(parseShow('Sürüm: 2.3.4'), '2.3.4');
  assert.throws(() => parseShow('No package found'));
});
test('automatic matching rejects ambiguous names and arbitrary similar applications', () => {
  assert.equal(matchPackage({ name: 'GitHub CLI', version: '2.0' }, [{ name: 'GitHub CLI', id: 'GitHub.cli', version: '2.0' }]).id, 'GitHub.cli');
  assert.equal(matchPackage({ name: 'Git', version: '2.0' }, [{ name: 'GitHub CLI', id: 'GitHub.cli', version: '2.0' }]), null);
  assert.equal(matchPackage({ name: 'App', version: '1.0' }, [{ name: 'App', id: 'Vendor.One', version: '2.0' }, { name: 'App', id: 'Vendor.Two', version: '3.0' }]), null);
});
test('GitHub installer selection respects Windows and CPU architecture', () => {
  const assets = ['app-linux-x64.zip', 'app-setup-arm64.exe', 'app-setup-x64.exe', 'app-x86.msi', 'app-source.zip'].map(name => ({ name, url: 'https://example.com/' + name }));
  assert.equal(pickAsset(assets, 'x64').name, 'app-setup-x64.exe');
  assert.equal(pickAsset(assets, 'arm64').name, 'app-setup-arm64.exe');
  assert.equal(pickAsset(assets, 'x86').name, 'app-x86.msi');
  assert.equal(pickAsset([{ name: 'app-arm64.exe' }], 'x64'), null);
});
test('repository and download inputs are validated', () => {
  assert.equal(repoName('https://github.com/owner/project/'), 'owner/project');
  assert.throws(() => repoName('owner/project/extra'));
  assert.throws(() => httpsUrl('file:///C:/test.exe'));
  assert.throws(() => httpsUrl('http://example.com/test.exe'));
  assert.equal(safeFilename('../../installer.exe'), 'installer.exe');
  assert.equal(safeFilename('CON.exe'), 'paket.bin');
});
test('Python settings and history are preserved during Node migration', t => {
  const store = storage(t);
  const old = { settings: { token: 'secret', auto_check: false }, repos: { App: 'owner/app' }, manual: [{ id: 8, name: 'Tool' }] };
  fs.writeFileSync(store.configPath, JSON.stringify(old));
  store.append('indirildi', 'App', 'installer.exe');
  const cfg = store.load(); store.save(cfg);
  assert.equal(cfg.settings.token, 'secret'); assert.equal(cfg.settings.include_user_scope, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(store.configPath + '.python-backup', 'utf8')), old);
  assert.equal(store.history()[0].program, 'App');
});
test('corrupt existing settings are never overwritten with defaults', t => {
  const store = storage(t); fs.writeFileSync(store.configPath, '{invalid');
  assert.throws(() => store.load(), /mevcut veriler korunuyor/);
  assert.equal(fs.readFileSync(store.configPath, 'utf8'), '{invalid');
});
function app(t, overrides = {}) {
  return new AppState({ storage: storage(t), scanner: async () => [{ name: 'App', version: '1.0', architecture: 'x64' }, { name: 'Unlisted', version: '5.0' }],
    winget: { available: true, error: '', list: async () => [{ name: 'App', id: 'Vendor.App', version: '1.0', latest: '2.0' }], latest: async () => '1.0' }, ...overrides });
}
test('startup discovers updates automatically without manually assigned repositories', async t => {
  const state = app(t); state.startScan(); await state.idle();
  assert.equal(state.row('App').status, 'update'); assert.equal(state.row('App').package_id, 'Vendor.App');
  assert.equal(state.row('Unlisted').status, 'nomatch'); assert.equal(state.summary.updates, 1);
  state.cfg.settings.token = 'secret'; assert.equal(JSON.stringify(state.state()).includes('secret'), false);
});
test('a failed catalogue cannot falsely mark programs current', async t => {
  const state = app(t, { winget: { available: false, error: 'offline', list: async () => { throw new Error('offline'); } } });
  state.startScan(); await state.idle(); assert.equal(state.row('App').status, 'error'); assert.equal(state.summary.errors, 2);
});
test('unknown installed version is not offered an automatic update', async t => {
  const state = app(t, { scanner: async () => [{ name: 'App', version: '' }] });
  state.startScan(); await state.idle(); assert.equal(state.row('App').status, 'unknown');
});
test('same-version ignore survives checks and a newer version is offered', async t => {
  const state = app(t); state.startScan(); await state.idle(); state.ignore('App');
  state.startCheck(); await state.idle(); assert.equal(state.row('App').status, 'ignore');
  state.winget.list = async () => [{ name: 'App', id: 'Vendor.App', version: '1.0', latest: '3.0' }];
  state.startCheck(); await state.idle(); assert.equal(state.row('App').status, 'update');
});
test('manual direct URL uses download flow and version comparison', async t => {
  let downloaded;
  const state = app(t, { download: async asset => { downloaded = asset.url; return 'installer.exe'; } });
  const { id } = state.saveManual({ name: 'Manual', version: '1.0', latest: '2.0', url: 'https://example.com/installer.exe' });
  assert.equal(state.row('m:' + id).status, 'update');
  state.startDownload('m:' + id); await state.idle();
  assert.equal(downloaded, 'https://example.com/installer.exe'); assert.equal(state.downloads.Manual.running, false);
  state.mark('m:' + id); assert.equal(state.row('m:' + id).version, '2.0');
});
test('WinGet download pins package version and retains hash verification', async () => {
  let args;
  const winget = new Winget(async (_file, options) => { args = options; return ''; });
  await winget.download({ package_id: 'Vendor.App', latest: '2.0', architecture: 'x86' }, 'C:\\downloads', () => {});
  assert.equal(args[0], 'download'); assert.equal(args[args.indexOf('--version') + 1], '2.0');
  assert.equal(args[args.indexOf('--architecture') + 1], 'x86'); assert.equal(args.includes('--ignore-security-hash'), false);
  assert.equal(args.includes('install'), false);
});
test('duplicate download clicks cannot create concurrent jobs', async t => {
  let finish;
  const state = app(t, { download: () => new Promise(resolve => { finish = resolve; }) });
  const { id } = state.saveManual({ name: 'Manual', version: '1', latest: '2', url: 'https://example.com/setup.exe' });
  state.startDownload('m:' + id); assert.throws(() => state.startDownload('m:' + id), /zaten indiriliyor/);
  finish('setup.exe'); await state.idle();
});
test('HTTP redirects and installer hash verification produce a complete file', async t => {
  const original = global.fetch; t.after(() => { global.fetch = original; });
  const content = Buffer.from('test-installer'); const digest = crypto.createHash('sha256').update(content).digest('hex'); let calls = 0;
  global.fetch = async () => ++calls === 1 ? new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/setup.exe' } })
    : new Response(content, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(content.length) } });
  const directory = temp(t); const target = await downloadFile({ url: 'https://example.com/setup.exe', digest: 'sha256:' + digest }, directory);
  assert.equal(fs.readFileSync(target, 'utf8'), 'test-installer'); assert.equal(fs.readdirSync(directory).length, 1);
});
test('bad hashes and HTML download pages leave no completed installer', async t => {
  const original = global.fetch; t.after(() => { global.fetch = original; }); const directory = temp(t);
  global.fetch = async () => new Response('bad-installer', { headers: { 'content-type': 'application/octet-stream' } });
  await assert.rejects(downloadFile({ url: 'https://example.com/setup.exe', digest: 'sha256:' + '0'.repeat(64) }, directory), /SHA-256/);
  assert.equal(fs.readdirSync(directory).length, 0);
  global.fetch = async () => new Response('<html>', { headers: { 'content-type': 'text/html' } });
  await assert.rejects(downloadFile({ url: 'https://example.com/setup.exe' }, directory), /web sayfası/);
  assert.equal(fs.readdirSync(directory).length, 0);
});
