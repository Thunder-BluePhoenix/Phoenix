#!/usr/bin/env -S npx tsx
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
//   phoenix-agent report --agent <name> --state <state> [--id <session>] [--workspace <dir>]
//                        [--task <title>] [--reason permission|input|idle]
//   phoenix-agent claude-hooks [--task-from-prompt] [--no-approvals] [--no-guard] [--approval-timeout-ms <ms>]
//   phoenix-agent codex-hooks [--no-guard] [--approval-timeout-ms <ms>]
//   phoenix-agent codex-usage                                         (Phase 58; launches `codex app-server` once, see codex-usage.ts)
//   phoenix-agent status | install|repair|uninstall <agent> [--yes] | self-test   (Phase 57, relay-cli.ts)
//
// `report` tells Phoenix what a coding agent is doing, for tools without a
// dedicated adapter (wire it into the tool's own hook or a wrapper script).
// `claude-hooks` / `codex-hooks` PRINT the hooks block for the agent's settings; they never
// write anything. The state hooks are observe-only; the approval hooks (Phase 56, approval-hook.ts)
// wait for a decision from Phoenix and fail open.
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CODEX_AGENT, codexHooksConfig } from "./approval-codex";
import { codexUsageBody, readCodexRateLimits, type AppServerLauncher } from "./codex-usage";
import { sendLive } from "./live-send";
import { APPROVAL_TIMEOUT, isApprovalTimeout } from "./approval-map";
import { CLAUDE_AGENT, claudeHooksConfig } from "./claude";
import { AGENT_STATES, WAIT_REASONS, validateReport } from "./report";
import { RELAY_COMMANDS, RELAY_USAGE, runRelayCommand } from "./relay-cli";
import { sendReport } from "./send";

const USAGE = `Usage:
  phoenix-agent report --agent <name> --state ${AGENT_STATES.join("|")} [--id <session>]
                       [--workspace <dir>] [--task <title>] [--reason ${WAIT_REASONS.join("|")}]
  phoenix-agent claude-hooks [--task-from-prompt] [--no-approvals] [--no-guard] [--approval-timeout-ms <ms>]
                       print the hooks for ~/.claude/settings.json (observe-only + approvals + secret guard)
  phoenix-agent codex-hooks [--no-guard] [--approval-timeout-ms <ms>]
                       print the PermissionRequest and secret guard hooks for ~/.codex/hooks.json
  phoenix-agent codex-usage
                       ask \`codex app-server\` once (read-only account/rateLimits/read) and send the plan windows to Phoenix
${RELAY_USAGE}`;

