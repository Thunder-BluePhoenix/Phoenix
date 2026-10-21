// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The protected list (Phase 74). A protected process is NEVER frozen: the freeze actions refuse to
// even plan it. The list has built-ins that no configuration can remove (configuration can only
// add), and the check is one pure function so a table test can pin every rule.
//
// A process is protected when it, or any of its ancestors, is:
//   - Phoenix itself (own pid), or a process in Phoenix's own tree (ancestors and descendants);
//   - a terminal, an editor or IDE, a coding agent (Phoenix-tracked pid or a well-known name), or
//     a meeting / recording / dictation app;
//   - something the user added.
// Ancestors count because a helper started by a protected program is part of it: freezing it would
// freeze work the user is doing there.
//
// Matching is by executable path segments: the `Something.app` bundle folders in the path, and the
// file name. Names are compared case-insensitively and exactly (the JetBrains family and Xcode by
// prefix). UNVERIFIED on a real Mac: names are the usual ones of a default install.
import type { ProcInfo } from "./types";

/** `.app` folder names (without `.app`), lower case. */
const BUNDLES_EXACT: ReadonlySet<string> = new Set([
  // Phoenix
  "phoenix",
  // terminals
  "terminal",
  "iterm",
  "iterm2",
  "ghostty",
  "alacritty",
  "wezterm",
  "kitty",
  "warp",
  // editors
  "visual studio code",
  "visual studio code - insiders",
  "cursor",
  "zed",
  "zed preview",
  "sublime text",
  "sublime merge",
  "macvim",
  "vimr",
  "neovide",
  "windsurf",
  "nova",
  "bbedit",
  "textmate",
  // meeting, recording, dictation
  "zoom.us",
  "microsoft teams",
  "microsoft teams (work or school)",
  "facetime",
  "webex",
  "cisco webex meetings",
  "google meet",
  "whereby",
  "around",
  "quicktime player",
  "obs",
  "loom",
  "screenflow",
  "audio hijack",
  "superwhisper",
  "wispr flow",
  "granola",
  "voice memos",
  "kage",
]);

/** `.app` folder name prefixes (JetBrains family, Xcode). */
const BUNDLE_PREFIXES: readonly string[] = [
  "xcode",
  "intellij idea",
  "pycharm",
  "webstorm",
  "goland",
  "clion",
  "rider",
  "rubymine",
  "phpstorm",
  "datagrip",
  "android studio",
  "appcode",
  "fleet",
  "rustrover",
  "jetbrains",
];

/** Executable file names, lower case (CLI editors, terminals, agents, GUI-less pieces of the above). */
const COMMANDS_EXACT: ReadonlySet<string> = new Set([
  // terminals
  "iterm2",
  "ghostty",
  "alacritty",
  "wezterm",
  "wezterm-gui",
  "kitty",
  "warp",
  "terminal",
  // editors
  "vim",
  "nvim",
  "gvim",
  "nvim-qt",
  "neovide",
  "code",
  "zed",
  "cursor",
  // coding agents
  "claude",
  "codex",
  "aider",
  "gemini",
  // Phoenix
  "phoenix",
]);

/** The coding agents' process names, for the README and the web list. */
export const AGENT_COMMAND_NAMES: readonly string[] = ["claude", "codex", "aider", "gemini"];

/** What the web list shows as built in (grouped; labels only, never used for matching). */
export const BUILT_IN_PROTECTED_LABELS: readonly string[] = [
  "Phoenix",
  "Terminal",
  "iTerm2",
  "Ghostty",
  "Alacritty",
  "WezTerm",
  "kitty",
  "Warp",
  "Visual Studio Code",
  "Cursor",
  "Zed",
  "JetBrains IDEs",
  "Xcode",
  "Sublime Text",
  "Vim / Neovim",
  "claude",
  "codex",
  "aider",
  "gemini",
  "Zoom",
  "Microsoft Teams",
  "FaceTime",
  "Webex",
  "QuickTime Player",
  "OBS",
];

