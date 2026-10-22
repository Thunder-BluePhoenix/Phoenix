// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Reading the machine: listening TCP sockets, the process table and working directories. Every
// read is a command through the injected Runner with an absolute path and an argv array (no shell).
// Nothing here writes anything or signals anything.
import {
  PS_COLUMNS,
  parseLsofCwd,
  parseLsofListeners,
  parseNetstat,
  parsePsLine,
  parsePsTable,
  type PsParse,
  parseSs,
  parseTasklist,
} from "./parse";
import {
  PortsError,
  type Collector,
  type PortsEnv,
  type ProcRow,
  type RawListener,
  type Runner,
  type RunResult,
} from "./types";

const READ_TIMEOUT_MS = 8_000;
const MAX_CWD_PIDS = 400;
const CWD_CHUNK = 100;

export const LSOF_MACOS = "/usr/sbin/lsof";
export const LSOF_LINUX = "/usr/bin/lsof";
export const SS_PATHS: readonly string[] = ["/usr/bin/ss", "/usr/sbin/ss", "/sbin/ss"];
const ENV = "/usr/bin/env";
const PS = "/bin/ps";
const DEFAULT_SYSTEM_ROOT = "C:\\Windows";

/**
 * `ps` prints `lstart` in the local zone, so a zone or DST change between the time the user saw a
 * process and the time it is signalled would make the same process look different. Reading it with
 * a fixed zone and locale makes the start time a stable half of the process's identity.
 */
export const PS_ARGV: readonly string[] = ["TZ=UTC", "LC_ALL=C", PS, "-axo", PS_COLUMNS];
/** The same columns for one pid: append the pid after `-p`. */
export const PS_ONE_ARGV: readonly string[] = ["TZ=UTC", "LC_ALL=C", PS, "-o", PS_COLUMNS, "-p"];

export const LSOF_LISTEN_ARGV: readonly string[] = ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcnL"];
export const SS_ARGV: readonly string[] = ["-ltnpH"];
export const NETSTAT_ARGV: readonly string[] = ["-ano", "-p", "TCP"];
export const TASKLIST_ARGV: readonly string[] = ["/FO", "CSV", "/NH"];

/** `%SystemRoot%\System32\<exe>`; the environment value is used only if it looks like a plain Windows path. */
export function windowsTool(env: PortsEnv, exe: string): string {
  const root = env.vars.SystemRoot;
  const safe =
    root !== undefined && /^[A-Za-z]:\\[A-Za-z0-9 _.\\-]{1,64}$/.test(root) && !root.includes("..");
  return `${safe ? root.replace(/\\+$/, "") : DEFAULT_SYSTEM_ROOT}\\System32\\${exe}`;
}

/** lsof exits 1 when it lists nothing; that is an empty answer, not a failure (stderr is empty). */
function lsofReadable(result: RunResult): boolean {
  return result.code === 0 || (result.code === 1 && result.stderr.trim() === "");
}

export interface Collected {
  collector: Collector;
  listeners: RawListener[];
  /** Lines the collector printed that did not parse completely and were dropped. */
  warnings: number;
}

/** Listening TCP sockets with their owning pid and the process name the tool reports. */
export async function collectListeners(env: PortsEnv): Promise<Collected> {
  if (env.platform === "win32") {
    const netstat = await env.run(windowsTool(env, "netstat.exe"), NETSTAT_ARGV, {
      timeoutMs: READ_TIMEOUT_MS,
    });
    if (netstat.code !== 0) throw new PortsError("unavailable", "netstat could not be read");
    const tasks = await env.run(windowsTool(env, "tasklist.exe"), TASKLIST_ARGV, {
      timeoutMs: READ_TIMEOUT_MS,
    });
    const names = tasks.code === 0 ? parseTasklist(tasks.stdout) : new Map<number, string>();
    return {
      collector: "netstat",
      listeners: parseNetstat(netstat.stdout).map((l) => ({ ...l, name: names.get(l.pid) ?? "" })),
      warnings: 0,
    };
  }
  const lsof = await env.run(
    env.platform === "darwin" ? LSOF_MACOS : LSOF_LINUX,
    LSOF_LISTEN_ARGV,
    {
      timeoutMs: READ_TIMEOUT_MS,
    },
  );
  if (lsofReadable(lsof)) {
    return { collector: "lsof", listeners: parseLsofListeners(lsof.stdout), warnings: 0 };
  }
  if (env.platform === "linux") {
    for (const path of SS_PATHS) {
      const ss = await env.run(path, SS_ARGV, { timeoutMs: READ_TIMEOUT_MS });
      if (ss.code === 0) {
        const parsed = parseSs(ss.stdout);
        return { collector: "ss", listeners: parsed.listeners, warnings: parsed.warnings };
      }
    }
  }
  throw new PortsError("unavailable", "The listening ports could not be read");
}

/**
 * The whole process table, strictly parsed (see `parsePsTable`). Throws when `ps` cannot run, so
 * nothing is ever signalled blind. `warnings` counts dropped lines and dropped duplicate pids.
 */
export async function readProcessTable(run: Runner): Promise<PsParse> {
  const result = await run(ENV, PS_ARGV, { timeoutMs: READ_TIMEOUT_MS });
  if (result.code !== 0) throw new PortsError("unavailable", "The process list could not be read");
  return parsePsTable(result.stdout);
}

export interface OneProcess {
  /** The process, when `ps -p` printed exactly one line and it parsed completely. */
  row: ProcRow | undefined;
  /** True when `ps` answered something other than "that one row" or "no such process". */
  ambiguous: boolean;
}

/**
 * Just ONE process: `ps -p <pid>`. The answer must be exactly one line that parses completely and
 * names that pid; no output at all (exit 1) is "gone". Anything else (a process name with a line
 * break prints more than one line) is `ambiguous` and the caller must refuse, not guess.
 */
export async function readOneProcess(run: Runner, pid: number): Promise<OneProcess> {
  const result = await run(ENV, [...PS_ONE_ARGV, String(pid)], { timeoutMs: READ_TIMEOUT_MS });
  const lines = result.stdout.split("\n").filter((l) => l.trim() !== "");
  if (result.code === 1 && lines.length === 0) return { row: undefined, ambiguous: false };
  if (result.code !== 0) throw new PortsError("unavailable", "The process could not be read");
  const row = lines.length === 1 ? parsePsLine(lines[0] ?? "") : undefined;
  if (row === undefined || row.pid !== pid) return { row: undefined, ambiguous: true };
  return { row, ambiguous: false };
}

/** pid -> working directory for the given pids (lsof, read-only). Unknown pids are simply absent. */
export async function readCwds(
  env: PortsEnv,
  pids: readonly number[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (env.platform === "win32") return out;
  const unique = [...new Set(pids)]
    .filter((p) => Number.isSafeInteger(p) && p > 0)
    .slice(0, MAX_CWD_PIDS);
  const file = env.platform === "darwin" ? LSOF_MACOS : LSOF_LINUX;
  for (let i = 0; i < unique.length; i += CWD_CHUNK) {
    const chunk = unique.slice(i, i + CWD_CHUNK);
    const result = await env.run(file, ["-a", "-d", "cwd", "-Fpn", "-p", chunk.join(",")], {
      timeoutMs: READ_TIMEOUT_MS,
    });
    if (!lsofReadable(result)) continue;
    for (const [pid, cwd] of parseLsofCwd(result.stdout)) out.set(pid, cwd);
  }
  return out;
}
