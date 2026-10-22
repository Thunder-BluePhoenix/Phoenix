#!/usr/bin/env -S npx tsx
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 58 `statusLine` relay for Claude Code. Claude Code runs the configured statusLine command
// with its status JSON on stdin and shows what the command prints
// (https://code.claude.com/docs/en/statusline). Phoenix's entry is:
//
//   statusline.ts [--then <previous statusLine command>]
//
// It (1) reads the JSON, (2) forwards ONLY the documented `rate_limits.five_hour` and
// `rate_limits.seven_day` windows and (Phase 78) the documented session cost `cost.total_cost_usd`
// with the session id, model id and project folder name to Core, and (3) runs the user's previous statusLine command
// (`--then`, or $PHOENIX_STATUSLINE_THEN) with the SAME stdin bytes and prints that command's
// stdout byte for byte. The previous command gets a 1 second budget; a slow one is killed and
// prints nothing. A previous command that fails makes this one exit with the same code and the
// same stdout, exactly as if it had been configured directly. Without `--then` it prints nothing:
// a Phoenix-only status line is empty by design. The status line is never held up by Core: the
// forward runs in parallel and has its own, shorter budget.
import { spawn } from "node:child_process";
import {
  extractClaudeCost,
  extractClaudeUsage,
  type TokenUsageReport,
  type UsageSample,
} from "./usage";
import { sendLive, type LiveSendOptions } from "./live-send";

export const THEN_BUDGET_MS = 1_000;
export const FORWARD_BUDGET_MS = 800;
/** Status JSON is small; anything above this is not forwarded to Core. */
export const MAX_STDIN_BYTES = 4_000_000;
const MAX_STDOUT_BYTES = 1_000_000;

export interface ThenResult {
  code: number | null;
  stdout: Buffer;
  timedOut: boolean;
}

/** Runs the user's previous command in a shell with `stdin`. Tests inject a fake. */
export type RunThen = (command: string, stdin: Buffer, timeoutMs: number) => Promise<ThenResult>;

/**
 * The previous command, as Claude Code runs a statusLine `command`: through a shell. Output
 * beyond MAX_STDOUT_BYTES is dropped; the whole process group is killed at the deadline.
 */
export const runThen: RunThen = (command, stdin, timeoutMs) => {
  const done = Promise.withResolvers<ThenResult>();
  const chunks: Buffer[] = [];
  let size = 0;
  let timedOut = false;
  const child = spawn(command, {
    shell: true,
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      if (child.pid !== undefined && process.platform !== "win32")
        process.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
    // A grandchild may keep the pipe open; do not wait for it.
    done.resolve({ code: null, stdout: Buffer.alloc(0), timedOut: true });
  }, timeoutMs);
  child.stdout.on("data", (c: Buffer) => {
    size += c.length;
    if (size <= MAX_STDOUT_BYTES) chunks.push(c);
  });
  child.stdin.on("error", () => {});
  child.stdin.end(stdin);
  child.on("error", () => done.resolve({ code: 127, stdout: Buffer.alloc(0), timedOut: false }));
  child.on("close", (code) => {
    clearTimeout(timer);
    done.resolve({ code, stdout: Buffer.concat(chunks), timedOut });
  });
  return done.promise.finally(() => clearTimeout(timer));
};

export interface StatuslineDeps {
  runThen: RunThen;
  /** Delivers usage to Core; defaults to the relay-then-HTTP transport. */
  send: (body: unknown) => Promise<{ ok: boolean; message?: string }>;
  now: () => number;
  warn: (message: string) => void;
}

export interface StatuslineOutcome {
  /** Bytes for stdout, exactly the previous command's. */
  stdout: Buffer;
  exitCode: number;
}

/** Splits `--then <command>`; the command is everything after the flag, as one argument. */
export function parseStatuslineArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = {},
): { then?: string } {
  const at = argv.indexOf("--then");
  const fromArg = at >= 0 ? argv[at + 1] : undefined;
  const command = fromArg ?? env.PHOENIX_STATUSLINE_THEN;
  return command && command.trim() !== "" ? { then: command } : {};
}

/** What to forward, parsed from the status JSON bytes; nothing for anything that is not usable JSON. */
function usageFrom(
  stdin: Buffer,
  nowMs: number,
): { samples: UsageSample[]; cost: TokenUsageReport | null } {
  if (stdin.length === 0 || stdin.length > MAX_STDIN_BYTES) return { samples: [], cost: null };
  try {
    const json: unknown = JSON.parse(stdin.toString("utf8"));
    return { samples: extractClaudeUsage(json, nowMs), cost: extractClaudeCost(json) };
  } catch {
    return { samples: [], cost: null };
  }
}

/** Sends one body to Core; a failure only warns. Never rejects. */
async function forwardOne(deps: StatuslineDeps, body: unknown): Promise<void> {
  try {
    const r = await deps.send(body);
    if (!r.ok) deps.warn(`phoenix: usage not reported (${r.message ?? "failed"})`);
  } catch {
    deps.warn("phoenix: usage not reported");
  }
}

/** The whole behaviour, with the process, Core and the clock injected. Never rejects. */
export async function runStatusline(
  args: { then?: string },
  stdin: Buffer,
  deps: StatuslineDeps,
): Promise<StatuslineOutcome> {
  const { samples, cost } = usageFrom(stdin, deps.now());
  const forward = Promise.all([
    samples.length > 0 ? forwardOne(deps, { agent: "claude-code", samples }) : undefined,
    // Phase 78: the session cost Claude Code shows (a running total), as a token report.
    cost ? forwardOne(deps, cost) : undefined,
  ]);
  const previous = args.then
    ? deps
        .runThen(args.then, stdin, THEN_BUDGET_MS)
        .catch((): ThenResult => ({ code: 127, stdout: Buffer.alloc(0), timedOut: false }))
    : Promise.resolve<ThenResult>({ code: 0, stdout: Buffer.alloc(0), timedOut: false });
  const [result] = await Promise.all([previous, forward]);
  if (result.timedOut) {
    deps.warn("phoenix: the previous status line command took longer than 1 second; skipped");
    return { stdout: Buffer.alloc(0), exitCode: 0 };
  }
  return { stdout: result.stdout, exitCode: result.code ?? 1 };
}

async function readStdin(): Promise<Buffer> {
  if (process.stdin.isTTY) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_STDIN_BYTES) break;
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/** Command-line entry: stdin → outcome → stdout and exit code. */
export async function main(argv: readonly string[]): Promise<number> {
  const options: LiveSendOptions = { timeoutMs: FORWARD_BUDGET_MS - 100 };
  const outcome = await runStatusline(parseStatuslineArgs(argv, process.env), await readStdin(), {
    runThen,
    send: (body) => sendLive("usage", body, options),
    now: Date.now,
    warn: (message) => process.stderr.write(`${message}\n`),
  });
  const flushed = Promise.withResolvers<void>();
  if (outcome.stdout.length === 0) flushed.resolve();
  else process.stdout.write(outcome.stdout, () => flushed.resolve());
  await flushed.promise;
  return outcome.exitCode;
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("/statusline.ts")
) {
  // Whatever happens, the status line is not held up longer than the previous command's budget.
  const deadline = setTimeout(() => process.exit(0), THEN_BUDGET_MS + 500);
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch(() => process.exit(0))
    .finally(() => clearTimeout(deadline));
}
