// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What may be stopped, and what the radar flags. Pure functions over the process table; nothing
// here reads the machine or signals anything.
//
// A process may be stopped only if EVERY rule below passes (a refusal names the first that fails):
//   1. not Phoenix itself: not Core's pid, its parent, any ancestor, any DESCENDANT of Core (a
//      process Core started), or anything in Core's process group (a group member killed by a
//      signal to the group could take Core with it);
//   2. never pid <= 1;
//   3. the same user id as Core, and Core is not root (uid 0);
//   4. not on the protected list: login, window and init processes, ssh and system daemons, the
//      container and model runtimes (ollama, colima, limactl, dockerd, com.docker.*) and every
//      executable whose name starts with `phoenix`;
//   5. not under /System, /usr/libexec, /usr/sbin, /sbin, /Library/Apple, unless it is one of the
//      dev interpreters below (macOS ships python and ruby under /System and /usr);
//   6. a dev tool: the executable is under the user's home, /opt/homebrew or /usr/local, or it is
//      node, python, ruby, deno, bun, java or go. Anything else (Safari, an Apple daemon, a
//      /usr/bin tool) is "not a dev tool" and is refused.
// On Linux `ps` gives the executable's NAME only (no path), so only rule 6's interpreter names can
// pass there; that is stricter, never looser.
import type { ProcRow, StopRefusal } from "./types";

export const PROTECTED_NAMES: ReadonlySet<string> = new Set([
  "launchd",
  "kernel_task",
  "init",
  "systemd",
  "loginwindow",
  "windowserver",
  "finder",
  "dock",
  "systemuiserver",
  "coreservicesd",
  "launchservicesd",
  "securityd",
  "trustd",
  "sshd",
  "ssh-agent",
  "cron",
  "crond",
  "dbus-daemon",
  "gnome-shell",
  "xorg",
  "pipewire",
  "pulseaudio",
  "explorer.exe",
  "svchost.exe",
  "csrss.exe",
  "winlogon.exe",
  "lsass.exe",
  "services.exe",
  "system",
  // Local runtimes the user's containers and models live in: stopping one loses work.
  "ollama",
  "colima",
  "limactl",
  "dockerd",
]);

/**
 * Protected by the START of the (lower-cased) executable name: Docker Desktop's helpers
 * (`com.docker.backend`, `com.docker.vmnetd`...) and every Phoenix process (`phoenix-core`,
 * `phoenix-desktop`...), which must never be stopped from inside Phoenix.
 */
export const PROTECTED_PREFIXES: readonly string[] = ["com.docker.", "phoenix"];

export const SYSTEM_PREFIXES: readonly string[] = [
  "/System/",
  "/usr/libexec/",
  "/usr/sbin/",
  "/sbin/",
  "/Library/Apple/",
];

export const DEV_ROOTS: readonly string[] = ["/opt/homebrew/", "/usr/local/"];

const INTERPRETER = /^(?:node|nodejs|python(?:\d+(?:\.\d+)*)?|ruby|deno|bun|java|go)$/;

export function baseName(command: string): string {
  const slash = command.lastIndexOf("/");
  return slash >= 0 ? command.slice(slash + 1) : command;
}

export function isInterpreter(command: string): boolean {
  return INTERPRETER.test(baseName(command).toLowerCase());
}

function underHome(path: string, home: string): boolean {
  if (!home.startsWith("/") || home === "/") return false;
  const root = home.endsWith("/") ? home : `${home}/`;
  return path.startsWith(root);
}

export interface StopContext {
  platform: "darwin" | "linux" | "win32";
  /** Core's own uid; -1 when unknown. */
  uid: number;
  pid: number;
  ppid: number;
  home: string;
  /** The process table read for this decision. */
  table: ReadonlyMap<number, ProcRow>;
}

function ancestorsOf(pid: number, table: ReadonlyMap<number, ProcRow>): Set<number> {
  const out = new Set<number>();
  let next = table.get(pid)?.ppid;
  while (next !== undefined && next > 0 && !out.has(next)) {
    out.add(next);
    next = table.get(next)?.ppid;
  }
  return out;
}

/** The first rule that forbids stopping `row`, or undefined when it may be stopped. */
export function stopRefusal(row: ProcRow, ctx: StopContext): StopRefusal | undefined {
  if (ctx.platform === "win32" || ctx.uid < 0) return "unsupported";
  if (!Number.isSafeInteger(row.pid) || row.pid <= 1) return "system";
  const core = ctx.table.get(ctx.pid);
  // Without Core's own row its process group is unknown: refuse rather than guess.
  if (core === undefined) return "unknown";
  if (
    row.pid === ctx.pid ||
    row.pid === ctx.ppid ||
    row.pgid === core.pgid ||
    ancestorsOf(ctx.pid, ctx.table).has(row.pid) ||
    // Core's own children (a helper Core started) go down with their parent's work: never ours to stop.
    ancestorsOf(row.pid, ctx.table).has(ctx.pid)
  ) {
    return "self";
  }
  if (ctx.uid === 0) return "system";
  if (row.uid !== ctx.uid) return "other_user";
  const name = baseName(row.command).toLowerCase();
  if (PROTECTED_NAMES.has(name) || PROTECTED_PREFIXES.some((p) => name.startsWith(p))) {
    return "system";
  }
  const interpreter = isInterpreter(row.command);
  if (SYSTEM_PREFIXES.some((p) => row.command.startsWith(p)) && !interpreter) return "system";
  if (interpreter) return undefined;
  if (row.command.split("/").includes("..")) return "not_dev_tool";
  if (underHome(row.command, ctx.home) || DEV_ROOTS.some((r) => row.command.startsWith(r))) {
    return undefined;
  }
  return "not_dev_tool";
}

export interface Thresholds {
  forgottenHours: number;
  heavyCpuPercent: number;
  heavyRssMb: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  forgottenHours: 8,
  heavyCpuPercent: 80,
  heavyRssMb: 1024,
};

/**
 * Forgotten server: a listening process that has run longer than `forgottenHours`, sits in a
 * project folder, and may be stopped (so never a system process, someone else's process or Phoenix
 * itself). Phoenix cannot cheaply see whether traffic still reaches the port, so age and project
 * are the whole definition; it says so in the UI and docs.
 */
export function isForgotten(
  ageSeconds: number | null,
  hasProject: boolean,
  refusal: StopRefusal | undefined,
  t: Thresholds,
): boolean {
  return (
    refusal === undefined &&
    hasProject &&
    ageSeconds !== null &&
    ageSeconds > t.forgottenHours * 3600
  );
}

/**
 * Heavy: `ps` CPU percent or resident memory at or above the thresholds. `pcpu` is an average (over
 * the process's life on Linux, a decaying average on macOS), so a spike that just ended can still
 * show and a brief burst can be missed. Applies to any listed process, stoppable or not.
 */
export function isHeavy(cpu: number | null, rssMb: number | null, t: Thresholds): boolean {
  return (cpu !== null && cpu >= t.heavyCpuPercent) || (rssMb !== null && rssMb >= t.heavyRssMb);
}
