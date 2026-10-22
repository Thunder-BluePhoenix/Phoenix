#!/usr/bin/env -S npx tsx
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Secret guard hook (Phase 79). Claude Code and Codex run this for EVERY `PreToolUse`, with the
// hook's JSON on stdin:
//
//   guard-hook.ts [--agent <name>] [--timeout-ms <ms>]
//
// It scans the tool call's input (a command, a file's content, new_string, patch text, MCP
// arguments) and, when the command is `git commit` or `git push`, what is about to be committed or
// pushed (`git diff --cached`, bounded), with Phoenix's own detector (relay/guard-scan.ts over
// protocol/src/secrets.ts). Contract of the agents' hooks (code.claude.com/docs/en/hooks,
// developers.openai.com/codex/hooks): exit 0 with no output = "no decision"; exit 0 with
// {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",
// "permissionDecisionReason":...}} = block the call and tell the agent why.
//
// What it prints:
//   - nothing, when nothing was found or the owner approved the override (the guard never says
//     "allow": that would skip the agent's own permission prompt);
//   - one deny line, when a secret was found and the owner has not approved it. The reason names the
//     pattern KIND and the LOCATION, never the secret.
//
// Override: only an approval card (Phase 56 path) bound to the hash of the scanned content. The card
// says what was found and where; "Allow" is honoured only when the owner decided it (not a rule or
// a policy). Core down, slow, refusing, a rate limit or a missing session id all mean the block stands.
//
// Failure behaviour (the documented trade-off):
//   - FOUND secret => blocked, fail CLOSED, whatever else fails.
//   - Input the guard cannot fully read, because the AGENT controls its size => fail CLOSED with a
//     deny line that says why (no override card: there is no complete content to bind one to):
//     stdin longer than MAX_STDIN, and a tool input longer than the scan limit (`truncated`).
//   - NOTHING found, or the hook itself failing for a reason the agent does not control (an
//     unexpected error, a bad payload, git not runnable so the diff could not be read, the hard
//     deadline) => fail OPEN: exit 0, empty stdout, a note on stderr. A guard that blocked every
//     tool call whenever it broke would make the agent unusable and users would uninstall it; the
//     cost is that a crash is a silent gap, so it is reported on stderr.
//   - A staged diff longer than the scan limit, or git output past its buffer, is scanned up to the
//     limit only; the note says so on stderr but the call is not blocked (a large honest commit
//     must stay possible).
//
// Results (counts and kinds, never content) go to Core: POST /api/secret-guard/result with the
// session token. A result that cannot be delivered changes nothing about the decision.
import { resolveSessionToken } from "@phoenix/sdk";
import { isAbsolute } from "node:path";
import { parseArgs } from "node:util";
import {
  requestApproval,
  type ApprovalClientOptions,
  type ApprovalOutcome,
} from "./approval-client";
import {
  APPROVAL_AGENT_PATTERN,
  APPROVAL_TIMEOUT,
  isApprovalTimeout,
  type ApprovalRequest,
} from "./approval-map";
import { CLAUDE_AGENT } from "./claude";
import { trustedCoreUrl } from "./core-url";
import { execGit, type GitExec } from "./diffs";
import { isRecord } from "./guards";
import { gatherChanges, gitIntent } from "./relay/guard-git";
import {
  describeFindings,
  guardHash,
  scanDiff,
  scanToolInput,
  type GuardFinding,
  type ScanResult,
} from "./relay/guard-scan";

const MAX_STDIN = 4_000_000;
const REPORT_TIMEOUT_MS = 1_500;
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export type GuardOutcome = "blocked" | "overridden" | "allowed";

/** The body of `POST /api/secret-guard/result`: kinds and locations only. */
export interface GuardResult {
  outcome: GuardOutcome;
  agent: string;
  session_id: string;
  tool: string;
  findings: GuardFinding[];
  /** SHA-256 of the scanned content: lets an audit reader tie an approval to a block, reveals nothing. */
  content_hash: string;
  /** What was scanned beyond the tool input (git commit/push), if anything. */
  scope: string | null;
}

const none = (note: string): GuardHookResult => ({ line: null, note, outcome: null });

/** The deny line for input the guard could not scan completely. */
export function incompleteLine(why: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: (
        `Phoenix secret guard blocked this: ${why}, so it could not be checked for secrets. ` +
        `Split the work into smaller calls (for example a shorter file or several commits).`
      ).slice(0, 1_000),
    },
  });
}

