// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Seeded randomness and bootstrap confidence intervals. Nothing here reads a clock or
// Math.random, so a report built from the same results and seed is byte-for-byte the same.

/** mulberry32: a small, well-known 32-bit generator. Returns numbers in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const mean = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

export interface Interval {
  /** Mean of the sample. */
  value: number;
  /** Lower and upper bound of the percentile bootstrap interval. */
  low: number;
  high: number;
  /** Sample size. */
  n: number;
}

export const DEFAULT_RESAMPLES = 2000;

/**
 * Percentile bootstrap interval of the mean. With one sample or no spread the interval is the
 * point itself (it says nothing about uncertainty, and `n` shows how little data there is).
 * `level` is the coverage, 0.95 by default.
 */
export function bootstrapMean(
  sample: readonly number[],
  seed: number,
  level = 0.95,
  resamples = DEFAULT_RESAMPLES,
): Interval {
  if (!(level > 0 && level < 1)) throw new RangeError("level must be between 0 and 1");
  const n = sample.length;
  const value = mean(sample);
  if (n === 0) return { value: 0, low: 0, high: 0, n };
  if (n === 1 || sample.every((x) => x === sample[0])) return { value, low: value, high: value, n };
  const rand = seededRandom(seed);
  const means: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += sample[Math.floor(rand() * n)] ?? 0;
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  const alpha = (1 - level) / 2;
  const at = (q: number): number =>
    means[Math.min(means.length - 1, Math.max(0, Math.floor(q * means.length)))] ?? 0;
  return { value, low: at(alpha), high: at(1 - alpha), n };
}

/** FNV-1a over a string, for deriving a stable per-category seed from a name. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Wilson score interval for a proportion k/n (used for rates, where a bootstrap of 0/1 is crude). */
export function wilson(k: number, n: number, z = 1.96): Interval {
  if (n === 0) return { value: 0, low: 0, high: 0, n };
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { value: p, low: Math.max(0, centre - margin), high: Math.min(1, centre + margin), n };
}
