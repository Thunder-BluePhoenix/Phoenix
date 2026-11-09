// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Draws media/icon.png (128x128) from scratch with node built-ins only: an orange flame shape on
// a dark rounded square. It is an original geometric drawing, not character art and not third-party
// artwork. Run: `node scripts/generate-icon.js`. Output is deterministic.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const SIZE = 128;
const SAMPLES = 4;

/** Inside the rounded square background (radius 24). */
function inBackground(x, y) {
  const r = 24;
  const cx = Math.min(Math.max(x, r), SIZE - r);
  const cy = Math.min(Math.max(y, r), SIZE - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** Flame: a teardrop that is round at the bottom and pointed at the top, centred on x = 64. */
function flameWidth(y, top, bottom) {
  if (y < top || y > bottom) return 0;
  const t = (y - top) / (bottom - top); // 0 at the tip, 1 at the base
  return 34 * Math.sin((Math.PI / 2) * Math.pow(t, 0.8)) * Math.pow(t, 0.35);
}

function inFlame(x, y, top, bottom, lean) {
  const t = (y - top) / (bottom - top);
  const centre = 64 + lean * (1 - t) * (1 - t);
  const w = flameWidth(y, top, bottom);
  return w > 0 && Math.abs(x - centre) <= w;
}

function sample(x, y) {
  if (!inBackground(x, y)) return [0, 0, 0, 0];
  if (inFlame(x, y, 70, 104, 0)) return [255, 214, 102, 255];
  if (inFlame(x, y, 22, 108, 14)) return [243, 112, 33, 255];
  return [32, 28, 46, 255];
}

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
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

function render() {
  const rows = [];
  for (let y = 0; y < SIZE; y++) {
    const row = Buffer.alloc(1 + SIZE * 4);
    for (let x = 0; x < SIZE; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const [pr, pg, pb, pa] = sample(x + (sx + 0.5) / SAMPLES, y + (sy + 0.5) / SAMPLES);
          r += pr * pa;
          g += pg * pa;
          b += pb * pa;
          a += pa;
        }
      }
      const n = SAMPLES * SAMPLES;
      const o = 1 + x * 4;
      row[o] = a ? Math.round(r / a) : 0;
      row[o + 1] = a ? Math.round(g / a) : 0;
      row[o + 2] = a ? Math.round(b / a) : 0;
      row[o + 3] = Math.round(a / n);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const out = path.join(__dirname, "..", "media", "icon.png");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, render());
console.log(`wrote ${out}`);
