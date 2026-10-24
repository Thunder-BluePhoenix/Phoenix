// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useCapabilities } from "./hooks";

export type PortExposure = "all" | "loopback" | "interface";
export type PortRefusal =
  "self" | "other_user" | "system" | "not_dev_tool" | "unsupported" | "unknown";

export interface PortView {
  pid: number;
  port: number;
  exposure: PortExposure;
  name: string;
  command: string | null;
  uid: number | null;
  start: string | null;
  age_seconds: number | null;
  /** The repository's folder name; Core never sends a path. */
  project: string | null;
  cpu_percent: number | null;
  rss_mb: number | null;
  forgotten: boolean;
  heavy: boolean;
  stoppable: boolean;
  refusal: PortRefusal | null;
  is_core: boolean;
  /** Core says whether a connection to 127.0.0.1 reaches this socket; the link itself is built here. */
  reachable: boolean;
  /**
   * The restart recipe the owner configured for this port (name, argument list as JSON, folder),
   * exactly what the approval will show. Null when there is none: no Restart button is offered.
   */
  restart: RestartOffer | null;
}

export interface RestartOffer {
  recipe: string;
  argv: string;
  cwd: string;
}

export interface PortsThresholds {
  forgottenHours: number;
  heavyCpuPercent: number;
  heavyRssMb: number;
}

export interface PortsSnapshotView {
  platform: "darwin" | "linux" | "win32";
  scanned_at: string;
  process_table: boolean;
  /** Lines of the system's process or port list Core could not parse and left out. */
  parse_warnings: number;
  ports: PortView[];
  thresholds: PortsThresholds;
}

export interface StopResultView {
  pid: number;
  port: number;
  name: string;
  signal: "SIGTERM" | "SIGKILL";
  exited: boolean;
  can_force: boolean;
}

export interface RestartResultView {
  pid: number;
  port: number;
  name: string;
  recipe: string;
  exited: boolean;
  started: boolean;
  new_pid: number | null;
  can_force: boolean;
}

const EXPOSURES: readonly string[] = ["all", "loopback", "interface"];
const REFUSALS: readonly string[] = [
  "self",
  "other_user",
  "system",
  "not_dev_tool",
  "unsupported",
  "unknown",
];

function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" ? Reflect.get(value, key) : undefined;
}
const int = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const nullable = <T>(v: unknown, ok: (x: unknown) => x is T): T | null | undefined =>
  v === null ? null : ok(v) ? v : undefined;
const str = (v: unknown): v is string => typeof v === "string";

/** The offered recipe; null when there is none (or Core sent none), undefined for a shape the screen cannot trust. */
function readRestartOffer(raw: unknown): RestartOffer | null | undefined {
  if (raw === null || raw === undefined) return null;
  const recipe = field(raw, "recipe");
  const argv = field(raw, "argv");
  const cwd = field(raw, "cwd");
  if (!str(recipe) || !str(argv) || !str(cwd)) return undefined;
  return { recipe, argv, cwd };
}

function readPort(raw: unknown): PortView | null {
  const pid = field(raw, "pid");
  const port = field(raw, "port");
  const exposure = field(raw, "exposure");
  const name = field(raw, "name");
  const refusal = field(raw, "refusal");
  const command = nullable(field(raw, "command"), str);
  const uid = nullable(field(raw, "uid"), int);
  const start = nullable(field(raw, "start"), str);
  const age = nullable(field(raw, "age_seconds"), num);
  const project = nullable(field(raw, "project"), str);
  const cpu = nullable(field(raw, "cpu_percent"), num);
  const rss = nullable(field(raw, "rss_mb"), num);
  const url = nullable(field(raw, "url"), str);
  const restart = readRestartOffer(field(raw, "restart"));
  if (
    !int(pid) ||
    !int(port) ||
    port < 1 ||
    port > 65535 ||
    !str(exposure) ||
    !EXPOSURES.includes(exposure) ||
    !str(name) ||
    command === undefined ||
    uid === undefined ||
    start === undefined ||
    age === undefined ||
    project === undefined ||
    cpu === undefined ||
    rss === undefined ||
    url === undefined ||
    restart === undefined ||
    typeof field(raw, "forgotten") !== "boolean" ||
    typeof field(raw, "heavy") !== "boolean" ||
    typeof field(raw, "stoppable") !== "boolean" ||
    typeof field(raw, "is_core") !== "boolean" ||
    !(refusal === null || (str(refusal) && REFUSALS.includes(refusal)))
  ) {
    return null;
  }
  return {
    pid,
    port,
    exposure: exposure as PortExposure,
    name,
    command,
    uid,
    start,
    age_seconds: age,
    project,
    cpu_percent: cpu,
    rss_mb: rss,
    forgotten: field(raw, "forgotten") === true,
    heavy: field(raw, "heavy") === true,
    stoppable: field(raw, "stoppable") === true,
    refusal: refusal as PortRefusal | null,
    is_core: field(raw, "is_core") === true,
    reachable: url !== null,
    restart,
  };
}

