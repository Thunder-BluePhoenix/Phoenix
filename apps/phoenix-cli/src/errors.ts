// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** Process exit codes, stable for scripts. */
export const EXIT = {
  ok: 0,
  failed: 1,
  usage: 2,
  unreachable: 3,
  refused: 4,
} as const;

/** The command line itself is wrong (or its prerequisites, such as a token file, are missing). */
export class UsageError extends Error {
  override name = "UsageError";
}

/** A decision the CLI declined to send, or that Core no longer accepts (changed, expired, gone). */
export class RefusedError extends Error {
  override name = "RefusedError";
}

export type CoreFailure = "unreachable" | "unauthenticated" | "rejected" | "protocol";

/** Core could not be reached, refused the request, or answered with something unexpected. */
export class CoreError extends Error {
  override name = "CoreError";
  constructor(
    readonly kind: CoreFailure,
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Core answered, but not with the AI answer that `phoenix ask` promises (AI off, nothing matched). */
export class NoAnswerError extends Error {
  override name = "NoAnswerError";
}
