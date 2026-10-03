// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const DEFAULT_CORE_URL = "http://127.0.0.1:4870";

/**
 * Finds the core session token: explicit value → PHOENIX_SESSION_TOKEN →
 * $PHOENIX_DATA_DIR/session.token → ./.phoenix/<env>/session.token →
 * ~/.phoenix/<env>/session.token.
 */
export function resolveSessionToken(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (explicit) return explicit;
  if (env.PHOENIX_SESSION_TOKEN) return env.PHOENIX_SESSION_TOKEN;
  const phoenixEnv = env.PHOENIX_ENV ?? "dev";
  const candidates = [
    env.PHOENIX_DATA_DIR && join(env.PHOENIX_DATA_DIR, "session.token"),
    resolve(".phoenix", phoenixEnv, "session.token"),
    join(homedir(), ".phoenix", phoenixEnv, "session.token"),
  ].filter(Boolean) as string[];
  for (const file of candidates) {
    if (existsSync(file)) return readFileSync(file, "utf8").trim();
  }
  throw new Error(
    `Phoenix Core session token not found (looked in ${candidates.join(", ")}). Is Phoenix Core running?`,
  );
}