const ROOT = resolve(import.meta.dirname, "../../..");
const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export async function run(
  argv: string[],
  seams: { codexAppServer?: AppServerLauncher } = {},
): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === "codex-usage") {
    if (rest.length > 0) {
      process.stderr.write(`phoenix-agent codex-usage takes no arguments\n${USAGE}\n`);
      return 2;
    }
    const read = await readCodexRateLimits(seams.codexAppServer);
    if (!read.ok) {
      process.stderr.write(`phoenix-agent codex-usage: ${read.message}\n`);
      return 1;
    }
    if (read.samples.length === 0) {
      process.stderr.write(
        "phoenix-agent codex-usage: Codex reported no 5-hour or weekly plan window (nothing sent)\n",
      );
      return 1;
    }
    const sent = await sendLive("usage", codexUsageBody(read.samples));
    if (!sent.ok) {
      process.stderr.write(`phoenix-agent codex-usage: not reported (${sent.message})\n`);
      return 1;
    }
    process.stdout.write(
      read.samples.map((x) => `${x.window}: ${x.used_pct}% used, resets ${x.resets_at}\n`).join(""),
    );
    return 0;
  }
  if (sub !== undefined && (RELAY_COMMANDS as readonly string[]).includes(sub)) {
    return runRelayCommand(sub, rest, {
      out: (text) => void process.stdout.write(text),
      err: (text) => void process.stderr.write(text),
    });
  }
  if (sub === "claude-hooks" || sub === "codex-hooks") {
    let values;
    try {
      ({ values } = parseArgs({
        args: rest,
        options: {
          "task-from-prompt": { type: "boolean" },
          "no-approvals": { type: "boolean" },
          "no-guard": { type: "boolean" },
          "approval-timeout-ms": { type: "string" },
        },
      }));
    } catch (err) {
      process.stderr.write(`${(err as Error).message}\n${USAGE}\n`);
      return 2;
    }
    const timeoutMs =
      values["approval-timeout-ms"] === undefined
        ? APPROVAL_TIMEOUT.default
        : Number(values["approval-timeout-ms"]);
    if (!isApprovalTimeout(timeoutMs)) {
      process.stderr.write(
        `phoenix-agent: --approval-timeout-ms must be an integer from ${APPROVAL_TIMEOUT.min} to ${APPROVAL_TIMEOUT.max}\n${USAGE}\n`,
      );
      return 2;
    }
    const tsx = quote(join(ROOT, "node_modules/.bin/tsx"));
    const approvalCommand = (agent: string) =>
      [
        tsx,
        quote(join(import.meta.dirname, "approval-hook.ts")),
        "--agent",
        agent,
        "--timeout-ms",
        String(timeoutMs),
      ].join(" ");
    const guardHook = (agent: string) =>
      values["no-guard"]
        ? undefined
        : {
            command: [
              tsx,
              quote(join(import.meta.dirname, "guard-hook.ts")),
              "--agent",
              agent,
              "--timeout-ms",
              String(timeoutMs),
            ].join(" "),
            timeoutMs,
          };
    if (sub === "codex-hooks") {
      process.stdout.write(
        JSON.stringify(
          codexHooksConfig(approvalCommand(CODEX_AGENT), timeoutMs, guardHook(CODEX_AGENT)),
          null,
          2,
        ) + "\n",
      );
      return 0;
    }
    const command = [
      tsx,
      quote(join(import.meta.dirname, "claude-hook.ts")),
      ...(values["task-from-prompt"] ? ["--task-from-prompt"] : []),
    ].join(" ");
    const approvals = values["no-approvals"]
      ? undefined
      : { command: approvalCommand(CLAUDE_AGENT), timeoutMs };
    process.stdout.write(
      JSON.stringify(claudeHooksConfig(command, approvals, guardHook(CLAUDE_AGENT)), null, 2) +
        "\n",
    );
    return 0;
  }
  if (sub !== "report") {
    process.stderr.write(USAGE + "\n");
    return sub === "help" || sub === "--help" ? 0 : 2;
  }

  let values;
  try {
    ({ values } = parseArgs({
      args: rest,
      options: {
        agent: { type: "string" },
        state: { type: "string" },
        id: { type: "string" },
        workspace: { type: "string" },
        task: { type: "string" },
        reason: { type: "string" },
      },
    }));
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n${USAGE}\n`);
    return 2;
  }
  const workspace = resolve(values.workspace ?? process.cwd());
  const agent = values.agent ?? "";
  // Without --id, one session per agent and directory.
  const id =
    values.id ?? `${agent}-${createHash("sha256").update(workspace).digest("hex").slice(0, 12)}`;
  const checked = validateReport({
    agent,
    agent_id: id,
    state: values.state,
    workspace,
    ...(values.task !== undefined ? { task: values.task } : {}),
    ...(values.reason !== undefined ? { reason: values.reason } : {}),
  });
  if (!checked.ok) {
    process.stderr.write(`phoenix-agent: ${checked.problems.join("; ")}\n${USAGE}\n`);
    return 2;
  }
  // Wrappers must not break because Phoenix is not running: report best-effort, exit 0.
  const sent = await sendReport(checked.report);
  if (!sent.ok) process.stderr.write(`phoenix: agent state not reported (${sent.message})\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("/cli.ts")) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: Error) => {
      process.stderr.write(`${err.message}\n`);
      process.exit(2);
    },
  );
}
