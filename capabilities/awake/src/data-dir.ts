// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { isAbsolute } from "node:path";
import type { CapabilityContext } from "@phoenix/sdk";

/**
 * The private directory Core owns for this capability (`<Core data dir>/capabilities/awake`), or
 * undefined when the host gives none (a harness without a manager): the caller then falls back to
 * the old `PHOENIX_DATA_DIR` / `~/.phoenix/<env>` rule. Throws when Core refuses to make the
 * directory safe (a symbolic link or a foreign owner on its path): the caller must not guess another
 * place, so the module does not start.
 */
export function coreDataDir(ctx: CapabilityContext): string | undefined {
  const dir: unknown = ctx.dataDir;
  if (dir === undefined) return undefined;
  if (typeof dir !== "string" || !isAbsolute(dir)) {
    throw new Error("the capability data directory is not an absolute path");
  }
  return dir;
}
