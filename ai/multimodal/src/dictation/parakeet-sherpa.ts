// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// NVIDIA Parakeet (a NeMo transducer) through sherpa-onnx's `sherpa-onnx-offline` CLI.
//
// Evidence for the command line and the output (read from the official docs, not guessed):
//   https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/nemo-transducer-models.html
//   ("Decode wave files": `--encoder=… --decoder=… --joiner=… --tokens=… --model-type=nemo_transducer
//   <file>.wav`; "It supports decoding only wave files of a single channel with 16-bit encoded
//   samples, while the sampling rate does not need to be 16 kHz.")
//   https://github.com/k2-fsa/sherpa-onnx/blob/master/sherpa-onnx/csrc/sherpa-onnx-offline.cc
//   (the config dump, "Started", "Done!", the file name and the timing all go to STDERR; each decoded
//   file's result is ONE JSON line on STDOUT: {"lang":…,"text":…,"timestamps":[…],"tokens":[…],…}).
//
// This is the one recogniser that writes the audio to disk: `sherpa-onnx-offline` only reads WAV
// FILES (no stdin mode in that doc or source). So the audio goes to a private temporary directory
// (mode 0700 on POSIX; the per-user temp dir on Windows, where modes do not apply) as a 0600 file
// that is overwritten with zeros and removed on EVERY path (success, failure, timeout, cancel). If the
// erase fails the session fails and the text is dropped, rather than leaving audio behind quietly.
// `availability()` says `audio_on_disk: true` so every status view can tell the owner.
//
// Same guarantees as the Whisper recogniser: argv only (no shell), the in-memory audio zeroed,
// bounded output, a timeout, fixed secret-free errors, no network (stderr, which carries the model
// paths, is not read). Nothing here has run a real model.
import { accessSync, constants, statSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { RecognizerAvailability, RecognizerSession, SpeechRecognizer } from "./recognizer";
import { onPath, pcmToWav, runProcess, type ProcessRunner } from "./whisper-stdin";

const MAX_TEXT_CHARS = 64 * 1024;
const MIN_MODEL_BYTES = 1024;

/** Where the official int8 model release keeps each file; the fp32 release drops the ".int8". */
const MODEL_FILES = {
  encoder: ["encoder.int8.onnx", "encoder.onnx"],
  decoder: ["decoder.int8.onnx", "decoder.onnx"],
  joiner: ["joiner.int8.onnx", "joiner.onnx"],
  tokens: ["tokens.txt"],
} as const;

type ModelPart = keyof typeof MODEL_FILES;
type ModelFiles = Record<ModelPart, string>;

function readable(file: string): boolean {
  try {
    if (!statSync(file).isFile() || statSync(file).size < MIN_MODEL_BYTES) return false;
    accessSync(file, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/** The model files inside `dir`, or null when any is missing or unreadable. */
export function resolveParakeetModel(dir: string): ModelFiles | null {
  const found: Partial<ModelFiles> = {};
  for (const part of Object.keys(MODEL_FILES) as ModelPart[]) {
    const hit = MODEL_FILES[part].map((name) => join(dir, name)).find(readable);
    if (!hit) return null;
    found[part] = hit;
  }
  return found as ModelFiles;
}

/**
 * The text of `sherpa-onnx-offline`'s stdout: the first line that is a JSON object with a string
 * `text`. Everything else (logs, anything hostile) is ignored; no such line throws a fixed error.
 * The text is stripped of control characters and whitespace-collapsed; an empty text stays empty.
 */
export function parseSherpaOutput(raw: string): string {
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof value !== "object" || value === null || !("text" in value)) continue;
    const text = value.text;
    if (typeof text !== "string") continue;
    return text
      .slice(0, MAX_TEXT_CHARS)
      .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
  }
  throw new Error("recogniser output not understood");
}

export interface ParakeetSherpaOptions {
  /** Absolute directory holding encoder, decoder, joiner and tokens.txt (from the environment only). */
  modelDir: string;
  /** Default "sherpa-onnx-offline", looked up on PATH; or an absolute path. */
  executable?: string;
  run?: ProcessRunner;
  /** Where the private temporary directory is made. Default: the OS temp dir. */
  tempRoot?: string;
  /** CPU threads handed to sherpa-onnx. Default 2 (the value in the official example output). */
  numThreads?: number;
}

export class ParakeetSherpaRecognizer implements SpeechRecognizer {
  private readonly modelDir: string;
  private readonly executable: string;
  private readonly run: ProcessRunner;
  private readonly tempRoot: string;
  private readonly numThreads: number;

  constructor(options: ParakeetSherpaOptions) {
    if (!options.modelDir || !isAbsolute(options.modelDir))
      throw new TypeError("An absolute Parakeet model directory is required");
    this.modelDir = resolve(options.modelDir);
    this.executable = options.executable ?? "sherpa-onnx-offline";
    this.run = options.run ?? runProcess;
    this.tempRoot = options.tempRoot ?? tmpdir();
    const threads = options.numThreads ?? 2;
    this.numThreads = Number.isInteger(threads) && threads >= 1 && threads <= 16 ? threads : 2;
  }

  async availability(): Promise<RecognizerAvailability> {
    if (!resolveParakeetModel(this.modelDir))
      return {
        available: false,
        audio_on_disk: true,
        detail:
          "Parakeet model files (encoder, decoder, joiner, tokens) are not installed or readable",
      };
    if (!(await onPath(this.executable)))
      return {
        available: false,
        audio_on_disk: true,
        detail: "sherpa-onnx-offline was not found on this device",
      };
    return {
      available: true,
      engine: "Parakeet (sherpa-onnx)",
      audio_on_disk: true,
      detail:
        "Parakeet through sherpa-onnx reads a WAV file, so the audio is written to a private temporary file for the recognition and erased straight after",
    };
  }

  start(): RecognizerSession {
    const model = resolveParakeetModel(this.modelDir);
    if (!model) throw new Error("recogniser unavailable");
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
        let dir: string | null = null;
        let file: string | null = null;
        try {
          dir = await mkdtemp(join(this.tempRoot, "phoenix-parakeet-"));
          await chmod(dir, 0o700);
          file = join(dir, "audio.wav");
          await writeFile(file, wav, { mode: 0o600, flag: "wx" });
          const out = await this.run(
            this.executable,
            [
              `--tokens=${model.tokens}`,
              `--encoder=${model.encoder}`,
              `--decoder=${model.decoder}`,
              `--joiner=${model.joiner}`,
              "--model-type=nemo_transducer",
              `--num-threads=${this.numThreads}`,
              file,
            ],
            new Uint8Array(0),
            abort.signal,
          );
          return { text: parseSherpaOutput(out) };
        } finally {
          wav.fill(0);
          await erase(dir, file, wav.length);
        }
      },
    };
  }
}

/** Overwrites the audio file with zeros, then removes the directory. Throws a fixed error if it stays. */
async function erase(dir: string | null, file: string | null, bytes: number): Promise<void> {
  if (!dir) return;
  if (file) await writeFile(file, new Uint8Array(bytes), { mode: 0o600 }).catch(() => {});
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    throw new Error("could not erase the temporary audio file");
  }
}
