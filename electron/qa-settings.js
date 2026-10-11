'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { translate } = require('../web/i18n');
const pause = milliseconds => new Promise(resolve => setTimeout(resolve,milliseconds));
async function validateSettings({window,state,desktop,directory,native = false}) {
  const contents = window.webContents, report = {languages:[],sections:[],themes:[],native:{}};
  const execute = code => contents.executeJavaScript(code);
  const section = async name => { await execute(`document.querySelector('[data-settings-tab="${name}"]').click()`); await pause(120); };
  const preference = async (key,value) => {
    await execute(`(() => {const control=document.querySelector('[data-pref="${key}"]');if(!control)throw Error('Preference missing');if(control.type==='checkbox')control.checked=${JSON.stringify(value)};else control.value=${JSON.stringify(String(value))};control.dispatchEvent(new Event('change',{bubbles:true}));return pendingSettings;})()`);
    await pause(150);
  };
  const screenshot = async name => { await contents.capturePage(); await pause(100); fs.writeFileSync(path.join(directory,name + '.png'),(await contents.capturePage()).toPNG()); };
  await execute('api("/api/settings/reset",{}).then(result=>{state.settings=result.settings;applyPreferences();renderAll();openSettings()})');
  await pause(200);
  assert.equal(state.cfg.settings.language,'en');
  const basePage = await execute('page');
  for (const language of ['en','de','fr','tr']) {
    await preference('language',language);
    const result = await execute('({language:document.documentElement.lang,title:document.querySelector("#settings-title").textContent,open:!document.querySelector("#settings-overlay").hidden,page,hasSettingsPage:!!document.querySelector("#page-settings")})');
    assert.equal(result.language,language); assert.equal(result.title,translate(language,'settings')); assert.equal(result.open,true); assert.equal(result.page,basePage); assert.equal(result.hasSettingsPage,false);
    assert.equal(state.cfg.settings.language,language);
    await screenshot('settings-' + language); report.languages.push(result);
  }
  await preference('language','en');
  for (const name of ['general','appearance','updates','notifications','language','advanced']) {
    await section(name);
    const result = await execute('({heading:document.querySelector("#settings-content h3").textContent,text:document.querySelector(".settings-modal").textContent})');
    assert.equal(result.heading,translate('en',name === 'updates' ? 'settings_updates' : name)); assert.equal(/GitHub|Data and folders|Storage/i.test(result.text),false);
    report.sections.push(name); await screenshot('settings-' + name);
  }
  await section('appearance'); await preference('theme','light');
  assert.equal(await execute('document.documentElement.dataset.theme'),'light'); await screenshot('settings-light'); report.themes.push('light');
  await preference('theme','dark'); report.themes.push('dark');
  await preference('compact',true); assert.equal(await execute('document.body.classList.contains("compact")'),true); await preference('compact',false);
  await section('updates'); await preference('check_interval',60); assert.equal(state.cfg.settings.check_interval,60); await preference('auto_refresh',false); assert.equal(state.cfg.settings.auto_refresh,false); await preference('auto_refresh',true);
  await section('general');
  if (native) {
    const before = state.cfg.settings.open_at_login;
    try { await preference('open_at_login',true); report.native.startupEnabled = desktop.app.getLoginItemSettings({path:desktop.target.path,args:[...desktop.target.args.map(value=>'"'+value+'"'),'--startup']}).openAtLogin; assert.equal(report.native.startupEnabled,true); }
    finally { await preference('open_at_login',before); }
    report.native.startupRestored = state.cfg.settings.open_at_login === before;
  } else { await preference('open_at_login',true); assert.equal(state.cfg.settings.open_at_login,true); await preference('open_at_login',false); }
  await section('notifications');
  if (native) {
    const result = await execute('api("/api/notifications/test",{})'); report.native.notification = result;
    assert.equal(result.shown,true,'Windows did not confirm notification delivery');
    report.native.shortcut = desktop.shell.readShortcutLink(desktop.shortcutPath);
    report.native.electronVersion = process.versions.electron;
    report.native.toastActivatorSetter = typeof desktop.app.setToastActivatorCLSID;
    assert.equal(report.native.shortcut.appUserModelId,desktop.appId);
    await screenshot('settings-notification-test');
  }
  await section('general');
  const colors = await execute(`Array.from(document.querySelectorAll('body *')).filter(el=>el.offsetParent!==null).flatMap(el=>{const style=getComputedStyle(el);return [style.color,style.backgroundColor,style.borderTopColor].filter(value=>value.startsWith('rgb'));})`);
  for (const colour of colors) { const parts = colour.match(/[\d.]+/g).map(Number); assert.equal(parts[0],parts[1],colour); assert.equal(parts[1],parts[2],colour); }
  report.monochrome = true;
  await execute('document.querySelector(".settings-modal").focus(); document.dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",bubbles:true,cancelable:true}))');
  assert.equal(await execute('document.querySelector(".settings-modal").contains(document.activeElement)'),true);
  await execute('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  assert.equal(await execute('document.querySelector("#settings-overlay").hidden'),true);
  report.escapeCloses = true;
  await execute('api("/api/settings/reset",{}).then(result=>{state.settings=result.settings;applyPreferences();renderAll();openSettings()})');
  await pause(200); await screenshot('electron-settings');
  fs.writeFileSync(path.join(directory,'settings-validation.json'),JSON.stringify(report,null,2));
  if (native) fs.writeFileSync(path.join(directory,'native-validation.json'),JSON.stringify(report.native,null,2));
  return report;
}
module.exports = {validateSettings};
