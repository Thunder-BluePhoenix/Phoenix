// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  byteCapacity,
  dataCodewordCount,
  encodeQr,
  formatBits,
  gfMultiply,
  interleaveCodewords,
  maskApplies,
  penaltyScore,
  QR_MAX_BYTES,
  QrTooLongError,
  qrSvgPath,
  reedSolomonDivisor,
  reedSolomonRemainder,
  totalCodewords,
  versionBits,
  type QrCode,
} from "../src/core/qr";

const bin = (value: number, length: number) => value.toString(2).padStart(length, "0");

// Reading a symbol back from its modules, written here independently of the encoder's drawing code.
const rowOf = (qr: QrCode, y: number, from: number, to: number) =>
  qr.modules[y]!.slice(from, to).map(Number).join("");

describe("QR encoder: spec vectors", () => {
  it("format information for level M and masks 0 to 7 (ISO/IEC 18004 table C.1)", () => {
    const expected = [
      "101010000010010",
      "101000100100101",
      "101111001111100",
      "101101101001011",
      "100010111111001",
      "100000011001110",
      "100111110010111",
      "100101010100000",
    ];
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((m) => bin(formatBits(m), 15))).toEqual(expected);
  });

  it("version information for versions 7 to 10 (ISO/IEC 18004 table D.1)", () => {
    expect(bin(versionBits(7), 18)).toBe("000111110010010100");
    expect(bin(versionBits(8), 18)).toBe("001000010110111100");
    expect(bin(versionBits(9), 18)).toBe("001001101010011001");
    expect(bin(versionBits(10), 18)).toBe("001010010011010011");
  });

  it("GF(256) arithmetic uses the QR polynomial 0x11D", () => {
    expect(gfMultiply(2, 128)).toBe(0x1d); // x * x^7 = x^8 = x^4 + x^3 + x^2 + 1
    expect(gfMultiply(0x57, 1)).toBe(0x57);
    expect(gfMultiply(0, 0xff)).toBe(0);
    expect(gfMultiply(3, 7)).toBe(9); // carry-less 0b11 * 0b111 = 0b1001
  });

  it("the degree-7 generator polynomial matches ISO/IEC 18004 annex A", () => {
    // 1·x^7 + a^87 x^6 + a^229 x^5 + a^146 x^4 + a^149 x^3 + a^238 x^2 + a^102 x + a^21
    expect(reedSolomonDivisor(7)).toEqual([127, 122, 154, 164, 11, 68, 117]);
  });

  it("ISO/IEC 18004 annex I example: the 1-M error correction codewords of '01234567'", () => {
    const data = [16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17];
    expect(reedSolomonRemainder(data, reedSolomonDivisor(10))).toEqual([
      165, 36, 212, 193, 237, 54, 199, 135, 44, 85,
    ]);
  });

  it("the well-known 'HELLO WORLD' 1-M example gives its published error correction codewords", () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(reedSolomonRemainder(data, reedSolomonDivisor(10))).toEqual([
      196, 35, 39, 119, 235, 215, 231, 226, 93, 23,
    ]);
  });

  it("a codeword followed by its error correction has a zero remainder", () => {
    const data = Array.from({ length: 40 }, (_, i) => (i * 37 + 11) & 0xff);
    const divisor = reedSolomonDivisor(18);
    const ecc = reedSolomonRemainder(data, divisor);
    expect(reedSolomonRemainder([...data, ...ecc].slice(0, data.length), divisor)).toEqual(ecc);
    // Flipping one data byte changes the error correction, so it protects the data.
    const damaged = [...data];
    damaged[3] = damaged[3]! ^ 1;
    expect(reedSolomonRemainder(damaged, divisor)).not.toEqual(ecc);
  });

  it("the eight mask formulas of table 10", () => {
    const at = (m: number) => {
      const out: string[] = [];
      for (let y = 0; y < 6; y++) {
        let row = "";
        for (let x = 0; x < 6; x++) row += maskApplies(m, x, y) ? "1" : "0";
        out.push(row);
      }
      return out;
    };
    expect(at(0)[0]).toBe("101010");
    expect(at(1)).toEqual(["111111", "000000", "111111", "000000", "111111", "000000"]);
    expect(at(2)[0]).toBe("100100");
    expect(at(3)[0]).toBe("100100");
    expect(at(3)[1]).toBe("001001");
    expect(at(4)[0]).toBe("111000");
    expect(at(5)[0]).toBe("111111");
    expect(at(5)[1]).toBe("100000"); // x*y%2 + x*y%3 == 0 only where x*y is a multiple of 6 (or 0)
    expect(at(6)[1]).toBe("111000"); // (x*y%2 + x*y%3) % 2 == 0 for x*y = x = 0,1,2 only
    expect(at(7)[0]).toBe("101010");
  });

  it("codeword capacity per version matches ISO/IEC 18004 table 7 and the level M byte capacities", () => {
    expect([1, 2, 3, 7, 10, 14].map(totalCodewords)).toEqual([26, 44, 70, 196, 346, 581]);
    expect([1, 2, 3, 7, 14].map(dataCodewordCount)).toEqual([16, 28, 44, 124, 365]);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(byteCapacity)).toEqual([
      14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362,
    ]);
    expect(QR_MAX_BYTES).toBe(byteCapacity(14));
  });

  it("interleaving two blocks: version 4 puts block data first, then error correction, in alternation", () => {
    const data = Array.from({ length: dataCodewordCount(4) }, (_, i) => i + 1); // 64 = 2 blocks of 32
    const out = interleaveCodewords(data, 4);
    expect(out.length).toBe(totalCodewords(4));
    expect(out.slice(0, 4)).toEqual([1, 33, 2, 34]);
    expect(out.slice(62, 64)).toEqual([32, 64]);
  });

  it("interleaving uneven blocks: version 9 has 3 blocks of 36 and 2 of 37 data codewords", () => {
    const data = Array.from({ length: dataCodewordCount(9) }, (_, i) => i);
    expect(data.length).toBe(182);
    const out = interleaveCodewords(data, 9);
    expect(out.length).toBe(totalCodewords(9));
    // First codeword of each block: block lengths 36, 36, 36, 37, 37.
    expect(out.slice(0, 5)).toEqual([0, 36, 72, 108, 145]);
    // The 37th data codeword exists only in the two long blocks, and comes before any error correction.
    expect(out.slice(180, 182)).toEqual([144, 181]);
  });
});

