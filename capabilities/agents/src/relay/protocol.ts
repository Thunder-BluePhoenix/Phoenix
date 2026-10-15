// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 57: the wire contract of the owner-only local relay between coding-agent hooks and
// Phoenix Core. One newline-terminated JSON request, one newline-terminated JSON response, then
// the server closes. Only the operations listed in RELAY_OPS exist; everything else is refused.
import { createHash } from "node:crypto";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

export const RELAY_VERSION = 1;

/** The complete allow-list. `ping` is answered by the server itself; the rest need a handler. */
export const RELAY_OPS = [
  "ping",
  "report",
  "approval.create",
  "approval.wait",
  "step",
  "usage",
] as const;
export type RelayOp = (typeof RELAY_OPS)[number];

// `includes` on a frozen list, not a keyed lookup: "__proto__" and "constructor" must not match.
export function isRelayOp(value: unknown): value is RelayOp {
  return typeof value === "string" && (RELAY_OPS as readonly string[]).includes(value);
}

/** A request line larger than this (before its newline) is refused. */
export const MAX_REQUEST_BYTES = 1_048_576;
/** A connection that has not delivered a complete request line within this long is closed. */
export const IDLE_TIMEOUT_MS = 2_000;

export type RelayErrorCode =
  | "invalid_request"
  | "unsupported_version"
  | "op_not_allowed"
  | "too_large"
  | "idle_timeout"
  | "not_available"
  | "internal_error";

export interface RelayRequest {
  v: typeof RELAY_VERSION;
  op: string;
  body?: unknown;
}

export interface RelayError {
  /** A RelayErrorCode, or the code of a PhoenixError a handler threw. */
  code: string;
  message: string;
}

export type RelayResponse =
  | { v: typeof RELAY_VERSION; ok: true; result: unknown }
  | { v: typeof RELAY_VERSION; ok: false; error: RelayError };

/** `<dataDir>/relay`: the directory that holds the socket (mode 0700). */
export function relayDir(dataDir: string): string {
  return join(dataDir, "relay");
}

/**
 * Where the relay listens. POSIX: a Unix domain socket inside the 0700 relay directory.
 * Windows: a per-user named pipe (no directory to protect, so the name carries the user).
 */
export function relaySocketPath(
  dataDir: string,
  platform: NodeJS.Platform = process.platform,
  user?: string,
): string {
  if (platform === "win32") {
    const hash = createHash("sha256")
      .update(user ?? userInfo().username)
      .digest("hex")
      .slice(0, 16);
    return `\\\\.\\pipe\\phoenix-relay-${hash}`;
  }
  return join(relayDir(dataDir), "relay.sock");
}

/** The data directory Core uses when nothing overrides it (same rule as core/config). */
export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PHOENIX_DATA_DIR) return env.PHOENIX_DATA_DIR;
  return join(homedir(), ".phoenix", env.PHOENIX_ENV ?? "dev");
}

/** $PHOENIX_RELAY_SOCKET if set, else the socket under the default data directory. */
export function resolveRelaySocket(env: NodeJS.ProcessEnv = process.env): string {
  return env.PHOENIX_RELAY_SOCKET || relaySocketPath(defaultDataDir(env));
}
