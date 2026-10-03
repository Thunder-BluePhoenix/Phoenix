// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Terminal capability (Phase 18): turns command reports from `phoenix run`
// into command.* / build.* / test.* events. Observation only: Phoenix never
// runs anything itself; the user's shell runs the command and reports it.
import { basename } from "node:path";
import { redact } from "@phoenix/logging";
import { defineCapability } from "@phoenix/sdk";

export type Kind = "command" | "build" | "test";

export interface Report {
  phase: "started" | "finished";
  /** Run id; becomes the correlation_id tying started and finished together. */
  id: string;
  command: string;
  cwd?: string;
  kind?: Kind;
  exit_code?: number;
  duration_ms?: number;
  /** Tail of the command's output (failures only). */
  output?: string;
}

const MAX_COMMAND = 300;
const MAX_EXCERPT = 2_000;

// ponytail: word heuristics; `phoenix run --kind` overrides when they guess wrong.
const TEST_WORDS = /(^|[\s/:])(test|tests|pytest|jest|vitest|mocha|rspec|phpunit|ctest)(\s|:|$)/;
const BUILD_WORDS =
  /(^|[\s/:])(build|make|cmake|compile|tsc|webpack|gradle|gradlew|mvn|ninja|bazel)(\s|:|$)/;

export function classify(command: string): Kind {
  if (TEST_WORDS.test(command)) return "test";
  if (BUILD_WORDS.test(command)) return "build";
  return "command";
}

/** Redacts known token formats plus `--password x`, `TOKEN=x`-style arguments. */
export function redactText(text: string): string {
  return (redact(text) as string)
    .replace(
      /(--?[\w-]*(?:password|passwd|token|secret|api[-_]?key)[\w-]*)(=|\s+)\S+/gi,
      "$1$2[REDACTED]",
    )
    .replace(
      /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY)[A-Z0-9_]*)=\S+/g,
      "$1=[REDACTED]",
    )
    .replace(/(\w+:\/\/[^\s:/@]+:)[^\s@/]+@/g, "$1[REDACTED]@");
}

/** Last lines of output, without ANSI escapes, redacted and capped. */
export function excerpt(output: string, maxLines = 20): string {
  const plain = output.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\r(?!\n)/g, "\n");
  const lines = plain.trimEnd().split("\n").slice(-maxLines).join("\n");
  return redactText(lines).slice(-MAX_EXCERPT);
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export const terminalCapability = defineCapability({
  manifest: {
    id: "terminal",
    name: "Terminal",
    version: "0.1.0",
    description:
      "Shows commands you run with `phoenix run` (builds, tests, scripts) as they start and finish.",
    license: "GPL-3.0-or-later",
    events: ["command.*", "build.*", "test.*"],
    permissions: [],
    data_categories: ["command lines", "command output excerpts (failures, stored locally)"],
    commands: [
      {
        name: "report",
        description: "Report a command started or finished in your terminal",
        side_effect: "none",
        input_schema: {
          type: "object",
          required: ["phase", "id", "command"],
          additionalProperties: false,
          properties: {
            phase: { enum: ["started", "finished"] },
            id: { type: "string", pattern: "^[A-Za-z0-9_-]{1,64}$" },
            command: { type: "string", minLength: 1, maxLength: 4_000 },
            cwd: { type: "string", maxLength: 4_000 },
            kind: { enum: ["command", "build", "test"] },
            exit_code: { type: "integer" },
            duration_ms: { type: "integer", minimum: 0 },
            output: { type: "string", maxLength: 16_000 },
          },
        },
      },
    ],
    // Name the command in Fawkes' explanation (US-03: an error with readable text).
    state_rules: [
      {
        match: "build.failed",
        effect: { state: "ERROR", explain: "Build failed: {payload.command}" },
      },
      {
        match: "test.failed",
        effect: { state: "ERROR", explain: "Tests failed: {payload.command}" },
      },
    ],
  },
  commands: {
    report(input, ctx) {
      const r = input as Report;
      const kind = r.kind ?? classify(r.command);
      const command = truncate(redactText(r.command), MAX_COMMAND);
      const base = {
        command,
        ...(r.cwd ? { cwd: r.cwd } : {}),
        ...(r.duration_ms !== undefined ? { duration_ms: r.duration_ms } : {}),
      };
      const event = (type: string, severity: "info" | "success" | "error", extra = {}) =>
        ctx.emit({
          event_type: `${kind}.${type}`,
          severity,
          correlation_id: `run_${r.id}`,
          ...(r.cwd ? { subject: basename(r.cwd) } : {}),
          payload: { ...base, ...extra },
        });

      const done = kind === "command" ? "completed" : "passed";
      const result =
        r.phase === "started"
          ? event("started", "info")
          : r.exit_code === 0
            ? event(done, "success", { exit_code: 0 })
            : event("failed", "error", {
                exit_code: r.exit_code ?? null,
                ...(r.output ? { excerpt: excerpt(r.output) } : {}),
              });
      if (!result.ok) throw result.error;
      return { event_id: result.event.event_id };
    },
  },
  health: () => ({ status: "healthy" }),
});
