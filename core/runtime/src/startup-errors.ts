// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ConfigError } from "@phoenix/config";
import { DatabaseInUseError, DatabaseTooNewError } from "@phoenix/persistence";

interface ErrorFields {
  code?: unknown;
  errcode?: unknown;
  message?: unknown;
}

/** SQLite result codes for a file that is not, or no longer is, a usable database. */
const SQLITE_DAMAGED = new Set([11, 26]); // SQLITE_CORRUPT, SQLITE_NOTADB
const SQLITE_CANTOPEN = 14;
const FILESYSTEM_CODES = new Set(["EACCES", "EPERM", "EEXIST", "ENOTDIR", "EROFS", "ENOENT"]);

/**
 * A single plain sentence for the startup failures a user can fix themselves, or undefined for
 * anything else (which should still print in full). Never includes a stack trace.
 */
export function explainStartupError(
  err: unknown,
  where: { port?: number; dataDir?: string } = {},
): string | undefined {
  if (
    err instanceof ConfigError ||
    err instanceof DatabaseInUseError ||
    err instanceof DatabaseTooNewError
  ) {
    return err.message;
  }
  const { code, errcode, message } = (err ?? {}) as ErrorFields;
  const detail = typeof message === "string" ? message : "unknown error";
  const folder = where.dataDir ?? "the data folder";
  if (code === "EADDRINUSE") {
    return `Port ${where.port ?? "(configured)"} is already in use, probably by another Phoenix Core. Stop that one, or set PHOENIX_PORT to a free port.`;
  }
  if (code === "ERR_SQLITE_ERROR" && typeof errcode === "number") {
    if (SQLITE_DAMAGED.has(errcode)) {
      return `The Phoenix database in ${folder} is damaged ("${detail}"). It was not modified. Move phoenix.sqlite out of that folder to start fresh; your history will be empty, so keep the file if you want it recovered.`;
    }
    if (errcode === SQLITE_CANTOPEN) {
      return `Phoenix cannot open its database in ${folder} ("${detail}"). Check that the folder exists and you can write to it, or set PHOENIX_DATA_DIR to another folder.`;
    }
  }
  if (typeof code === "string" && FILESYSTEM_CODES.has(code)) {
    return `Phoenix cannot use ${folder} (${detail}). Check that it is a folder you can write to, or set PHOENIX_DATA_DIR to another folder.`;
  }
  return undefined;
}
