// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The speech-to-text seam of dictation. A recogniser is handed 16 kHz mono 16-bit PCM in memory
// and returns text. Implementations:
//   * FakeRecognizer (here): deterministic, for tests.
//   * WhisperStdinRecognizer (whisper-stdin.ts): whisper.cpp's CLI reading the audio from stdin.
//   * ParakeetSherpaRecognizer (parakeet-sherpa.ts): NVIDIA Parakeet through sherpa-onnx's
//     `sherpa-onnx-offline`, which can only read a WAV FILE: the one recogniser that writes audio
//     to disk (a private temporary file, erased on every path), and it says so in `audio_on_disk`.
//   * ChainedRecognizer (speech-engines.ts): the owner's ordered, opted-in list of the above.

export const SAMPLE_RATE = 16_000;
/** 16-bit mono PCM. */
export const BYTES_PER_SAMPLE = 2;
export const BYTES_PER_SECOND = SAMPLE_RATE * BYTES_PER_SAMPLE;

export interface RecognizerAvailability {
  available: boolean;
  /** Safe to show: no path, no text. */
  detail: string;
  /** Name of the engine, for the user ("whisper.cpp"). */
  engine?: string;
  /** True when this engine writes the audio to a temporary file while it recognises. Absent = false. */
  audio_on_disk?: boolean;
  /** Every engine the owner opted in to, in order, and why the active one was chosen. */
  engines?: RecognizerEngineStatus[];
}

export interface RecognizerEngineStatus {
  /** Stable id: "whisper" | "parakeet". */
  id: string;
  available: boolean;
  /** The engine that will run the next session. */
  active: boolean;
  /** Safe to show: no path, no text. */
  detail: string;
}

export interface RecognizerSession {
  /**
   * Hands over audio. The array stays owned by the caller (the session manager), which zeroes it
   * when the session ends: keep a reference only until `finish`/`cancel`, never write it to disk.
   */
  push(pcm: Int16Array): void;
  /** Ends the audio and resolves with the recognised text. */
  finish(): Promise<{ text: string }>;
  /** Abandons the session and any recognition in progress. Safe to call more than once. */
  cancel(): void;
}

export interface SpeechRecognizer {
  availability(): Promise<RecognizerAvailability>;
  /** Starts a session; throws if the recogniser cannot run. */
  start(): RecognizerSession;
}

export interface FakeRecognizerOptions {
  /** What every session returns; or a function of the PCM seen (sample count, first sample). */
  transcript: string | ((samples: number) => string);
  available?: boolean;
  /** `finish` rejects with this message. */
  failWith?: string;
  /** `finish` waits for this before answering (tests drive timing with it). */
  gate?: Promise<void>;
}

/** What a fake session saw: the SAME arrays that were pushed (not copies), so tests can check zeroing. */
export interface FakeSessionRecord {
  chunks: Int16Array[];
  state: "open" | "finished" | "cancelled";
}

export class FakeRecognizer implements SpeechRecognizer {
  readonly sessions: FakeSessionRecord[] = [];

  constructor(private readonly options: FakeRecognizerOptions) {}

  availability(): Promise<RecognizerAvailability> {
    const available = this.options.available !== false;
    return Promise.resolve({
      available,
      detail: available ? "Fake recogniser (tests)" : "Fake recogniser switched off",
      engine: "fake",
    });
  }

  start(): RecognizerSession {
    if (this.options.available === false) throw new Error("recogniser unavailable");
    const record: FakeSessionRecord = { chunks: [], state: "open" };
    this.sessions.push(record);
    const { options } = this;
    return {
      push: (pcm) => void record.chunks.push(pcm),
      cancel: () => {
        record.state = "cancelled";
      },
      finish: async () => {
        await options.gate;
        if (record.state === "cancelled") throw new Error("cancelled");
        record.state = "finished";
        if (options.failWith) throw new Error(options.failWith);
        const samples = record.chunks.reduce((n, c) => n + c.length, 0);
        const text =
          typeof options.transcript === "function"
            ? options.transcript(samples)
            : options.transcript;
        return { text };
      },
    };
  }
}
