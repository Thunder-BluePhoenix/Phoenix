// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Agent continuity (Phase 75), web side: reads and writes the `continuity` key of the Keep awake
// capability's config, validates list entries the same way the capability does (the capability
// validates again; this only saves the user a round trip), and reads the capability's status
// answers defensively. Nothing here sends anything by itself.
import type { MessageKey } from "../i18n";

// Mirrors capabilities/awake/src/continuity/config.ts.
export const PANE_ID = /^%[0-9]{1,6}$/;
export const SESSION_ID = /^ph-[0-9a-f]{16}$/;
export const HOST_SPEC = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?(?::[0-9]{1,5})?$/;
export const COMMAND_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
export const MAX_HOSTS = 5;
export const MAX_PANES = 16;
export const MAX_SESSIONS = 16;
export const MAX_COMMANDS = 16;
export const MIN_NUDGE_SECONDS = 30;
export const MAX_NUDGE_SECONDS = 3600;
export const DEFAULT_NUDGE_SECONDS = 90;
export const MAX_SSID_BYTES = 32;

export type ListKind = "hosts" | "panes" | "sessions" | "commands";

interface ListRule {
  max: number;
  valid: (value: string) => boolean;
  invalid: MessageKey;
}

export const LIST_RULES: Readonly<Record<ListKind, ListRule>> = {
  hosts: {
    max: MAX_HOSTS,
    valid: (v) => v.length <= 260 && HOST_SPEC.test(v) && validPort(v),
    invalid: "power.continuity.invalid.host",
  },
  panes: {
    max: MAX_PANES,
    valid: (v) => PANE_ID.test(v),
    invalid: "power.continuity.invalid.pane",
  },
  sessions: {
    max: MAX_SESSIONS,
    valid: (v) => SESSION_ID.test(v),
    invalid: "power.continuity.invalid.session",
  },
  commands: {
    max: MAX_COMMANDS,
    valid: (v) => COMMAND_NAME.test(v),
    invalid: "power.continuity.invalid.command",
  },
};