/** Core's `list` answer, validated; null for any shape the screen cannot trust. */
export function readPortsSnapshot(raw: unknown): PortsSnapshotView | null {
  const platform = field(raw, "platform");
  const at = field(raw, "scanned_at");
  const ports = field(raw, "ports");
  const thresholds = field(raw, "thresholds");
  const hours = field(thresholds, "forgottenHours");
  const cpu = field(thresholds, "heavyCpuPercent");
  const mb = field(thresholds, "heavyRssMb");
  if (
    (platform !== "darwin" && platform !== "linux" && platform !== "win32") ||
    !str(at) ||
    !Array.isArray(ports) ||
    typeof field(raw, "process_table") !== "boolean" ||
    !num(hours) ||
    !num(cpu) ||
    !num(mb)
  ) {
    return null;
  }
  const rawWarnings = field(raw, "parse_warnings");
  const warnings = num(rawWarnings) && rawWarnings >= 0 ? Math.floor(rawWarnings) : 0;
  const list: PortView[] = [];
  for (const item of ports) {
    const view = readPort(item);
    if (view === null) return null;
    list.push(view);
  }
  return {
    platform,
    scanned_at: at,
    process_table: field(raw, "process_table") === true,
    parse_warnings: warnings,
    ports: list,
    thresholds: { forgottenHours: hours, heavyCpuPercent: cpu, heavyRssMb: mb },
  };
}

export function readStopResult(raw: unknown): StopResultView | null {
  const pid = field(raw, "pid");
  const port = field(raw, "port");
  const name = field(raw, "name");
  const signal = field(raw, "signal");
  if (
    !int(pid) ||
    !int(port) ||
    !str(name) ||
    (signal !== "SIGTERM" && signal !== "SIGKILL") ||
    typeof field(raw, "exited") !== "boolean" ||
    typeof field(raw, "can_force") !== "boolean"
  ) {
    return null;
  }
  return {
    pid,
    port,
    name,
    signal,
    exited: field(raw, "exited") === true,
    can_force: field(raw, "can_force") === true,
  };
}

export function readRestartResult(raw: unknown): RestartResultView | null {
  const pid = field(raw, "pid");
  const port = field(raw, "port");
  const name = field(raw, "name");
  const recipe = field(raw, "recipe");
  const newPid = nullable(field(raw, "new_pid"), int);
  if (
    !int(pid) ||
    !int(port) ||
    !str(name) ||
    !str(recipe) ||
    newPid === undefined ||
    typeof field(raw, "exited") !== "boolean" ||
    typeof field(raw, "started") !== "boolean" ||
    typeof field(raw, "can_force") !== "boolean"
  ) {
    return null;
  }
  return {
    pid,
    port,
    name,
    recipe,
    exited: field(raw, "exited") === true,
    started: field(raw, "started") === true,
    new_pid: newPid,
    can_force: field(raw, "can_force") === true,
  };
}

/**
 * The page to open for a listening port. Built here from the port NUMBER only, always the literal
 * loopback address and http: nothing Core, a process name or a project name says can change where
 * the link points. Null when the port is not a valid port or 127.0.0.1 does not reach the socket.
 */
export function localhostUrl(port: number, reachable: boolean): string | null {
  if (!reachable || !Number.isSafeInteger(port) || port < 1 || port > 65535) return null;
  return `http://127.0.0.1:${port}/`;
}

export type AgeUnit = { unit: "minutes" | "hours" | "days"; count: number } | null;

/** A process age as a whole number of the largest fitting unit; null when unknown. */
export function ageParts(seconds: number | null): AgeUnit {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds >= 86_400) return { unit: "days", count: Math.floor(seconds / 86_400) };
  if (seconds >= 3600) return { unit: "hours", count: Math.floor(seconds / 3600) };
  return { unit: "minutes", count: Math.floor(seconds / 60) };
}

export type PortsAvailability = "absent" | "disabled" | "ready";

/** Whether the ports capability exists and is enabled; the scan itself is only ever on request. */
export function usePortsAvailability(): {
  availability: PortsAvailability;
  watching: boolean;
  config: Record<string, unknown>;
} {
  const { data: caps } = useCapabilities();
  const cap = caps.find((c) => c.id === "ports");
  return {
    availability: cap === undefined ? "absent" : cap.status === "enabled" ? "ready" : "disabled",
    watching: cap?.config?.watch === true,
    config: cap?.config ?? {},
  };
}
