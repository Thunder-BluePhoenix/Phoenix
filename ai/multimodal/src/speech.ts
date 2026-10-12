// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { access, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { constants } from "node:fs";
import { CaptureUnavailableError } from "./session";

export interface SpeechResult {
  transcript: string;
  provider: "whisper.cpp";
  locality: "local";
}

/** whisper-cli requires a locally installed model and a WAV input; it is not Kage's meeting bot. */
export class LocalWhisperSpeech {
  constructor(
    private readonly modelPath: string,
    private readonly executable = "whisper-cli",
  ) {
    if (!modelPath || !executable) throw new TypeError("Whisper model and executable are required");
  }

  async availability(): Promise<{ available: boolean; detail: string }> {
    try {
      await access(this.modelPath, constants.R_OK);
      const file = await stat(this.modelPath);
      if (!file.isFile() || file.size < 1024) throw new Error("Invalid Whisper model");
      return {
        available: true,
        detail: "Local Whisper model file is readable; executable checked on use",
      };
    } catch {
      return { available: false, detail: "Local Whisper model is not installed or readable" };
    }
  }

  async transcribe(wav: Uint8Array, signal?: AbortSignal): Promise<SpeechResult> {
    let dir: string | undefined;
    try {
      if (
        wav.byteLength < 44 ||
        wav.byteLength > 32 * 1024 * 1024 ||
        Buffer.from(wav.buffer, wav.byteOffset, 4).toString("ascii") !== "RIFF" ||
        Buffer.from(wav.buffer, wav.byteOffset + 8, 4).toString("ascii") !== "WAVE"
      ) {
        throw new CaptureUnavailableError(
          "Speech requires bounded WAV audio captured on this device",
        );
      }
      const status = await this.availability();
      if (!status.available) throw new CaptureUnavailableError(status.detail);
      if (signal?.aborted) throw new CaptureUnavailableError("Speech processing stopped");
      dir = await mkdtemp(join(tmpdir(), "phoenix-speech-"));
      const file = join(dir, "input.wav");
      await writeFile(file, wav, { mode: 0o600 });
      if (signal?.aborted) throw new CaptureUnavailableError("Speech processing stopped");
      const completion = Promise.withResolvers<string>();
      const child = spawn(this.executable, ["-m", this.modelPath, "-f", file, "-nt", "-np"], {
        stdio: ["ignore", "pipe", "ignore"],
        env: {
          PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
          HOME: process.env.HOME ?? tmpdir(),
          WHISPER_LOG_LEVEL: "error",
        },
      });
      let text = "";
      let tooLarge = false;
      const abort = () => child.kill("SIGKILL");
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      child.stdout.on("data", (chunk: Buffer) => {
        if (text.length + chunk.length > 1024 * 1024) {
          tooLarge = true;
          abort();
        } else text += chunk.toString("utf8");
      });
      child.once("error", () => {
        signal?.removeEventListener("abort", abort);
        completion.reject(new CaptureUnavailableError("Local Whisper executable unavailable"));
      });
      child.once("close", (code) => {
        signal?.removeEventListener("abort", abort);
        if (signal?.aborted)
          completion.reject(new CaptureUnavailableError("Speech processing stopped"));
        else if (tooLarge || code !== 0)
          completion.reject(new CaptureUnavailableError("Local Whisper transcription failed"));
        else completion.resolve(text.trim());
      });
      const transcript = await completion.promise;
      if (signal?.aborted) throw new CaptureUnavailableError("Speech processing stopped");
      if (!transcript) throw new CaptureUnavailableError("Local Whisper returned no transcript");
      return { transcript, provider: "whisper.cpp", locality: "local" };
    } finally {
      wav.fill(0);
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  }
}