/** What a user may add: a program or app name, matched exactly (no paths, no wildcards). */
export const PROTECTED_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,63}$/;
export const MAX_PROTECTED_EXTRA = 64;

export interface ProtectedContext {
  /** Phoenix's own pid. */
  selfPid: number;
  /** Pids of the coding agents Phoenix tracks (the agents capability's live sessions). */
  agentPids: ReadonlySet<number>;
  /** The whole process table, for ancestors and descendants. */
  table: ReadonlyMap<number, ProcInfo>;
  /** The user's additions, already validated (lower case). */
  extra: ReadonlySet<string>;
}

export type ProtectedWhy = "self" | "self_tree" | "agent" | "built_in" | "user_added";

const MAX_DEPTH = 64;

/** The names in a path that identify a program: `.app` folders (without the suffix) and the file name. */
function namesOf(command: string): { bundles: string[]; file: string } {
  const parts = command.split("/").filter((p) => p.length > 0);
  const bundles = parts
    .filter((p) => p.toLowerCase().endsWith(".app"))
    .map((p) => p.slice(0, -4).toLowerCase());
  return { bundles, file: (parts.at(-1) ?? "").toLowerCase() };
}

function matchesBuiltIn(command: string): boolean {
  const { bundles, file } = namesOf(command);
  if (COMMANDS_EXACT.has(file)) return true;
  return bundles.some((b) => BUNDLES_EXACT.has(b) || BUNDLE_PREFIXES.some((p) => b.startsWith(p)));
}

function matchesExtra(command: string, extra: ReadonlySet<string>): boolean {
  if (extra.size === 0) return false;
  const { bundles, file } = namesOf(command);
  return extra.has(file) || bundles.some((b) => extra.has(b));
}

/** Pids of `pid` and everything above it (stops at a loop or after MAX_DEPTH). */
function ancestorsOf(pid: number, table: ReadonlyMap<number, ProcInfo>): number[] {
  const out: number[] = [];
  let at = pid;
  for (let i = 0; i < MAX_DEPTH; i++) {
    out.push(at);
    const parent = table.get(at)?.ppid;
    if (parent === undefined || parent <= 0 || out.includes(parent)) break;
    at = parent;
  }
  return out;
}

/** Why `proc` is protected, or null when nothing protects it. Pure. */
export function protectedReason(proc: ProcInfo, ctx: ProtectedContext): ProtectedWhy | null {
  if (proc.pid === ctx.selfPid) return "self";
  const chain = ancestorsOf(proc.pid, ctx.table);
  // Phoenix's own tree: Phoenix's ancestors (the launching shell or app) and its descendants.
  if (ancestorsOf(ctx.selfPid, ctx.table).includes(proc.pid) || chain.includes(ctx.selfPid)) {
    return "self_tree";
  }
  let why: ProtectedWhy | null = null;
  for (const pid of chain) {
    if (ctx.agentPids.has(pid)) return "agent";
    const command = pid === proc.pid ? proc.command : (ctx.table.get(pid)?.command ?? "");
    if (matchesBuiltIn(command)) why ??= "built_in";
    else if (matchesExtra(command, ctx.extra)) why ??= "user_added";
  }
  return why;
}

/** True when `proc` must never be frozen. Pure. */
export function isProtected(proc: ProcInfo, ctx: ProtectedContext): boolean {
  return protectedReason(proc, ctx) !== null;
}

/** Valid, lower-cased, de-duplicated user additions; the count of rejected entries. */
export function parseProtectedExtra(raw: unknown): { names: string[]; dropped: number } {
  if (!Array.isArray(raw)) return { names: [], dropped: 0 };
  const seen = new Set<string>();
  let dropped = 0;
  for (const item of raw) {
    if (
      typeof item !== "string" ||
      !PROTECTED_NAME.test(item.trim()) ||
      seen.size >= MAX_PROTECTED_EXTRA
    ) {
      dropped += 1;
      continue;
    }
    seen.add(item.trim().toLowerCase());
  }
  return { names: [...seen], dropped };
}
