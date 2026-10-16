#!/usr/bin/env -S npx tsx
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Approval hook (Phase 56). Claude Code runs this for `PermissionRequest` and for
// `PreToolUse` of `AskUserQuestion`; Codex runs it for `PermissionRequest`. The hook's JSON is
// on stdin:
//
//   approval-hook.ts [--agent <name>] [--timeout-ms <ms>]
//
// It asks Phoenix Core for a decision and waits up to the timeout. Unlike claude-hook.ts it MAY
// print to stdout, but only ever ONE line of decision JSON, or nothing. Nothing means "no
// decision": the agent then asks in its own terminal. It fails open and always exits 0: Core down,
// slow, refusing, a malformed reply, a reply for another request, the deadline, or the user
// choosing "Reply in terminal" all end in empty stdout. Diagnostics go to stderr.
import { parseArgs } from "node:util";
import { requestApproval, type ApprovalClientOptions } from "./approval-client";
import { SUMMARIZERS } from "./approval-codex";
import {
  APPROVAL_AGENT_PATTERN,
  APPROVAL_TIMEOUT,
  isApprovalTimeout,
  mapApprovalPayload,
  renderDecision,
} from "./approval-map";
import { CLAUDE_AGENT } from "./claude";

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

export interface HookResult {
  /** The one line for stdout (without newline), or null: print nothing. */
  line: string | null;
  /** Why there is no line, for stderr; empty when there is one or when it is not worth saying. */
  note: string;
}

/**
 * Whole hook minus process I/O: arguments and stdin text in, the stdout line out. Never throws.
 */
export async function decideApproval(
  argv: readonly string[],
  input: string,
  client: ApprovalClientOptions = {},
): Promise<HookResult> {
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: { agent: { type: "string" }, "timeout-ms": { type: "string" } },
    });
    const agent = values.agent ?? CLAUDE_AGENT;
    if (!APPROVAL_AGENT_PATTERN.test(agent)) return { line: null, note: "invalid --agent" };
    const timeoutMs =
      values["timeout-ms"] === undefined ? APPROVAL_TIMEOUT.default : Number(values["timeout-ms"]);
    if (!isApprovalTimeout(timeoutMs)) return { line: null, note: "invalid --timeout-ms" };

    let payload: unknown;
    try {
      payload = JSON.parse(input);
    } catch {
      return { line: null, note: "" };
    }
    let rejected = "";
    const mapped = mapApprovalPayload(payload, {
      agent,
      timeoutMs,
      onReject: (reason) => (rejected ||= reason),
      ...(SUMMARIZERS[agent] ? { summarize: SUMMARIZERS[agent] } : {}),
    });
    if (!mapped) return { line: null, note: rejected };

    const outcome = await requestApproval(mapped.request, client);
    if (!outcome.decision) return { line: null, note: outcome.reason };
    const line = renderDecision(mapped, outcome.decision);
    return line ? { line, note: "" } : { line: null, note: "decision does not fit the request" };
  } catch (err) {
    return { line: null, note: (err as Error).message.slice(0, 300) };
  }
}

async function main(argv: string[]): Promise<void> {
  const result = await decideApproval(argv, await readStdin());
  if (result.line) {
    // Exit only after the line is flushed: process.exit() could cut off a pipe write.
    const flushed = Promise.withResolvers<void>();
    process.stdout.write(result.line + "\n", () => flushed.resolve());
    await flushed.promise;
  } else if (result.note) {
    process.stderr.write(`phoenix: no approval decision (${result.note})\n`);
  }
}

/** Hard stop in case something hangs: the decision timeout plus a margin below the hook's +10 s. */
function deadlineMs(argv: string[]): number {
  const i = argv.indexOf("--timeout-ms");
  const asked = i === -1 ? APPROVAL_TIMEOUT.default : Number(argv[i + 1]);
  return (isApprovalTimeout(asked) ? asked : APPROVAL_TIMEOUT.default) + 2_000;
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("/approval-hook.ts")
) {
  const argv = process.argv.slice(2);
  const deadline = setTimeout(() => process.exit(0), deadlineMs(argv));
  main(argv)
    .catch(() => {})
    .finally(() => {
      clearTimeout(deadline);
      process.exit(0);
    });
}
