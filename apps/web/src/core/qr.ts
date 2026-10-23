// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A small QR Code encoder (ISO/IEC 18004), written for one job: turning the phone-pairing link into
// an image the page can draw offline. Byte mode only, error correction level M only, versions 1 to
// 14 (up to 362 bytes). Pure functions: no network, no storage, no clock, no logging, no
// dependency. The text it is given is a secret for two minutes, so nothing here keeps it.

/** Largest payload (UTF-8 bytes) this encoder accepts: version 14, level M. */
export const QR_MAX_BYTES = 362;

const MAX_VERSION = 14;
/** Error correction level M: format-information indicator bits (ISO/IEC 18004 table 12). */
const EC_LEVEL_M_BITS = 0;
const QUIET_ZONE = 4;

/**
 * Level M error correction per version 1..14: codewords per block and number of blocks (ISO/IEC
 * 18004 table 9). The data codewords follow from the total codeword count of the version.
 */
const EC_M: readonly (readonly [perBlock: number, blocks: number])[] = [
  [10, 1],
  [16, 1],
  [26, 1],
  [18, 2],
  [24, 2],
  [16, 4],
  [18, 4],
  [22, 4],
  [22, 5],
  [26, 5],
  [30, 5],
  [22, 8],
  [22, 9],
  [24, 9],
];

export class QrTooLongError extends Error {
  constructor(readonly bytes: number) {
    super(
      `Cannot make a QR code from ${bytes} bytes; the most this encoder takes is ${QR_MAX_BYTES}`,
    );
    this.name = "QrTooLongError";
  }
}

export interface QrCode {
  version: number;
  /** The mask pattern (0 to 7) chosen by the lowest penalty score. */
  mask: number;
  /** Modules per side: 17 + 4 * version. */
  size: number;
  /** `modules[y][x]` is true for a dark module. Excludes the quiet zone. */
  modules: readonly (readonly boolean[])[];
}

// ── GF(256) and Reed-Solomon ───────────────────────────────────────────────

/** Product in GF(2^8) with the QR reduction polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D). */
export function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

/**
 * The generator polynomial (x - a^0)(x - a^1)...(x - a^(degree-1)) without its leading 1
 * coefficient, highest power first.
 */
export function reedSolomonDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j]!, root);
      if (j + 1 < result.length) result[j]! ^= result[j + 1]!;
    }
    root = gfMultiply(root, 2);
  }
  return result;
}

/** The error correction codewords for `data` under `divisor` (polynomial remainder). */
export function reedSolomonRemainder(
  data: readonly number[],
  divisor: readonly number[],
): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    divisor.forEach((coefficient, i) => {
      result[i]! ^= gfMultiply(coefficient, factor);
    });
  }
  return result;
}

// ── Capacity ───────────────────────────────────────────────────────────────

/** Codewords (data + error correction) that fit in a version after the function patterns. */
export function totalCodewords(version: number): number {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    modules -= (25 * align - 10) * align - 55;
    if (version >= 7) modules -= 36;
  }
  return Math.floor(modules / 8);
}

/** Data codewords at level M for a version. */
export function dataCodewordCount(version: number): number {
  const [perBlock, blocks] = EC_M[version - 1]!;
  return totalCodewords(version) - perBlock * blocks;
}

/** Bytes of byte-mode payload a version holds at level M. */
export function byteCapacity(version: number): number {
  const countBits = version <= 9 ? 8 : 16;
  return Math.floor((dataCodewordCount(version) * 8 - 4 - countBits) / 8);
}

// ── Bit helpers ────────────────────────────────────────────────────────────

const bit = (value: number, index: number): boolean => ((value >>> index) & 1) !== 0;

function appendBits(buffer: number[], value: number, length: number): void {
  for (let i = length - 1; i >= 0; i--) buffer.push((value >>> i) & 1);
}

