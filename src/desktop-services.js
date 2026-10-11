'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { translate } = require('../web/i18n');
function launchTarget({ packaged, execPath = process.execPath, portablePath = process.env.PORTABLE_EXECUTABLE_FILE, projectDir = path.resolve(__dirname, '..') }) {
  return { path: packaged && portablePath ? path.resolve(portablePath) : execPath, args: packaged ? [] : [projectDir] };
}
function quoteArgument(value) { return '"' + String(value).replace(/"/g, '\\"') + '"'; }
class DesktopServices {
  constructor({ app, shell, Notification, settings, activate, onError = () => {}, icon, appId = 'com.updatepilot.desktop', simulated = false, shortcutDir }) {
    Object.assign(this, { app, shell, Notification, settings, activate, onError, icon, appId, simulated });
    this.target = launchTarget({ packaged:app.isPackaged });
    this.shortcutDir = shortcutDir || path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    this.live = new Set(); this.seen = new Set(); this.registered = false;
    this.status = { supported:Notification.isSupported(), registered:false, last_error:'', last_shown:null, simulated };
    if (!simulated && typeof Notification.handleActivation === 'function') Notification.handleActivation(details => this.activate({ kind:'updates', activation:details }));
  }
  register() {
    if (this.simulated || this.registered) return;
    if (process.platform !== 'win32') { this.registered = true; this.status.registered = true; return; }
    fs.mkdirSync(this.shortcutDir, { recursive:true });
    const shortcut = path.join(this.shortcutDir, this.appId.endsWith('.qa') ? 'UpdatePilot QA.lnk' : 'UpdatePilot.lnk');
    const target = { target:this.target.path, args:this.target.args.map(quoteArgument).join(' '), cwd:path.dirname(this.target.path), appUserModelId:this.appId,
      description:'UpdatePilot', toastActivatorClsid:this.app.toastActivatorCLSID,
      icon:this.app.isPackaged ? this.target.path : path.resolve(__dirname,'..','assets','icon.ico'), iconIndex:0 };
    if (!this.shell.writeShortcutLink(shortcut, 'create', target)) throw new Error('Windows notification shortcut could not be registered.');
    const actual = this.shell.readShortcutLink(shortcut);
    if (actual.appUserModelId !== this.appId || actual.target.toLowerCase() !== target.target.toLowerCase()) throw new Error('Windows notification shortcut verification failed.');
    this.shortcutPath = shortcut; this.registered = true; this.status.registered = true;
  }
  setStartup(enabled, name = this.appId) {
    if (this.simulated) return { openAtLogin:enabled, simulated:true };
    const args = [...this.target.args.map(quoteArgument), '--startup'];
    this.app.setLoginItemSettings({ openAtLogin:enabled, enabled, name, path:this.target.path, args });
    const result = this.app.getLoginItemSettings({ path:this.target.path, args });
    const item = result.launchItems?.find(entry => entry.name === name);
    if (enabled && (!result.openAtLogin || item?.enabled === false)) throw new Error('Windows did not enable the startup entry.');
    if (!enabled && item?.enabled) throw new Error('Windows did not remove the startup entry.');
    return { openAtLogin:enabled ? result.openAtLogin : false, enabled:enabled ? item?.enabled !== false : false };
  }
  async show(event, force = false) {
    const prefs = this.settings();
    if (!force && (!prefs.toasts || event.kind === 'download' && !prefs.notify_downloads || event.kind === 'error' && !prefs.notify_errors)) return { skipped:true };
    if (!this.status.supported) throw new Error(translate(prefs.language, 'notification_unavailable'));
    const signature = JSON.stringify([event.kind,event.name,event.version,event.keys]);
    if (!force && this.seen.has(signature)) return { skipped:true };
    if (this.simulated) return { simulated:true, shown:false };
    try { this.register(); } catch (error) { this.fail(error); throw error; }
    const prefix = event.kind === 'download' ? 'notify_download' : event.kind === 'error' ? 'notify_error' : event.kind === 'test' ? 'notify_test' : 'notify_updates';
    const notification = new this.Notification({ title:'UpdatePilot — ' + translate(prefs.language, prefix + '_title'),
      body:translate(prefs.language, prefix + '_body', event), icon:this.icon, id:crypto.createHash('sha256').update(signature).digest('hex').slice(0,16), groupId:'updatepilot', groupTitle:'UpdatePilot', silent:false });
    this.live.add(notification);
    notification.on('click', () => { this.activate(event); this.live.delete(notification); });
    notification.on('close', () => this.live.delete(notification));
    return new Promise((resolve,reject) => {
      let settled = false;
      const timer = setTimeout(() => { settled = true; resolve({ shown:false, pending:true }); }, 5000);
      notification.once('show', () => {
        this.seen.add(signature); this.status.last_error = ''; this.status.last_shown = new Date().toISOString();
        if (!settled) { settled = true; clearTimeout(timer); resolve({ shown:true }); }
      });
      notification.once('failed', (_event,error) => {
        this.live.delete(notification); this.fail(new Error(error || 'Windows notification delivery failed.'));
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error(this.status.last_error)); }
      });
      try { notification.show(); } catch (error) { clearTimeout(timer); this.live.delete(notification); this.fail(error); reject(error); }
    });
  }
  fail(error) { this.status.last_error = error.message; this.onError(error.message); }
  cleanupTest() {
    if (!this.appId.endsWith('.qa')) return;
    for (const notification of [...this.live]) { notification.close?.(); this.live.delete(notification); }
    if (this.shortcutPath && fs.existsSync(this.shortcutPath)) {
      const current = this.shell.readShortcutLink(this.shortcutPath);
      if (current.appUserModelId === this.appId && path.basename(this.shortcutPath) === 'UpdatePilot QA.lnk') fs.unlinkSync(this.shortcutPath);
    }
  }
}
module.exports = { DesktopServices, launchTarget };
