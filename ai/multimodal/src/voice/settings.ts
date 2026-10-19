// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

export type VoiceErrorKind =
  "disabled" | "busy" | "not_found" | "limit" | "invalid" | "unavailable" | "aborted";

/** A refusal with a stable kind; the Core maps it to an API error. Its message is safe to show. */
export class VoiceError extends Error {
  constructor(
    readonly kind: VoiceErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "VoiceError";
  }
}

/** Everything the user can change. The voice assistant is OFF until the user turns it on. */
export interface VoiceSettings {
  enabled: boolean;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = { enabled: false };

/** Applies a user patch; unknown keys and non-boolean values are refused. */
export function patchVoiceSettings(current: VoiceSettings, patch: unknown): VoiceSettings {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch))
    throw new VoiceError("invalid", "The settings must be an object");
  const input = patch as Record<string, unknown>;
  for (const key of Object.keys(input))
    if (key !== "enabled") throw new VoiceError("invalid", `Unknown setting "${key.slice(0, 40)}"`);
  if (input.enabled === undefined) return current;
  if (typeof input.enabled !== "boolean")
    throw new VoiceError("invalid", "enabled must be true or false");
  return { enabled: input.enabled };
}

/** Reads stored settings. Anything invalid falls back to the safe default (voice off). */
export function readVoiceSettings(raw: unknown): VoiceSettings {
  if (raw === null || raw === undefined) return DEFAULT_VOICE_SETTINGS;
  try {
    return patchVoiceSettings(DEFAULT_VOICE_SETTINGS, raw);
  } catch {
    return DEFAULT_VOICE_SETTINGS;
  }
}
