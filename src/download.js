'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
function httpsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('HTTPS indirme bağlantısı gerekli.');
  return url.href;
}
function safeFilename(value) {
  const name = path.basename(String(value).replace(/\\/g, '/')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '');
  if (!name || name === '.' || /^\.{1,2}$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) return 'paket.bin';
  return name.slice(0, 180);
}
async function downloadFile(asset, directory, onProgress = () => {}) {
  let url = httpsUrl(asset.url);
  fs.mkdirSync(directory, { recursive: true });
  const controller = new AbortController();
  let idleTimer;
  const refreshTimeout = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => controller.abort(new Error('İndirme zaman aşımına uğradı.')), 60000); };
  const hardTimer = setTimeout(() => controller.abort(), 30 * 60 * 1000);
  let temp;
  try {
    refreshTimeout();
    let result;
    for (let redirects = 0; redirects <= 10; redirects++) {
      result = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'UpdatePilot/' + require('../package.json').version, 'Accept-Encoding': 'identity' }, signal: controller.signal });
      if (![301, 302, 303, 307, 308].includes(result.status)) break;
      const location = result.headers.get('location');
      await result.body?.cancel();
      if (!location || redirects === 10) throw new Error('İndirme yönlendirmesi geçersiz.');
      url = httpsUrl(new URL(location, url).href);
    }
    if (!result.ok) throw new Error('İndirme başarısız: HTTP ' + result.status);
    if (/text\/html|application\/json/i.test(result.headers.get('content-type') || '')) throw new Error('Bağlantı kurulum dosyası yerine web sayfası döndürüyor.');
    const filename = safeFilename(asset.name || decodeURIComponent(new URL(url).pathname.split('/').at(-1)));
    const parsed = path.parse(filename);
    let target = path.join(directory, filename), index = 1;
    while (fs.existsSync(target)) target = path.join(directory, `${parsed.name} (${index++})${parsed.ext}`);
    temp = target + '.' + crypto.randomUUID() + '.part';
    const total = Number(result.headers.get('content-length') || 0);
    let received = 0;
    const hash = crypto.createHash('sha256');
    const progress = new Transform({ transform(chunk, encoding, callback) {
      refreshTimeout(); received += chunk.length; hash.update(chunk);
      onProgress(total ? `%${Math.floor(received * 100 / total)} (${Math.round(received / 1024)} KB)` : `${Math.round(received / 1024)} KB`);
      callback(null, chunk);
    } });
    await pipeline(Readable.fromWeb(result.body), progress, fs.createWriteStream(temp, { flags: 'wx' }), { signal: controller.signal });
    if (total && total !== received) throw new Error('İndirme eksik; paket kaydedilmedi.');
    if (!received) throw new Error('İndirilen dosya boş.');
    const digest = hash.digest('hex');
    if (asset.digest?.startsWith('sha256:') && digest !== asset.digest.slice(7).toLowerCase()) throw new Error('Dosyanın SHA-256 doğrulaması başarısız.');
    fs.renameSync(temp, target); temp = null;
    return target;
  } finally {
    clearTimeout(idleTimer); clearTimeout(hardTimer);
    if (temp && fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
module.exports = { downloadFile, safeFilename, httpsUrl };
