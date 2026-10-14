#!/usr/bin/env node
// Generates the original Workspace OS app icons (no external dependencies): a coral tile with a white check mark.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/web/public/icons');
mkdirSync(out, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
};
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const distSeg = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

function render(size, { maskable }) {
  const buf = Buffer.alloc(size * size * 4);
  const SS = 3; // supersampling
  const radius = maskable ? 0 : size * 0.22;
  const scale = maskable ? 0.62 : 0.78; // check mark size (maskable keeps inside the safe zone)
  const stroke = size * 0.085 * (maskable ? 0.9 : 1);
  const c = size / 2;
  const pts = [[-0.27, 0.02], [-0.06, 0.24], [0.3, -0.2]].map(([x, y]) => [c + x * size * scale * 1.15, c + y * size * scale * 1.15]);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
          // rounded square mask
          const qx = Math.abs(px - c) - (c - radius), qy = Math.abs(py - c) - (c - radius);
          const inside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius <= 0;
          if (!inside) continue;
          // diagonal gradient coral
          const k = (px + py) / (2 * size);
          let cr = 238 - 28 * k, cg = 98 - 28 * k, cb = 84 - 24 * k;
          const d = Math.min(distSeg(px, py, ...pts[0], ...pts[1]), distSeg(px, py, ...pts[1], ...pts[2]));
          if (d <= stroke / 2) { cr = 255; cg = 255; cb = 255; }
          r += cr; g += cg; b += cb; a += 255;
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      const cov = a / (255 * n);
      buf[i] = cov ? r / (cov * n) : 0;
      buf[i + 1] = cov ? g / (cov * n) : 0;
      buf[i + 2] = cov ? b / (cov * n) : 0;
      buf[i + 3] = Math.round(cov * 255);
    }
  }
  return png(size, buf);
}

writeFileSync(resolve(out, 'icon-192.png'), render(192, { maskable: false }));
writeFileSync(resolve(out, 'icon-512.png'), render(512, { maskable: false }));
writeFileSync(resolve(out, 'icon-maskable-512.png'), render(512, { maskable: true }));
writeFileSync(resolve(out, 'apple-touch-icon.png'), render(180, { maskable: true }));
writeFileSync(
  resolve(out, 'icon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ee6254"/><stop offset="1" stop-color="#d4443c"/></linearGradient></defs><rect width="512" height="512" rx="113" fill="url(#g)"/><path d="M168 268l66 66 118-130" fill="none" stroke="#fff" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/></svg>\n`,
);
console.log('icons written to', out);
