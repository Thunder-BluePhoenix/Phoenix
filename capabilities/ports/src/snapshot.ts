// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Builds what the radar shows: every listening TCP port with its process, project folder name,
// age, flags and whether Phoenix would let the user stop it. Read-only.
import { collectListeners, readCwds, readProcessTable } from "./collect";
import {
  cleanText,
  isWildcard,
  loopbackOnly,
  reachableOnIpv4Loopback,
  type PsParse,
} from "./parse";
import { baseName, isForgotten, isHeavy, stopRefusal, type Thresholds } from "./policy";
import { findProject } from "./project";
import { renderArgv, type RecipeTable } from "./recipes";
import type { Collector, PortsEnv, StopRefusal } from "./types";

/** Which interfaces a port accepts connections from. */
export type Exposure = "all" | "loopback" | "interface";

export interface PortEntry {
  pid: number;
  port: number;
  exposure: Exposure;
  /** Display name: the executable's file name (from `ps`), else the collector's name. */
  name: string;
  /** The executable as `ps` reports it (a full path on macOS): half of the stop proof. */
  command: string | null;
  uid: number | null;
  /** `lstart` in UTC: the other half of the stop proof. Null when `ps` could not be read. */
  start: string | null;
  /** Seconds since the process started; null on Windows or when unreadable. */
  age_seconds: number | null;
  /** Repository folder name only, never a path; null when there is no project. */
  project: string | null;
  cpu_percent: number | null;
  rss_mb: number | null;
  forgotten: boolean;
  heavy: boolean;
  /** True when every stop rule passes right now (the stop re-checks everything again). */
  stoppable: boolean;
  /** Why it cannot be stopped; null when it can. */
  refusal: StopRefusal | null;
  /** True for Core itself. */
  is_core: boolean;
  /** `http://127.0.0.1:<port>/` when a connection to 127.0.0.1 reaches this socket, else null. */
  url: string | null;
  /**
   * The owner's restart recipe declared for this port, and only when this process may be stopped:
   * the name, the argv (JSON) and the folder exactly as the approval prompt will show them. Never
   * derived from the process itself.
   */
  restart: { recipe: string; argv: string; cwd: string } | null;
}

export interface PortsSnapshot {
  platform: PortsEnv["platform"];
  collector: Collector;
  scanned_at: string;
  /** False when the process table could not be read: ages, flags and stopping are unavailable. */
  process_table: boolean;
  /**
   * Lines of `ps`/`ss` output that did not parse completely (or pids claimed twice) and were
   * dropped. Non-zero means some listed processes may be missing details or hidden: the output
   * contained something unexpected, such as a process name with a line break.
   */
  parse_warnings: number;
  ports: PortEntry[];
  thresholds: Thresholds;
}

interface Merged {
  pid: number;
  port: number;
  name: string;
  addresses: Set<string>;
}

function exposureOf(addresses: ReadonlySet<string>): Exposure {
  if ([...addresses].some(isWildcard)) return "all";
  return [...addresses].every(loopbackOnly) ? "loopback" : "interface";
}

export const MAX_PORTS = 500;

/** The process table for the pids in play, plus Core's own row. Never throws: it answers undefined. */
async function tableOrUndefined(env: PortsEnv): Promise<PsParse | undefined> {
  if (env.platform === "win32") return undefined;
  try {
    return await readProcessTable(env.run);
  } catch {
    return undefined;
  }
}

/** The recipe the owner declared for `port`, if any. The port is the only link between a process and a recipe. */
function restartOffer(recipes: RecipeTable, port: number): PortEntry["restart"] {
  for (const [name, recipe] of Object.entries(recipes)) {
    if (recipe.ports.includes(port))
      return { recipe: name, argv: renderArgv(recipe.argv), cwd: recipe.cwd };
  }
  return null;
}

export async function buildSnapshot(
  env: PortsEnv,
  thresholds: Thresholds,
  recipes: RecipeTable = {},
): Promise<PortsSnapshot> {
  const collected = await collectListeners(env);
  const { collector, listeners } = collected;
  const merged = new Map<string, Merged>();
  for (const l of listeners) {
    const key = `${l.pid}:${l.port}`;
    const have = merged.get(key);
    if (have) have.addresses.add(l.address);
    else
      merged.set(key, { pid: l.pid, port: l.port, name: l.name, addresses: new Set([l.address]) });
  }
  const processes = await tableOrUndefined(env);
  const rows = processes?.rows;
  const warnings = collected.warnings + (processes?.warnings ?? 0);
  const table = new Map((rows ?? []).map((r) => [r.pid, r]));
  const cwds = await readCwds(
    env,
    [...merged.values()].map((m) => m.pid),
  );
  const now = env.now();
  const entries: PortEntry[] = [];
  for (const m of [...merged.values()].sort((a, b) => a.port - b.port || a.pid - b.pid)) {
    const row = table.get(m.pid);
    const project = await findProject(cwds.get(m.pid), env.home, env.fs);
    const age =
      row === undefined
        ? null
        : (row.etimeSeconds ??
          (row.startMs === null ? null : Math.max(0, Math.floor((now - row.startMs) / 1000))));
    const refusal =
      row === undefined
        ? env.platform === "win32"
          ? ("unsupported" as const)
          : ("unknown" as const)
        : stopRefusal(row, {
            platform: env.platform,
            uid: env.uid,
            pid: env.pid,
            ppid: env.ppid,
            home: env.home,
            table,
          });
    const rssMb = row === undefined ? null : Math.round(row.rssKb / 1024);
    const reachable = [...m.addresses].some(reachableOnIpv4Loopback);
    entries.push({
      pid: m.pid,
      port: m.port,
      exposure: exposureOf(m.addresses),
      name: cleanText(row ? baseName(row.command) : m.name),
      command: row?.command ?? null,
      uid: row?.uid ?? null,
      start: row?.start ?? null,
      age_seconds: age,
      project: project === undefined ? null : cleanText(project.name) || null,
      cpu_percent: row?.cpu ?? null,
      rss_mb: rssMb,
      forgotten: isForgotten(age, project !== undefined, refusal, thresholds),
      heavy: isHeavy(row?.cpu ?? null, rssMb, thresholds),
      stoppable: refusal === undefined,
      refusal: refusal ?? null,
      is_core: m.pid === env.pid,
      url: reachable ? `http://127.0.0.1:${m.port}/` : null,
      restart: refusal === undefined ? restartOffer(recipes, m.port) : null,
    });
    if (entries.length >= MAX_PORTS) break;
  }
  return {
    platform: env.platform,
    collector,
    scanned_at: new Date(now).toISOString(),
    process_table: rows !== undefined,
    parse_warnings: warnings,
    ports: entries,
    thresholds,
  };
}
