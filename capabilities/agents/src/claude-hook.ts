#!/usr/bin/env -S npx tsx
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Claude Code hook adapter (Phase 25). Claude Code runs this for each hook,
// with the hook's JSON on stdin:
//
//   claude-hook.ts [--task-from-prompt]
//
// It tells Phoenix Core what Claude Code is doing and nothing else. It NEVER
// fails the agent: it always exits 0 within about 2 seconds, even when Core is
// down or slow, and writes nothing to stdout (Claude Code reads stdout of some
// hooks as context or as a decision). Problems go to stderr.
import { mapClaudeHook } from "./claude";
import { sendReport } from "./send";

/** Whole-process deadline, covering reading stdin and talking to Core. */
export const HOOK_DEADLINE_MS = 2_000;
const MAX_STDIN = 1_000_000;

/** Reads stdin up to the cap; an interactive terminal counts as empty. */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_STDIN) return "";
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main(argv: string[]): Promise<void> {
  const withTitle = argv.includes("--task-from-prompt");
  let payload: unknown;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    return; // not JSON: nothing to report
  }
  const report = mapClaudeHook(payload, { withTitle });
  if (!report) return;
  const sent = await sendReport(report, { timeoutMs: HOOK_DEADLINE_MS - 500 });
  if (!sent.ok) process.stderr.write(`phoenix: agent state not reported (${sent.message})\n`);
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("/claude-hook.ts")
) {
  const deadline = setTimeout(() => process.exit(0), HOOK_DEADLINE_MS);
  main(process.argv.slice(2))
    .catch(() => {})
    .finally(() => {
      clearTimeout(deadline);
      process.exit(0);
    });
}
