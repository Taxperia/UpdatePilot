'use strict';
const { compare } = require('./versioning');
const { httpsUrl } = require('./download');
const { pickAsset } = require('./github');
const REPOS = {
  'GitHub.cli': 'cli/cli', 'Git.Git': 'git-for-windows/git', 'Microsoft.PowerToys': 'microsoft/PowerToys',
  'DBeaver.DBeaver.Community': 'dbeaver/dbeaver', 'Tailscale.Tailscale': 'tailscale/tailscale',
  'Notepad++.Notepad++': 'notepad-plus-plus/notepad-plus-plus', 'RustDesk.RustDesk': 'rustdesk/rustdesk',
  'WinDirStat.WinDirStat': 'windirstat/windirstat', 'Zen-Team.Zen-Browser': 'zen-browser/desktop'
};
function architecture(row) { return row.architecture === 'ia32' ? 'x86' : row.architecture || (process.arch === 'ia32' ? 'x86' : process.arch); }
function stableVersion(value) { return typeof value === 'string' && /^v?\d+(?:\.\d+){1,3}$/.test(value); }
function descending(a, b) { return compare(b.version, a.version) || 0; }
function nodeChannels(releases, installed) {
  const stable = releases.filter(r => /^v\d+\.\d+\.\d+$/.test(r.version) && Array.isArray(r.files)).sort(descending);
  if (!stable.length) throw new Error('Resmi Node.js sürüm listesi geçersiz.');
  const major = String(installed || '').replace(/^v/, '').split('.')[0];
  const selections = [
    ['latest', 'En yeni genel sürüm (Current)', stable[0]],
    ['lts', 'En yeni LTS sürümü', stable.find(r => typeof r.lts === 'string' && r.lts)],
    ['series', 'Kurulu ' + major + ' serisinin güncellemesi', stable.find(r => r.version.slice(1).split('.')[0] === major)]
  ];
  return selections.filter(([, , release]) => release).map(([id, label, release]) => ({
    id, label, version: release.version.slice(1), date: release.date, files: release.files,
    major_change: release.version.slice(1).split('.')[0] !== major
  }));
}
class OfficialSources {
  constructor(github, fetcher = (...args) => fetch(...args)) { this.github = github; this.fetch = fetcher; }
  identify(row) {
    const id = row.package_id || '';
    if (/^OpenJS\.NodeJS(?:\.(?:LTS|\d+))?$/.test(id) || /^Node\.js(?: \(LTS\))?$/i.test(row.name || '')) return 'node';
    if (id === 'Anysphere.Cursor' || /^Cursor(?: \(User\))?$/i.test(row.name || '')) return 'cursor';
    if (id === 'Microsoft.VisualStudioCode' || /^Microsoft Visual Studio Code(?: \(User\))?$/i.test(row.name || '')) return 'vscode';
    if (['Mozilla.Firefox', 'Mozilla.Firefox.ESR'].includes(id) || /^Mozilla Firefox(?: ESR)? \(/i.test(row.name || '')) return 'firefox';
    if (id === 'Google.Chrome' || /^Google Chrome$/i.test(row.name || '')) return 'chrome';
    if (REPOS[id]) return 'github:' + REPOS[id];
    return null;
  }
  async response(url) {
    const result = await this.fetch(httpsUrl(url), { headers: { 'User-Agent': 'UpdatePilot/' + require('../package.json').version }, signal: AbortSignal.timeout(30000) });
    if (!result.ok) throw new Error('Resmi sürüm isteği başarısız: HTTP ' + result.status);
    return result;
  }
  async json(url, cache) {
    if (!cache.has(url)) cache.set(url, this.response(url).then(r => r.json()));
    return cache.get(url);
  }
  async check(row, { cache = new Map(), token = '', skipPre = true } = {}) {
    const provider = this.identify(row); if (!provider) return null;
    const arch = architecture(row);
    if (provider === 'node') {
      const releases = await this.json('https://nodejs.org/dist/index.json', cache);
      if (!Array.isArray(releases)) throw new Error('Resmi Node.js sürüm listesi geçersiz.');
      const channels = nodeChannels(releases, row.version);
      return { provider, latest: channels[0].version, latest_url: 'https://nodejs.org/en/download', channels,
        source_name: 'Node.js resmi sürüm API’si', source_url: 'https://nodejs.org/dist/index.json' };
    }
    if (provider === 'cursor' || provider === 'vscode') {
      if (!['x64', 'arm64', 'x86'].includes(arch)) throw new Error('İşlemci mimarisi desteklenmiyor.');
      const platform = 'win32-' + arch + (row.scope === 'user' || /\(User\)/i.test(row.name) ? '-user' : '');
      const source = provider === 'cursor' ? `https://cursor.com/api/download?platform=${platform}&releaseTrack=stable`
        : `https://update.code.visualstudio.com/api/update/${platform}/stable/latest`;
      const info = await this.json(source, cache);
      const version = provider === 'cursor' ? info.version : info.productVersion;
      if (!stableVersion(version)) throw new Error('Resmi sürüm verisi tanınamadı.');
      const url = httpsUrl(provider === 'cursor' ? info.downloadUrl : info.url);
      const host = new URL(url).hostname;
      if (provider === 'cursor' ? !['downloads.cursor.com', 'download.todesktop.com', 'cursor.blob.core.windows.net'].includes(host)
        : !['vscode.download.prss.microsoft.com', 'az764295.vo.msecnd.net', 'update.code.visualstudio.com'].includes(host)) throw new Error('Resmi yükleyici sunucusu doğrulanamadı.');
      const digest = info.sha256hash && /^[a-f0-9]{64}$/i.test(info.sha256hash) ? 'sha256:' + info.sha256hash : '';
      return { provider, latest: version, latest_url: provider === 'cursor' ? 'https://cursor.com/download' : 'https://code.visualstudio.com/updates',
        source_name: provider === 'cursor' ? 'Cursor resmi indirme API’si' : 'Microsoft VS Code resmi güncelleme API’si', source_url: source,
        asset: { url, name: decodeURIComponent(new URL(url).pathname.split('/').at(-1)), digest } };
    }
    if (provider === 'firefox') {
      const source = 'https://product-details.mozilla.org/1.0/firefox_versions.json';
      const info = await this.json(source, cache);
      const esr = row.package_id === 'Mozilla.Firefox.ESR' || /\bESR\b/i.test(row.name);
      const version = esr ? [info.FIREFOX_ESR, info.FIREFOX_ESR_NEXT].filter(Boolean).map(v => v.replace(/esr$/, '')).sort((a, b) => compare(b, a) || 0)[0] : info.LATEST_FIREFOX_VERSION;
      if (!stableVersion(version)) throw new Error('Resmi Firefox sürümü tanınamadı.');
      return { provider, latest: version, latest_url: 'https://www.mozilla.org/firefox/releases/', source_name: 'Mozilla resmi sürüm API’si', source_url: source, esr };
    }
    if (provider === 'chrome') {
      const platform = arch === 'x86' ? 'win' : arch === 'arm64' ? 'win_arm64' : 'win64';
      const source = `https://versionhistory.googleapis.com/v1/chrome/platforms/${platform}/channels/stable/versions?pageSize=1`;
      const info = await this.json(source, cache); const version = info.versions?.[0]?.version;
      if (!stableVersion(version)) throw new Error('Resmi Chrome sürümü tanınamadı.');
      return { provider, latest: version, latest_url: 'https://www.google.com/chrome/', source_name: 'Google resmi sürüm API’si', source_url: source };
    }
    const repo = provider.slice(7), key = 'github:' + repo;
    if (!cache.has(key)) cache.set(key, this.github.latest(repo, token, skipPre));
    const rel = await cache.get(key);
    const version = repo === 'git-for-windows/git' ? rel.version.replace(/\.windows\./, '.') : rel.version;
    return { provider, latest: version, latest_url: rel.url, source_name: 'Yayıncının resmi GitHub Releases deposu', source_url: 'https://github.com/' + repo,
      asset: pickAsset(rel.assets || [], arch) };
  }
  async asset(row, track = 'latest') {
    const info = row.official_data;
    if (!info) throw new Error('Resmi sürüm doğrulanmamış. Önce kontrol edin.');
    const arch = architecture(row);
    if (info.provider === 'node') {
      const channel = info.channels.find(c => c.id === track);
      if (!channel) throw new Error('Sürüm kanalı bulunamadı.');
      const format = channel.files.includes(`win-${arch}-msi`) ? 'msi' : channel.files.includes(`win-${arch}-zip`) ? 'zip' : null;
      if (!format) throw new Error('Seçilen Node.js sürümünde bu mimari için Windows yükleyicisi yok.');
      const filename = `node-v${channel.version}-${format === 'msi' ? arch : 'win-' + arch}.${format}`;
      const base = `https://nodejs.org/dist/v${channel.version}/`;
      const sums = await (await this.response(base + 'SHASUMS256.txt')).text();
      const hash = sums.split(/\r?\n/).map(line => line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i)).find(m => m?.[2] === filename)?.[1];
      if (!hash) throw new Error('Node.js yükleyicisinin resmi SHA-256 özeti bulunamadı.');
      return { url: base + filename, name: filename, digest: 'sha256:' + hash, version: channel.version };
    }
    if (track !== 'latest') throw new Error('Bu uygulamada farklı sürüm kanalı yok.');
    if (info.provider === 'firefox') {
      const locale = row.name.match(/\((?:x64|x86|arm64) ([A-Za-z]{2,3}(?:-[A-Za-z]{2})?)\)/)?.[1] || 'en-US';
      const platform = arch === 'x86' ? 'win32' : arch === 'arm64' ? 'win64-aarch64' : 'win64';
      const version = info.latest + (info.esr ? 'esr' : '');
      const filename = 'Firefox Setup ' + info.latest + (info.esr ? 'esr' : '') + '.exe';
      return { url: `https://archive.mozilla.org/pub/firefox/releases/${version}/${platform}/${locale}/${encodeURIComponent(filename)}`, name: filename, version: info.latest };
    }
    if (info.provider === 'chrome') {
      if (row.package_id && row.catalog_latest === info.latest) return null;
      if (!['x64', 'x86'].includes(arch)) throw new Error('Bu mimaride Chrome için resmi indirme sayfasını kullanın.');
      // Google's canonical enterprise installer is an evergreen download, not a version-pinned archive.
      const filename = 'googlechromestandaloneenterprise' + (arch === 'x64' ? '64' : '') + '.msi';
      return { url: 'https://dl.google.com/dl/chrome/install/' + filename, name: filename, version: info.latest, evergreen: true };
    }
    if (!info.asset) throw new Error('Resmi sürüm için uygun Windows kurulum dosyası bulunamadı.');
    return { ...info.asset, version: info.latest };
  }
}
module.exports = { OfficialSources, nodeChannels, architecture };
