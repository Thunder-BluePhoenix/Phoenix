// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/**
 * unsupported = not Linux; missing_tool = `playerctl` is not installed; not_running = no (such)
 * MPRIS player is on the session bus (Phoenix never starts one); invalid = input refused;
 * too_large = the answer was bigger than the caller allowed; player = anything else (an error exit,
 * a timeout, an answer of the wrong shape).
 */
export type PlayerFailureKind =
  "unsupported" | "missing_tool" | "not_running" | "invalid" | "too_large" | "player";

/** A failed player call. The message is written here: it never carries `playerctl` or player text. */
export class PlayerError extends Error {
  constructor(
    readonly kind: PlayerFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "PlayerError";
  }
}
