'use strict';
class UpdateScheduler {
  constructor({ check, busy, setIntervalFn = setInterval, clearIntervalFn = clearInterval }) {
    this.check = check; this.busy = busy; this.setInterval = setIntervalFn; this.clearInterval = clearIntervalFn; this.timer = null;
  }
  configure(settings) {
    this.stop(); if (!settings.auto_refresh) return;
    this.timer = this.setInterval(() => { if (!this.busy()) Promise.resolve().then(this.check).catch(() => {}); }, settings.check_interval * 60000);
    this.timer?.unref?.();
  }
  stop() { if (this.timer !== null) this.clearInterval(this.timer); this.timer = null; }
}
module.exports = { UpdateScheduler };
