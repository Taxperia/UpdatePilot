'use strict';
const { run } = require('./process');
const { compare } = require('./versioning');
const os = require('node:os');
function cleanOutput(text) {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\u0008/g, '').replace(/\r/g, '');
}
function parseList(text) {
  const lines = cleanOutput(text).split('\n');
  const divider = lines.findIndex(line => /^-{10,}\s*$/.test(line.trim()));
  if (divider < 1) return [];
  const header = lines[divider - 1];
  const columns = [...header.matchAll(/\S(?:.*?\S)?(?=\s{2,}|$)/g)].map(m => ({ name: m[0].trim(), start: m.index }));
  if (columns.length < 3) throw new Error('WinGet tablo biçimi tanınamadı.');
  const availableIndex = columns.findIndex(c => /^(Available|Kullanılabilir|Verfügbar|Disponible|Disponível|Disponibile|可用|Доступно)$/i.test(c.name));
  return lines.slice(divider + 1).flatMap(line => {
    // Package ids provide an unambiguous boundary even when the name contains wide Unicode characters.
    const candidates = [...line.matchAll(/(?<=\s)([A-Za-z0-9][A-Za-z0-9._+-]*\.[A-Za-z0-9._+-]+)(?=\s)/g)]
      .filter(m => /[a-z]/i.test(m[1]))
      .sort((a, b) => Math.abs(a.index - columns[1].start) - Math.abs(b.index - columns[1].start));
    const idMatch = candidates[0];
    if (!idMatch) return [];
    const tail = line.slice(idMatch.index + idMatch[1].length).trim().match(/^([<>]\s+\S+|\S+)(?:\s+(.*))?$/);
    if (!tail) return [];
    const name = line.slice(0, idMatch.index).trim();
    const version = tail[1] || '';
    const next = tail[2]?.trim().split(/\s+/)[0] || '';
    const latest = availableIndex >= 0 && next !== 'winget' ? next : '';
    return [{ name, id: idMatch[1], version, latest }];
  });
}
function parseShow(text) {
  const match = cleanOutput(text).match(/^\s*(?:Version|Sürüm|Versión|Versão|Versione|版本|Версия):\s*(\S+)\s*$/mi);
  if (!match) throw new Error('Katalog sürümü okunamadı.');
  return match[1];
}
class Winget {
  constructor(runner = run) { this.run = runner; this.available = false; this.error = ''; }
  async list(includeUser = true) {
    try {
      const args = ['list', '--source', 'winget', '--accept-source-agreements', '--disable-interactivity'];
      if (!includeUser) args.push('--scope', 'machine');
      const output = await this.run('winget.exe', args, { timeout: 180000 });
      const rows = parseList(output);
      if (!rows.length) throw new Error('WinGet kataloğunda eşleşen uygulama bulunamadı.');
      this.available = true; this.error = ''; return rows;
    } catch (error) {
      this.available = false;
      this.error = 'WinGet kullanılamıyor: ' + error.message;
      throw new Error(this.error);
    }
  }
  async latest(id) {
    return parseShow(await this.run('winget.exe', ['show', '--id', id, '--exact', '--source', 'winget', '--accept-source-agreements', '--disable-interactivity'], { timeout: 60000 }));
  }
  async download(row, directory, onOutput) {
    const args = ['download', '--id', row.package_id, '--exact', '--source', 'winget', '--version', row.latest,
      '--download-directory', directory, '--architecture', row.architecture || (os.arch() === 'arm64' ? 'arm64' : 'x64'),
      '--skip-dependencies', '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity'];
    // WinGet keeps its installer SHA-256 verification enabled.
    return this.run('winget.exe', args, { timeout: 30 * 60 * 1000, onOutput });
  }
}
function matchPackage(row, packages) {
  const normalize = name => name.toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim();
  const exact = packages.filter(p => normalize(p.name) === normalize(row.name));
  if (exact.length === 1) return exact[0];
  const sameVersion = exact.filter(p => compare(p.version, row.version) === 0);
  if (sameVersion.length) return sameVersion[0];
  // WinGet may truncate long names. Only accept one prefix match with the exact installed version.
  const truncated = packages.filter(p => p.name.endsWith('…') && normalize(row.name).startsWith(normalize(p.name.slice(0, -1))) && compare(p.version, row.version) === 0);
  return truncated.length === 1 ? truncated[0] : null;
}
module.exports = { Winget, parseList, parseShow, matchPackage, cleanOutput };
