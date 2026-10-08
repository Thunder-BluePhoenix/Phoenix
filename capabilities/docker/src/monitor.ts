// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Pure parts of the Docker capability: turn the Engine's JSON into small snapshots and diff two
// snapshots into docker.* events. Everything here treats the Engine's reply as hostile input, and
// only these fields ever leave it: container id (12 chars), name, image, state, health, exit code,
// and two Compose labels. Environment variables, mounts, command lines, ports and every other
// label are never read, so they cannot end up in an event.
import { redact } from "@phoenix/logging";
import type { CapabilityContext } from "@phoenix/sdk";
import { isRecord } from "./guards";

export type DockerEvent = Parameters<CapabilityContext["emit"]>[0];

export type Health = "healthy" | "unhealthy" | "starting";

export interface ContainerSnapshot {
  /** First 12 hex characters of the container id (what `docker ps` shows). */
  id: string;
  /** Full id, only used to inspect; never emitted. */
  fullId: string;
  name: string;
  image: string;
  /** created | running | paused | restarting | removing | exited | dead (as the Engine reports). */
  state: string;
  health: Health | null;
  /** Exit code if the Status text carries one ("Exited (1) 3 seconds ago"). */
  exitCode: number | null;
  composeProject?: string;
  composeService?: string;
}

/** What `GET /containers/<id>/json` adds for a container that just stopped. */
export interface ExitDetails {
  exitCode: number;
  oomKilled: boolean;
}

/** More containers than this in one reply are ignored: a hostile or broken reply must stay bounded. */
export const MAX_CONTAINERS = 500;
/** More events than this from one poll are dropped (a mass restart should not flood the bus). */
export const MAX_EVENTS_PER_POLL = 100;

const ACTIVE: Readonly<Record<string, true>> = { running: true, paused: true, restarting: true };
/** Exit codes `docker stop` / `docker kill` / a user's Ctrl-C produce: SIGKILL and SIGTERM. */
const SIGNAL_EXITS: Readonly<Record<number, true>> = { 137: true, 143: true };


/** Printable, bounded text from an untrusted value, with credentials redacted. */
function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!clean) return undefined;
  const safe = redact(clean) as string;
  return safe.length > max ? safe.slice(0, max - 1) + "…" : safe;
}

/** Image references can carry `user:password@registry/…`; keep only what follows the `@`-less part. */
function imageName(value: unknown): string {
  const raw = text(value, 400)?.replace(/^[^/@\s]*:[^/@\s]*@/, "");
  return raw && raw.length > 200 ? raw.slice(0, 199) + "…" : (raw ?? "unknown");
}

const HEALTH = /\((healthy|unhealthy|health: starting)\)/;
const EXIT = /^(?:Exited|Restarting) \((-?\d{1,5})\)/;