/** The 15-bit format information for level M and a mask, BCH(15,5) coded and masked (ISO table C.1). */
export function formatBits(mask: number): number {
  const data = (EC_LEVEL_M_BITS << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** The 18-bit version information for version 7 and up, BCH(18,6) coded (ISO table D.1). */
export function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

// ── Data codewords ─────────────────────────────────────────────────────────

function dataCodewords(bytes: Uint8Array, version: number): number[] {
  const capacityBits = dataCodewordCount(version) * 8;
  const bits: number[] = [];
  appendBits(bits, 0b0100, 4); // byte mode
  appendBits(bits, bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) appendBits(bits, b, 8);
  appendBits(bits, 0, Math.min(4, capacityBits - bits.length)); // terminator
  appendBits(bits, 0, (8 - (bits.length % 8)) % 8);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j++) value = (value << 1) | bits[i + j]!;
    codewords.push(value);
  }
  for (let pad = 0xec; codewords.length < capacityBits / 8; pad ^= 0xec ^ 0x11) codewords.push(pad);
  return codewords;
}

/** Splits into blocks, appends each block's error correction and interleaves (ISO 18004 §7.6). */
export function interleaveCodewords(data: readonly number[], version: number): number[] {
  const [perBlock, blocks] = EC_M[version - 1]!;
  const total = totalCodewords(version);
  const shortBlocks = blocks - (total % blocks);
  const shortLength = Math.floor(total / blocks);
  const divisor = reedSolomonDivisor(perBlock);
  const built: number[][] = [];
  let k = 0;
  for (let i = 0; i < blocks; i++) {
    const block = data.slice(k, k + shortLength - perBlock + (i < shortBlocks ? 0 : 1));
    k += block.length;
    const ecc = reedSolomonRemainder(block, divisor);
    if (i < shortBlocks) block.push(0); // placeholder so every block has the same length; skipped below
    built.push(block.concat(ecc));
  }
  const out: number[] = [];
  for (let i = 0; i < built[0]!.length; i++) {
    for (let j = 0; j < blocks; j++) {
      if (i !== shortLength - perBlock || j >= shortBlocks) out.push(built[j]![i]!);
    }
  }
  return out;
}

// ── Matrix ─────────────────────────────────────────────────────────────────

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
  const positions = [6];
  for (let pos = version * 4 + 10; positions.length < count; pos -= step)
    positions.splice(1, 0, pos);
  return positions;
}

class Grid {
  readonly dark: boolean[][];
  readonly fixed: boolean[][];
  constructor(readonly size: number) {
    this.dark = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }
  setFunction(x: number, y: number, dark: boolean): void {
    this.dark[y]![x] = dark;
    this.fixed[y]![x] = true;
  }
  drawFormat(mask: number): void {
    const bits = formatBits(mask);
    const n = this.size;
    for (let i = 0; i <= 5; i++) this.setFunction(8, i, bit(bits, i));
    this.setFunction(8, 7, bit(bits, 6));
    this.setFunction(8, 8, bit(bits, 7));
    this.setFunction(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) this.setFunction(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) this.setFunction(n - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) this.setFunction(8, n - 15 + i, bit(bits, i));
    this.setFunction(8, n - 8, true); // the always-dark module
  }
  drawVersion(version: number): void {
    if (version < 7) return;
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunction(a, b, bit(bits, i));
      this.setFunction(b, a, bit(bits, i));
    }
  }
  drawFinder(cx: number, cy: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= this.size || y >= this.size) continue;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        this.setFunction(x, y, distance !== 2 && distance !== 4);
      }
    }
  }
  drawAlignment(cx: number, cy: number): void {
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++)
        this.setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  drawFunctionPatterns(version: number): void {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      this.setFunction(6, i, i % 2 === 0);
      this.setFunction(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(n - 4, 3);
    this.drawFinder(3, n - 4);
    const positions = alignmentPositions(version);
    const last = positions.length - 1;
    positions.forEach((px, i) =>
      positions.forEach((py, j) => {
        const onFinder = (i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0);
        if (!onFinder) this.drawAlignment(px, py);
      }),
    );
    this.drawFormat(0); // reserves the cells; rewritten once the mask is chosen
    this.drawVersion(version);
  }
  drawCodewords(codewords: readonly number[]): void {
    const n = this.size;
    let i = 0;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < n; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? n - 1 - vert : vert;
          if (!this.fixed[y]![x] && i < codewords.length * 8) {
            this.dark[y]![x] = bit(codewords[i >>> 3]!, 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }
  applyMask(mask: number): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (!this.fixed[y]![x] && maskApplies(mask, x, y)) this.dark[y]![x] = !this.dark[y]![x];
      }
    }
  }
}

