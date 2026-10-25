// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The owner's ordered, opted-in list of speech engines. Only engines the owner listed are ever
// consulted; the first one that is AVAILABLE runs. Fallback happens only when an engine is
// unavailable (model or program missing, cannot start): never because a recognition came back
// empty or wrong, because that would send the same audio to a second engine behind the owner's back.
//
// There is deliberately no operating-system speech engine in this list:
//   * macOS: SFSpeechRecognizer needs a signed app with the speech-recognition entitlement and
//     usage string, and a system permission prompt; on-device recognition is only offered for some
//     locales and Apple's server path is a network call. Phoenix's Node core cannot call it, and
//     binding it into the Tauri shell would add a permission prompt and a cloud-capable path.
//   * Windows and Linux: there is no stock, offline, scriptable speech-to-text program to call.
// Dropping those routes is a decision, not an omission.
import {
  type RecognizerAvailability,
  type RecognizerEngineStatus,
  type RecognizerSession,
  type SpeechRecognizer,
} from "./recognizer";
import { ParakeetSherpaRecognizer } from "./parakeet-sherpa";
import { WhisperStdinRecognizer } from "./whisper-stdin";

export type SpeechEngineId = "whisper" | "parakeet";
export const SPEECH_ENGINE_IDS: readonly SpeechEngineId[] = ["whisper", "parakeet"];

export interface ChainedEngine {
  id: string;
  recognizer: SpeechRecognizer;
}

export class ChainedRecognizer implements SpeechRecognizer {
  /** Index of the engine the last `availability()` chose; -1 when none was available. */
  private active = -1;

  constructor(private readonly engines: readonly ChainedEngine[]) {
    if (engines.length === 0) throw new TypeError("At least one speech engine is required");
  }

  async availability(): Promise<RecognizerAvailability> {
    const results: RecognizerAvailability[] = [];
    let active = -1;
    for (const [index, engine] of this.engines.entries()) {
      const result = await engine.recognizer.availability().catch((): RecognizerAvailability => ({
        available: false,
        detail: "Speech engine check failed",
      }));
      results.push(result);
      if (result.available && active < 0) active = index;
    }
    this.active = active;
    const statuses: RecognizerEngineStatus[] = this.engines.map((engine, index) => ({
      id: engine.id,
      available: results[index]?.available === true,
      active: index === active,
      detail: results[index]!.detail,
    }));
    if (active < 0) {
      return {
        available: false,
        detail: results.map((r, i) => `${this.engines[i]!.id}: ${r.detail}`).join("; "),
        audio_on_disk: results.some((r) => r.audio_on_disk === true),
        engines: statuses,
      };
    }
    const chosen = results[active]!;
    const skipped = this.engines.slice(0, active).map((e) => e.id);
    return {
      available: true,
      detail:
        skipped.length === 0
          ? chosen.detail
          : `${chosen.detail}. Using ${this.engines[active]!.id} because ${skipped.join(", ")} ${
              skipped.length === 1 ? "is" : "are"
            } not available`,
      ...(chosen.engine ? { engine: chosen.engine } : {}),
      audio_on_disk: chosen.audio_on_disk === true,
      engines: statuses,
    };
  }

  /** Starts on the engine the last `availability()` chose (the session managers always call it first). */
  start(): RecognizerSession {
    const chosen = this.engines[this.active];
    if (!chosen) throw new Error("recogniser unavailable");
    return chosen.recognizer.start();
  }
}

/** An engine the owner asked for that cannot run, so the status says why instead of hiding it. */
function notConfigured(detail: string): SpeechRecognizer {
  return {
    availability: () => Promise.resolve({ available: false, detail }),
    start: () => {
      throw new Error("recogniser unavailable");
    },
  };
}

export interface SpeechEngineConfig {
  /** Whisper model file (PHOENIX_WHISPER_MODEL_PATH). */
  whisperModelPath?: string;
  /** Directory of the Parakeet model files (PHOENIX_PARAKEET_MODEL_DIR). Absolute. */
  parakeetModelDir?: string;
  /** Comma-separated engine ids in the owner's order (PHOENIX_SPEECH_ENGINES). Default "whisper". */
  order?: string;
}

/** Splits and validates the owner's list. Unknown or repeated ids are an error, not silently dropped. */
export function parseSpeechEngineOrder(order: string | undefined): SpeechEngineId[] {
  if (order === undefined || order.trim() === "") return ["whisper"];
  const ids: SpeechEngineId[] = [];
  for (const part of order.split(",")) {
    const id = part.trim().toLowerCase();
    if (!SPEECH_ENGINE_IDS.includes(id as SpeechEngineId))
      throw new TypeError(
        `Unknown speech engine in the list (use ${SPEECH_ENGINE_IDS.join(", ")})`,
      );
    if (ids.includes(id as SpeechEngineId)) throw new TypeError("A speech engine is listed twice");
    ids.push(id as SpeechEngineId);
  }
  return ids;
}

/**
 * The host's recogniser from its configuration, or null when no listed engine has anything to run
 * and the owner did not ask for Parakeet. Whisper stays the default; Parakeet is used only when the
 * owner lists it AND points at its model files.
 */
export function buildSpeechRecognizer(config: SpeechEngineConfig): SpeechRecognizer | null {
  const order = parseSpeechEngineOrder(config.order);
  const engines: ChainedEngine[] = [];
  let real = false;
  for (const id of order) {
    if (id === "whisper") {
      if (config.whisperModelPath) {
        real = true;
        engines.push({
          id,
          recognizer: new WhisperStdinRecognizer({ modelPath: config.whisperModelPath }),
        });
      } else {
        engines.push({ id, recognizer: notConfigured("No Whisper model is configured") });
      }
    } else if (config.parakeetModelDir) {
      real = true;
      engines.push({
        id,
        recognizer: new ParakeetSherpaRecognizer({ modelDir: config.parakeetModelDir }),
      });
    } else {
      engines.push({ id, recognizer: notConfigured("No Parakeet model directory is configured") });
    }
  }
  if (!real && order.length === 1 && order[0] === "whisper") return null;
  return new ChainedRecognizer(engines);
}
