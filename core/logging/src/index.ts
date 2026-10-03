// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { isSecretKey, SECRET_VALUE_PATTERNS } from "@phoenix/protocol";

export type LogLevel = "debug" | "info" | "warn" | "error";
const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export const REDACTED = "[REDACTED]";

/** Returns a deep copy with secret-looking keys and values replaced by [REDACTED]. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 20) return "[TRUNCATED]";
  if (typeof value === "string") {
    let out = value;
    for (const re of SECRET_VALUE_PATTERNS)
      out = out.replace(
        new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"),
        REDACTED,
      );
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redact(value.message, depth + 1),
      stack: value.stack ? redact(value.stack, depth + 1) : undefined,
    };
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value))
      out[k] = isSecretKey(k) ? REDACTED : redact(v, depth + 1);
    return out;
  }
  return value;
}

export interface LogRecord {
  ts: string;
  level: LogLevel;
  component: string;
  msg: string;
  [field: string]: unknown;
}

export type LogSink = (record: LogRecord) => void;

export const stdoutSink: LogSink = (record) => {
  const line = JSON.stringify(record);
  if (record.level === "error" || record.level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
};

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(component: string): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  component?: string;
  sink?: LogSink;
  now?: () => Date;
}

/** Structured JSON logger. All messages and fields pass through redact(). */
export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const component = options.component ?? "core";
  const sink = options.sink ?? stdoutSink;
  const now = options.now ?? (() => new Date());

  const log = (lvl: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (LEVEL_ORDER[lvl] < LEVEL_ORDER[level]) return;
    const safeFields = (fields ? redact(fields) : {}) as Record<string, unknown>;
    sink({
      ...safeFields,
      ts: now().toISOString(),
      level: lvl,
      component,
      msg: redact(msg) as string,
    });
  };

  return {
    debug: (m, f) => log("debug", m, f),
    info: (m, f) => log("info", m, f),
    warn: (m, f) => log("warn", m, f),
    error: (m, f) => log("error", m, f),
    child: (c) => createLogger({ level, sink, now, component: `${component}.${c}` }),
  };
}

/** Logger that discards everything; handy in tests. */
export const silentLogger: Logger = createLogger({ sink: () => {} });
