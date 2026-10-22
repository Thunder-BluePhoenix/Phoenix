// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { UsageError } from "./errors";

/** The file name Core writes into its data directory (core/runtime SESSION_TOKEN_FILE). */
export const SESSION_TOKEN_FILE = "session.token";

const ENVIRONMENTS = ["dev", "staging", "prod"];

export interface TokenSources {
  env: Record<string, string | undefined>;
  cwd: string;
  home: string;
  platform: NodeJS.Platform;
  /** `--data-dir`, the highest-priority place to look. */
  dataDir?: string;
}

export interface SessionToken {
  value: string;
  /** Where it came from: never the value itself. */
  origin: string;
  /** Set when the token file is readable by other users. */
  warning?: string;
}

/**
 * Finds the Core session token the way Core's own clients do: PHOENIX_SESSION_TOKEN, else
 * `<data dir>/session.token` for `--data-dir`, PHOENIX_DATA_DIR, `./.phoenix/<env>` or
 * `~/.phoenix/<env>`. The value is never part of an error or a warning.
 */
export function resolveSessionToken(sources: TokenSources): SessionToken {
  const fromEnv = sources.env.PHOENIX_SESSION_TOKEN?.trim();
  if (fromEnv) return { value: fromEnv, origin: "PHOENIX_SESSION_TOKEN" };

  const env = sources.env.PHOENIX_ENV ?? "dev";
  if (!ENVIRONMENTS.includes(env)) {
    throw new UsageError(`PHOENIX_ENV must be one of ${ENVIRONMENTS.join(", ")}`);
  }
  const candidates = [
    sources.dataDir,
    sources.env.PHOENIX_DATA_DIR,
    join(sources.cwd, ".phoenix", env),
    join(sources.home, ".phoenix", env),
  ]
    .filter((dir): dir is string => dir !== undefined && dir !== "")
    .map((dir) => join(resolve(sources.cwd, dir), SESSION_TOKEN_FILE));

  const file = candidates.find((candidate) => existsSync(candidate));
  if (file === undefined) {
    throw new CoreNotRunningHint(candidates);
  }
  const value = readFileSync(file, "utf8").trim();
  if (value === "") throw new CoreNotRunningHint([file], "is empty");
  const loose = sources.platform !== "win32" && (statSync(file).mode & 0o077) !== 0;
  return {
    value,
    origin: file,
    ...(loose
      ? {
          warning: `${file} can be read by other users; Core creates it owner-only (chmod 600).`,
        }
      : {}),
  };
}

/** The token file is missing or unusable: usually Core is not running. */
export class CoreNotRunningHint extends UsageError {
  constructor(paths: readonly string[], problem = "was not found") {
    super(
      `Phoenix Core session token ${problem} (looked in ${paths.join(", ")}). ` +
        "Is Phoenix Core running? Use --data-dir or PHOENIX_DATA_DIR to point at its data directory.",
    );
  }
}