function validPort(spec: string): boolean {
  const colon = spec.lastIndexOf(":");
  if (colon === -1) return true;
  const port = Number(spec.slice(colon + 1));
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

export type ListProblem = "invalid" | "duplicate" | "full";

/** The entry as it would be stored, or why it is refused. Whitespace around it is ignored. */
export function checkEntry(
  kind: ListKind,
  text: string,
  current: readonly string[],
): { ok: true; value: string } | { ok: false; problem: ListProblem } {
  const value = text.trim();
  const rule = LIST_RULES[kind];
  if (!rule.valid(value)) return { ok: false, problem: "invalid" };
  if (current.includes(value)) return { ok: false, problem: "duplicate" };
  if (current.length >= rule.max) return { ok: false, problem: "full" };
  return { ok: true, value };
}

/** A Wi-Fi name: 1-32 bytes, no control or invisible characters, not starting with "-". */
export function validSsid(value: string): boolean {
  return (
    value.length > 0 &&
    new TextEncoder().encode(value).length <= MAX_SSID_BYTES &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/.test(
      value,
    ) &&
    !value.startsWith("-")
  );
}

/** Whole seconds in range, from the text field; null otherwise. */
export function parseSeconds(text: string): number | null {
  if (!/^\d{1,5}$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= MIN_NUDGE_SECONDS && n <= MAX_NUDGE_SECONDS ? n : null;
}

/** What the form edits. Everything is off and empty by default. */
export interface ContinuityDraft {
  networkOn: boolean;
  hosts: string[];
  hotspotOn: boolean;
  ssid: string;
  allowPasswordArgv: boolean;
  nudgeOn: boolean;
  afterSeconds: string;
  panes: string[];
  sessions: string[];
  commands: string[];
  enter: boolean;
  throttleOn: boolean;
}

function obj(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

/** The saved config as a draft. Anything unreadable falls back to off / empty. */
export function draftFromConfig(config: Record<string, unknown> | undefined): ContinuityDraft {
  const root = obj(config?.continuity);
  const network = obj(root.network_watch);
  const hotspot = obj(root.hotspot);
  const nudge = obj(root.nudge);
  const throttle = obj(root.throttle_check);
  return {
    networkOn: network.enabled === true,
    hosts: strings(network.hosts),
    hotspotOn: hotspot.enabled === true,
    ssid: typeof hotspot.ssid === "string" ? hotspot.ssid : "",
    allowPasswordArgv: hotspot.allow_password_argv === true,
    nudgeOn: nudge.enabled === true,
    afterSeconds: String(
      typeof nudge.after_seconds === "number" ? nudge.after_seconds : DEFAULT_NUDGE_SECONDS,
    ),
    panes: strings(nudge.panes),
    sessions: strings(nudge.sessions),
    commands: strings(nudge.allowed_commands),
    enter: nudge.enter === true,
    throttleOn: throttle.enabled === true,
  };
}

export type DraftProblem = "ssid" | "seconds";

/** Why the draft cannot be saved, if it cannot. */
export function draftProblems(draft: ContinuityDraft): DraftProblem[] {
  const problems: DraftProblem[] = [];
  if (draft.ssid.trim() !== "" && !validSsid(draft.ssid.trim())) problems.push("ssid");
  if (parseSeconds(draft.afterSeconds) === null) problems.push("seconds");
  return problems;
}

/**
 * The whole capability config with the `continuity` key replaced. Other keys (the battery floor)
 * and fields this form does not edit are kept as they were.
 */
export function configFromDraft(
  previous: Record<string, unknown> | undefined,
  draft: ContinuityDraft,
): Record<string, unknown> {
  const root = obj(previous?.continuity);
  const ssid = draft.ssid.trim();
  return {
    ...previous,
    continuity: {
      ...root,
      network_watch: { ...obj(root.network_watch), enabled: draft.networkOn, hosts: draft.hosts },
      hotspot: {
        ...Object.fromEntries(Object.entries(obj(root.hotspot)).filter(([k]) => k !== "ssid")),
        enabled: draft.hotspotOn,
        ...(ssid ? { ssid } : {}),
        allow_password_argv: draft.allowPasswordArgv,
      },
      nudge: {
        ...obj(root.nudge),
        enabled: draft.nudgeOn,
        after_seconds: parseSeconds(draft.afterSeconds) ?? DEFAULT_NUDGE_SECONDS,
        panes: draft.panes,
        sessions: draft.sessions,
        allowed_commands: draft.commands,
        enter: draft.enter,
      },
      throttle_check: { ...obj(root.throttle_check), enabled: draft.throttleOn },
    },
  };
}

// ── Status answers ───────────────────────────────────────────────────────────

export type HotspotOutcome = "not_tried" | "joined" | "failed" | "skipped";

export interface OutageView {
  startedAt: string;
  endedAt: string | null;
  hotspot: HotspotOutcome;
  nudged: number;
}

export interface ContinuityStatusView {
  networkDown: boolean;
  passwordSaved: boolean;
  previousNetworkSaved: boolean;
  lastOutage: OutageView | null;
}

const HOTSPOT_OUTCOMES: readonly string[] = ["not_tried", "joined", "failed", "skipped"];

function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" ? Reflect.get(value, key) : undefined;
}

function readOutage(raw: unknown): OutageView | null {
  const started = field(raw, "started_at");
  const ended = field(raw, "ended_at");
  const hotspot = field(raw, "hotspot");
  const nudged = field(raw, "nudged");
  if (typeof started !== "string" || Number.isNaN(Date.parse(started))) return null;
  if (ended !== null && typeof ended !== "string") return null;
  return {
    startedAt: started,
    endedAt: ended,
    hotspot:
      typeof hotspot === "string" && HOTSPOT_OUTCOMES.includes(hotspot)
        ? (hotspot as HotspotOutcome)
        : "not_tried",
    nudged: typeof nudged === "number" && Number.isFinite(nudged) ? nudged : 0,
  };
}

/** The `continuity.status` result, or null when it is not shaped like one. */
export function readContinuityStatus(raw: unknown): ContinuityStatusView | null {
  const network = field(raw, "network_watch");
  const hotspot = field(raw, "hotspot");
  if (network === undefined || hotspot === undefined) return null;
  return {
    networkDown: field(network, "down") === true,
    passwordSaved: field(hotspot, "password_saved") === true,
    previousNetworkSaved: field(hotspot, "previous_network_saved") === true,
    lastOutage: readOutage(field(raw, "last_outage")),
  };
}

export interface BrowserView {
  bundleId: string;
  name: string;
  running: boolean;
  throttled: boolean;
}

export interface ThrottleView {
  enabled: boolean;
  supported: boolean;
  browsers: BrowserView[];
}

/** The `throttle.status` result. A browser entry that is not fully shaped is dropped. */
export function readThrottleStatus(raw: unknown): ThrottleView | null {
  const enabled = field(raw, "enabled");
  if (typeof enabled !== "boolean") return null;
  const list = field(raw, "browsers");
  const browsers: BrowserView[] = [];
  for (const item of Array.isArray(list) ? list : []) {
    const bundleId = field(item, "bundle_id");
    const name = field(item, "name");
    if (typeof bundleId !== "string" || typeof name !== "string") continue;
    browsers.push({
      bundleId,
      name,
      running: field(item, "running") === true,
      throttled: field(item, "throttled") === true,
    });
  }
  return { enabled, supported: field(raw, "supported") !== false, browsers };
}

const REASON_KEYS: Readonly<Record<string, MessageKey>> = {
  unsupported_platform: "power.continuity.reason.unsupported_platform",
  no_wifi_device: "power.continuity.reason.no_wifi_device",
  no_hotspot_configured: "power.continuity.reason.no_hotspot_configured",
  bad_password: "power.continuity.reason.bad_password",
  join_failed: "power.continuity.reason.join_failed",
  unknown_browser: "power.continuity.reason.unknown_browser",
  protected: "power.continuity.reason.protected",
  not_running: "power.continuity.reason.not_running",
  already_unthrottled: "power.continuity.reason.already_unthrottled",
  unavailable: "power.continuity.reason.unavailable",
  quit_failed: "power.continuity.reason.quit_failed",
  still_running: "power.continuity.reason.still_running",
  open_failed: "power.continuity.reason.open_failed",
};

export type CommandOutcome = { done: true } | { done: false; reason: MessageKey };

/** A hotspot or relaunch command's result as text keys; anything unexpected is a generic refusal. */
export function readOutcome(raw: unknown, doneField: "joined" | "relaunched"): CommandOutcome {
  if (field(raw, doneField) === true) return { done: true };
  const reason = field(raw, "reason");
  const key =
    typeof reason === "string" && Object.hasOwn(REASON_KEYS, reason)
      ? REASON_KEYS[reason]
      : undefined;
  return { done: false, reason: key ?? "power.continuity.reason.other" };
}
