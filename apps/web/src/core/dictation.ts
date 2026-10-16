// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// Wire types of the dictation routes (see core/api/src/dictation-routes.ts for the protocol).

export type CleanupMode = "as_said" | "natural" | "polished";
export const CLEANUP_MODE_LABELS: Record<CleanupMode, string> = {
  as_said: "As said (no clean-up)",
  natural: "Natural (remove fillers)",
  polished: "Polished (fix grammar too)",
};
export const CLEANUP_MODES = Object.keys(CLEANUP_MODE_LABELS) as CleanupMode[];

export interface DictationVocabulary {
  dictionary: { term: string; sounds_like?: string }[];
  replacements: { from: string; to: string }[];
  snippets: { trigger: string; text: string }[];
}

export interface DictationSettings {
  enabled: boolean;
  typing_wpm: number;
  default_mode: CleanupMode;
  app_modes: Record<string, CleanupMode>;
  vocabulary: DictationVocabulary;
}

export interface DictationStatus {
  enabled: boolean;
  kill_switch_engaged: boolean;
  recognizer: { available: boolean; detail: string; engine?: string };
  audio_on_disk: false;
  cleanup: { available: boolean; detail: string; locality: "local" };
  active: { id: string; phase: "listening" | "recognising" } | null;
  limits: { max_seconds: number; max_bytes: number; max_frame_bytes: number };
  vocabulary_limits: {
    dictionary: number;
    replacements: number;
    snippets: number;
    phrase_words: number;
    phrase_chars: number;
    term_chars: number;
    replacement_chars: number;
    snippet_chars: number;
    app_modes: number;
  };
}

export interface DictationStats {
  words: number;
  sessions: number;
  speech_ms: number;
  typing_ms: number;
  saved_ms: number;
  typing_wpm: number;
  average_wpm: number;
  streak_days: number;
  top_apps: { app: string; words: number; sessions: number }[];
}

export interface DictationStarted {
  id: string;
  max_seconds: number;
  max_bytes: number;
  max_frame_bytes: number;
}

export interface DictationResult {
  text: string;
  words: number;
  steps: {
    dictionary: number;
    replacements: number;
    snippet: boolean;
    cleanup: "used" | "off" | "skipped";
  };
}

/** "3 min 20 s", "45 s", "0 s". */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes} min ${seconds} s` : `${seconds} s`;
}
