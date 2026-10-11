'use strict';
const { parse } = require('./versioning');
function repoName(value) {
  const repo = String(value || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/$/, '');
  if (repo && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('Depoyu kullanici/depo biçiminde girin.');
  return repo;
}
function release(raw) {
  const tag = raw.tag_name || '';
  const version = tag.replace(/^v(?=\d)/i, '');
  return { tag, version, name: raw.name || tag, url: raw.html_url, body: raw.body || '', published: raw.published_at,
    prerelease: raw.prerelease, assets: (raw.assets || []).map(a => ({ name: a.name, url: a.browser_download_url, size: a.size, digest: a.digest || '' })) };
}
class GitHub {
  constructor() { this.remaining = null; }
  async request(endpoint, token = '') {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'UpdatePilot/3.0', 'X-GitHub-Api-Version': '2022-11-28' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const result = await fetch('https://api.github.com' + endpoint, { headers, signal: AbortSignal.timeout(30000) });
    if (result.headers.has('x-ratelimit-remaining')) this.remaining = Number(result.headers.get('x-ratelimit-remaining'));
    if (!result.ok) {
      if (result.status === 403 || result.status === 429) throw new Error('GitHub istek sınırı aşıldı. Ayarlardan token ekleyin veya daha sonra deneyin.');
      throw new Error('GitHub isteği başarısız: HTTP ' + result.status);
    }
    return result.json();
  }
  async releases(repo, token) {
    return (await this.request('/repos/' + repoName(repo) + '/releases?per_page=30', token)).filter(r => !r.draft).map(release);
  }
  async latest(repo, token, skipPre = true) {
    const releases = await this.releases(repo, token);
    const latest = releases.find(r => (!skipPre || !r.prerelease) && parse(r.version));
    if (!latest) throw new Error('Karşılaştırılabilir bir sürüm yayımlanmamış.');
    return latest;
  }
  async suggest(query, token) {
    const data = await this.request('/search/repositories?q=' + encodeURIComponent(query + ' in:name') + '&sort=stars&per_page=5', token);
    return (data.items || []).map(item => ({ full_name: item.full_name, description: item.description, stars: item.stargazers_count }));
  }
}
function pickAsset(assets, architecture = process.arch) {
  const arch = architecture === 'ia32' ? 'x86' : architecture;
  const candidates = assets.filter(a => /\.(exe|msi|msix|msixbundle|zip)$/i.test(a.name) && !/(?:linux|ubuntu|darwin|macos|mac[-_.]|osx|\.dmg|\.app\.)/i.test(a.name));
  const scored = candidates.flatMap(a => {
    const name = a.name.toLowerCase();
    const arm = /(?:arm64|aarch64)/.test(name), x64 = /(?:x64|amd64|win64|x86_64|64[-_ ]?bit)/.test(name);
    const x86 = !x64 && /(?:x86|ia32|win32|i686|32[-_ ]?bit)/.test(name);
    if ((arm && arch !== 'arm64') || (x64 && arch !== 'x64') || (x86 && arch !== 'x86')) return [];
    let score = /\.(exe|msi)$/.test(name) ? 10 : /\.msix/.test(name) ? 8 : 1;
    if (arm || x64 || x86) score += 10;
    if (/(?:windows|win-|win\.)/.test(name)) score += 5;
    if (/(?:setup|installer)/.test(name)) score += 3;
    if (/(?:source|symbols|debug|pdb)/.test(name)) return [];
    return [{ asset: a, score }];
  }).sort((a, b) => b.score - a.score);
  return scored[0]?.asset || null;
}
module.exports = { GitHub, repoName, pickAsset };
