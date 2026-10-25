// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// whisper.cpp reading the audio from STDIN: no audio file is written by Phoenix.
//
// Evidence for the mode (read, not assumed): whisper.cpp `examples/cli/cli.cpp` accepts the
// argument "-" as an input name and `examples/common-whisper.cpp` (`read_audio_data`) then reads
// all of stdin into memory and decodes it from memory (miniaudio `ma_decoder_init_memory`); it
// logs "read N bytes from stdin". This is in the source of the CLI; the README does not mention it.
// The unit tests use a fake process runner. Whether a given whisper-cli build and model produce a
// good transcript from stdin has NOT been proven here (only a stub test model was available).
// Output goes to stdout only: we pass no -o* flag, so whisper-cli writes no output file either.
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, join } from "node:path";
import {
  BYTES_PER_SAMPLE,
  SAMPLE_RATE,
  type RecognizerAvailability,
  type RecognizerSession,
  type SpeechRecognizer,
} from "./recognizer";

const MAX_TRANSCRIPT_BYTES = 256 * 1024;
const RUN_TIMEOUT_MS = 60_000;

/** A 44-byte RIFF/WAVE header for 16 kHz mono 16-bit PCM of `dataBytes` bytes. */
export function wavHeader(dataBytes: number): Uint8Array {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) header[at + i] = value.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * BYTES_PER_SAMPLE, true);
  view.setUint16(32, BYTES_PER_SAMPLE, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, dataBytes, true);
  return header;
}

/** Runs an executable with `input` on stdin and resolves with stdout. The input is not retained. */
export type ProcessRunner = (
  executable: string,
  args: readonly string[],
  input: Uint8Array,
  signal: AbortSignal,
) => Promise<string>;

export const runProcess: ProcessRunner = (executable, args, input, signal) => {
  const done = Promise.withResolvers<string>();
  const child = spawn(executable, [...args], {
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
  });
  const chunks: Buffer[] = [];
  let size = 0;
  let settled = false;
  const finish = (fn: () => void) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    fn();
  };
  const abort = () => {
    child.kill("SIGKILL");
    finish(() => done.reject(new Error("recognition stopped")));
  };
  const timer = setTimeout(abort, RUN_TIMEOUT_MS);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  child.stdout.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_TRANSCRIPT_BYTES) {
      child.kill("SIGKILL");
      finish(() => done.reject(new Error("recogniser output too large")));
      return;
    }
    chunks.push(chunk);
  });
  child.once("error", () => finish(() => done.reject(new Error("recogniser could not start"))));
  child.once("close", (code) =>
    finish(() =>
      code === 0
        ? done.resolve(Buffer.concat(chunks).toString("utf8"))
        : done.reject(new Error("recogniser failed")),
    ),
  );
  // EPIPE when the child dies early is reported through 'close'/'error', not thrown here.
  child.stdin.on("error", () => {});
  child.stdin.end(input);
  return done.promise;
};

export async function onPath(executable: string): Promise<boolean> {
  const dirs = executable.includes("/") ? [""] : (process.env.PATH ?? "").split(delimiter);
  for (const dir of dirs) {
    try {
      const file = dir ? join(dir, executable) : executable;
      await access(file, constants.X_OK);
      return (await stat(file)).isFile();
    } catch {
      // try the next directory
    }
  }
  return false;
}

/** Whisper's own bracketed notes ("[BLANK_AUDIO]", "(music)") are not speech. */
export function cleanWhisperOutput(raw: string): string {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^[[(].{0,40}[\])]$/u.test(line))
    .join(" ");
}

/** A WAV (44-byte header + 16-bit samples) built in memory from PCM chunks. The caller zeroes it. */
export function pcmToWav(chunks: readonly Int16Array[]): Uint8Array {
  const samples = chunks.reduce((n, c) => n + c.length, 0);
  const wav = new Uint8Array(44 + samples * BYTES_PER_SAMPLE);
  wav.set(wavHeader(samples * BYTES_PER_SAMPLE), 0);
  const view = new DataView(wav.buffer);
  let offset = 44;
  for (const chunk of chunks) {
    for (const sample of chunk) {
      view.setInt16(offset, sample, true);
      offset += BYTES_PER_SAMPLE;
    }
  }
  return wav;
}

export interface WhisperStdinOptions {
  modelPath: string;
  executable?: string;
  run?: ProcessRunner;
}

export class WhisperStdinRecognizer implements SpeechRecognizer {
  private readonly executable: string;
  private readonly run: ProcessRunner;

  constructor(private readonly options: WhisperStdinOptions) {
    if (!options.modelPath) throw new TypeError("A Whisper model path is required");
    this.executable = options.executable ?? "whisper-cli";
    this.run = options.run ?? runProcess;
  }

  async availability(): Promise<RecognizerAvailability> {
    try {
      const model = await stat(this.options.modelPath);
      if (!model.isFile() || model.size < 1024) throw new Error("model");
      await access(this.options.modelPath, constants.R_OK);
    } catch {
      return { available: false, detail: "Local Whisper model is not installed or readable" };
    }
    if (!(await onPath(this.executable)))
      return { available: false, detail: "whisper-cli was not found on this device" };
    return {
      available: true,
      engine: "whisper.cpp",
      detail: "whisper.cpp reads the audio from memory (stdin); no audio file is written",
    };
  }

  start(): RecognizerSession {
    const chunks: Int16Array[] = [];
    const abort = new AbortController();
    let ended = false;
    return {
      push: (pcm) => {
        if (!ended) chunks.push(pcm);
      },
      cancel: () => {
        ended = true;
        chunks.length = 0;
        abort.abort();
      },
      finish: async () => {
        if (ended) throw new Error("recognition stopped");
        ended = true;
        const wav = pcmToWav(chunks);
        chunks.length = 0;
        try {
          const out = await this.run(
            this.executable,
            ["-m", this.options.modelPath, "-nt", "-np", "-"],
            wav,
            abort.signal,
          );
          return { text: cleanWhisperOutput(out) };
        } finally {
          wav.fill(0);
        }
      },
    };
  }
}
