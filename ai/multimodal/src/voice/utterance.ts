// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The audio gate in front of the recogniser. While nobody is speaking, frames only go through the
// energy VAD and into a small FIXED pre-roll ring (so the first syllable is not lost); no
// recogniser runs and nothing is allocated per frame. When the VAD declares speech, the ring's
// contents and the frames that follow become ONE utterance, handed to `onUtterance` when the VAD
// says the speech ended (or the length cap is hit).
//
// Every buffer here is memory only and is zeroed: the ring on `stop()` (every exit path of the
// session calls it) and the partial utterance on `stop()`; a finished utterance belongs to the
// callback, which must `wipeUtterance` it (the session does, on every path). The ring is also
// emptied (zeroed) the moment its contents move into an utterance.
import { DEFAULT_VAD_CONFIG, EnergyVad, type VadConfig } from "./vad";

export interface UtteranceConfig {
  vad: VadConfig;
  /** Audio kept from before the VAD fired. Must cover `vad.minSpeechMs`. */
  preRollMs: number;
  /** Longest utterance; going over ENDS it (and is recognised as it stands). */
  maxUtteranceMs: number;
}

export const DEFAULT_UTTERANCE_CONFIG: UtteranceConfig = {
  vad: DEFAULT_VAD_CONFIG,
  preRollMs: 400,
  maxUtteranceMs: 15_000,
};

export interface Utterance {
  /** Private copies of the audio, in order. The owner zeroes them with `wipeUtterance`. */
  chunks: Int16Array[];
  samples: number;
  reason: "silence" | "max_length";
}

export function wipeUtterance(utterance: Utterance): void {
  for (const chunk of utterance.chunks) chunk.fill(0);
  utterance.chunks.length = 0;
  utterance.samples = 0;
}

export class UtteranceGate {
  private readonly vad: EnergyVad;
  private readonly ring: Int16Array;
  private readonly maxSamples: number;
  private head = 0;
  private filled = 0;
  private chunks: Int16Array[] = [];
  private samples = 0;

  constructor(
    private readonly onUtterance: (utterance: Utterance) => void,
    config: UtteranceConfig = DEFAULT_UTTERANCE_CONFIG,
  ) {
    if (config.preRollMs * 1 < config.vad.minSpeechMs)
      throw new RangeError("preRollMs must cover minSpeechMs");
    this.vad = new EnergyVad(config.vad);
    this.ring = new Int16Array(Math.ceil((config.preRollMs * config.vad.sampleRate) / 1000));
    this.maxSamples = Math.ceil((config.maxUtteranceMs * config.vad.sampleRate) / 1000);
  }

  get speaking(): boolean {
    return this.vad.speaking;
  }

  /** Reads the frame (never keeps a reference to it). */
  push(pcm: Int16Array): void {
    const wasSpeaking = this.vad.speaking;
    const { event } = this.vad.push(pcm);
    if (event === "start") {
      this.begin();
      this.append(pcm);
    } else if (wasSpeaking) {
      this.append(pcm);
      if (event === "end") this.finish("silence");
      else if (this.samples >= this.maxSamples) {
        this.vad.reset();
        this.finish("max_length");
      }
    } else {
      this.remember(pcm);
    }
  }

  /** Zeroes the ring and any partial utterance and forgets the VAD state. Idempotent. */
  stop(): void {
    this.ring.fill(0);
    this.head = 0;
    this.filled = 0;
    for (const chunk of this.chunks) chunk.fill(0);
    this.chunks = [];
    this.samples = 0;
    this.vad.reset();
  }

  private remember(pcm: Int16Array): void {
    const size = this.ring.length;
    if (pcm.length >= size) {
      this.ring.set(pcm.subarray(pcm.length - size));
      this.head = 0;
      this.filled = size;
      return;
    }
    const first = Math.min(pcm.length, size - this.head);
    this.ring.set(pcm.subarray(0, first), this.head);
    if (first < pcm.length) this.ring.set(pcm.subarray(first), 0);
    this.head = (this.head + pcm.length) % size;
    this.filled = Math.min(size, this.filled + pcm.length);
  }

  /** The ring, oldest first, as the start of a new utterance; the ring is then zeroed. */
  private begin(): void {
    const size = this.ring.length;
    if (this.filled > 0) {
      const lead = new Int16Array(this.filled);
      const start = (this.head - this.filled + size) % size;
      const first = Math.min(this.filled, size - start);
      lead.set(this.ring.subarray(start, start + first), 0);
      if (first < this.filled) lead.set(this.ring.subarray(0, this.filled - first), first);
      this.chunks = [lead];
      this.samples = lead.length;
    }
    this.ring.fill(0);
    this.head = 0;
    this.filled = 0;
  }

  private append(pcm: Int16Array): void {
    this.chunks.push(pcm.slice());
    this.samples += pcm.length;
  }

  private finish(reason: Utterance["reason"]): void {
    const utterance: Utterance = { chunks: this.chunks, samples: this.samples, reason };
    this.chunks = [];
    this.samples = 0;
    try {
      this.onUtterance(utterance);
    } catch {
      // A consumer that throws must not leave the audio behind.
      wipeUtterance(utterance);
    }
  }
}