/** Whether mask pattern `mask` flips the module at column `x`, row `y` (ISO/IEC 18004 table 10). */
export function maskApplies(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

const FINDER_LIKE_A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
const FINDER_LIKE_B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];

/** The four mask penalty rules of ISO/IEC 18004 §7.8.3 added together. */
export function penaltyScore(dark: readonly (readonly boolean[])[]): number {
  const n = dark.length;
  let score = 0;
  for (let vertical = 0; vertical < 2; vertical++) {
    for (let i = 0; i < n; i++) {
      const line = Array.from({ length: n }, (_, j) => (vertical ? dark[j]![i]! : dark[i]![j]!));
      let run = 1;
      for (let j = 1; j <= n; j++) {
        if (j < n && line[j] === line[j - 1]) {
          run++;
        } else {
          if (run >= 5) score += run - 2; // rule 1: 3 + (run - 5)
          run = 1;
        }
      }
      for (let j = 0; j + 11 <= n; j++) {
        const window = line.slice(j, j + 11).map(Number);
        // rule 3: 1:1:3:1:1 with four light modules on either side
        if (
          window.every((v, k) => v === FINDER_LIKE_A[k]) ||
          window.every((v, k) => v === FINDER_LIKE_B[k])
        )
          score += 40;
      }
    }
  }
  let count = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (dark[y]![x]) count++;
      if (x + 1 < n && y + 1 < n) {
        const c = dark[y]![x];
        if (c === dark[y]![x + 1] && c === dark[y + 1]![x] && c === dark[y + 1]![x + 1]) score += 3; // rule 2
      }
    }
  }
  const total = n * n;
  // rule 4: 10 for each full 5% the dark share is away from 50%, the first 5% being free
  score += Math.max(0, Math.ceil(Math.abs(count * 20 - total * 10) / total) - 1) * 10;
  return score;
}

/**
 * Encodes `text` (as UTF-8 bytes) in byte mode at error correction level M, in the smallest version
 * that holds it, with the mask of lowest penalty (the lowest number wins a tie). `options.mask`
 * forces one mask, for tests. Throws {@link QrTooLongError} above {@link QR_MAX_BYTES} bytes and a
 * `RangeError` for empty text.
 */
export function encodeQr(text: string, options: { mask?: number } = {}): QrCode {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length === 0) throw new RangeError("Cannot make a QR code from empty text");
  let version = 1;
  while (version <= MAX_VERSION && byteCapacity(version) < bytes.length) version++;
  if (version > MAX_VERSION) throw new QrTooLongError(bytes.length);
  const forced = options.mask;
  if (forced !== undefined && !(Number.isInteger(forced) && forced >= 0 && forced <= 7))
    throw new RangeError("mask must be a whole number from 0 to 7");

  const grid = new Grid(version * 4 + 17);
  grid.drawFunctionPatterns(version);
  grid.drawCodewords(interleaveCodewords(dataCodewords(bytes, version), version));

  let bestMask = forced ?? 0;
  if (forced === undefined) {
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      grid.applyMask(mask);
      grid.drawFormat(mask);
      const score = penaltyScore(grid.dark);
      if (score < bestScore) {
        bestScore = score;
        bestMask = mask;
      }
      grid.applyMask(mask); // flipping again restores the unmasked data
    }
  }
  grid.applyMask(bestMask);
  grid.drawFormat(bestMask);
  return { version, mask: bestMask, size: grid.size, modules: grid.dark };
}

/**
 * SVG path data for the dark modules, one horizontal run per `M x y h len v 1 h -len z`, offset by
 * the quiet zone (4 modules, the minimum the standard asks for). With the path's `viewBox`
 * `0 0 total total` one module is one unit.
 */
export function qrSvgPath(qr: QrCode): { path: string; total: number } {
  const parts: string[] = [];
  for (let y = 0; y < qr.size; y++) {
    const row = qr.modules[y]!;
    for (let x = 0; x < qr.size; x++) {
      if (!row[x]) continue;
      let end = x;
      while (end + 1 < qr.size && row[end + 1]) end++;
      const length = end - x + 1;
      parts.push(`M${x + QUIET_ZONE} ${y + QUIET_ZONE}h${length}v1h-${length}z`);
      x = end;
    }
  }
  return { path: parts.join(""), total: qr.size + 2 * QUIET_ZONE };
}
