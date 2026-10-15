// SPDX-License-Identifier: CC-BY-SA-4.0
// Copyright (C) 2026 Phoenix contributors
//
// Fawkes sound set: original, procedurally generated. Every sound is a few notes described below
// and rendered by the small synthesiser in this file; no sampled or third-party audio is used.

export type Waveform = "sine" | "triangle" | "square";

/** One note. A glide moves linearly from `freq` to `endFreq` over the note. */
export interface Note {
  /** Start frequency in Hz. */
  freq: number;
  endFreq?: number;
  ms: number;
  wave: Waveform;
  /** 0..1, before the sound's master gain. */
  gain: number;
  /** Silence after this note, in ms (default 0). */
  gapMs?: number;
}

export interface SoundSpec {
  id: string;
  name: string;
  /** Linear master gain, keeps every sound well below full scale. */
  master: number;
  notes: readonly Note[];
}

/** Every built-in sound. Ids double as the file names a user can drop into the sounds folder. */
export const SOUND_IDS = ["greet", "poke", "dizzy", "recover", "jump", "waiting", "error"] as const;
export type SoundId = (typeof SOUND_IDS)[number];

export const SOUNDS: Readonly<Record<SoundId, SoundSpec>> = {
  greet: {
    id: "greet",
    name: "Hello chirp",
    master: 0.5,
    notes: [
      { freq: 660, endFreq: 880, ms: 90, wave: "triangle", gain: 0.8, gapMs: 20 },
      { freq: 880, endFreq: 1175, ms: 130, wave: "triangle", gain: 0.8 },
    ],
  },
  poke: {
    id: "poke",
    name: "Squeak",
    master: 0.5,
    notes: [{ freq: 1250, endFreq: 520, ms: 110, wave: "triangle", gain: 0.9 }],
  },
  dizzy: {
    id: "dizzy",
    name: "Wobble",
    master: 0.45,
    notes: [
      { freq: 520, endFreq: 380, ms: 140, wave: "sine", gain: 0.9 },
      { freq: 380, endFreq: 560, ms: 140, wave: "sine", gain: 0.9 },
      { freq: 560, endFreq: 330, ms: 160, wave: "sine", gain: 0.9 },
      { freq: 330, endFreq: 440, ms: 200, wave: "sine", gain: 0.8 },
    ],
  },
  recover: {
    id: "recover",
    name: "Shake off",
    master: 0.45,
    notes: [
      { freq: 392, ms: 80, wave: "triangle", gain: 0.8, gapMs: 15 },
      { freq: 523, ms: 120, wave: "triangle", gain: 0.8 },
    ],
  },
  jump: {
    id: "jump",
    name: "Happy hop",
    master: 0.5,
    notes: [
      { freq: 523, ms: 90, wave: "triangle", gain: 0.85, gapMs: 15 },
      { freq: 659, ms: 90, wave: "triangle", gain: 0.85, gapMs: 15 },
      { freq: 784, ms: 90, wave: "triangle", gain: 0.85, gapMs: 15 },
      { freq: 1047, ms: 220, wave: "triangle", gain: 0.9 },
    ],
  },
  waiting: {
    id: "waiting",
    name: "Needs you",
    master: 0.5,
    notes: [
      { freq: 880, ms: 110, wave: "sine", gain: 0.9, gapMs: 70 },
      { freq: 880, ms: 160, wave: "sine", gain: 0.9 },
    ],
  },
  error: {
    id: "error",
    name: "Low note",
    master: 0.5,
    notes: [
      { freq: 330, endFreq: 262, ms: 180, wave: "triangle", gain: 0.9, gapMs: 30 },
      { freq: 262, endFreq: 196, ms: 260, wave: "triangle", gain: 0.9 },
    ],
  },
};

/** What happened in the product (never a guess) that may be accompanied by a sound. */
export const SOUND_EVENTS = [
  "launch",
  "poke",
  "dizzy",
  "recover",
  "completion",
  "needs-you",
  "failure",
] as const;
export type SoundEvent = (typeof SOUND_EVENTS)[number];

