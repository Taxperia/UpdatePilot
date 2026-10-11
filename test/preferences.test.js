'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { DEFAULT_PREFERENCES, preferenceChanges } = require('../src/preferences');
const { UpdateScheduler } = require('../src/update-scheduler');
const { DesktopServices, launchTarget } = require('../src/desktop-services');
const { AppState } = require('../src/app-state');
const { Storage } = require('../src/storage');
const I18N = require('../web/i18n');
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(),'updatepilot-prefs-')); t.after(() => fs.rmSync(dir,{recursive:true,force:true})); return dir; }
function store(t) { const dir = temp(t); return new Storage({dataDir:path.join(dir,'data'),downloadDir:path.join(dir,'downloads')}); }
test('English is the default and every translation key has all four languages', () => {
  assert.equal(DEFAULT_PREFERENCES.language,'en'); assert.equal(DEFAULT_PREFERENCES.open_at_login,false); assert.equal(DEFAULT_PREFERENCES.auto_download,false);
  for (const [key,values] of Object.entries(I18N.rows)) { assert.equal(values.length,4,key); for (const value of values) assert.ok(value,key); }
  assert.equal(I18N.translate('de','settings'),'Einstellungen'); assert.equal(I18N.translate('fr','settings'),'Paramètres');
  assert.equal(I18N.translate('unknown','settings'),'Settings'); assert.equal(I18N.translate('en','update_count',{count:3}),'3 app updates are available');
});
test('invalid languages and timing values do not reach persisted preferences', () => {
  assert.throws(() => preferenceChanges({language:'invalid'})); assert.throws(() => preferenceChanges({check_interval:1})); assert.throws(() => preferenceChanges({open_at_login:'true'}));
  assert.deepEqual(preferenceChanges({language:'fr',check_interval:60,theme:'light',token:'ignored'}),{language:'fr',theme:'light',check_interval:60});
});
test('preferences persist while resetting defaults preserves tracked apps and credentials', t => {
  const state = new AppState({storage:store(t)}); state.cfg.repos.App = 'owner/app'; state.cfg.settings.token = 'secret';
  state.settings({language:'de',theme:'light',auto_refresh:false,open_at_login:true});
  const saved = state.storage.load(); assert.equal(saved.settings.language,'de'); assert.equal(saved.settings.open_at_login,true);
  const result = state.resetSettings(); assert.equal(result.settings.language,'en'); assert.equal(result.settings.open_at_login,false); assert.equal(result.settings.token,undefined);
  assert.equal(state.cfg.repos.App,'owner/app'); assert.equal(state.cfg.settings.token,'secret');
});
test('scheduled checks honour intervals, busy work and disabling the option', async () => {
  let callback, milliseconds, cleared = 0, checks = 0, busy = false;
  const scheduler = new UpdateScheduler({check:() => checks++,busy:() => busy,setIntervalFn:(fn,ms) => { callback = fn; milliseconds = ms; return 42; },clearIntervalFn:() => cleared++});
  scheduler.configure({...DEFAULT_PREFERENCES,check_interval:60}); assert.equal(milliseconds,3600000);
  callback(); await Promise.resolve(); await Promise.resolve(); assert.equal(checks,1);
  busy = true; callback(); await Promise.resolve(); assert.equal(checks,1);
  scheduler.configure({...DEFAULT_PREFERENCES,auto_refresh:false}); assert.equal(cleared,1); assert.equal(scheduler.timer,null);
});
test('portable startup points to the persistent wrapper instead of its temporary executable', () => {
  const target = launchTarget({packaged:true,execPath:'C:\\Temp\\unpacked.exe',portablePath:'C:\\Apps\\UpdatePilot.exe'});
  assert.equal(target.path,'C:\\Apps\\UpdatePilot.exe'); assert.deepEqual(target.args,[]);
  assert.deepEqual(launchTarget({packaged:false,execPath:'electron.exe',projectDir:'C:\\Project'}),{path:'electron.exe',args:['C:\\Project']});
});
function desktop(t,{fail = false,prefs = {...DEFAULT_PREFERENCES}} = {}) {
  const dir = temp(t); let shortcut, startup;
  class Notification extends EventEmitter {
    static isSupported() { return true; }
    constructor(options) { super(); this.options = options; Notification.instances.push(this); }
    show() { setImmediate(() => this.emit(fail ? 'failed' : 'show',{},fail ? 'delivery failed' : undefined)); }
  }
  Notification.instances = [];
  const errors = [], activations = [];
  const app = {isPackaged:false,toastActivatorCLSID:'{02BDF85D-2109-4E75-88B8-31A9EB585A99}',getPath:() => dir,
    setLoginItemSettings:options => {startup = options;},getLoginItemSettings:() => ({openAtLogin:startup.openAtLogin,launchItems:startup.openAtLogin ? [{name:startup.name,enabled:true}] : []})};
  const service = new DesktopServices({app,Notification,settings:() => prefs,activate:event => activations.push(event),onError:message => errors.push(message),shortcutDir:dir,
    shell:{writeShortcutLink:(file,_operation,options) => {shortcut = options;fs.writeFileSync(file,'test');return true;},readShortcutLink:() => shortcut}});
  return {service,Notification,errors,activations,app,prefs,getShortcut:() => shortcut,getStartup:() => startup};
}
test('Windows shortcut includes the app identity and toast activator; notifications are retained and clickable', async t => {
  const {service,Notification,getShortcut,activations} = desktop(t);
  const result = await service.show({kind:'updates',count:2,keys:['App@2']}); assert.equal(result.shown,true);
  assert.equal(getShortcut().appUserModelId,'com.updatepilot.desktop'); assert.equal(getShortcut().toastActivatorClsid,'{02BDF85D-2109-4E75-88B8-31A9EB585A99}');
  assert.equal(service.live.size,1); assert.match(Notification.instances[0].options.body,/2 apps/);
  Notification.instances[0].emit('click'); assert.equal(activations[0].kind,'updates'); assert.equal(service.live.size,0);
});
test('notification failures are recorded and surfaced instead of silently succeeding', async t => {
  const {service,errors} = desktop(t,{fail:true}); await assert.rejects(service.show({kind:'test'},true),/delivery failed/);
  assert.equal(errors.length,1); assert.equal(service.live.size,0); assert.equal(service.status.last_error,'delivery failed');
});
test('notifications honour switches, suppress repeats and use the selected language', async t => {
  const {service,Notification,prefs} = desktop(t); prefs.language = 'fr';
  await service.show({kind:'download',name:'Node.js',version:'26.11.1'}); assert.match(Notification.instances[0].options.title,/Téléchargement prêt/);
  const duplicate = await service.show({kind:'download',name:'Node.js',version:'26.11.1'}); assert.equal(duplicate.skipped,true);
  prefs.notify_errors = false; assert.equal((await service.show({kind:'error',name:'App'})).skipped,true);
  prefs.toasts = false; assert.equal((await service.show({kind:'updates',count:1})).skipped,true);
  assert.equal((await service.show({kind:'test'},true)).shown,true);
});
test('startup registration is verified and removed when disabled', t => {
  const {service,getStartup} = desktop(t);
  assert.equal(service.setStartup(true).openAtLogin,true); assert.ok(getStartup().args.includes('--startup'));
  assert.equal(service.setStartup(false).openAtLogin,false); assert.equal(getStartup().openAtLogin,false);
});
test('automatic downloads are limited to two jobs and installers are never launched', async t => {
  let active = 0, maximum = 0, downloaded = 0;
  const state = new AppState({storage:store(t),download:async () => { active++; maximum = Math.max(maximum,active); await new Promise(resolve => setTimeout(resolve,10)); active--; downloaded++; return 'installer.exe'; }});
  for (let index=0;index<4;index++) state.saveManual({name:'App '+index,version:'1.0',latest:'2.0',url:'https://example.com/installer.exe'});
  state.settings({auto_download:true}); state.startCheck(); await state.idle();
  assert.equal(downloaded,4); assert.equal(maximum,2); assert.ok(Object.values(state.downloads).every(item => item.running === false && item.path));
});
test('notification errors cannot turn a successful download into a failed download', async t => {
  const state = new AppState({storage:store(t),download:async () => 'installer.exe',notify:() => {throw Error('toast failed');}});
  const {id} = state.saveManual({name:'App',version:'1',latest:'2',url:'https://example.com/installer.exe'});
  state.startDownload('m:' + id); await state.idle(); assert.equal(state.downloads.App.path,'installer.exe'); assert.equal(state.downloads.App.error,undefined);
  assert.ok(state.storage.history().some(event => event.type === 'notification_error'));
});