export interface GuardHookResult {
  /** The one stdout line (without newline), or null: print nothing. */
  line: string | null;
  /** For stderr: why nothing was decided, or a failure that was swallowed. */
  note: string;
  outcome: GuardOutcome | null;
}

/** Everything with a side effect, injectable. */
export interface GuardDeps {
  exec?: GitExec;
  approve?: (request: ApprovalRequest) => Promise<ApprovalOutcome>;
  report?: (result: GuardResult) => Promise<void>;
  client?: ApprovalClientOptions;
}

const nonEmpty = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max && !HIDDEN.test(v);

/** The deny line. `findings` carry kinds and locations only. */
export function denyLine(findings: readonly GuardFinding[], overridable: boolean): string {
  const reason =
    `Phoenix secret guard blocked this: ${describeFindings(findings)}. ` +
    `Remove the secret (use an environment variable or a secret store) and try again. ` +
    (overridable
      ? "The owner can allow this one call from the Phoenix approval card; waiting for it ended without approval."
      : "Phoenix could not ask the owner for an override.");
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason.slice(0, 1_000),
    },
  });
}

function approvalRequest(
  agent: string,
  session: string,
  project: string,
  tool: string,
  findings: readonly GuardFinding[],
  scope: string | null,
  hash: string,
  timeoutMs: number,
): ApprovalRequest {
  const where = scope === null ? "the tool call" : `the tool call and the ${scope}`;
  const description =
    `Secret guard found: ${describeFindings(findings)} in ${where}. ` +
    `Allow lets this one call run with the secret in it.`;
  return {
    kind: "permission",
    agent,
    session_id: session,
    project,
    tool: "SecretGuard",
    input_summary: {
      description: description.length > 500 ? `${description.slice(0, 499)}…` : description,
      // The hash is what binds the card: Core's digest covers input_summary, and a decision is
      // only accepted for the digest of exactly this request.
      detail: JSON.stringify({
        blocked_tool: tool.slice(0, 100),
        content_hash: hash,
        session_id: session,
      }),
    },
    timeout_ms: timeoutMs,
  };
}

/**
 * The whole hook minus process I/O. Never throws. `timeoutMs` is the override card's lifetime.
 */
export async function runGuard(
  argv: readonly string[],
  input: string,
  deps: GuardDeps = {},
): Promise<GuardHookResult> {
  let held: GuardHookResult | undefined;
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: { agent: { type: "string" }, "timeout-ms": { type: "string" } },
    });
    const agent = values.agent ?? CLAUDE_AGENT;
    if (!APPROVAL_AGENT_PATTERN.test(agent)) return none("invalid --agent");
    const timeoutMs =
      values["timeout-ms"] === undefined ? APPROVAL_TIMEOUT.default : Number(values["timeout-ms"]);
    if (!isApprovalTimeout(timeoutMs)) return none("invalid --timeout-ms");

    let payload: unknown;
    try {
      payload = JSON.parse(input);
    } catch {
      return none("");
    }
    if (!isRecord(payload) || payload.hook_event_name !== "PreToolUse") return none("");
    const tool =
      typeof payload.tool_name === "string" ? payload.tool_name.slice(0, 100) : "unknown";
    const cwd = typeof payload.cwd === "string" && isAbsolute(payload.cwd) ? payload.cwd : null;

    const scans: ScanResult[] = [scanToolInput(payload.tool_input)];
    let scope: string | null = null;
    let note = "";
    const command = isRecord(payload.tool_input) ? payload.tool_input.command : undefined;
    // gitIntent is linear and looks at a bounded window per `git`, so a long command is read in
    // full: padding a command must not skip the staged-diff scan.
    const intent = typeof command === "string" ? gitIntent(command) : null;
    if (intent && cwd) {
      try {
        const gathered = await gatherChanges(intent, cwd, deps.exec ?? execGit);
        scope = gathered.scope;
        scans.push(scanDiff(gathered.diff));
        const parts: string[] = [];
        if (gathered.truncated) parts.push("the diff was longer than the scan limit");
        if (gathered.note !== undefined) parts.push(gathered.note);
        note = parts.join("; ");
      } catch (err) {
        // The diff could not be read: fail open for the diff only; the input was still scanned.
        note = `could not read the changes (${(err as Error).message.slice(0, 120)})`;
      }
    }

    const findings = scans.flatMap((s) => s.findings).slice(0, 20);
    if (findings.length === 0 && scans[0]!.truncated) {
      // The agent chooses the size of its tool input: a pass on a partial scan would let padding
      // hide a secret. (A found secret is handled below and blocked as usual.)
      return {
        line: incompleteLine("the tool input is longer than the scan limit"),
        note: "",
        outcome: "blocked",
      };
    }
    const hash = guardHash(scans.flatMap((s) => s.scanned));
    const session = payload.session_id;
    const report = deps.report ?? ((r) => sendGuardResult(r, deps.client));
    const base = {
      agent,
      session_id: nonEmpty(session, 200) ? session : "unknown",
      tool,
      content_hash: hash,
      scope,
    };

    if (findings.length === 0) {
      // Only a scanned commit/push is worth a request: reporting every clean tool call would add
      // a round trip to each one.
      if (scope !== null) await report({ ...base, outcome: "allowed", findings: [] });
      return none(note);
    }

    const project = cwd;
    const canAsk = nonEmpty(session, 200) && project !== null && !HIDDEN.test(project);
    held = { line: denyLine(findings, canAsk), note: "", outcome: "blocked" };
    if (canAsk) {
      const request = approvalRequest(
        agent,
        session,
        project,
        tool,
        findings,
        scope,
        hash,
        timeoutMs,
      );
      const asked = await (deps.approve ?? ((r) => requestApproval(r, deps.client)))(request);
      if (
        asked.decision !== null &&
        asked.decision.behavior === "allow" &&
        asked.decidedBy === "user"
      ) {
        await report({ ...base, outcome: "overridden", findings });
        return { line: null, note: "", outcome: "overridden" };
      }
    }
    await report({ ...base, outcome: "blocked", findings });
    return held;
  } catch (err) {
    // A bug in the guard. A decision already reached (a found secret) stands; otherwise fail open.
    return held ?? none(`secret guard error: ${(err as Error).message.slice(0, 200)}`);
  }
}

