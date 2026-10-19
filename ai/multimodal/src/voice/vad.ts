// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Voice activity detection (Phase 66): a pure energy gate over 16 kHz mono Int16 frames. It is the
// FIRST thing every microphone frame meets, so the idle cost of "OK Fawkes" is one pass of integer
// multiply-adds per frame and a square root; nothing else runs until speech is detected.
//
// The loudness maths is the pill's (apps/web/src/pill/analyser.ts): RMS of the samples scaled to
// 0..1. On top of it:
//   * Hysteresis: speech STARTS at `startRms` but only ENDS below the lower `stopRms`, so a voice
//     that dips between words does not chop an utterance in two.
//   * Onset: `minSpeechMs` of consecutive loud audio is needed before speech is declared, so a
//     click or a door slam is not an utterance.
//   * Hangover: after the audio falls below `stopRms`, `hangoverMs` of continued quiet is needed
//     before the utterance ends.
// Boundaries: a frame is loud when `rms >= startRms` (inclusive) and quiet when `rms < stopRms`
// (strict), so a level exactly on `startRms` starts speech and exactly on `stopRms` still counts as
// speech. No clock is read: time is the audio's own length, so the result depends only on the PCM.

export const VAD_SAMPLE_RATE = 16_000;

export interface VadConfig {
  sampleRate: number;
  /** Normalised RMS (0..1) at or above which a frame can start speech. */
  startRms: number;
  /** Normalised RMS below which a frame counts as quiet inside speech. Must be below `startRms`. */
  stopRms: number;
  /** Consecutive loud audio needed to declare speech. */
  minSpeechMs: number;
  /** Consecutive quiet audio needed to end speech. */
  hangoverMs: number;
}

export const DEFAULT_VAD_CONFIG: VadConfig = {
  sampleRate: VAD_SAMPLE_RATE,
  startRms: 0.02,
  stopRms: 0.012,
  minSpeechMs: 120,
  hangoverMs: 600,
};

export type VadEvent = "none" | "start" | "end";

export interface VadResult {
  event: VadEvent;
  /** True while inside an utterance, after this frame was counted. */
  speaking: boolean;
  /** Normalised RMS of this frame (0 for an empty frame). */
  rms: number;
}

/** Throws RangeError for a configuration that cannot work. */
export function validateVadConfig(config: VadConfig): VadConfig {
  const positive = (n: number) => Number.isFinite(n) && n > 0;
  if (!positive(config.sampleRate)) throw new RangeError("sampleRate must be positive");
  if (!positive(config.startRms) || config.startRms > 1)
    throw new RangeError("startRms must be in (0, 1]");
  if (!positive(config.stopRms) || config.stopRms >= config.startRms)
    throw new RangeError("stopRms must be positive and below startRms");
  if (!positive(config.minSpeechMs)) throw new RangeError("minSpeechMs must be positive");
  if (!positive(config.hangoverMs)) throw new RangeError("hangoverMs must be positive");
  return config;
}

/** RMS of one frame as 0..1 of full scale. 0 for an empty frame. */
export function frameRms(pcm: Int16Array): number {
  const n = pcm.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = pcm[i]!;
    sum += s * s;
  }
  return Math.sqrt(sum / n) / 32768;
}

export class EnergyVad {
  private readonly config: VadConfig;
  private inSpeech = false;
  private loudMs = 0;
  private quietMs = 0;

  constructor(config: VadConfig = DEFAULT_VAD_CONFIG) {
    this.config = validateVadConfig({ ...config });
  }

  get speaking(): boolean {
    return this.inSpeech;
  }

  push(pcm: Int16Array): VadResult {
    if (pcm.length === 0) return { event: "none", speaking: this.inSpeech, rms: 0 };
    const rms = frameRms(pcm);
    const ms = (pcm.length * 1000) / this.config.sampleRate;
    if (!this.inSpeech) {
      if (rms >= this.config.startRms) {
        this.loudMs += ms;
        if (this.loudMs >= this.config.minSpeechMs) {
          this.inSpeech = true;
          this.loudMs = 0;
          this.quietMs = 0;
          return { event: "start", speaking: true, rms };
        }
      } else {
        this.loudMs = 0;
      }
      return { event: "none", speaking: false, rms };
    }
    if (rms < this.config.stopRms) {
      this.quietMs += ms;
      if (this.quietMs >= this.config.hangoverMs) {
        this.reset();
        return { event: "end", speaking: false, rms };
      }
    } else {
      this.quietMs = 0;
    }
    return { event: "none", speaking: true, rms };
  }

  reset(): void {
    this.inSpeech = false;
    this.loudMs = 0;
    this.quietMs = 0;
  }
}
