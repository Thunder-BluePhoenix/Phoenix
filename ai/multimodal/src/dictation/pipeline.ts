// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The dictation text pipeline. Pure apart from the optional model call:
//   normalise -> dictionary -> replacements -> snippets -> optional AI clean-up -> { text, words }
//
// The transcript is DATA. Nothing in it is ever executed, interpreted as a command or given to
// anything but the vocabulary tables (literal) and the clean-up model (told it is data, guarded).
import { cleanUp, type CleanupGenerate, type CleanupMode } from "./cleanup";
import { MAX_EXPANDED_CHARS, DictationError, countWords, normaliseText } from "./text";
import { applyVocabulary, type CompiledVocabulary } from "./vocabulary";

export interface PipelineOptions {
  vocabulary: CompiledVocabulary;
  mode: CleanupMode;
  /** The model path; null when AI is off or unavailable. */
  generate: CleanupGenerate | null;
  nonce?: () => string;
  signal?: AbortSignal;
}

export interface PipelineResult {
  text: string;
  words: number;
  /** Counts and flags only; never text. */
  steps: {
    dictionary: number;
    replacements: number;
    snippet: boolean;
    cleanup: "used" | "off" | "skipped";
  };
}

/** Runs the pipeline. Throws only DictationError("limit") for input or output past the size limits. */
export async function runPipeline(raw: string, options: PipelineOptions): Promise<PipelineResult> {
  const normalised = normaliseText(raw);
  if (!normalised)
    return {
      text: "",
      words: 0,
      steps: { dictionary: 0, replacements: 0, snippet: false, cleanup: "off" },
    };
  const vocab = applyVocabulary(normalised, options.vocabulary);
  // A snippet is the user's own text: it is inserted as written and is not "cleaned up".
  const cleaned = vocab.snippet
    ? { text: vocab.text, used: false, skipped: "mode" as const }
    : await cleanUp(vocab.text, {
        generate: options.generate,
        mode: options.mode,
        ...(options.nonce ? { nonce: options.nonce } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
  if (cleaned.text.length > MAX_EXPANDED_CHARS)
    throw new DictationError("limit", "The text is longer than the allowed size");
  return {
    text: cleaned.text,
    words: countWords(cleaned.text),
    steps: {
      dictionary: vocab.dictionary,
      replacements: vocab.replacements,
      snippet: vocab.snippet,
      cleanup: cleaned.used ? "used" : cleaned.skipped === "mode" ? "off" : "skipped",
    },
  };
}
