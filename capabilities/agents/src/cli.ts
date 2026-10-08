#!/usr/bin/env -S npx tsx
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
//   phoenix-agent report --agent <name> --state <state> [--id <session>] [--workspace <dir>]
//                        [--task <title>] [--reason permission|input|idle]
//   phoenix-agent claude-hooks [--task-from-prompt]
//
// `report` tells Phoenix what a coding agent is doing, for tools without a
// dedicated adapter (wire it into the tool's own hook or a wrapper script).
// `claude-hooks` PRINTS the hooks block for ~/.claude/settings.json; it never
// writes anything. Observe-only: nothing here can steer an agent.
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { claudeHooksConfig } from "./claude";
import { AGENT_STATES, WAIT_REASONS, validateReport } from "./report";
import { sendReport } from "./send";

const USAGE = `Usage:
  phoenix-agent report --agent <name> --state ${AGENT_STATES.join("|")} [--id <session>]
                       [--workspace <dir>] [--task <title>] [--reason ${WAIT_REASONS.join("|")}]
  phoenix-agent claude-hooks [--task-from-prompt]    print the hooks for ~/.claude/settings.json`;

const ROOT = resolve(import.meta.dirname, "../../..");
const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export async function run(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === "claude-hooks") {
    const { values } = parseArgs({
      args: rest,
      options: { "task-from-prompt": { type: "boolean" } },
    });
    const hook = join(import.meta.dirname, "claude-hook.ts");
    const command = [
      quote(join(ROOT, "node_modules/.bin/tsx")),
      quote(hook),
      ...(values["task-from-prompt"] ? ["--task-from-prompt"] : []),
    ].join(" ");
    process.stdout.write(JSON.stringify(claudeHooksConfig(command), null, 2) + "\n");
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