describe("QR encoder: symbols", () => {
  it("chooses the smallest version for the byte count and refuses too much", () => {
    const sizeFor = (n: number) => encodeQr("a".repeat(n)).version;
    expect(sizeFor(1)).toBe(1);
    expect(sizeFor(14)).toBe(1);
    expect(sizeFor(15)).toBe(2);
    expect(sizeFor(26)).toBe(2);
    expect(sizeFor(27)).toBe(3);
    expect(sizeFor(122)).toBe(7);
    expect(sizeFor(123)).toBe(8);
    expect(sizeFor(QR_MAX_BYTES)).toBe(14);
    expect(() => encodeQr("a".repeat(QR_MAX_BYTES + 1))).toThrow(QrTooLongError);
    expect(() => encodeQr("a".repeat(QR_MAX_BYTES + 1))).toThrow(/363 bytes/);
    expect(() => encodeQr("")).toThrow(RangeError);
  });

  it("counts UTF-8 bytes, not characters", () => {
    expect(encodeQr("é".repeat(7)).version).toBe(1); // 14 bytes
    expect(encodeQr("é".repeat(8)).version).toBe(2); // 16 bytes
    expect(() => encodeQr("€".repeat(121))).toThrow(QrTooLongError); // 363 bytes
    expect(encodeQr("€".repeat(120)).version).toBe(14); // 360 bytes
  });

  it("draws the three finder patterns, the timing patterns and the dark module", () => {
    const qr = encodeQr("phoenixphone://pair");
    const n = qr.size;
    expect(n).toBe(17 + 4 * qr.version);
    const finder = ["1111111", "1000001", "1011101", "1011101", "1011101", "1000001", "1111111"];
    for (const [ox, oy] of [
      [0, 0],
      [n - 7, 0],
      [0, n - 7],
    ] as const) {
      for (let y = 0; y < 7; y++) expect(rowOf(qr, oy + y, ox, ox + 7)).toBe(finder[y]);
    }
    for (let i = 8; i < n - 8; i++) {
      expect(qr.modules[6]![i]).toBe(i % 2 === 0);
      expect(qr.modules[i]![6]).toBe(i % 2 === 0);
    }
    expect(qr.modules[n - 8]![8]).toBe(true);
  });

  it("writes the format information of the chosen mask in both places", () => {
    for (const text of ["a", "phoenixphone://pair?host=192.168.1.5&port=47821", "x".repeat(200)]) {
      const qr = encodeQr(text);
      const n = qr.size;
      const bits = formatBits(qr.mask);
      // Copy next to the top-left finder (bit 14 first), per ISO/IEC 18004 figure 25.
      const m = qr.modules;
      let value = 0;
      const cells: boolean[] = [];
      for (let i = 0; i <= 5; i++) cells[i] = m[i]![8]!;
      cells[6] = m[7]![8]!;
      cells[7] = m[8]![8]!;
      cells[8] = m[8]![7]!;
      for (let i = 9; i < 15; i++) cells[i] = m[8]![14 - i]!;
      cells.forEach((c, i) => (value |= Number(c) << i));
      expect(value).toBe(bits);
      // The second copy, split between the top-right and bottom-left finders.
      let second = 0;
      for (let i = 0; i < 8; i++) second |= Number(m[8]![n - 1 - i]) << i;
      for (let i = 8; i < 15; i++) second |= Number(m[n - 15 + i]![8]) << i;
      expect(second).toBe(bits);
    }
  });

  it("writes the version information for version 7 and up", () => {
    const qr = encodeQr("v".repeat(150)); // version 8
    expect(qr.version).toBe(8);
    const bits = versionBits(8);
    for (let i = 0; i < 18; i++) {
      const a = qr.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      expect(qr.modules[a]![b]).toBe(((bits >>> i) & 1) === 1);
      expect(qr.modules[b]![a]).toBe(((bits >>> i) & 1) === 1);
    }
  });

  it("is deterministic and different text gives a different symbol", () => {
    const a = encodeQr("phoenixphone://pair?host=10.0.0.2");
    expect(encodeQr("phoenixphone://pair?host=10.0.0.2").modules).toEqual(a.modules);
    expect(encodeQr("phoenixphone://pair?host=10.0.0.3").modules).not.toEqual(a.modules);
  });

  it("picks the mask with the lowest penalty among the eight", () => {
    for (const text of [
      "phoenixphone://pair?host=192.168.1.5&port=47821&code=ABCD-EFGH-JKLM",
      "a",
      "x".repeat(100),
    ]) {
      const chosen = encodeQr(text);
      const scores = [0, 1, 2, 3, 4, 5, 6, 7].map((mask) =>
        penaltyScore(encodeQr(text, { mask }).modules),
      );
      expect(penaltyScore(chosen.modules)).toBe(Math.min(...scores));
      expect(chosen.mask).toBe(scores.indexOf(Math.min(...scores)));
      expect(new Set(scores).size).toBeGreaterThan(1); // the masks really differ
    }
    expect(() => encodeQr("a", { mask: 8 })).toThrow(RangeError);
  });

  it("scores the four penalty rules of section 7.8.3", () => {
    // 5x5 all dark: rule 1 gives 3+0.. per run of 5 (10 runs of 5 = 3 each), rule 2 gives 16 boxes x 3,
    // rule 4 gives 100% dark = 10 steps of 5% beyond 50% = 90.
    const dark = Array.from({ length: 5 }, () => new Array<boolean>(5).fill(true));
    expect(penaltyScore(dark)).toBe(10 * 3 + 16 * 3 + 90);
  });

  it("every version from 1 to 14 builds a square symbol of the right size", () => {
    for (let v = 1; v <= 14; v++) {
      const qr = encodeQr("z".repeat(byteCapacity(v)));
      expect(qr.version).toBe(v);
      expect(qr.modules.length).toBe(17 + 4 * v);
      expect(qr.modules.every((row) => row.length === qr.size)).toBe(true);
    }
  });

  it("makes SVG path data with a 4-module quiet zone", () => {
    const qr = encodeQr("hello");
    const { path, total } = qrSvgPath(qr);
    expect(total).toBe(qr.size + 8);
    // The top-left finder's first row is a run of seven dark modules, shifted by the quiet zone.
    expect(path.startsWith("M4 4h7v1h-7z")).toBe(true);
    // No coordinate leaves the viewBox, and the path holds only the characters it is built from.
    expect(path).toMatch(/^[Mhvz\d\s-]+$/);
    for (const [, x, y, len] of path.matchAll(/M(\d+) (\d+)h(\d+)/g)) {
      expect(Number(x) + Number(len)).toBeLessThanOrEqual(total - 4);
      expect(Number(y)).toBeLessThan(total - 4);
    }
  });
});
