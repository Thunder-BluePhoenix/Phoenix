// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** Turns the PCM frames the microphone delivers into one smoothed 0..1 loudness for the dots. */
export interface PillAnalyser {
  push(pcm: Int16Array): void;
  /** Smoothed loudness, 0 (silence) .. 1 (loud). */
  level(): number;
  reset(): void;
}

export const PCM_SAMPLE_RATE = 16_000;
/** Speech sits well below full scale; this makes ordinary speaking reach most of the range. */
const GAIN = 6;
/** Time constants (seconds): quick to rise with the voice, slower to fall. */
const ATTACK_SECONDS = 0.05;
const DECAY_SECONDS = 0.2;

/**
 * RMS of each frame with attack/decay smoothing. The time that passed is the frame's own length
 * (samples / sample rate), so no clock is read and the result depends only on the audio pushed.
 */
export function createPcmAnalyser(sampleRate = PCM_SAMPLE_RATE): PillAnalyser {
  let current = 0;
  return {
    push(pcm) {
      if (pcm.length === 0) return;
      let sum = 0;
      for (const sample of pcm) sum += (sample / 32768) * (sample / 32768);
      const target = Math.min(1, Math.sqrt(sum / pcm.length) * GAIN);
      const seconds = pcm.length / sampleRate;
      const tau = target > current ? ATTACK_SECONDS : DECAY_SECONDS;
      current = Math.min(
        1,
        Math.max(0, current + (target - current) * (1 - Math.exp(-seconds / tau))),
      );
    },
    level: () => current,
    reset() {
      current = 0;
    },
  };
}
