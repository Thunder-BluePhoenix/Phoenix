// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Small audio and statistics helpers for the real-run measurements (Phase 66). Pure; checked
// without any model by the ungated block of `real-wake.test.ts`.

export interface DecodedWav {
  samples: Int16Array;
  sampleRate: number;
  channels: number;
  bits: number;
}

/** RIFF/WAVE 16-bit PCM: walks the chunks (tolerates LIST and friends). */
export function decodeWav(buf: Uint8Array): DecodedWav {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o: number) => String.fromCharCode(...buf.subarray(o, o + 4));
  if (buf.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | undefined;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      fmt = {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (!fmt) throw new Error("data before fmt");
      if (fmt.format !== 1 || fmt.bits !== 16) throw new Error("not 16-bit PCM");
      const bytes = Math.min(size, buf.length - body);
      const samples = new Int16Array(Math.floor(bytes / 2));
      for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(body + i * 2, true);
      return { samples, sampleRate: fmt.sampleRate, channels: fmt.channels, bits: fmt.bits };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("no data chunk");
}

const clip16 = (x: number) => Math.max(-32768, Math.min(32767, Math.round(x)));

/** Mean of the two signals, sample by sample, the shorter one padded with zeros. */
export function mixPcm(a: Int16Array, b: Int16Array): Int16Array {
  const out = new Int16Array(Math.max(a.length, b.length));
  for (let i = 0; i < out.length; i++) out[i] = clip16(((a[i] ?? 0) + (b[i] ?? 0)) / 2);
  return out;
}

/** RMS in sample units (0..32768). */
export function rmsOf(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i]! * pcm[i]!;
  return Math.sqrt(sum / pcm.length);
}

/**
 * Synthetic pink-ish noise: a seeded LCG (Numerical Recipes constants) gives uniform white noise,
 * shaped by Paul Kellet's economy pink filter (-3 dB/octave, approximate), scaled to `rms`
 * (sample units). Deterministic for a given seed. NOT a recording of any real room.
 */
export function pinkishNoise(length: number, rms: number, seed: number): Float64Array {
  let state = seed >>> 0;
  const white = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x80000000 - 1;
  };
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  const out = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    const w = white();
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    out[i] = b0 + b1 + b2 + w * 0.1848;
  }
  let sum = 0;
  for (const v of out) sum += v * v;
  const scale = sum === 0 ? 0 : rms / Math.sqrt(sum / length);
  for (let i = 0; i < length; i++) out[i] = out[i]! * scale;
  return out;
}

export function addNoise(pcm: Int16Array, noise: Float64Array): Int16Array {
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = clip16(pcm[i]! + (noise[i] ?? 0));
  return out;
}

/** Noise RMS that puts the given signal at `snrDb` above it (20·log10 of the RMS ratio). */
export function noiseRmsForSnr(signalRms: number, snrDb: number): number {
  return signalRms / 10 ** (snrDb / 20);
}

export interface Interval {
  k: number;
  n: number;
  rate: number | null;
  low: number | null;
  high: number | null;
}

/** Wilson score interval for k of n at 95% (z = 1.96). n = 0 gives nulls. */
export function wilson(k: number, n: number): Interval {
  if (n === 0) return { k, n, rate: null, low: null, high: null };
  const z = 1.96;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { k, n, rate: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

export const fmtInterval = (i: Interval): string =>
  i.n === 0
    ? "n/a (n = 0)"
    : `${i.k}/${i.n} = ${(i.rate! * 100).toFixed(1)}% [${(i.low! * 100).toFixed(1)}, ${(i.high! * 100).toFixed(1)}]`;
