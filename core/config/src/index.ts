// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export const ENVIRONMENTS = ["dev", "staging", "prod"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface PhoenixConfig {
  env: Environment;
  host: string;
  port: number;
  logLevel: LogLevel;
  /** Absolute directory for the SQLite database and local state. */
  dataDir: string;
  /** Must be true to bind to a non-loopback host (ADR-0015). */
  allowRemote: boolean;
  /** Maximum number of durable events kept in local history. */
  eventHistoryLimit: number;
  /** How many recent event ids the bus remembers for deduplication. */
  dedupWindow: number;
  /** Browser origins allowed to call the API (CORS), e.g. the Vite dev server. */
  allowedOrigins: string[];
  /** Directory with the built web app (apps/web/dist) served at "/". Unset: API only. */
  webRoot?: string;
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

export function defaultDataDir(env: Environment): string {
  return join(homedir(), ".phoenix", env);
}

export function defaults(env: Environment): PhoenixConfig {
  return {
    env,
    host: "127.0.0.1",
    port: 4870,
    logLevel: env === "dev" ? "debug" : "info",
    dataDir: defaultDataDir(env),
    allowRemote: false,
    eventHistoryLimit: 10_000,
    dedupWindow: 10_000,
    allowedOrigins: env === "dev" ? ["http://localhost:5173", "http://127.0.0.1:5173"] : [],
  };
}

export interface LoadOptions {
  env?: NodeJS.ProcessEnv;
  /** Directory containing {dev,staging,prod}.json. */
  configDir?: string;
  /** Base directory for resolving a relative dataDir. */
  cwd?: string;
}

function parseIntStrict(name: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new ConfigError(`${name} must be an integer, got "${raw}"`);
  return n;
}

/**
 * Loads configuration: built-in defaults ← config/<env>.json ← PHOENIX_* environment variables.
 */
export function loadConfig(options: LoadOptions = {}): PhoenixConfig {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const envName = (env.PHOENIX_ENV ?? "dev") as Environment;
  if (!ENVIRONMENTS.includes(envName)) {
    throw new ConfigError(`PHOENIX_ENV must be one of ${ENVIRONMENTS.join(", ")}`);
  }

  let config: PhoenixConfig = defaults(envName);

  const configDir = options.configDir ?? join(cwd, "config");
  const file = join(configDir, `${envName}.json`);
  if (existsSync(file)) {
    const fromFile = JSON.parse(readFileSync(file, "utf8")) as Partial<PhoenixConfig>;
    config = { ...config, ...fromFile, env: envName };
  }

  if (env.PHOENIX_HOST) config.host = env.PHOENIX_HOST;
  if (env.PHOENIX_PORT) config.port = parseIntStrict("PHOENIX_PORT", env.PHOENIX_PORT);
  if (env.PHOENIX_LOG_LEVEL) config.logLevel = env.PHOENIX_LOG_LEVEL as LogLevel;
  if (env.PHOENIX_DATA_DIR) config.dataDir = env.PHOENIX_DATA_DIR;
  if (env.PHOENIX_ALLOWED_ORIGINS !== undefined) {
    config.allowedOrigins = env.PHOENIX_ALLOWED_ORIGINS.split(",")
      .map((o) => o.trim())
      .filter(Boolean);
  }
  if (env.PHOENIX_WEB_ROOT) config.webRoot = env.PHOENIX_WEB_ROOT;
  if (env.PHOENIX_ALLOW_REMOTE) config.allowRemote = env.PHOENIX_ALLOW_REMOTE === "true";

  if (!isAbsolute(config.dataDir)) config.dataDir = resolve(cwd, config.dataDir);
  if (config.webRoot && !isAbsolute(config.webRoot)) config.webRoot = resolve(cwd, config.webRoot);
  validateConfig(config);
  return config;
}

export function validateConfig(config: PhoenixConfig): void {
  if (!LOG_LEVELS.includes(config.logLevel)) {
    throw new ConfigError(`logLevel must be one of ${LOG_LEVELS.join(", ")}`);
  }
  if (config.port < 0 || config.port > 65_535) throw new ConfigError("port out of range");
  if (!LOOPBACK.has(config.host) && !config.allowRemote) {
    throw new ConfigError(
      `Refusing to bind to non-loopback host "${config.host}". Set allowRemote=true to override (ADR-0015).`,
    );
  }
  for (const origin of config.allowedOrigins) {
    if (!/^https?:\/\/[^/\s]+$/.test(origin)) {
      throw new ConfigError(`allowedOrigins entry "${origin}" must be scheme://host[:port]`);
    }
  }
  if (config.eventHistoryLimit < 1 || config.dedupWindow < 1) {
    throw new ConfigError("eventHistoryLimit and dedupWindow must be positive");
  }
}
