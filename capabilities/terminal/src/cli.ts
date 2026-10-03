#!/usr/bin/env -S npx tsx
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
//   phoenix run [--kind build|test|command] [--] <command> [args...]
//
// Runs your command exactly as given (no shell), passes its output and exit
// code through, and reports start/finish to Phoenix Core's terminal capability.
// If Phoenix is not running, the command still runs; it is just not reported.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:os";
import { DEFAULT_CORE_URL, resolveSessionToken } from "@phoenix/sdk";
import { redactText, type Kind, type Report } from "./index";

const TAIL_BYTES = 16_000;
const USAGE = "Usage: phoenix run [--kind build|test|command] [--] <command> [args...]";

export function parseRunArgs(argv: string[]): { kind?: Kind; command: string[] } {
  const args = [...argv];
  let kind: Kind | undefined;
  while (args[0]?.startsWith("--")) {
    const flag = args.shift()!;
    if (flag === "--") break;
    const value = flag.startsWith("--kind=")
      ? flag.slice(7)
      : flag === "--kind"
        ? args.shift()
        : "";
    if (value !== "build" && value !== "test" && value !== "command") throw new Error(USAGE);
    kind = value;
  }
  if (!args.length) throw new Error(USAGE);
  return { ...(kind ? { kind } : {}), command: args };
}

/** Shell-style display of argv, for the report only. */
const display = (argv: string[]) =>
  argv.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(" ");

function reporter(coreUrl: string) {
  let token: string | null = null;
  try {
    token = resolveSessionToken();
  } catch {
    process.stderr.write("phoenix: Phoenix Core is not running; this command is not reported\n");
  }
  let warned = false;
  return async (report: Report): Promise<void> => {
    if (!token) return;
    try {
      const res = await fetch(`${coreUrl}/api/capabilities/terminal/commands/report`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ input: report }),
        signal: AbortSignal.timeout(2_000),
      });
      if (!res.ok && !warned) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      if (!warned) process.stderr.write(`phoenix: not reported (${(err as Error).message})\n`);
      warned = true;
    }
  };
}

async function run(argv: string[]): Promise<number> {
  const { kind, command } = parseRunArgs(argv);
  const report = reporter((process.env.PHOENIX_CORE_URL ?? DEFAULT_CORE_URL).replace(/\/$/, ""));
  const base = {
    id: randomBytes(8).toString("hex"),
    command: redactText(display(command)).slice(0, 4_000),
    cwd: process.cwd(),
    ...(kind ? { kind } : {}),
  };
  const startedAt = Date.now();
  const started = report({ ...base, phase: "started" });

  // ponytail: output is piped (to keep a tail for failures), so the child sees no TTY;
  // switch to a pty if interactive commands ever need it.
  const child = spawn(command[0]!, command.slice(1), { stdio: ["inherit", "pipe", "pipe"] });
  let tail = "";
  const keep = (chunk: Buffer) => {
    tail = (tail + chunk.toString("utf8")).slice(-TAIL_BYTES);
  };
  child.stdout!.on("data", (c: Buffer) => (process.stdout.write(c), keep(c)));
  child.stderr!.on("data", (c: Buffer) => (process.stderr.write(c), keep(c)));

  // Ctrl-C reaches the child through the terminal; stay alive to report how it ended.
  const ignore = () => {};
  process.on("SIGINT", ignore);
  const forward = (sig: NodeJS.Signals) => child.kill(sig);
  process.on("SIGTERM", forward);
  process.on("SIGHUP", forward);

  const exitCode = await new Promise<number>((resolve) => {
    child.on("error", (err: NodeJS.ErrnoException) => {
      process.stderr.write(`phoenix: ${command[0]}: ${err.message}\n`);
      resolve(err.code === "ENOENT" ? 127 : 126);
    });
    child.on("close", (code, signal) =>
      resolve(code ?? 128 + (signal ? constants.signals[signal] : 0)),
    );
  });

  await started;
  await report({
    ...base,
    phase: "finished",
    exit_code: exitCode,
    duration_ms: Date.now() - startedAt,
    ...(exitCode !== 0 && tail ? { output: redactText(tail).slice(-TAIL_BYTES) } : {}),
  });
  return exitCode;
}

async function main(): Promise<void> {
  const [sub, ...rest] = process.argv.slice(2);
  if (sub !== "run") {
    process.stderr.write(USAGE + "\n");
    process.exit(sub === "help" || sub === "--help" ? 0 : 2);
  }
  try {
    process.exit(await run(rest));
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("/cli.ts")) {
  void main();
}