/** The sound-event table: each real event maps to one built-in sound. */
export const SOUND_EVENT_TABLE: Readonly<Record<SoundEvent, SoundId>> = {
  launch: "greet",
  poke: "poke",
  dizzy: "dizzy",
  recover: "recover",
  completion: "jump",
  "needs-you": "waiting",
  failure: "error",
};

export const SAMPLE_RATE = 22_050;
const ATTACK_MS = 6;
const RELEASE_MS = 24;

/** Renders a sound to mono 16-bit PCM. Deterministic: the same spec always yields the same bytes. */
export function renderPcm(spec: SoundSpec, sampleRate = SAMPLE_RATE): Int16Array {
  const samplesPer = (ms: number) => Math.max(1, Math.round((ms / 1000) * sampleRate));
  const total = spec.notes.reduce(
    (n, note) => n + samplesPer(note.ms) + samplesPer(note.gapMs ?? 0),
    0,
  );
  const out = new Int16Array(total);
  let at = 0;
  for (const note of spec.notes) {
    const length = samplesPer(note.ms);
    const attack = Math.min(samplesPer(ATTACK_MS), length >> 1);
    const release = Math.min(samplesPer(RELEASE_MS), length >> 1);
    const end = note.endFreq ?? note.freq;
    let phase = 0;
    for (let i = 0; i < length; i++) {
      const freq = note.freq + (end - note.freq) * (i / length);
      phase += freq / sampleRate;
      phase -= Math.floor(phase);
      const raw =
        note.wave === "sine"
          ? Math.sin(2 * Math.PI * phase)
          : note.wave === "triangle"
            ? 1 - 4 * Math.abs(phase - 0.5)
            : phase < 0.5
              ? 0.6
              : -0.6;
      const envelope = Math.min(
        1,
        i / Math.max(1, attack),
        (length - 1 - i) / Math.max(1, release),
      );
      out[at + i] = Math.round(raw * envelope * note.gain * spec.master * 32767);
    }
    at += length + samplesPer(note.gapMs ?? 0);
  }
  return out;
}

const HEADER_BYTES = 44;

/** Wraps mono 16-bit PCM in a canonical WAV container. */
export function encodeWav(pcm: Int16Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const bytes = new Uint8Array(HEADER_BYTES + pcm.length * 2);
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  tag(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  pcm.forEach((sample, i) => view.setInt16(HEADER_BYTES + i * 2, sample, true));
  return bytes;
}

/** The WAV file for a built-in sound. */
export function synthesize(id: SoundId): Uint8Array {
  return encodeWav(renderPcm(SOUNDS[id]));
}

/** Largest user-supplied sound we accept, and the longest it may play. */
export const MAX_OVERRIDE_BYTES = 2 * 1024 * 1024;
export const MAX_OVERRIDE_SECONDS = 5;

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  seconds: number;
}

/**
 * Checks that user-supplied bytes are a plain PCM WAV file of sane size and length. Returns null
 * for anything else (the built-in sound is used instead); never throws on hostile input.
 */
export function inspectWav(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < HEADER_BYTES || bytes.length > MAX_OVERRIDE_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let offset = 12;
  let fmt: Pick<WavInfo, "sampleRate" | "channels" | "bitsPerSample"> | null = null;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt " && size >= 16 && body + 16 <= bytes.length) {
      if (view.getUint16(body, true) !== 1) return null; // PCM only
      fmt = {
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      if (!fmt || fmt.channels < 1 || fmt.sampleRate < 1 || fmt.bitsPerSample < 8) return null;
      const length = Math.min(size, bytes.length - body);
      const seconds = length / (fmt.sampleRate * fmt.channels * (fmt.bitsPerSample / 8));
      if (length === 0 || seconds > MAX_OVERRIDE_SECONDS) return null;
      return { ...fmt, seconds };
    }
    offset = body + size + (size % 2);
  }
  return null;
}
