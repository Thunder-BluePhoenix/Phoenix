// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Draws the plugin's marketplace icon (imgs/plugin-icon.png 256 and plugin-icon@2x.png 512) and the
// category icon (imgs/category-icon.png 28, @2x 56) from scratch with node built-ins only: an orange
// flame on a dark rounded square, an original geometric drawing. Run: `node scripts/generate-icon.js`.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const DESIGN = 128;
const SAMPLES = 3;
const TARGETS = [
  ["plugin-icon", 256],
  ["plugin-icon@2x", 512],
  ["category-icon", 28],
  ["category-icon@2x", 56],
];

function inBackground(x, y) {
  const r = 24;
  const cx = Math.min(Math.max(x, r), DESIGN - r);
  const cy = Math.min(Math.max(y, r), DESIGN - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function flameWidth(y, top, bottom) {
  if (y < top || y > bottom) return 0;
  const t = (y - top) / (bottom - top);
  return 34 * Math.sin((Math.PI / 2) * Math.pow(t, 0.8)) * Math.pow(t, 0.35);
}
function inFlame(x, y, top, bottom, lean) {
  const t = (y - top) / (bottom - top);
  const w = flameWidth(y, top, bottom);
  return w > 0 && Math.abs(x - (64 + lean * (1 - t) * (1 - t))) <= w;
}
function sample(x, y) {
  if (!inBackground(x, y)) return [0, 0, 0, 0];
  if (inFlame(x, y, 70, 104, 0)) return [255, 214, 102, 255];
  if (inFlame(x, y, 22, 108, 14)) return [243, 112, 33, 255];
  return [32, 28, 46, 255];
}
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    let c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
function render(size) {
  const scale = DESIGN / size;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const [pr, pg, pb, pa] = sample(
            (x + (sx + 0.5) / SAMPLES) * scale,
            (y + (sy + 0.5) / SAMPLES) * scale,
          );
          r += pr * pa;
          g += pg * pa;
          b += pb * pa;
          a += pa;
        }
      }
      const o = 1 + x * 4;
      row[o] = a ? Math.round(r / a) : 0;
      row[o + 1] = a ? Math.round(g / a) : 0;
      row[o + 2] = a ? Math.round(b / a) : 0;
      row[o + 3] = Math.round(a / (SAMPLES * SAMPLES));
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const dir = path.join(import.meta.dirname, "..", "com.phoenix.fawkes.sdPlugin", "imgs");
fs.mkdirSync(dir, { recursive: true });
for (const [name, size] of TARGETS) {
  fs.writeFileSync(path.join(dir, `${name}.png`), render(size));
  console.log(`wrote ${name}.png`);
}
