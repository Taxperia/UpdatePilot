'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Storage } = require('./storage');
const { scanInstalled } = require('./scanner');
const { Winget, matchPackage, cleanOutput } = require('./winget');
const { GitHub, repoName, pickAsset } = require('./github');
const { compare } = require('./versioning');
const { downloadFile, httpsUrl, safeFilename } = require('./download');
const { OfficialSources } = require('./official-sources');
const { DEFAULT_PREFERENCES, preferenceChanges } = require('./preferences');
const now = () => new Date().toISOString();
const STATUS = { ok: 'Güncel', 'catalog-ok': 'Katalogda güncel', 'catalog-old': 'Katalog eski', update: 'Güncelleme var', ignore: 'Yoksayıldı', nomatch: 'Eşleşme yok', error: 'Kontrol edilemedi', unknown: 'Sürüm bilinmiyor' };
class AppState {
  constructor({ storage = new Storage(), scanner = scanInstalled, winget = new Winget(), github = new GitHub(), official, download = downloadFile, notify = () => {} } = {}) {
    this.storage = storage; this.scanner = scanner; this.winget = winget; this.github = github; this.download = download; this.notify = notify;
    this.official = official || new OfficialSources(github);
    this.cfg = storage.load(); this.programs = []; this.manual = []; this.scanRunning = false; this.checkRunning = false;
    this.message = 'Hazır'; this.progressCode = 'ready'; this.progressArgs = {}; this.summary = null; this.downloads = {}; this.downloadJobs = new Map(); this.jobs = new Set(); this.rebuildManual();
  }
  track(promise) { this.jobs.add(promise); promise.finally(() => this.jobs.delete(promise)).catch(() => {}); return promise; }
  async idle() { while (this.jobs.size) await Promise.allSettled([...this.jobs]); }
  rebuildManual() {
    this.manual = this.cfg.manual.map(entry => ({ publisher: '(manuel paket)', date: (entry.added || '').slice(0, 10), location: '', size: '', status: 'unknown', latest_url: '', note: '', checked: '', ...entry, key: 'm:' + entry.id, is_manual: true, entry }));
  }
  rows() { return [...this.programs, ...this.manual]; }
  row(key) { const row = this.rows().find(p => p.key === key); if (!row) throw new Error('Program bulunamadı.'); return row; }
  save() { this.storage.save(this.cfg); }
  sendNotification(event) {
    try { Promise.resolve(this.notify(event)).catch(error => this.storage.append('notification_error', 'UpdatePilot', error.message)); }
    catch (error) { this.storage.append('notification_error', 'UpdatePilot', error.message); }
  }
  status(row, latest) {
    const diff = compare(latest, row.version);
    if (diff === null) return 'unknown';
    if (this.cfg.ignored[row.name] && compare(this.cfg.ignored[row.name], latest) === 0) return 'ignore';
    return diff > 0 ? 'update' : 'ok';
  }
  startScan() {
    if (this.scanRunning || this.checkRunning) throw new Error('Devam eden tarama veya kontrolü bekleyin.');
    this.scanRunning = true; this.message = 'Programlar taranıyor…';
    this.progressCode = 'progress_scan'; this.progressArgs = {};
    this.track((async () => {
      try {
        const installed = await this.scanner(this.cfg.settings.include_user_scope);
        let packages = [], catalogError = '';
        try { packages = await this.winget.list(this.cfg.settings.include_user_scope); } catch (error) { catalogError = error.message; }
        const matched = new Set();
        const old = new Map(this.programs.map(row => [row.key, row]));
        this.programs = installed.map(p => {
          const pkg = matchPackage(p, packages);
          if (pkg) matched.add(pkg.id + '@' + pkg.version);
          const row = { latest: '', latest_url: '', note: '', checked: '', status: p.version ? 'nomatch' : 'unknown', ...p,
            key: p.name, repo: this.cfg.repos[p.name] || '', package_id: pkg?.id || '', is_manual: false };
          if (pkg) row.catalog = pkg;
          const previous = old.get(row.key);
          if (previous?.version === row.version && previous?.repo === row.repo) {
            for (const field of ['latest', 'latest_url', 'note', 'checked', 'status', 'assets', 'official_data', 'version_source', 'source_name', 'source_url', 'source_error', 'channels', 'catalog_latest']) if (previous[field] !== undefined) row[field] = previous[field];
          }
          return row;
        });
        for (const pkg of packages) {
          if (matched.has(pkg.id + '@' + pkg.version)) continue;
          matched.add(pkg.id + '@' + pkg.version);
          // Also include catalogue-discovered apps absent from the traditional uninstall registry.
          this.programs.push({ name: pkg.name, version: /^[<>]|unknown|bilinmiyor/i.test(pkg.version) ? '' : pkg.version,
            key: 'w:' + pkg.id + ':' + pkg.version, publisher: '', date: '', size: '', location: '', repo: this.cfg.repos[pkg.name] || '',
            package_id: pkg.id, catalog: pkg, latest: '', latest_url: '', note: '', checked: '', status: 'unknown', is_manual: false });
        }
        for (const row of this.programs) {
          const previous = this.cfg.known[row.name];
          if (previous?.version && row.version && compare(row.version, previous.version) !== 0 && compare(row.version, previous.version) !== null) this.storage.append('program_guncellendi', row.name, previous.version + ' → ' + row.version);
          this.cfg.known[row.name] = { ...previous, version: row.version, ts: now() };
        }
        this.cfg.last_scan = now(); this.save();
        this.message = `${this.programs.length} kurulu program bulundu.${catalogError ? ' ' + catalogError : ''}`;
        this.progressCode = 'progress_scan_complete'; this.progressArgs = { count:this.programs.length };
        this.storage.append('tarama', 'Sistem', this.message);
      } catch (error) { this.message = 'Tarama hatası: ' + error.message; this.progressCode = 'progress_error'; this.progressArgs = {}; this.storage.append('hata', 'Tarama', error.message); }
      finally { this.scanRunning = false; }
      if (this.cfg.settings.auto_check && this.programs.length) this.startCheck(undefined, true);
    })());
    return { ok: true };
  }
  startCheck(keys, useScanCatalog = false) {
    if (this.checkRunning || this.scanRunning) throw new Error('Devam eden tarama veya kontrolü bekleyin.');
    const targets = keys ? keys.map(key => this.row(key)) : this.rows();
    this.checkRunning = true; this.message = 'Güncellemeler kontrol ediliyor…';
    this.progressCode = 'progress_check'; this.progressArgs = { done:0, total:targets.length };
    this.track((async () => {
      let packages = [], catalogError = '', completed = 0;
      try {
        if (targets.some(p => !p.is_manual && !p.repo)) {
          if (useScanCatalog && this.winget.available) packages = this.programs.map(p => p.catalog).filter(Boolean);
          else { try { packages = await this.winget.list(this.cfg.settings.include_user_scope); } catch (error) { catalogError = error.message; } }
        }
        const latestPromises = new Map(), releasePromises = new Map(), officialCache = new Map();
        let cursor = 0;
        const worker = async () => {
          while (cursor < targets.length) {
            const row = targets[cursor++];
            try {
              row.official_data = null; row.channels = []; row.source_error = ''; row.version_source = ''; row.assets = [];
              if (row.repo) {
                if (!releasePromises.has(row.repo)) releasePromises.set(row.repo, this.github.latest(row.repo, this.cfg.settings.token, this.cfg.settings.skip_prerelease));
                const rel = await releasePromises.get(row.repo);
                Object.assign(row, { latest: rel.version, latest_url: rel.url, note: rel.name, assets: rel.assets });
                row.status = this.status(row, rel.version);
                Object.assign(row, { version_source: 'github', source_name: 'Atanan GitHub Releases deposu', source_url: 'https://github.com/' + row.repo });
              } else if (row.is_manual) {
                row.status = row.url && row.latest ? this.status(row, row.latest) : 'unknown';
                row.latest_url = row.url || ''; row.note = row.latest ? '' : 'Bilinen en yeni sürüm girilmemiş.';
                Object.assign(row, { version_source: 'manual', source_name: 'Elle girilen sürüm', source_url: row.url });
              } else {
                const pkg = packages.find(p => p.id === row.package_id && compare(p.version, row.version) === 0) || matchPackage(row, packages);
                if (pkg) { row.package_id = pkg.id; row.catalog_latest = pkg.latest || ''; }
                let officialResult;
                try { officialResult = await this.official.check(row, { cache: officialCache, token: this.cfg.settings.token, skipPre: this.cfg.settings.skip_prerelease }); }
                catch (error) { row.source_error = 'Resmi kaynak doğrulanamadı: ' + error.message; }
                if (officialResult) {
                Object.assign(row, { official_data: officialResult, source_provider:officialResult.provider, latest: officialResult.latest, latest_url: officialResult.latest_url,
                    version_source: 'official', source_name: officialResult.source_name, source_url: officialResult.source_url,
                    channels: (officialResult.channels || []).map(({ files, ...channel }) => channel), note: officialResult.source_name });
                  row.status = this.status(row, row.latest);
                } else if (catalogError) throw new Error([row.source_error, catalogError].filter(Boolean).join(' '));
                else if (!pkg) { Object.assign(row, { status: row.source_error ? 'error' : 'nomatch', latest: '', package_id: '', note: row.source_error || 'Resmi sürüm kaynağı ve katalog eşleşmesi bulunamadı. GitHub deposu veya manuel paket ekleyebilirsiniz.' }); }
                else {
                  row.package_id = pkg.id;
                  if (!latestPromises.has(pkg.id)) latestPromises.set(pkg.id, pkg.latest ? Promise.resolve(pkg.latest) : this.winget.latest(pkg.id));
                  row.latest = await latestPromises.get(pkg.id);
                  row.latest_url = 'https://github.com/microsoft/winget-pkgs/tree/master/manifests/' + pkg.id[0].toLowerCase() + '/' + pkg.id.split('.').map(encodeURIComponent).join('/');
                  Object.assign(row, { version_source: 'catalog', source_name: 'WinGet kataloğu — resmi site doğrulanmadı', source_url: row.latest_url });
                  row.note = [row.source_error, 'WinGet: ' + pkg.id + '. Bu değer katalog sürümüdür; resmi sitenin en yeni sürümü doğrulanmadı.'].filter(Boolean).join(' ');
                  row.status = this.status(row, row.latest);
                  // WinGet may use version mappings that differ from DisplayVersion. Its update signal is authoritative.
                  if (pkg.latest && row.version && row.status !== 'ignore') row.status = 'update';
                  if (row.status === 'ok') row.status = compare(row.latest, row.version) < 0 ? 'catalog-old' : 'catalog-ok';
                }
              }
              row.checked = now();
              if (row.status === 'update') {
                const known = this.cfg.known[row.name] || {};
                if (known.latest !== row.latest) this.storage.append('guncelleme_bulundu', row.name, row.version + ' → ' + row.latest);
                this.cfg.known[row.name] = { ...known, latest: row.latest };
              }
            } catch (error) { row.status = 'error'; row.note = error.message; row.checked = now(); }
            if (row.entry) Object.assign(row.entry, { latest: row.latest, latest_url: row.latest_url, note: row.note, status: row.status, checked: row.checked });
            this.message = `Güncellemeler kontrol ediliyor… ${++completed}/${targets.length}`;
            this.progressArgs = { done:completed, total:targets.length };
          }
        };
        await Promise.all(Array.from({ length: Math.min(4, targets.length) }, worker));
        this.summary = { total: targets.length, updates: targets.filter(p => p.status === 'update').length, errors: targets.filter(p => p.status === 'error').length, unmatched: targets.filter(p => p.status === 'nomatch').length, ts: now() };
        this.cfg.last_check = this.summary.ts; this.save();
        this.message = `Kontrol tamamlandı: ${this.summary.total} program, ${this.summary.updates} güncelleme, ${this.summary.errors} hata, ${this.summary.unmatched} eşleşmeyen.`;
        this.progressCode = 'progress_complete'; this.progressArgs = this.summary;
        if (this.summary.updates && this.cfg.settings.toasts) this.sendNotification({ kind:'updates', count:this.summary.updates, keys:targets.filter(p => p.status === 'update').map(p => p.key + '@' + p.latest).sort() });
      } catch (error) { this.message = 'Kontrol hatası: ' + error.message; this.progressCode = 'progress_error'; this.progressArgs = {}; this.storage.append('hata', 'Kontrol', error.message); }
      finally { this.checkRunning = false; }
      if (this.cfg.settings.auto_download) this.queueAutoDownloads();
    })());
    return { ok: true };
  }
  startDownload(key, track = 'latest') {
    const row = this.row(key);
    if (this.downloads[row.name]?.running) throw new Error('Bu program zaten indiriliyor.');
    if (this.checkRunning || this.scanRunning) throw new Error('Güncelleme kontrolünün bitmesini bekleyin.');
    const officialPackage = !row.repo && !!row.official_data;
    const nativePackage = !officialPackage && !row.repo && !!row.package_id;
    let asset = row.repo ? pickAsset(row.assets || [], row.architecture || process.arch) : row.url ? { url: httpsUrl(row.url) } : null;
    if (nativePackage && !row.latest) throw new Error('Önce güncellemeleri kontrol edin.');
    if (!nativePackage && !officialPackage && !asset) throw new Error('Bu sürüm için mimarinize uygun Windows kurulum dosyası bulunamadı.');
    if (row.version_source === 'catalog' && row.status === 'catalog-old') throw new Error('Katalog kurulu sürümden eski; eski paket indirilmeyecek.');
    if (track !== 'latest' && !officialPackage) throw new Error('Bu uygulamada farklı sürüm kanalı yok.');
    const snapshot = structuredClone(row);
    this.downloads[row.name] = { msg: 'Başlatılıyor…', running: true };
    const progress = msg => { this.downloads[row.name].msg = msg; };
    const job = this.track((async () => {
      let staging;
      try {
        fs.mkdirSync(this.storage.downloadDir, { recursive: true });
        if (officialPackage) asset = await this.official.asset(snapshot, track);
        let target;
        if (nativePackage || (officialPackage && !asset)) {
          const base = path.join(this.storage.downloadDir, safeFilename(snapshot.package_id + '-' + snapshot.latest));
          let directory = base, index = 1;
          while (fs.existsSync(directory)) directory = base + '-' + index++;
          staging = directory + '.part'; fs.mkdirSync(staging);
          await this.winget.download(snapshot, staging, output => {
            const match = cleanOutput(output).match(/\d+(?:\.\d+)?\s*(?:KB|MB|GB)\s*\/\s*\d+(?:\.\d+)?\s*(?:KB|MB|GB)/g);
            if (match) progress(match.at(-1));
            else progress('Paket indiriliyor ve doğrulanıyor…');
          });
          if (!fs.readdirSync(staging).some(name => /\.(exe|msi|msix|appx|msixbundle|appxbundle|zip)$/i.test(name))) throw new Error('WinGet tamamlandı fakat kurulum dosyası bulunamadı.');
          fs.renameSync(staging, directory); staging = null; target = directory;
        } else target = await this.download(asset, this.storage.downloadDir, progress);
        this.storage.append('indirildi', row.name, target);
        this.downloads[row.name] = { msg: 'Tamamlandı: ' + target, running: false, path: target, version: asset?.version || snapshot.latest };
        this.sendNotification({ kind:'download', name:row.name, key:row.key, version:asset?.version || snapshot.latest, path:target });
      } catch (error) {
        // Only remove this job's freshly created staging directory under Downloads/UpdatePilot.
        if (staging && path.dirname(staging) === path.resolve(this.storage.downloadDir)) fs.rmSync(staging, { recursive: true, force: true });
        this.downloads[row.name] = { msg: 'Hata: ' + error.message, running: false, error:error.message };
        this.storage.append('hata', row.name, error.message);
        this.sendNotification({ kind:'error', name:row.name, key:row.key, version:snapshot.latest });
      }
    })());
    this.downloadJobs.set(key, job); job.finally(() => { if (this.downloadJobs.get(key) === job) this.downloadJobs.delete(key); }).catch(() => {});
    return { ok: true };
  }
  queueAutoDownloads() {
    const keys = this.rows().filter(row => row.status === 'update' && !this.downloads[row.name]?.running && this.downloads[row.name]?.version !== row.latest).map(row => row.key);
    let cursor = 0;
    this.track(Promise.all(Array.from({ length:Math.min(2, keys.length) }, async () => {
      while (cursor < keys.length && this.cfg.settings.auto_download) {
        const key = keys[cursor++];
        try { this.startDownload(key); await this.downloadJobs.get(key); } catch (error) { this.storage.append('hata', this.row(key).name, error.message); }
      }
    })));
  }
  saveRepo(key, value) {
    const row = this.row(key), repo = repoName(value);
    if (repo) this.cfg.repos[row.name] = repo; else delete this.cfg.repos[row.name];
    row.repo = repo; row.latest = ''; row.assets = []; row.checked = '';
    if (row.entry) row.entry.repo = repo;
    this.save(); if (!this.checkRunning && !this.scanRunning) this.startCheck([key]);
    return { ok: true };
  }
  ignore(key, undo = false) {
    const row = this.row(key);
    if (undo) { delete this.cfg.ignored[row.name]; this.storage.append('yoksayma_kaldirildi', row.name); }
    else {
      if (!row.latest) throw new Error('Yoksayılacak sürüm bulunamadı.');
      this.cfg.ignored[row.name] = row.latest; row.status = 'ignore';
      if (row.entry) row.entry.status = 'ignore';
      this.storage.append('yoksayildi', row.name, row.latest);
    }
    this.save(); if (undo && !this.checkRunning && !this.scanRunning) this.startCheck([key]);
    return { ok: true };
  }
  saveManual(data) {
    const fields = Object.fromEntries(['name', 'version', 'latest', 'notes', 'url'].map(k => [k, String(data[k] || '').trim()]));
    fields.repo = repoName(data.repo);
    if (!fields.name || !(fields.repo || fields.url)) throw new Error('Ad ve depo ya da indirme bağlantısı gerekli.');
    if (fields.url) fields.url = httpsUrl(fields.url);
    let entry;
    if (data.id != null) { entry = this.cfg.manual.find(e => e.id === Number(data.id)); if (!entry) throw new Error('Manuel paket bulunamadı.'); Object.assign(entry, fields); }
    else { entry = { ...fields, id: Math.max(0, ...this.cfg.manual.map(e => e.id)) + 1, added: now(), status: 'unknown' }; this.cfg.manual.push(entry); }
    entry.status = this.status(entry, entry.latest); this.storage.append('manuel_eklendi', entry.name);
    this.save(); this.rebuildManual(); if (entry.repo && !this.checkRunning && !this.scanRunning) this.startCheck(['m:' + entry.id]);
    return { ok: true, id: entry.id };
  }
  deleteManual(id) {
    const entry = this.cfg.manual.find(e => e.id === Number(id)); if (!entry) throw new Error('Manuel paket bulunamadı.');
    this.cfg.manual = this.cfg.manual.filter(e => e !== entry); this.storage.append('manuel_silindi', entry.name); this.save(); this.rebuildManual(); return { ok: true };
  }
  mark(key) {
    const row = this.row(key); if (!row.entry || !row.latest) throw new Error('Önce en yeni sürümü girin.');
    row.entry.version = row.latest; row.entry.status = 'ok'; this.storage.append('isaretlendi', row.name, row.latest); this.save(); this.rebuildManual(); return { ok: true };
  }
  settings(data) {
    Object.assign(this.cfg.settings, preferenceChanges(data));
    this.save(); const { token, ...settings } = this.cfg.settings; return { ok:true, settings };
  }
  resetSettings() { return this.settings(DEFAULT_PREFERENCES); }
  state() {
    const rows = this.rows().map(({ entry, catalog, assets, official_data, ...row }) => ({ ...row, assets: assets?.length || (official_data ? 1 : 0) }));
    const { token, ...settings } = this.cfg.settings;
    return { rows, stats: { total: this.programs.length, manual: this.manual.length, update: rows.filter(p => p.status === 'update').length, ok: this.programs.filter(p => ['ok', 'catalog-ok'].includes(p.status)).length },
      statuses: STATUS, progress: { scan: this.scanRunning, check: this.checkRunning, message: this.message, code:this.progressCode, args:this.progressArgs }, settings,
      last_scan: this.cfg.last_scan, last_check: this.cfg.last_check, rate: this.github.remaining, downloads: structuredClone(this.downloads), summary: this.summary,
      history: this.storage.history(), winget: { available: this.winget.available, error: this.winget.error } };
  }
}
module.exports = { AppState };