/** Parses `GET /containers/json?all=true`. Entries that are not well-formed are skipped. */
export function parseContainerList(raw: unknown): ContainerSnapshot[] {
  if (!Array.isArray(raw)) throw new Error("Docker returned a container list in an unexpected format");
  const out: ContainerSnapshot[] = [];
  for (const item of raw.slice(0, MAX_CONTAINERS) as unknown[]) {
    if (!isRecord(item)) continue;
    const fullId = item.Id;
    if (typeof fullId !== "string" || !/^[0-9a-f]{12,64}$/.test(fullId)) continue;
    const id = fullId.slice(0, 12);
    const names = Array.isArray(item.Names) ? (item.Names as unknown[]) : [];
    const name = text(names.find((n) => typeof n === "string"), 100)?.replace(/^\//, "") || id;
    const status = typeof item.Status === "string" ? item.Status : "";
    const healthText = HEALTH.exec(status)?.[1];
    const exit = EXIT.exec(status)?.[1];
    const labels = isRecord(item.Labels) ? item.Labels : {};
    const project = text(labels["com.docker.compose.project"], 80);
    const service = text(labels["com.docker.compose.service"], 80);
    out.push({
      id,
      fullId,
      name,
      image: imageName(item.Image),
      state: text(item.State, 20)?.toLowerCase() ?? "unknown",
      health:
        healthText === "healthy" || healthText === "unhealthy"
          ? healthText
          : healthText
            ? "starting"
            : null,
      exitCode: exit === undefined ? null : Number(exit),
      ...(project ? { composeProject: project } : {}),
      ...(service ? { composeService: service } : {}),
    });
  }
  return out;
}

/** Reads only State.ExitCode and State.OOMKilled from an inspect reply. */
export function parseExitDetails(raw: unknown): ExitDetails | null {
  if (!isRecord(raw) || !isRecord(raw.State)) return null;
  const code = raw.State.ExitCode;
  if (typeof code !== "number" || !Number.isInteger(code)) return null;
  return { exitCode: code, oomKilled: raw.State.OOMKilled === true };
}

export function byId(list: readonly ContainerSnapshot[]): Record<string, ContainerSnapshot> {
  const out: Record<string, ContainerSnapshot> = {};
  for (const c of list) out[c.id] = c;
  return out;
}

/** Containers that were up last poll and are not now: worth an inspect to learn why. */
export function needsExitDetails(
  prev: Record<string, ContainerSnapshot>,
  next: Record<string, ContainerSnapshot>,
): ContainerSnapshot[] {
  return Object.values(next).filter((c) => {
    const p = prev[c.id];
    return p !== undefined && exited(p, c);
  });
}

/** Up (or paused) → stopped, or a running container that started restarting after a crash. */
function exited(p: ContainerSnapshot, c: ContainerSnapshot): boolean {
  if (!ACTIVE[p.state]) return false;
  return !ACTIVE[c.state] || (c.state === "restarting" && p.state !== "restarting");
}

function base(c: ContainerSnapshot): Record<string, unknown> {
  return {
    container_id: c.id,
    name: c.name,
    image: c.image,
    ...(c.composeProject ? { compose_project: c.composeProject } : {}),
    ...(c.composeService ? { compose_service: c.composeService } : {}),
  };
}

/** One stable key per container, so a container's states replace each other in Fawkes. */
function event(
  type: string,
  c: ContainerSnapshot,
  severity: DockerEvent["severity"],
  extra: Record<string, unknown> = {},
): DockerEvent {
  return {
    event_type: type,
    severity,
    subject: c.name,
    correlation_id: `docker-${c.id}`,
    payload: { ...base(c), ...extra },
  };
}

/**
 * A container that stopped: a clean exit, or one that `docker stop` / `docker kill` / Ctrl-C
 * caused (SIGTERM 143, SIGKILL 137 without an out-of-memory kill), is "stopped". Anything else is
 * "died". An unknown exit code is never turned into an alarm.
 */
export function exitEvent(c: ContainerSnapshot, details: ExitDetails | undefined): DockerEvent {
  const code = details?.exitCode ?? c.exitCode;
  const oom = details?.oomKilled === true;
  if (code === null || code === 0 || (SIGNAL_EXITS[code] === true && !oom)) {
    return event("docker.container.stopped", c, "info", code === null ? {} : { exit_code: code });
  }
  return event("docker.container.died", c, "error", { exit_code: code, oom_killed: oom });
}

/**
 * Events for the change from `prev` to `next`. `prev` undefined is the first look: there is no
 * history to replay, so only containers that are unhealthy right now are reported.
 */
export function diffContainers(
  prev: Record<string, ContainerSnapshot> | undefined,
  next: Record<string, ContainerSnapshot>,
  exits: Record<string, ExitDetails>,
): DockerEvent[] {
  const events: DockerEvent[] = [];
  for (const c of Object.values(next)) {
    const p = prev?.[c.id];
    if (prev === undefined) {
      if (c.state === "running" && c.health === "unhealthy") {
        events.push(event("docker.container.unhealthy", c, "warning"));
      }
      continue;
    }
    if (c.state === "running" && p?.state !== "running" && p?.state !== "paused") {
      events.push(event("docker.container.started", c, "info"));
    } else if (p && exited(p, c)) {
      events.push(exitEvent(c, exits[c.id]));
    }
    if (c.state === "running" && c.health === "unhealthy" && p?.health !== "unhealthy") {
      events.push(event("docker.container.unhealthy", c, "warning"));
    } else if (p?.health === "unhealthy" && c.state === "running" && c.health !== "unhealthy") {
      // A restart resets health to "starting"; either way the warning is over.
      events.push(
        event(c.health === "healthy" ? "docker.container.healthy" : "docker.container.started", c, "info"),
      );
    }
  }
  for (const p of Object.values(prev ?? {})) {
    if (next[p.id]) continue;
    events.push(
      ACTIVE[p.state]
        ? event("docker.container.stopped", p, "info", { removed: true })
        : event("docker.container.removed", p, "info"),
    );
  }
  return events.slice(0, MAX_EVENTS_PER_POLL);
}

/** Row for the `containers` command. */
export function summarise(c: ContainerSnapshot): Record<string, unknown> {
  return {
    ...base(c),
    state: c.state,
    health: c.health,
    exit_code: c.exitCode,
  };
}
