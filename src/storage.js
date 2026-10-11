'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DEFAULT_PREFERENCES } = require('./preferences');
const DEFAULTS = { settings: { ...DEFAULT_PREFERENCES, token: '' }, repos: {}, ignored: {}, manual: [], known: {}, last_scan: null, last_check: null };
class Storage {
  constructor({ dataDir, downloadDir } = {}) {
    this.dataDir = dataDir || process.env.UPDATEPILOT_DATA_DIR || path.join(process.env.LOCALAPPDATA || os.homedir(), 'UpdatePilot');
    this.downloadDir = downloadDir || process.env.UPDATEPILOT_DOWNLOAD_DIR || path.join(os.homedir(), 'Downloads', 'UpdatePilot');
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.configPath = path.join(this.dataDir, 'config.json');
    this.historyPath = path.join(this.dataDir, 'history.jsonl');
  }
  load() {
    const config = structuredClone(DEFAULTS);
    if (!fs.existsSync(this.configPath)) return config;
    let saved;
    try { saved = JSON.parse(fs.readFileSync(this.configPath, 'utf8').replace(/^\uFEFF/, '')); }
    catch (error) { throw new Error('Ayar dosyası okunamadı; mevcut veriler korunuyor: ' + error.message); }
    // Preserve the Python configuration before the first Node migration.
    const backup = this.configPath + '.python-backup';
    if (!fs.existsSync(backup)) fs.copyFileSync(this.configPath, backup);
    for (const key of ['settings', 'repos', 'ignored', 'known']) {
      if (saved[key] && typeof saved[key] === 'object' && !Array.isArray(saved[key])) Object.assign(config[key], saved[key]);
    }
    config.manual = Array.isArray(saved.manual) ? saved.manual : [];
    config.last_scan = saved.last_scan || null; config.last_check = saved.last_check || null;
    return config;
  }
  save(config) {
    const temp = this.configPath + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, this.configPath);
  }
  append(type, program, detail = '') {
    fs.appendFileSync(this.historyPath, JSON.stringify({ ts: new Date().toISOString(), type, program, detail }) + '\n', 'utf8');
  }
  history(limit = 200) {
    if (!fs.existsSync(this.historyPath)) return [];
    return fs.readFileSync(this.historyPath, 'utf8').trim().split(/\r?\n/).slice(-limit).flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    }).reverse();
  }
  clearHistory() { fs.writeFileSync(this.historyPath, '', 'utf8'); }
}
module.exports = { Storage };
