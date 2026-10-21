// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 75 configuration and the strict validators every target must pass before Phoenix acts on
// it. Everything here is OFF / EMPTY by default: no hosts, no panes, no allowed commands.
// Targets are validated twice: by the capability's config schema (the manager refuses a bad save)
// and again here, because stored config is data, never trusted code.
import { isRecord } from "../guards";

/** tmux pane ids: `%` and 1-6 digits. Nothing else is ever put after `-t`. */
export const PANE_ID = /^%[0-9]{1,6}$/;
/** Phoenix-started agent sessions (Phase 34): `ph-` and 16 hex digits. */
export const SESSION_ID = /^ph-[0-9a-f]{16}$/;
/** macOS Wi-Fi device names (`en0`, `en12`). */
export const WIFI_DEVICE = /^en[0-9]{1,3}$/;
/** A DNS name or IPv4 address, optionally `:port`. No brackets, no paths, no leading dash. */
export const HOST_SPEC = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?(?::[0-9]{1,5})?$/;
/** Process names of agent CLIs the user allows nudging (`claude`, `codex`, ...). */
export const COMMAND_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

export const MAX_HOSTS = 5;
export const MAX_PANES = 16;
export const MAX_SESSIONS = 16;
export const MAX_COMMANDS = 16;
export const MIN_NUDGE_SECONDS = 30;
export const DEFAULT_NUDGE_SECONDS = 90;
export const MAX_NUDGE_SECONDS = 3600;
export const DEFAULT_FAILURES_REQUIRED = 3;
export const DEFAULT_INTERVAL_SECONDS = 15;
export const MAX_SSID_BYTES = 32;
export const DEFAULT_PORT = 443;

// eslint-disable-next-line no-control-regex
const UNSEEN =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/;

/** A Wi-Fi name: 1-32 bytes, no control or invisible characters, not starting with `-`. */
export function isValidSsid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    new TextEncoder().encode(value).length <= MAX_SSID_BYTES &&
    !UNSEEN.test(value) &&
    !value.startsWith("-")
  );
}

export function isPaneId(value: unknown): value is string {
  return typeof value === "string" && PANE_ID.test(value);
}

export function isSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID.test(value);
}

export function isWifiDevice(value: unknown): value is string {
  return typeof value === "string" && WIFI_DEVICE.test(value);
}

export interface ProbeHost {
  host: string;
  port: number;
}

