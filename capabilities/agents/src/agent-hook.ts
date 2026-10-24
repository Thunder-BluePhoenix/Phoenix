#!/usr/bin/env -S npx tsx
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Observe-only hook for the agents the installer supports (Phase 57). Run by Codex, Cursor,
// Gemini CLI, Copilot CLI and Muse Code with the hook's JSON on stdin, and by the OpenCode and Amp
// plugins with PHOENIX_AGENT_* variables:
//
//   agent-hook.ts --agent <name> [--event <name>]
//
// It tells Phoenix what the agent is doing and, only when the payload carries an explicit
// `phoenix_usage` object (Phoenix's own wrapper; see mapGenericUsage), the session's token/cost
// totals. It NEVER fails the agent: it always
// exits 0 within about 2 seconds, even when Core is down. Stdout is the single line `{}`: valid,
// empty JSON for every agent whose docs say hook stdout is parsed as JSON (it means "no decision").
import { parseArgs } from "node:util";
import { APPROVAL_AGENT_PATTERN } from "./approval-map";
import { isRecord } from "./guards";
import { mapGenericHook, mapGenericUsage } from "./relay/generic-map";
import { sendLive } from "./live-send";
import { sendReport } from "./send";

export const HOOK_DEADLINE_MS = 2_000;
const MAX_STDIN = 1_000_000;

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

/** Whole hook minus process I/O. Never throws; the note is for stderr. */
export async function runAgentHook(
  argv: readonly string[],
  input: string,
  env: Record<string, string | undefined>,
): Promise<{ note: string }> {
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: { agent: { type: "string" }, event: { type: "string" } },
    });
    let payload: unknown = null;
    try {
      payload = input.trim() === "" ? null : JSON.parse(input);
    } catch {
      return { note: "" }; // not JSON: nothing to report
    }
    // Any other agent: `--agent <name>`, or a `phoenix_agent` field in the payload it sends.
    const named = values.agent ?? (isRecord(payload) ? payload.phoenix_agent : undefined);
    if (typeof named !== "string" || !APPROVAL_AGENT_PATTERN.test(named)) {
      return { note: "agent name must match ^[a-z0-9-]{1,24}$ (--agent or a phoenix_agent field)" };
    }
    const hookOptions = {
      agent: named,
      ...(values.event ? { event: values.event } : {}),
      env,
    };
    const report = mapGenericHook(payload, hookOptions);
    // Phase 78: only an explicit `phoenix_usage` object produces a usage report (never read from
    // the agent's native payload); it goes to the generic usage route, in parallel with the state.
    const usage = mapGenericUsage(payload, hookOptions);
    const budget = { timeoutMs: HOOK_DEADLINE_MS - 500 };
    const [sent, usageSent] = await Promise.all([
      report ? sendReport(report, budget) : undefined,
      usage ? sendLive("usage", usage, budget) : undefined,
    ]);
    const failed = [
      sent && !sent.ok ? `agent state not reported (${sent.message})` : "",
      usageSent && !usageSent.ok ? `agent usage not reported (${usageSent.message})` : "",
    ].filter((n) => n !== "");
    return { note: failed.join("; ") };
  } catch (err) {
    return { note: (err as Error).message.slice(0, 300) };
  }
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("/agent-hook.ts")
) {
  const deadline = setTimeout(() => process.exit(0), HOOK_DEADLINE_MS);
  readStdin()
    .then((input) => runAgentHook(process.argv.slice(2), input, process.env))
    .then(({ note }) => {
      if (note) process.stderr.write(`phoenix: ${note}\n`);
    })
    .catch(() => {})
    .finally(() => {
      clearTimeout(deadline);
      process.stdout.write("{}\n", () => process.exit(0));
    });
}
