'use strict';
const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const paths = {
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  box:'<path d="m12 3 9 5v8l-9 5-9-5V8z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5M5 21h14"/>',
  history:'<path d="M3 11a9 9 0 1 1 2 7M3 3v8h8M12 7v5l3 2"/>',
  settings:'<path d="m9 3-1 3-3 1-2 3 2 3v4l3 1 1 3h6l1-3 3-1 2-3-2-3V8l-3-2-1-3z"/><circle cx="12" cy="12" r="3"/>',
  refresh:'<path d="M21 11a9 9 0 1 0-2 7M21 3v8h-8"/>',
  bolt:'<path d="m13 2-9 12h7l-1 8 10-12h-7z"/>',
  check:'<path d="m5 12 4 4L19 6"/>', eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  more:'<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  link:'<path d="M14 3h7v7M10 14 21 3M21 14v6H4V3h6"/>',
  search:'<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>', folder:'<path d="M3 7h7l2 3h9v10H3V5h7l2 2h9v3"/>',
  plus:'<path d="M12 4v16M4 12h16"/>', x:'<path d="m6 6 12 12M6 18 18 6"/>',
  trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  sliders:'<path d="M6 3v5m0 4v9M12 3v10m0 4v4M18 3v2m0 4v12M3 8h6M9 13h6M15 5h6"/>',
  appearance:'<path d="M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 1-4 2 2 0 0 1 1-4h2a3 3 0 0 0 3-3c0-4-4-7-9-7Z"/><circle cx="7" cy="9" r=".7"/><circle cx="11" cy="6" r=".7"/><circle cx="16" cy="7" r=".7"/>',
  bell:'<path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5zM10 21h4"/>',
  globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18Z"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.box}</svg>`;
let state = null, page = 'dash', language = 'en', searchQ = '', sortCol = 'name', sortDir = 1, histFilter = 'all';
let drawerKey = null, settingsTab = 'general', initialized = false, polling = false, lastSummary = null, settingsFocus = null;
let pendingSettings = Promise.resolve();
const seenDownloads = new Set();
const t = (key, params) => I18N.translate(language, key, params);
const errorText = value => I18N.translateError(language, value);
const rowById = key => state?.rows.find(row => row.key === key);
function translateStatic() {
  document.documentElement.lang = language;
  $$('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  $$('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); el.setAttribute('aria-label',el.placeholder); });
  $$('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label',t(el.dataset.i18nAria)); });
  $$('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); el.setAttribute('aria-label', el.title); });
  $$('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
  $('#page-title').textContent = t(page);
  document.title = 'UpdatePilot — ' + t('app_sub');
}
async function api(endpoint, body) {
  const result = await window.updatePilot.request(endpoint, body);
  if (result.error) throw new Error(errorText(result.error));
  return result;
}
function toast(message, kind = '') {
  const node = document.createElement('div'); node.className = 'toast ' + kind;
  node.innerHTML = icon(kind === 'err' ? 'x' : 'check') + `<span>${esc(message)}</span>`; $('#toasts').append(node);
  setTimeout(() => { node.classList.add('out'); setTimeout(() => node.remove(), 250); }, 4500);
}
function relative(iso) {
  if (!iso) return t('never'); const diff = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(diff)) return '—';
  if (diff < 60) return t('just_now'); if (diff < 3600) return t('minutes_ago', { count:Math.floor(diff/60) });
  if (diff < 86400) return t('hours_ago', { count:Math.floor(diff/3600) }); return t('days_ago', { count:Math.floor(diff/86400) });
}
function dateText(value) {
  if (!value) return '—'; const date = new Date(value); if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(I18N.languages[language].locale, { dateStyle:'short', timeStyle:'short' }).format(date);
}
function sourceName(row) {
  if (row.version_source === 'official') return t('source_official');
  if (row.version_source === 'catalog') return t('source_catalog');
  if (row.version_source === 'github') return t('source_github');
  if (row.version_source === 'manual') return t('source_manual'); return t('unknown');
}
function pill(row) { const cls = row.status === 'catalog-old' ? 'error' : row.status === 'catalog-ok' ? 'nomatch' : row.status; return `<span class="pill ${esc(cls)}" title="${esc(t(row.status) + ' · ' + sourceName(row))}">${esc(t(row.status))}</span>`; }
function versionTitle(row) { return [row.latest || '—', sourceName(row), ...(row.channels || []).map(c => t('channel_' + (c.id === 'series' ? 'series' : c.id)) + ': ' + c.version)].join('\n'); }
function sourceTag(row) { return row.version_source === 'official' ? t('official') : row.version_source === 'catalog' ? t('catalog') : row.version_source === 'manual' ? t('manual_source') : row.version_source === 'github' ? 'GitHub' : '—'; }
function button(action, key, symbol, label, disabled = false, extra = '') { return `<button class="btn icon" data-act="${action}" data-key="${esc(key)}" title="${esc(t(label))}" aria-label="${esc(t(label))}" ${disabled ? 'disabled' : ''} ${extra}>${icon(symbol)}</button>`; }
function downloadDisabled(row) { return row.status === 'catalog-old' || !!state?.downloads?.[row.name]?.running; }
function progressText() {
  const progress = state.progress;
  if (progress.code) return t(progress.code, progress.args || {});
  if (progress.scan) return t('progress_scan');
  if (progress.check) return t('progress_check', { done:0, total:state.stats.total });
  if (state.summary) return t('progress_complete', state.summary);
  return t('ready');
}
function applyPreferences() {
  language = I18N.languages[state.settings.language] ? state.settings.language : 'en';
  document.documentElement.dataset.theme = state.settings.theme || 'dark'; document.body.classList.toggle('compact', !!state.settings.compact);
  translateStatic();
}
async function poll() {
  if (polling) return; polling = true;
  try {
    state = await api('/api/state'); applyPreferences();
    if (!initialized) { initialized = true; switchPage(state.settings.landing_page || 'dash'); }
    renderAll();
    if (qaDetailKey) { const key = qaDetailKey; qaDetailKey = null; const row = rowById(key) || state.rows.find(r => r.name === key); if (row) openDrawer(row.key); }
  } catch (error) { $('#live-text').textContent = t('connection_error'); }
  finally { polling = false; setTimeout(poll, 1000); }
}
function renderAll() {
  const busy = state.progress.scan || state.progress.check;
  $('#live-text').textContent = progressText(); $('#live-chip').classList.toggle('busy', busy); $('#top-progress').hidden = !busy;
  $('#btn-scan').disabled = $('#btn-check').disabled = busy;
  $('#badge-update').hidden = !state.stats.update; $('#badge-update').textContent = state.stats.update;
  $('#last-check-chip').textContent = t('last_check', { time:relative(state.last_check) });
  for (const [name, download] of Object.entries(state.downloads || {})) {
    const signature = name + '|' + download.msg;
    if (!download.running && !seenDownloads.has(signature)) { seenDownloads.add(signature); toast(t(download.error || !download.path ? 'download_failed' : 'download_done', { name }), download.error || !download.path ? 'err' : ''); }
  }
  if (state.summary?.ts !== lastSummary) { lastSummary = state.summary?.ts; if (state.summary?.updates) toast(t('update_count', { count:state.summary.updates })); }
  renderDash(); renderPrograms(); renderManual(); renderHistory(); updateDrawerLive();
  if (!$('#settings-overlay').hidden) syncSettingsControls();
}
function renderDash() {
  for (const key of ['total','ok','update','manual']) $('#stat-' + key).textContent = state.stats[key];
  const rows = state.rows.filter(row => row.status === 'update'); $('#update-banner').hidden = !rows.length; $('#banner-text').textContent = t('update_count', { count:rows.length });
  $('#dash-empty').hidden = !!rows.length;
  $('#dash-list').innerHTML = rows.map(row => `<div class="rich-row"><span class="stat-icon">${icon('box')}</span><div class="rich-main"><div class="rich-name">${esc(row.name)}</div><div class="rich-ver"><span>${esc(row.version || '—')}</span><span class="ver-arrow">→</span><span class="ver-new">${esc(row.latest || '—')}</span><span class="repo-chip" title="${esc(sourceName(row))}">${esc(sourceTag(row))}</span></div>${state.downloads[row.name]?.running ? `<p class="hint">${esc(state.downloads[row.name].msg.match(/[%\d]/) ? state.downloads[row.name].msg : t('download_started', { name:row.name }))}</p>` : ''}</div><div class="rich-actions">${button('detail',row.key,'eye','detail')}${button('download',row.key,'download','download',downloadDisabled(row))}${button('open-page',row.key,'link','release_page')}</div></div>`).join('');
}
function renderPrograms() {
  let rows = state.rows.filter(r => !r.is_manual); const total = rows.length;
  if (searchQ) rows = rows.filter(r => (r.name + ' ' + (r.publisher || '')).toLocaleLowerCase().includes(searchQ.toLocaleLowerCase()));
  rows.sort((a,b) => String(sortCol === 'source' ? sourceName(a) : a[sortCol] || '').localeCompare(String(sortCol === 'source' ? sourceName(b) : b[sortCol] || ''), I18N.languages[language].locale, { numeric:true }) * sortDir);
  $('#prog-count').textContent = t(searchQ ? 'filtered_count' : 'app_count', { count:rows.length, total });
  $('#tbl-programs tbody').innerHTML = rows.map(row => `<tr data-key="${esc(row.key)}"><td title="${esc(row.name)}"><div class="t-name">${esc(row.name)}</div><div class="t-sub">${esc(row.publisher || '')}</div></td><td class="mono" title="${esc(row.version)}">${esc(row.version || '—')}</td><td class="mono" title="${esc(row.publisher)}">${esc(row.publisher || '—')}</td><td>${pill(row)}</td><td class="mono ${row.status === 'update' ? 'ver-new-c' : ''}" title="${esc(versionTitle(row))}">${esc(row.latest || '—')}<div class="t-sub">${esc(sourceTag(row))}</div></td><td><span class="repo-chip" title="${esc(sourceName(row))}">${esc(row.repo || row.package_id || sourceTag(row))}</span></td><td class="t-right"><span class="row-actions">${button('detail',row.key,'eye','detail')}${button('download',row.key,'download','download',downloadDisabled(row))}${button('menu',row.key,'more','more')}</span></td></tr>`).join('');
}
function renderManual() {
  const rows = state.rows.filter(r => r.is_manual); $('#manual-empty').hidden = !!rows.length;
  $('#tbl-manual tbody').innerHTML = rows.map(row => `<tr><td><b>${esc(row.name)}</b></td><td class="mono">${esc(row.version || '—')}</td><td>${pill(row)}</td><td title="${esc(versionTitle(row))}">${esc(row.latest || '—')}</td><td title="${esc(row.url || row.repo)}">${esc(row.repo || row.url || '—')}</td><td title="${esc(row.notes)}">${esc(row.notes || '—')}</td><td class="t-right">${button('detail',row.key,'eye','detail')}${button('download',row.key,'download','download',downloadDisabled(row))}${button('manual-edit',row.key,'settings','edit')}</td></tr>`).join('');
}
const groups = { updates:['guncelleme_bulundu','program_guncellendi','isaretlendi'], scans:['tarama'], downloads:['indirildi'], other:['yoksayildi','yoksayma_kaldirildi','manuel_eklendi','manuel_silindi','hata','notification_error'] };
function renderHistory() {
  const rows = (state.history || []).filter(row => histFilter === 'all' || groups[histFilter]?.includes(row.type)); $('#history-empty').hidden = !!rows.length;
  $('#tbl-history tbody').innerHTML = rows.map(row => `<tr><td class="mono">${esc(dateText(row.ts))}</td><td>${esc(row.program)}</td><td>${esc(t('event_' + row.type))}</td><td class="mono" title="${esc(row.detail)}">${esc(row.detail || '—')}</td></tr>`).join('');
}
function versionsHtml(row) {
  return `<div class="info-item"><div class="k">${esc(t('source'))}</div><div class="v">${esc(sourceName(row))}</div></div>${row.version_source === 'catalog' ? `<p class="hint">${esc(t(row.status === 'catalog-old' ? 'catalog_old_hint' : 'catalog_hint'))}</p>` : ''}${row.source_error ? `<p class="hint">${esc(t('source_failed'))}</p>` : ''}${row.source_url?.includes('versionhistory.googleapis.com') ? `<p class="hint">${esc(t('chrome_hint'))}</p>` : ''}${(row.channels || []).map(channel => `<div class="info-item channel-card"><div class="k">${esc(t('channel_' + channel.id))}</div><div class="v">${esc(channel.version)}</div>${channel.major_change ? `<p class="hint">${esc(t('major_change'))}</p>` : ''}<button class="btn soft" data-act="download" data-key="${esc(row.key)}" data-track="${esc(channel.id)}" ${downloadDisabled(row) ? 'disabled' : ''}>${icon('download')}${esc(t('download_version'))}</button></div>`).join('')}`;
}
function openDrawer(key) { drawerKey = key; renderDrawer(); $('#drawer').hidden = $('#backdrop').hidden = false; }
function closeDrawer() { $('#drawer').hidden = $('#backdrop').hidden = true; drawerKey = null; closeMenu(); }
function renderDrawer() {
  const row = rowById(drawerKey); if (!row) return closeDrawer();
  const info = [['version',row.version],['latest',row.latest],['publisher',row.publisher],['install_date',row.date],['size',row.size],['last_check',relative(row.checked)]];
  $('#drawer').innerHTML = `<header class="drawer-head"><div class="drawer-title"><h2>${esc(row.name)}</h2><span id="drawer-pill">${pill(row)}</span></div><button class="btn icon" data-act="close-drawer" aria-label="${esc(t('close'))}">${icon('x')}</button></header><div class="drawer-body"><div class="info-grid">${info.map(([key,value]) => `<div class="info-item"><div class="k">${esc(t(key, {time:''}).replace(/:\s*$/, ''))}</div><div class="v" ${key === 'latest' ? 'id="drawer-latest"' : ''}>${esc(value || '—')}</div></div>`).join('')}</div><div class="drawer-section"><h3>${esc(t('version_info'))}</h3><div id="drawer-versions">${versionsHtml(row)}</div></div><div class="drawer-section"><h3>${esc(t('repository'))}</h3><div class="field-row"><input id="drawer-repo" placeholder="owner/project" value="${esc(row.repo || '')}" aria-label="${esc(t('repository'))}"><button class="btn" data-act="save-repo" data-key="${esc(row.key)}">${esc(t('save'))}</button></div><p class="hint">${esc(t('repository_hint'))}</p><div class="drawer-actions" style="margin-top:10px"><button class="btn ghost" data-act="suggest" data-key="${esc(row.key)}">${esc(t('suggest'))}</button><button class="btn ghost" data-act="releases" data-key="${esc(row.key)}">${esc(t('releases'))}</button><button class="btn ghost" data-act="check-one" data-key="${esc(row.key)}">${esc(t('check_now'))}</button></div><div id="drawer-sug"></div><div id="drawer-rel"></div></div><div class="drawer-section"><h3>${esc(t('actions'))}</h3><div class="drawer-actions"><button class="btn" data-act="open-page" data-key="${esc(row.key)}">${icon('link')}${esc(t('release_page'))}</button><button class="btn primary" data-act="download" data-key="${esc(row.key)}" ${downloadDisabled(row) ? 'disabled' : ''}>${icon('download')}${esc(t('download'))}</button>${row.is_manual ? `<button class="btn ghost" data-act="manual-edit" data-key="${esc(row.key)}">${esc(t('edit'))}</button><button class="btn ghost" data-act="mark" data-key="${esc(row.key)}">${esc(t('mark_updated'))}</button><button class="btn ghost" data-act="delete-manual" data-key="${esc(row.key)}">${esc(t('delete'))}</button>` : `<button class="btn ghost" data-act="ignore" data-key="${esc(row.key)}">${esc(t('ignore_version'))}</button><button class="btn ghost" data-act="unignore" data-key="${esc(row.key)}">${esc(t('unignore'))}</button><button class="btn ghost" data-act="open-folder" data-key="${esc(row.key)}">${esc(t('install_folder'))}</button>`}<button class="btn ghost" data-act="open-download">${esc(t('open_downloads'))}</button></div></div></div>`;
  $('#drawer').dataset.language = language;
}
function updateDrawerLive() {
  if (!drawerKey) return; const row = rowById(drawerKey); if (!row) return closeDrawer();
  if ($('#drawer').dataset.language !== language) { const draft = $('#drawer-repo')?.value; renderDrawer(); if (draft != null) $('#drawer-repo').value = draft; }
  $('#drawer-pill').innerHTML = pill(row); $('#drawer-latest').textContent = row.latest || '—';
  const versions = $('#drawer-versions'), signature = JSON.stringify([row.version_source,row.source_error,row.channels,row.status,state.downloads[row.name]?.running,language]);
  if (versions.dataset.signature !== signature) { versions.innerHTML = versionsHtml(row); versions.dataset.signature = signature; }
  $$('#drawer [data-act="download"]').forEach(el => { el.disabled = downloadDisabled(row); });
}
function closeMenu() { $('#context-menu')?.remove(); }
function openMenu(key, trigger) {
  closeMenu(); const row = rowById(key); if (!row) return;
  const actions = row.is_manual ? [['manual-edit','edit'],['mark','mark_updated'],['delete-manual','delete']] : [['detail','detail'],['ignore','ignore_version'],['unignore','unignore'],['check-one','check_now']];
  const node = document.createElement('div'); node.id = 'context-menu'; node.className = 'context-menu'; node.innerHTML = actions.map(([action,label]) => `<button data-act="${action}" data-key="${esc(key)}">${esc(t(label))}</button>`).join(''); document.body.append(node);
  const rect = trigger.getBoundingClientRect(); node.style.top = Math.min(rect.bottom + 5, innerHeight - node.offsetHeight - 10) + 'px'; node.style.left = Math.min(rect.left, innerWidth - node.offsetWidth - 10) + 'px';
}
function switchPage(next) {
  if (next === 'settings') return openSettings(); if (!['dash','programs','manual','history'].includes(next)) next = 'dash';
  page = next; $$('.page').forEach(el => el.classList.toggle('active', el.id === 'page-' + page)); $$('[data-nav]').forEach(el => el.classList.toggle('active', el.dataset.nav === page)); $('#page-title').textContent = t(page);
}
function preferenceRow(key, title, desc) { return `<div class="setting-row"><div class="setting-copy"><b>${esc(t(title))}</b><p>${esc(t(desc))}</p></div><label class="switch"><input type="checkbox" data-pref="${key}" ${state.settings[key] ? 'checked' : ''} aria-label="${esc(t(title))}"><i></i></label></div>`; }
function selectRow(key, title, desc, options, id = '') { return `<div class="setting-row"><div class="setting-copy"><b>${esc(t(title))}</b><p>${esc(t(desc))}</p></div><select data-pref="${key}" ${id ? `id="${id}"` : ''} aria-label="${esc(t(title))}">${options.map(([value,label]) => `<option value="${value}" ${String(state.settings[key]) === String(value) ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></div>`; }
function languageRow() { return selectRow('language','app_language','language_desc',Object.entries(I18N.languages).map(([key,value]) => [key,value.name]),'settings-language'); }
function renderSettings() {
  const content = $('#settings-content'), focusedPreference = document.activeElement?.dataset.pref; const sectionKey = settingsTab === 'updates' ? 'settings_updates' : settingsTab;
  let html = `<h3>${esc(t(sectionKey))}</h3><p class="settings-description">${esc(t(settingsTab + '_sub'))}</p>`;
  if (settingsTab === 'general') html += preferenceRow('open_at_login','startup','startup_desc') + preferenceRow('minimize_to_tray','tray','tray_desc') + preferenceRow('confirm_close','confirm_close','confirm_close_desc') + preferenceRow('start_minimized','minimized','minimized_desc') + selectRow('landing_page','landing','landing_desc',['dash','programs','manual','history'].map(key => [key,t(key)])) + languageRow();
  if (settingsTab === 'appearance') html += selectRow('theme','theme','theme_desc',[['dark',t('dark')],['light',t('light')]]) + preferenceRow('compact','compact','compact_desc');
  if (settingsTab === 'updates') html += preferenceRow('auto_check','auto_check','auto_check_desc') + preferenceRow('auto_refresh','auto_refresh','auto_refresh_desc') + selectRow('check_interval','interval','interval_desc',[15,60,360,1440].map(value => [value,t('interval_' + value)])) + preferenceRow('auto_download','auto_download','auto_download_desc') + preferenceRow('skip_prerelease','skip_pre','skip_pre_desc');
  if (settingsTab === 'notifications') html += preferenceRow('toasts','windows_notifications','windows_notifications_desc') + preferenceRow('notify_downloads','notify_downloads','notify_downloads_desc') + preferenceRow('notify_errors','notify_errors','notify_errors_desc') + `<div class="setting-row"><div class="setting-copy"><b>${esc(t('test_notification'))}</b><p>${esc(t('notifications_hint'))}</p></div><button class="btn" data-act="test-notification">${icon('bell')}${esc(t('test_notification'))}</button></div><p class="notification-status" id="notification-status">${esc(state.desktop?.notifications?.last_error || t('native_warning'))}</p>`;
  if (settingsTab === 'language') html += languageRow();
  if (settingsTab === 'advanced') html += preferenceRow('include_user_scope','user_scope','user_scope_desc') + `<div class="setting-row"><div class="setting-copy"><b>${esc(t('quit'))}</b><p>${esc(t('app_sub'))}</p></div><button class="btn" data-act="quit">${esc(t('quit'))}</button></div>`;
  content.innerHTML = html; $$('[data-settings-tab]').forEach(el => { el.classList.toggle('active', el.dataset.settingsTab === settingsTab); el.setAttribute('aria-current', el.dataset.settingsTab === settingsTab ? 'page' : 'false'); });
  $('#settings-overlay').dataset.language = language; $('#settings-status').textContent = t('autosaved');
  if (focusedPreference) $(`[data-pref="${focusedPreference}"]`,content)?.focus();
}
function syncSettingsControls() {
  if ($('#settings-overlay').dataset.language !== language) return renderSettings();
  $$('[data-pref]', $('#settings-content')).forEach(el => { if (document.activeElement === el) return; if (el.type === 'checkbox') el.checked = !!state.settings[el.dataset.pref]; else el.value = state.settings[el.dataset.pref]; });
}
function openSettings(section = 'general') {
  if (!state) return; closeDrawer(); closeModal(); settingsFocus = document.activeElement; settingsTab = section; renderSettings(); $('#settings-overlay').hidden = false; $('.settings-modal').focus();
}
function closeSettings() { $('#settings-overlay').hidden = true; settingsFocus?.focus(); }
function savePreference(key, value) {
  const before = { ...state.settings }; state.settings[key] = value; applyPreferences(); renderAll(); if (!$('#settings-overlay').hidden) renderSettings(); $('#settings-status').textContent = t('saving');
  pendingSettings = pendingSettings.catch(() => {}).then(async () => {
    try { const result = await api('/api/settings', { [key]:value }); state.settings = result.settings || { ...state.settings, [key]:value }; applyPreferences(); renderAll(); renderSettings(); }
    catch (error) { state.settings = before; applyPreferences(); renderAll(); renderSettings(); toast(errorText(error), 'err'); }
  });
  return pendingSettings;
}
function openManualModal(row) {
  const fields = [['name',row?.name],['version',row?.version],['repository',row?.repo],['latest',row?.latest],['download_url',row?.url]];
  $('#modal-root').innerHTML = `<form class="modal" id="manual-form" data-id="${row?.is_manual ? esc(row.key.slice(2)) : ''}"><header class="modal-head"><h2>${esc(t(row ? 'edit' : 'add_package'))}</h2><button type="button" class="btn icon" data-act="close-modal" aria-label="${esc(t('close'))}">${icon('x')}</button></header><div class="modal-body">${fields.map(([key,value]) => `<label><span class="field-label">${esc(t(key))}</span><input name="${key}" value="${esc(value || '')}" ${key === 'name' ? 'required' : ''}></label>`).join('')}<label><span class="field-label">${esc(t('notes'))}</span><textarea name="notes">${esc(row?.notes || '')}</textarea></label><footer class="modal-foot"><button type="button" class="btn ghost" data-act="close-modal">${esc(t('cancel'))}</button><button class="btn primary" type="submit">${esc(t('save'))}</button></footer></div></form>`;
  $('#modal-root').hidden = false; $('#manual-form input').focus();
}
function closeModal() { $('#modal-root').hidden = true; $('#modal-root').innerHTML = ''; }
const ACTIONS = {
  scan: async () => { await api('/api/scan',{}); toast(t('scan_started')); },
  check: async () => { await api('/api/check',{}); toast(t('check_started')); },
  'check-one': async key => { await api('/api/check',{keys:[key]}); toast(t('check_started')); },
  detail: openDrawer, 'close-drawer':closeDrawer, 'close-settings':closeSettings, 'close-modal':closeModal,
  download: async (key, el) => { await api('/api/download',{key, track:el.dataset.track || 'latest'}); toast(t('download_started',{name:rowById(key)?.name || ''})); },
  'open-page': key => { const row = rowById(key), url = row?.latest_url || row?.source_url || row?.url || (row?.repo ? 'https://github.com/' + row.repo + '/releases' : ''); if (!url) throw new Error(t('no_link')); window.open(url,'_blank'); },
  ignore: async key => { await api('/api/ignore',{key}); toast(t('ignored_saved')); },
  unignore: async key => { await api('/api/unignore',{key}); toast(t('check_started')); },
  mark: async key => { await api('/api/mark',{key}); toast(t('mark_updated')); },
  'open-folder': key => api('/api/open',{path:'location',location:rowById(key)?.location}),
  'open-download': () => api('/api/open',{path:'download'}),
  'clear-history': async () => { if (confirm(t('confirm_clear'))) { await api('/api/clear_history',{}); toast(t('cleared')); } },
  quit: () => api('/api/shutdown',{}),
  'save-repo': async key => { await api('/api/repo',{key,repo:$('#drawer-repo').value}); toast(t('repo_saved')); },
  suggest: async key => {
    const box = $('#drawer-sug'); box.innerHTML = `<p class="hint">${esc(t('search_running'))}</p>`;
    const result = await api('/api/suggest?q=' + encodeURIComponent(rowById(key).name));
    box.innerHTML = result.items.length ? `<p class="hint">${esc(t('select_repo'))}</p>` + result.items.map(item => `<button class="sug-item" data-act="pick-repo" data-repo="${esc(item.full_name)}"><b>${esc(item.full_name)}</b><p class="hint">${esc(item.description || '')}</p></button>`).join('') : `<p class="hint">${esc(t('no_results'))}</p>`;
  },
  'pick-repo': (_key,el) => { $('#drawer-repo').value = el.dataset.repo; },
  releases: async key => {
    const row = rowById(key); if (!row.repo) throw new Error(t('no_repo')); $('#drawer-rel').innerHTML = `<p class="hint">${esc(t('search_running'))}</p>`;
    const result = await api('/api/releases?repo=' + encodeURIComponent(row.repo));
    $('#drawer-rel').innerHTML = result.releases.map(rel => `<div class="rel-item"><div class="rel-head"><span class="rel-tag">${esc(rel.tag)}</span><span class="rel-date">${esc(dateText(rel.published))}</span>${rel.prerelease ? `<span class="pill">${esc(t('prerelease'))}</span>` : ''}</div><p class="rel-body">${esc(rel.body || rel.name || '')}</p></div>`).join('') || `<p class="hint">${esc(t('no_results'))}</p>`;
  },
  'manual-add': () => openManualModal(), 'manual-edit': key => openManualModal(rowById(key)),
  'delete-manual': async key => { const row = rowById(key); if (confirm(t('confirm_delete',{name:row.name}))) { await api('/api/manual/delete',{id:Number(key.slice(2))}); closeDrawer(); } },
  menu: openMenu,
  'reset-settings': async () => { const result = await api('/api/settings/reset',{}); state.settings = result.settings; applyPreferences(); renderAll(); renderSettings(); toast(t('reset_done')); },
  'test-notification': async (_key,el) => { el.disabled = true; try { const result = await api('/api/notifications/test',{}); const text = t(result.shown ? 'notification_sent' : 'notification_pending'); $('#notification-status').textContent = text; toast(text); } finally { el.disabled = false; } }
};
document.addEventListener('click', event => {
  const el = event.target.closest('[data-act],[data-nav],[data-hf],[data-sort],[data-settings-tab],[data-export]'); if (!event.target.closest('#context-menu')) closeMenu(); if (!el) return;
  if (el.dataset.nav) return switchPage(el.dataset.nav);
  if (el.dataset.settingsTab) { settingsTab = el.dataset.settingsTab; renderSettings(); return; }
  if (el.dataset.hf) { histFilter = el.dataset.hf; $$('[data-hf]').forEach(button => button.classList.toggle('active',button === el)); renderHistory(); return; }
  if (el.dataset.sort) { sortDir = sortCol === el.dataset.sort ? -sortDir : 1; sortCol = el.dataset.sort; renderPrograms(); return; }
  if (el.dataset.export) { window.updatePilot.exportCsv(el.dataset.export).then(result => { if (result.error) throw Error(result.error); if (result.ok) toast(t('report_saved')); }).catch(error => toast(errorText(error),'err')); return; }
  const action = ACTIONS[el.dataset.act]; if (action) Promise.resolve().then(() => action(el.dataset.key,el)).catch(error => toast(errorText(error),'err'));
});
document.addEventListener('change', event => { const el = event.target.closest('[data-pref]'); if (el) savePreference(el.dataset.pref,el.type === 'checkbox' ? el.checked : el.dataset.pref === 'check_interval' ? Number(el.value) : el.value); });
$('#search-input').addEventListener('input', event => { searchQ = event.target.value.trim(); renderPrograms(); });
$('#backdrop').addEventListener('click',closeDrawer);
$('#settings-overlay').addEventListener('click', event => { if (event.target === event.currentTarget) closeSettings(); });
$('#modal-root').addEventListener('click',event => { if (event.target === event.currentTarget) closeModal(); });
document.addEventListener('submit', async event => {
  if (event.target.id !== 'manual-form') return; event.preventDefault();
  const fields = Object.fromEntries(new FormData(event.target));
  const data = {name:fields.name,version:fields.version,repo:fields.repository,latest:fields.latest,url:fields.download_url,notes:fields.notes}; if (event.target.dataset.id) data.id = Number(event.target.dataset.id);
  try { await api('/api/manual/save',data); closeModal(); toast(t('package_saved')); } catch(error) { toast(errorText(error),'err'); }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { if (!$('#settings-overlay').hidden) closeSettings(); else if (!$('#modal-root').hidden) closeModal(); else closeDrawer(); closeMenu(); }
  if (event.key === 'Tab' && !$('#settings-overlay').hidden) {
    const elements = $$('button,input,select,[tabindex="0"]',$('.settings-modal')).filter(el => !el.disabled && el.offsetParent !== null), first = elements[0], last = elements.at(-1);
    const outside = !$('.settings-modal').contains(document.activeElement);
    if (event.shiftKey && (outside || document.activeElement === first || document.activeElement === $('.settings-modal'))) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (outside || document.activeElement === last || document.activeElement === $('.settings-modal'))) { event.preventDefault(); first?.focus(); }
  }
});
const qaPage = new URLSearchParams(location.search).get('qa'); let qaDetailKey = qaPage?.startsWith('detail:') ? decodeURIComponent(qaPage.slice(7)) : null;
if (qaPage) document.documentElement.classList.add('qa-noanim');
translateStatic(); poll();