/** "example.org" → port 443; "example.org:8080". Null for anything else. */
export function parseHost(value: unknown): ProbeHost | null {
  if (typeof value !== "string" || value.length > 260 || !HOST_SPEC.test(value)) return null;
  const colon = value.lastIndexOf(":");
  const host = colon === -1 ? value : value.slice(0, colon);
  const port = colon === -1 ? DEFAULT_PORT : Number(value.slice(colon + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port };
}

export interface ContinuityConfig {
  network: {
    enabled: boolean;
    hosts: ProbeHost[];
    failuresRequired: number;
    intervalSeconds: number;
  };
  hotspot: { enabled: boolean; ssid: string | null; allowPasswordArgv: boolean };
  nudge: {
    enabled: boolean;
    afterSeconds: number;
    panes: string[];
    sessions: string[];
    enter: boolean;
    allowedCommands: string[];
  };
  throttle: { enabled: boolean };
  /** List entries that failed validation and were ignored (never used). */
  dropped: number;
}

function section(root: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = root[key];
  return isRecord(value) ? value : {};
}

function intIn(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}

/** Valid, de-duplicated entries up to `max`; the number of rejected entries is counted. */
function entries<T>(
  value: unknown,
  max: number,
  parse: (item: unknown) => T | null,
  key: (item: T) => string,
  counter: { dropped: number },
): T[] {
  if (!Array.isArray(value)) return [];
  const out = new Map<string, T>();
  for (const item of value) {
    const parsed = parse(item);
    if (parsed === null || out.size >= max) {
      counter.dropped += 1;
      continue;
    }
    out.set(key(parsed), parsed);
  }
  return [...out.values()];
}

/** Everything off and empty unless the user switched it on and filled it in. Never throws. */
export function parseContinuityConfig(raw: unknown): ContinuityConfig {
  const root = isRecord(raw) ? raw : {};
  const network = section(root, "network_watch");
  const hotspot = section(root, "hotspot");
  const nudge = section(root, "nudge");
  const throttle = section(root, "throttle_check");
  const counter = { dropped: 0 };
  return {
    network: {
      enabled: network.enabled === true,
      hosts: entries(network.hosts, MAX_HOSTS, parseHost, (h) => `${h.host}:${h.port}`, counter),
      failuresRequired: intIn(network.failures_required, 2, 10, DEFAULT_FAILURES_REQUIRED),
      intervalSeconds: intIn(network.interval_seconds, 5, 300, DEFAULT_INTERVAL_SECONDS),
    },
    hotspot: {
      enabled: hotspot.enabled === true,
      ssid: isValidSsid(hotspot.ssid) ? hotspot.ssid : null,
      allowPasswordArgv: hotspot.allow_password_argv === true,
    },
    nudge: {
      enabled: nudge.enabled === true,
      afterSeconds: intIn(
        nudge.after_seconds,
        MIN_NUDGE_SECONDS,
        MAX_NUDGE_SECONDS,
        DEFAULT_NUDGE_SECONDS,
      ),
      panes: entries(
        nudge.panes,
        MAX_PANES,
        (v) => (isPaneId(v) ? v : null),
        (v) => v,
        counter,
      ),
      sessions: entries(
        nudge.sessions,
        MAX_SESSIONS,
        (v) => (isSessionId(v) ? v : null),
        (v) => v,
        counter,
      ),
      enter: nudge.enter === true,
      allowedCommands: entries(
        nudge.allowed_commands,
        MAX_COMMANDS,
        (v) => (typeof v === "string" && COMMAND_NAME.test(v) ? v : null),
        (v) => v,
        counter,
      ),
    },
    throttle: { enabled: throttle.enabled === true },
    dropped: counter.dropped,
  };
}

/** What a module reports to the activity feed: ids and counts only, never text from outside. */
export type ContinuityEmit = (
  type: string,
  severity: "info" | "warning",
  payload: Record<string, unknown>,
) => void;

/**
 * JSON Schema `properties` for the four opt-in extras (all off by default). The manager validates
 * every config save with them, so a bad pane id or host never reaches storage.
 */
const CONTINUITY_PROPERTIES: Record<string, unknown> = {
  network_watch: {
    type: "object",
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean", default: false },
      hosts: {
        type: "array",
        maxItems: MAX_HOSTS,
        items: { type: "string", pattern: HOST_SPEC.source, maxLength: 260 },
        default: [],
      },
      failures_required: { type: "integer", minimum: 2, maximum: 10 },
      interval_seconds: { type: "integer", minimum: 5, maximum: 300 },
    },
  },
  hotspot: {
    type: "object",
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean", default: false },
      ssid: { type: "string", minLength: 1, maxLength: MAX_SSID_BYTES },
      allow_password_argv: { type: "boolean", default: false },
    },
  },
  nudge: {
    type: "object",
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean", default: false },
      after_seconds: { type: "integer", minimum: MIN_NUDGE_SECONDS, maximum: MAX_NUDGE_SECONDS },
      panes: {
        type: "array",
        maxItems: MAX_PANES,
        items: { type: "string", pattern: PANE_ID.source },
        default: [],
      },
      sessions: {
        type: "array",
        maxItems: MAX_SESSIONS,
        items: { type: "string", pattern: SESSION_ID.source },
        default: [],
      },
      enter: { type: "boolean", default: false },
      allowed_commands: {
        type: "array",
        maxItems: MAX_COMMANDS,
        items: { type: "string", pattern: COMMAND_NAME.source },
        default: [],
      },
    },
  },
  throttle_check: {
    type: "object",
    additionalProperties: false,
    properties: { enabled: { type: "boolean", default: false } },
  },
};

/** The one top-level config key this module adds to the capability's schema. */
export const CONTINUITY_CONFIG: Record<string, unknown> = {
  continuity: {
    type: "object",
    additionalProperties: false,
    description:
      "Agent continuity extras. All four are off by default and separately opt-in: network watch, hotspot failover, tmux nudge, browser throttling check.",
    properties: CONTINUITY_PROPERTIES,
  },
};
