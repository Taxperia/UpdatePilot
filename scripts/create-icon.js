'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const table = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc(buffer) { let value = 0xffffffff; for (const byte of buffer) value = table[(value ^ byte) & 255] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; }
function chunk(type, body) { const header = Buffer.alloc(8), tail = Buffer.alloc(4); header.writeUInt32BE(body.length); header.write(type, 4); tail.writeUInt32BE(crc(Buffer.concat([Buffer.from(type), body]))); return Buffer.concat([header, body, tail]); }
function icon(size) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) * 64 / size, v = (y + .5) * 64 / size;
    const circle = Math.hypot(u - 32, v - 18) <= 4.5;
    const left = Math.hypot(u - 20, v - Math.max(20, Math.min(34, v))) <= 3;
    const right = Math.hypot(u - 44, v - Math.max(20, Math.min(34, v))) <= 3;
    const bottom = v >= 34 && Math.abs(Math.hypot(u - 32, v - 34) - 12) <= 3;
    const rounded = u >= 16 && u <= 48 || v >= 16 && v <= 48 || Math.hypot(u - (u < 32 ? 16 : 48), v - (v < 32 ? 16 : 48)) <= 16;
    const offset = y * (size * 4 + 1) + 1 + x * 4, colour = circle || left || right || bottom ? 255 : 0;
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = colour; pixels[offset + 3] = rounded ? 255 : 0;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
const directory = path.resolve(__dirname, '..', 'assets'); fs.mkdirSync(directory, { recursive: true });
const png = icon(256); fs.writeFileSync(path.join(directory, 'icon.png'), png); fs.writeFileSync(path.join(directory, 'tray.png'), icon(32));
const header = Buffer.alloc(22); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4); header[8] = 0; header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12); header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
fs.writeFileSync(path.join(directory, 'icon.ico'), Buffer.concat([header, png]));
console.log('Monochrome app icons created.');
