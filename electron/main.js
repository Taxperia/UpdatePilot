'use strict';
const { app, BrowserWindow, ipcMain, shell, Notification, dialog, Tray, Menu, nativeImage, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { AppState } = require('../src/app-state');
const { Storage } = require('../src/storage');
const { httpsUrl } = require('../src/download');
const { DEFAULT_PREFERENCES, preferenceChanges } = require('../src/preferences');
const { DesktopServices } = require('../src/desktop-services');
const { UpdateScheduler } = require('../src/update-scheduler');
const { translate, translateError } = require('../web/i18n');
const smoke = process.argv.includes('--smoke');
const qa = process.argv.includes('--qa') || smoke;
const qaDir = process.env.UPDATEPILOT_QA_DIR || path.resolve(__dirname, '..', '.qa');
if (qa) app.setPath('userData', path.join(qaDir, 'electron-profile'));
app.setName('UpdatePilot');
const appId = qa ? 'com.updatepilot.desktop.qa' : 'com.updatepilot.desktop';
app.setAppUserModelId(appId);
let window, state, desktop, scheduler, tray, rescanTimer, pendingActivation, quitting = false;
const assets = path.resolve(__dirname, '..', 'assets');
const webFile = path.resolve(__dirname, '..', 'web', 'index.html');
const webUrl = pathToFileURL(webFile).href;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(start).catch(error => { console.error('UpdatePilot başlatılamadı:', error); dialog.showErrorBox('UpdatePilot başlatılamadı', error.message); app.quit(); });
}
function text(key, args) { return translate(state?.cfg.settings.language || 'en', key, args); }
function showWindow(page) {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore(); window.show(); window.focus();
  if (page) window.webContents.executeJavaScript(`switchPage(${JSON.stringify(page)})`).catch(() => {});
}
function activateNotification(event) {
  if (!window) { pendingActivation = event; return; }
  showWindow(event.kind === 'updates' || event.kind === 'test' ? 'dash' : 'programs');
  if (event.kind === 'download') openPath(state.storage.downloadDir).catch(error => desktop.fail(error));
  if (event.kind === 'error' && event.key) window.webContents.executeJavaScript(`openDrawer(${JSON.stringify(event.key)})`).catch(() => {});
}
function updateTray() {
  if (!tray && (state.cfg.settings.minimize_to_tray || state.cfg.settings.start_minimized)) {
    tray = new Tray(nativeImage.createFromPath(path.join(assets, 'tray.png'))); tray.setToolTip('UpdatePilot');
    tray.on('click', () => showWindow()); tray.on('double-click', () => showWindow());
  }
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label:text('show_app'), click:() => showWindow() },
    { label:text('check'), click:() => { showWindow(); if (!state.scanRunning && !state.checkRunning) state.startCheck(); } },
    { type:'separator' }, { label:text('quit'), click:requestQuit }
  ]));
}
function requestQuit() {
  if (!quitting && state?.cfg.settings.confirm_close && Object.values(state.downloads).some(item => item.running) && !qa) {
    const choice = dialog.showMessageBoxSync(window, { type:'question', title:text('close_download_title'), message:text('close_download_body'), buttons:[text('keep_running'),text('quit_now')], defaultId:0, cancelId:0 });
    if (choice !== 1) return false;
  }
  quitting = true; app.quit(); return true;
}
function applySettings(data, reset = false) {
  const previous = { ...state.cfg.settings };
  const changes = reset ? { ...DEFAULT_PREFERENCES } : preferenceChanges(data);
  let startupChanged = false;
  try {
    if ('open_at_login' in changes && changes.open_at_login !== previous.open_at_login) { desktop.setStartup(changes.open_at_login); startupChanged = true; }
    const result = state.settings(changes);
    nativeTheme.themeSource = state.cfg.settings.theme;
    scheduler.configure(state.cfg.settings); updateTray();
    if (changes.auto_download === true && !previous.auto_download && !state.scanRunning && !state.checkRunning && state.summary) state.queueAutoDownloads();
    if (changes.include_user_scope !== undefined && changes.include_user_scope !== previous.include_user_scope) {
      clearTimeout(rescanTimer);
      const rescan = () => { if (state.scanRunning || state.checkRunning) rescanTimer = setTimeout(rescan, 500); else state.startScan(); };
      rescan();
    }
    return result;
  } catch (error) {
    Object.assign(state.cfg.settings, previous);
    if (startupChanged) { try { desktop.setStartup(previous.open_at_login); } catch { /* Keep the original error. */ } }
    throw error;
  }
}
function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url.split('?')[0] !== webUrl) throw new Error('İstek kaynağı geçersiz.');
}
async function openPath(directory) {
  if (!directory || !fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()) throw new Error('Klasör kayıtlı değil.');
  const error = await shell.openPath(directory); if (error) throw new Error(error);
}
async function request(endpoint, body) {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) throw new Error('Geçersiz istek.');
  const url = new URL(endpoint, 'https://updatepilot.local');
  if (url.origin !== 'https://updatepilot.local') throw new Error('Geçersiz istek.');
  const data = body || {};
  if (typeof data !== 'object' || Array.isArray(data)) throw new Error('Geçersiz istek gövdesi.');
  switch (url.pathname) {
    case '/api/state': return { ...state.state(), desktop:{ notifications:{...desktop.status} } };
    case '/api/heartbeat': return { ok: true };
    case '/api/scan': return state.startScan();
    case '/api/check': return state.startCheck(data.keys);
    case '/api/download': return state.startDownload(data.key, data.track || 'latest');
    case '/api/repo': return state.saveRepo(data.key, data.repo);
    case '/api/ignore': return state.ignore(data.key);
    case '/api/unignore': return state.ignore(data.key, true);
    case '/api/mark': return state.mark(data.key);
    case '/api/manual/save': return state.saveManual(data);
    case '/api/manual/delete': return state.deleteManual(data.id);
    case '/api/settings': return applySettings(data);
    case '/api/settings/reset': return applySettings({}, true);
    case '/api/notifications/test': return { ok:true, ...await desktop.show({kind:'test'}, true) };
    case '/api/clear_history': state.storage.clearHistory(); return { ok: true };
    case '/api/suggest': return { items: await state.github.suggest(url.searchParams.get('q') || '', state.cfg.settings.token) };
    case '/api/releases': return { releases: (await state.github.releases(url.searchParams.get('repo'), state.cfg.settings.token)).slice(0, 10) };
    case '/api/open':
      if (data.path === 'download') { fs.mkdirSync(state.storage.downloadDir, { recursive: true }); await openPath(state.storage.downloadDir); }
      else if (data.path === 'appdata') await openPath(state.storage.dataDir);
      else if (data.path === 'appwiz') spawn('control.exe', ['appwiz.cpl'], { windowsHide: true, stdio: 'ignore' }).on('error', error => dialog.showErrorBox('Windows ayarları açılamadı', error.message));
      else {
        const row = state.programs.find(p => p.location && p.location === data.location);
        if (!row) throw new Error('Klasör kayıtlı değil.'); await openPath(row.location);
      }
      return { ok: true };
    case '/api/shutdown': setTimeout(requestQuit, 100); return { ok:true };
    default: throw new Error('Bilinmeyen işlem.');
  }
}
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
async function start() {
  const errors = [];
  if (process.platform === 'win32' && typeof app.setToastActivatorCLSID === 'function') app.setToastActivatorCLSID(qa ? '{1A76D964-CF50-45D8-A25A-0A97F0D78432}' : '{02BDF85D-2109-4E75-88B8-31A9EB585A99}');
  const storage = qa ? new Storage({ dataDir: path.join(qaDir, 'data'), downloadDir: path.join(qaDir, 'downloads') }) : new Storage({ downloadDir: path.join(app.getPath('downloads'), 'UpdatePilot') });
  state = new AppState({ storage, notify:event => { if (!qa) return desktop.show(event).catch(() => {}); } });
  nativeTheme.themeSource = state.cfg.settings.theme;
  desktop = new DesktopServices({ app, shell, Notification, settings:() => state.cfg.settings, activate:activateNotification,
    icon:nativeImage.createFromPath(path.join(assets, 'icon.png')), appId, simulated:qa && !process.argv.includes('--native-test'),
    onError:message => state.storage.append('notification_error','UpdatePilot',message) });
  scheduler = new UpdateScheduler({ check:() => state.startCheck(), busy:() => state.scanRunning || state.checkRunning || Object.values(state.downloads).some(item => item.running) });
  scheduler.configure(state.cfg.settings);
  if (!qa && state.cfg.settings.open_at_login) desktop.setStartup(true);
  if (!qa && state.cfg.settings.toasts) { try { desktop.register(); } catch (error) { desktop.fail(error); } }
  ipcMain.handle('updatepilot:request', async (event, endpoint, body) => {
    try { trusted(event); return await request(endpoint, body); } catch (error) { return { error:translateError(state.cfg.settings.language,error) }; }
  });
  ipcMain.handle('updatepilot:export', async (event, kind) => {
    try {
      trusted(event);
      if (!['status', 'history'].includes(kind)) throw new Error('Geçersiz rapor.');
      const result = await dialog.showSaveDialog(window, { defaultPath: path.join(app.getPath('downloads'), `UpdatePilot-${kind}.csv`), filters: [{ name: 'CSV', extensions: ['csv'] }] });
      if (result.canceled) return { canceled: true };
      const rows = kind === 'status' ? [[text('name'),text('version'),text('latest'),text('status'),text('source')], ...state.rows().map(p => [p.name,p.version,p.latest,text(p.status),p.repo || p.package_id || p.url])]
        : [[text('time'),text('name'),text('event'),text('detail')], ...storage.history(10000).map(e => [e.ts,e.program,text('event_' + e.type),e.detail])];
      fs.writeFileSync(result.filePath, '\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\r\n'), 'utf8');
      return { ok: true };
    } catch (error) { return { error: error.message }; }
  });
  window = new BrowserWindow({ width:1200, height:800, minWidth:900, minHeight:600, backgroundColor:state.cfg.settings.theme === 'light' ? '#ffffff' : '#0a0a0a', icon:path.join(assets,'icon.png'), show:false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: !smoke } });
  window.removeMenu();
  window.once('ready-to-show', () => {
    if (!smoke && !state.cfg.settings.start_minimized) {
      showWindow();
      if (!app.isPackaged) console.log('UpdatePilot window opened.');
    }
  });
  window.webContents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message); });
  window.webContents.setWindowOpenHandler(({ url }) => {
    try { shell.openExternal(httpsUrl(url)).catch(() => {}); } catch { /* Refuse unsupported protocols. */ }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => { if (url.split('?')[0] !== webUrl) event.preventDefault(); });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.on('close', event => {
    if (quitting) return;
    if (state.cfg.settings.minimize_to_tray) { event.preventDefault(); updateTray(); window.hide(); return; }
    if (state.cfg.settings.confirm_close && Object.values(state.downloads).some(item => item.running)) { event.preventDefault(); requestQuit(); }
  });
  updateTray();
  await window.loadFile(webFile, qa ? { query: { qa: '1' } } : {});
  if (pendingActivation) { activateNotification(pendingActivation); pendingActivation = null; }
  state.startScan();
  if (smoke) {
    const capture = async () => { await window.webContents.capturePage(); await new Promise(resolve => setTimeout(resolve,100)); return window.webContents.capturePage(); };
    await state.idle();
    await window.webContents.executeJavaScript('poll()');
    await new Promise(resolve => setTimeout(resolve, 1500));
    fs.mkdirSync(qaDir, { recursive: true });
    const screenshot = await capture();
    fs.writeFileSync(path.join(qaDir, 'electron-panel.png'), screenshot.toPNG());
    const ui = await window.webContents.executeJavaScript('({total: document.querySelector("#stat-total").textContent, progress: document.querySelector("#live-text").textContent, bridge: typeof window.updatePilot.request, node: typeof window.require, styles: document.styleSheets.length})');
    await window.webContents.executeJavaScript('document.querySelector(\'[data-nav="programs"]\').click()');
    await new Promise(resolve => setTimeout(resolve, 150));
    fs.writeFileSync(path.join(qaDir, 'electron-programs.png'), (await capture()).toPNG());
    if (process.argv.includes('--smoke-download') || process.argv.includes('--smoke-node-download')) {
      const nodeDownload = process.argv.includes('--smoke-node-download');
      const requestedTrack = nodeDownload ? (process.argv.find(arg => arg.startsWith('--smoke-node-track='))?.split('=')[1] || 'latest') : 'latest';
      const row = state.rows().find(p => (nodeDownload ? p.name === 'Node.js' : p.package_id === 'GitHub.cli') && p.status === 'update');
      if (!row) throw new Error('İndirme testi için güncelleme bulunamadı.');
      const key = JSON.stringify(row.key);
      await window.webContents.executeJavaScript(`document.querySelectorAll('[data-act="detail"]').forEach(button => { if (button.dataset.key === ${key}) button.click(); })`);
      await new Promise(resolve => setTimeout(resolve, 150));
      fs.writeFileSync(path.join(qaDir, 'electron-detail.png'), (await capture()).toPNG());
      const detail = await window.webContents.executeJavaScript('({versions:document.querySelector("#drawer-versions").textContent, latest:document.querySelector("#drawer-latest").textContent, channels:Array.from(document.querySelectorAll("#drawer-versions [data-track]"),b=>b.dataset.track)})');
      fs.writeFileSync(path.join(qaDir, 'version-detail.json'), JSON.stringify(detail, null, 2));
      if (nodeDownload && (!detail.channels.includes('lts') || !detail.channels.includes('series') || detail.latest !== row.latest)) throw new Error('Node.js release channels were not displayed.');
      await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('#drawer [data-act="download"]')).find(button => button.dataset.key === ${key} && ${nodeDownload ? `button.dataset.track === ${JSON.stringify(requestedTrack)}` : "!button.dataset.track"})?.click()`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      await state.idle();
      if (!state.downloads[row.name]?.path) throw new Error('İndirme testi başarısız: ' + JSON.stringify(state.downloads[row.name]));
      if (nodeDownload && state.downloads[row.name].version !== row.channels.find(c => c.id === requestedTrack)?.version) throw new Error('Yanlış Node.js sürüm kanalı indirildi.');
      await new Promise(resolve => setTimeout(resolve, 1200));
      fs.writeFileSync(path.join(qaDir, 'electron-download.png'), (await capture()).toPNG());
    }
    await window.webContents.executeJavaScript('document.querySelector(\'[data-nav="settings"]\').click(); document.querySelector(\'[data-act="close-drawer"]\')?.click()');
    await new Promise(resolve => setTimeout(resolve, 250));
    const modalVisible = await window.webContents.executeJavaScript('!document.querySelector("#settings-overlay").hidden');
    if (!modalVisible) throw new Error('Settings modal did not open.');
    fs.writeFileSync(path.join(qaDir, 'electron-settings.png'), (await capture()).toPNG());
    if (process.argv.includes('--smoke-settings')) {
      const report = await require('./qa-settings').validateSettings({window,state,desktop,directory:qaDir,native:process.argv.includes('--native-test')});
      console.log(JSON.stringify({settingsValidation:{languages:report.languages.map(result=>result.language),sections:report.sections,monochrome:report.monochrome,native:report.native}}));
    }
    fs.writeFileSync(path.join(qaDir, 'smoke.json'), JSON.stringify({ ui, errors, state: state.state() }, null, 2));
    console.log(JSON.stringify({ ui, errors, stats: state.state().stats, summary: state.summary, downloads: state.downloads }));
    const passed = !errors.length && Number(ui.total) === state.programs.length && ui.node === 'undefined' && ui.styles > 0 && !state.summary.errors;
    desktop.cleanupTest();
    quitting = true; app.exit(passed ? 0 : 1);
  }
}
app.on('before-quit', event => { if (!quitting) { event.preventDefault(); requestQuit(); } });
app.on('window-all-closed', () => { if (!quitting) requestQuit(); });
app.on('will-quit', () => { scheduler?.stop(); clearTimeout(rescanTimer); tray?.destroy(); });