/**
 * stdin passed MAX_STDIN: the payload cannot be parsed, so there is no tool name to scope the block
 * to; the flags are still checked so that a bad install keeps its fail-open behaviour. Deny.
 */
export function oversizeResult(argv: readonly string[]): GuardHookResult {
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: { agent: { type: "string" }, "timeout-ms": { type: "string" } },
    });
    if (!APPROVAL_AGENT_PATTERN.test(values.agent ?? CLAUDE_AGENT)) return none("invalid --agent");
  } catch {
    return none("invalid arguments");
  }
  return {
    line: incompleteLine("the hook input is longer than the guard can read"),
    note: "",
    outcome: "blocked",
  };
}

/** POST /api/secret-guard/result over loopback with the session token. Never throws. */
export async function sendGuardResult(
  result: GuardResult,
  options: ApprovalClientOptions = {},
): Promise<void> {
  const base = trustedCoreUrl(options.coreUrl);
  if (base === null) return;
  let token: string;
  try {
    token = resolveSessionToken(options.token);
  } catch {
    return;
  }
  try {
    await fetch(`${base}/api/secret-guard/result`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(result),
      redirect: "error",
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
    });
  } catch {
    // The decision does not depend on the audit trail arriving.
  }
}

/** Reads stdin up to the cap; an interactive terminal counts as empty; more than the cap is `oversize`. */
export async function readStdin(
  stream: AsyncIterable<unknown> & { isTTY?: boolean } = process.stdin,
  max = MAX_STDIN,
): Promise<{ text: string; oversize: boolean }> {
  if (stream.isTTY) return { text: "", oversize: false };
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > max) return { text: "", oversize: true };
    chunks.push(buf);
  }
  return { text: Buffer.concat(chunks).toString("utf8"), oversize: false };
}

async function write(line: string): Promise<void> {
  const flushed = Promise.withResolvers<void>();
  process.stdout.write(line + "\n", () => flushed.resolve());
  await flushed.promise;
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("/guard-hook.ts")
) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--timeout-ms");
  const asked = i === -1 ? APPROVAL_TIMEOUT.default : Number(argv[i + 1]);
  // Hard stop in case something hangs: the card's lifetime plus a margin below the hook's +10 s.
  const deadline = setTimeout(
    () => process.exit(0),
    (isApprovalTimeout(asked) ? asked : APPROVAL_TIMEOUT.default) + 2_000,
  );
  readStdin()
    .then(async (read) => (read.oversize ? oversizeResult(argv) : await runGuard(argv, read.text)))
    .then(async (result) => {
      if (result.line) await write(result.line);
      else if (result.note) process.stderr.write(`phoenix: secret guard: ${result.note}\n`);
    })
    .catch(() => {})
    .finally(() => {
      clearTimeout(deadline);
      process.exit(0);
    });
}
