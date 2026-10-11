'use strict';
const DEFAULT_PREFERENCES = Object.freeze({
  language: 'en', theme: 'dark', compact: false, open_at_login: false, minimize_to_tray: false, confirm_close: true,
  start_minimized: false, landing_page: 'dash', auto_check: true, auto_refresh: true, check_interval: 360,
  auto_download: false, toasts: true, notify_downloads: true, notify_errors: true, include_user_scope: true, skip_prerelease: true
});
function preferenceChanges(data) {
  const result = {};
  for (const [key, fallback] of Object.entries(DEFAULT_PREFERENCES)) {
    if (!(key in data)) continue;
    if (typeof fallback === 'boolean') {
      if (typeof data[key] !== 'boolean') throw new Error('Invalid preference: ' + key);
      result[key] = data[key];
    }
  }
  for (const [key, allowed] of Object.entries({ language: ['en', 'de', 'fr', 'tr'], theme: ['dark', 'light'], landing_page: ['dash', 'programs', 'manual', 'history'], check_interval: [15, 60, 360, 1440] })) {
    if (key in data) { if (!allowed.includes(data[key])) throw new Error('Invalid preference: ' + key); result[key] = data[key]; }
  }
  return result;
}
module.exports = { DEFAULT_PREFERENCES, preferenceChanges };
