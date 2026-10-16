// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { CLEANUP_MODES, isCleanupMode, type CleanupMode } from "./cleanup";
import { MAX_APP_ID_CHARS, TYPING_WPM, isAppId } from "./stats";
import { DictationError } from "./text";
import { EMPTY_VOCABULARY, validateVocabulary, type Vocabulary } from "./vocabulary";

export const MAX_APP_MODES = 100;

/** Everything the user can change. Dictation is OFF until the user turns it on. */
export interface DictationSettings {
  enabled: boolean;
  typing_wpm: number;
  default_mode: CleanupMode;
  /** App id -> clean-up mode; an app not listed uses `default_mode`. */
  app_modes: Record<string, CleanupMode>;
  vocabulary: Vocabulary;
}

export const DEFAULT_DICTATION_SETTINGS: DictationSettings = {
  enabled: false,
  typing_wpm: TYPING_WPM.default,
  default_mode: "as_said",
  app_modes: {},
  vocabulary: EMPTY_VOCABULARY,
};

const bad = (message: string): never => {
  throw new DictationError("invalid", message);
};

function validateAppModes(input: unknown): Record<string, CleanupMode> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return bad("app_modes must be an object of app id to mode");
  const entries = Object.entries(input);
  if (entries.length > MAX_APP_MODES) bad(`app_modes may hold at most ${MAX_APP_MODES} apps`);
  const out: Record<string, CleanupMode> = {};
  for (const [app, mode] of entries) {
    if (!isAppId(app))
      bad(
        `"${app.slice(0, 40)}" is not an app id (letters, digits, dot, dash, underscore; at most ${MAX_APP_ID_CHARS} characters)`,
      );
    if (!isCleanupMode(mode)) bad(`Clean-up mode must be one of ${CLEANUP_MODES.join(", ")}`);
    out[app] = mode as CleanupMode;
  }
  return out;
}

/** Applies a user patch to the current settings; every field present is validated and replaced. */
export function patchSettings(current: DictationSettings, patch: unknown): DictationSettings {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch))
    return bad("The settings must be an object");
  const input = patch as Record<string, unknown>;
  const known = ["enabled", "typing_wpm", "default_mode", "app_modes", "vocabulary"];
  for (const key of Object.keys(input))
    if (!known.includes(key)) bad(`Unknown setting "${key.slice(0, 40)}"`);
  const next = { ...current };
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") bad("enabled must be true or false");
    next.enabled = input.enabled as boolean;
  }
  if (input.typing_wpm !== undefined) {
    const wpm = input.typing_wpm;
    if (
      typeof wpm !== "number" ||
      !Number.isInteger(wpm) ||
      wpm < TYPING_WPM.min ||
      wpm > TYPING_WPM.max
    )
      bad(`typing_wpm must be a whole number from ${TYPING_WPM.min} to ${TYPING_WPM.max}`);
    next.typing_wpm = wpm as number;
  }
  if (input.default_mode !== undefined) {
    if (!isCleanupMode(input.default_mode))
      bad(`default_mode must be one of ${CLEANUP_MODES.join(", ")}`);
    next.default_mode = input.default_mode as CleanupMode;
  }
  if (input.app_modes !== undefined) next.app_modes = validateAppModes(input.app_modes);
  if (input.vocabulary !== undefined) next.vocabulary = validateVocabulary(input.vocabulary);
  return next;
}

/** Reads stored settings. Anything invalid falls back to the safe default (dictation off). */
export function readSettings(raw: unknown): DictationSettings {
  if (raw === null || raw === undefined) return DEFAULT_DICTATION_SETTINGS;
  try {
    return patchSettings(DEFAULT_DICTATION_SETTINGS, raw);
  } catch {
    return DEFAULT_DICTATION_SETTINGS;
  }
}

/** The clean-up mode for an app: its own, else the default. */
export function modeFor(settings: DictationSettings, app: string | undefined): CleanupMode {
  return app !== undefined && Object.hasOwn(settings.app_modes, app)
    ? settings.app_modes[app]!
    : settings.default_mode;
}
