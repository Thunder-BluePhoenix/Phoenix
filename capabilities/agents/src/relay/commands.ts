// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The shell commands Phoenix writes into an agent's hook settings. Every one of them runs one of
// Phoenix's hook scripts by absolute path, and that path is the sentinel: an entry whose
// command matches HOOK_SCRIPT_PATTERN is Phoenix's, anything else is the user's and is never
// touched by install, repair, health or uninstall.
import { resolve } from "node:path";

/** Phoenix's hook scripts, all in capabilities/agents/src. */
export const HOOK_SCRIPTS = [
  "claude-hook.ts",
  "approval-hook.ts",
  "agent-hook.ts",
  "guard-hook.ts",
  "statusline.ts",
] as const;
export type HookScript = (typeof HOOK_SCRIPTS)[number];

/** Matches the sentinel path in a command, with either kind of separator. */
export const HOOK_SCRIPT_PATTERN =
  /capabilities[\\/]agents[\\/]src[\\/](?:claude-hook|approval-hook|agent-hook|guard-hook|statusline)\.ts(?=["'\s]|$)/;

export interface HookCommandOptions {
  /** Repository root that holds node_modules/.bin/tsx. Default: this checkout. */
  root?: string;
  platform?: NodeJS.Platform;
}

export interface HookCommands {
  /** `claude-hook.ts` with optional flags. */
  claudeState(): string;
  /** `approval-hook.ts --agent <agent> --timeout-ms <ms>`. */
  approval(agent: string, timeoutMs: number): string;
  /** `guard-hook.ts --agent <agent> --timeout-ms <ms>` (Phase 79 secret guard). */
  guard(agent: string, timeoutMs: number): string;
  /** `agent-hook.ts --agent <agent> [--event <name>] [--reply <name>]` (`reply`: a name in HOOK_REPLIES). */
  generic(agent: string, event?: string, reply?: string): string;
  /** `statusline.ts [--then <previous statusLine command>]` (Phase 58). POSIX only: see statusline-hook.ts. */
  statusline(previous?: string): string;
}

const DEFAULT_ROOT = resolve(import.meta.dirname, "../../../..");

/** POSIX single quotes; Windows double quotes (UNVERIFIED on a real Windows agent). */
function quoter(platform: NodeJS.Platform): (value: string) => string {
  return platform === "win32"
    ? (s) => `"${s.replace(/"/g, '\\"')}"`
    : (s) => `'${s.replace(/'/g, `'\\''`)}'`;
}

export function hookCommands(options: HookCommandOptions = {}): HookCommands {
  const root = options.root ?? DEFAULT_ROOT;
  const platform = options.platform ?? process.platform;
  const quote = quoter(platform);
  const tsx = quote(resolve(root, "node_modules/.bin", platform === "win32" ? "tsx.cmd" : "tsx"));
  const script = (name: HookScript, args: string[] = []) =>
    [tsx, quote(resolve(root, "capabilities/agents/src", name)), ...args].join(" ");
  return {
    claudeState: () => script("claude-hook.ts"),
    approval: (agent, timeoutMs) =>
      script("approval-hook.ts", ["--agent", agent, "--timeout-ms", String(timeoutMs)]),
    guard: (agent, timeoutMs) =>
      script("guard-hook.ts", ["--agent", agent, "--timeout-ms", String(timeoutMs)]),
    statusline: (previous) => script("statusline.ts", previous ? ["--then", quote(previous)] : []),
    generic: (agent, event, reply) =>
      script("agent-hook.ts", [
        "--agent",
        agent,
        ...(event ? ["--event", event] : []),
        ...(reply ? ["--reply", reply] : []),
      ]),
  };
}
