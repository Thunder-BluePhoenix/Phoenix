// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/**
 * unsupported = not macOS; not_running = the app is closed (Phoenix never launches it);
 * permission = macOS Automation consent missing; invalid = input refused; player = anything else.
 */
export type PlayerFailureKind = "unsupported" | "not_running" | "permission" | "invalid" | "player";

/** A failed player call. The message is written here: it never carries AppleScript or app text. */
export class PlayerError extends Error {
  constructor(
    readonly kind: PlayerFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "PlayerError";
  }
}
