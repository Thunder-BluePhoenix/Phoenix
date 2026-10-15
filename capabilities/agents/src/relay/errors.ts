// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

export type InstallErrorCode =
  "unknown_agent" | "unsupported" | "not_detected" | "invalid_file" | "nothing_to_do" | "io";

/** A request the installer refuses; `code` says why (the message is safe to show). */
export class InstallError extends Error {
  readonly code: InstallErrorCode;

  constructor(code: InstallErrorCode, message: string) {
    super(message);
    this.name = "InstallError";
    this.code = code;
  }
}

/** The agent's file is not what the user confirmed: it changed after the preview. */
export class StaleFileError extends Error {
  constructor(message = "The file changed since the preview. Preview again before applying.") {
    super(message);
    this.name = "StaleFileError";
  }
}
