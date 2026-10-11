'use strict';
function parse(value) {
  const text = String(value || '').trim().replace(/^v\s*(?=\d)/i, '').split('+')[0];
  if (!/^\d/.test(text)) return null;
  const match = text.match(/^(\d+(?:[._]\d+)*)(.*)$/);
  if (!match) return null;
  const nums = match[1].split(/[._]/).map(Number);
  while (nums.length > 1 && nums.at(-1) === 0) nums.pop();
  return { nums, suffix: match[2].replace(/^[\s._-]+/, '').toLowerCase() };
}
function compare(a, b) {
  const x = parse(a), y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const delta = (x.nums[i] || 0) - (y.nums[i] || 0);
    if (delta) return Math.sign(delta);
  }
  if (x.suffix === y.suffix) return 0;
  if (!x.suffix) return 1;
  if (!y.suffix) return -1;
  const ranks = { dev: 0, alpha: 1, a: 1, beta: 2, b: 2, pre: 3, preview: 3, rc: 4 };
  const sx = x.suffix.match(/([a-z]+)|(\d+)/g) || [], sy = y.suffix.match(/([a-z]+)|(\d+)/g) || [];
  for (let i = 0; i < Math.max(sx.length, sy.length); i++) {
    if (sx[i] === sy[i]) continue;
    if (sx[i] === undefined) return -1;
    if (sy[i] === undefined) return 1;
    if (/^\d+$/.test(sx[i]) && /^\d+$/.test(sy[i])) return Math.sign(Number(sx[i]) - Number(sy[i]));
    if (ranks[sx[i]] !== undefined && ranks[sy[i]] !== undefined) return Math.sign(ranks[sx[i]] - ranks[sy[i]]);
    return sx[i] < sy[i] ? -1 : 1;
  }
  return 0;
}
module.exports = { parse, compare, isNewer: (a, b) => compare(a, b) === 1 };
