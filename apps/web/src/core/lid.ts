// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Lid-close actions (Phase 74), web side: reads and writes the `lid_actions` key of the Keep awake
// capability's config, validates list entries the way the capability does (the capability checks
// again; this only saves the user a round trip), and reads `lid_actions.status` defensively.
import type { MessageKey } from "../i18n";

// Mirrors capabilities/awake/src/lid-actions/{config,protected,apps}.ts.
export const BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$/;
export const MAX_BUNDLE_ID_LENGTH = 155;
export const MAX_NAP_APPS = 16;
export const PROTECTED_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,63}$/;
export const MAX_PROTECTED_EXTRA = 64;

export const ACTION_IDS = [
  "display",
  "freeze_apps",
  "mute",
  "low_power",
  "docker_freeze",
  "app_nap",
] as const;
export type LidActionId = (typeof ACTION_IDS)[number];

/** The chat apps Phoenix may freeze (keys of the table in the capability). */
export const FREEZABLE = ["slack", "whatsapp", "discord"] as const;

export type LidListKind = "napApps" | "protectedExtra";

interface ListRule {
  max: number;
  valid: (value: string) => boolean;
  invalid: MessageKey;
}

export const LID_LIST_RULES: Readonly<Record<LidListKind, ListRule>> = {
  napApps: {
    max: MAX_NAP_APPS,
    valid: (v) => v.length <= MAX_BUNDLE_ID_LENGTH && BUNDLE_ID.test(v),
    invalid: "power.lid.invalid.bundle",
  },
  protectedExtra: {
    max: MAX_PROTECTED_EXTRA,
    valid: (v) => PROTECTED_NAME.test(v),
    invalid: "power.lid.invalid.name",
  },
};

export type LidListProblem = "invalid" | "duplicate" | "full";

/** The entry as it would be stored, or why it is refused. Names are compared without case. */
export function checkLidEntry(
  kind: LidListKind,
  text: string,
  current: readonly string[],
): { ok: true; value: string } | { ok: false; problem: LidListProblem } {
  const value = text.trim();
  const rule = LID_LIST_RULES[kind];
  if (!rule.valid(value)) return { ok: false, problem: "invalid" };
  const same = (x: string) =>
    kind === "protectedExtra" ? x.toLowerCase() === value.toLowerCase() : x === value;
  if (current.some(same)) return { ok: false, problem: "duplicate" };
  if (current.length >= rule.max) return { ok: false, problem: "full" };
  return { ok: true, value };
}

/** What the form edits. Defaults are the capability's defaults. */
export interface LidDraft {
  enabled: boolean;
  display: boolean;
  freezeApps: boolean;
  freezeList: string[];
  mute: boolean;
  lowPower: boolean;
  dockerFreeze: boolean;
  appNap: boolean;
  appNapList: string[];
  protectedExtra: string[];
}

function obj(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

function flag(root: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = root[key];
  return typeof value === "boolean" ? value : fallback;
}

/** The saved config as a draft. Anything unreadable falls back to the default. */
export function lidDraftFromConfig(config: Record<string, unknown> | undefined): LidDraft {
  const root = obj(config?.lid_actions);
  return {
    enabled: flag(root, "enabled", true),
    display: flag(root, "display", true),
    freezeApps: flag(root, "freeze_apps", true),
    freezeList: Array.isArray(root.freeze_apps_list)
      ? strings(root.freeze_apps_list).filter((k) => FREEZABLE.some((f) => f === k))
      : [...FREEZABLE],
    mute: flag(root, "mute", true),
    lowPower: flag(root, "low_power", true),
    dockerFreeze: flag(root, "docker_freeze", false),
    appNap: flag(root, "app_nap", false),
    appNapList: strings(root.app_nap_apps),
    protectedExtra: strings(root.protected_extra),
  };
}

/** The whole capability config with the `lid_actions` key replaced; other keys are kept as they were. */
export function lidConfigFromDraft(
  previous: Record<string, unknown> | undefined,
  draft: LidDraft,
): Record<string, unknown> {
  return {
    ...previous,
    lid_actions: {
      ...obj(previous?.lid_actions),
      enabled: draft.enabled,
      display: draft.display,
      freeze_apps: draft.freezeApps,
      freeze_apps_list: draft.freezeList,
      mute: draft.mute,
      low_power: draft.lowPower,
      docker_freeze: draft.dockerFreeze,
      app_nap: draft.appNap,
      app_nap_apps: draft.appNapList,
      protected_extra: draft.protectedExtra,
    },
  };
}

// ── Status answers ───────────────────────────────────────────────────────────

export interface LidActionView {
  id: LidActionId;
  enabled: boolean;
  /** undefined while it was not asked (the action is off). */
  supported: boolean | undefined;
  reason: string | undefined;
  limits: string[];
}

export type LidOutcome = "applied" | "skipped" | "failed" | "undone" | "undo_failed";

export interface LidResultView {
  action: LidActionId;
  outcome: LidOutcome;
  reason: string | undefined;
  count: number;
  mismatched: number;
  /** Processes Phoenix may not signal. */
  notOurs: number;
  /** Fixed codes (plain facts) such as `output_identity_unknown`. */
  notes: string[];
}

export interface LidRunView {
  event: "closed" | "opened";
  at: number;
  results: LidResultView[];
}

export interface LidStatusView {
  closed: boolean;
  actions: LidActionView[];
  builtIn: string[];
  extra: string[];
  last: LidRunView | null;
}

function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" ? Reflect.get(value, key) : undefined;
}

const OUTCOMES: readonly string[] = ["applied", "skipped", "failed", "undone", "undo_failed"];

function isActionId(value: unknown): value is LidActionId {
  return typeof value === "string" && ACTION_IDS.some((a) => a === value);
}

function readRun(raw: unknown): LidRunView | null {
  const event = field(raw, "event");
  const at = field(raw, "at");
  const list = field(raw, "results");
  if ((event !== "closed" && event !== "opened") || typeof at !== "number" || !Array.isArray(list))
    return null;
  const results: LidResultView[] = [];
  for (const item of list) {
    const action = field(item, "action");
    const outcome = field(item, "outcome");
    if (!isActionId(action) || typeof outcome !== "string" || !OUTCOMES.includes(outcome)) continue;
    const reason = field(item, "reason");
    const count = field(item, "count");
    const mismatched = field(item, "mismatched");
    const notOurs = field(item, "notOurs");
    results.push({
      action,
      outcome: outcome as LidOutcome,
      reason: typeof reason === "string" ? reason : undefined,
      count: typeof count === "number" ? count : 0,
      mismatched: typeof mismatched === "number" ? mismatched : 0,
      notOurs: typeof notOurs === "number" ? notOurs : 0,
      notes: strings(field(item, "notes")),
    });
  }
  return { event, at, results };
}

/** The `lid_actions.status` result, or null when it is not shaped like one. */
export function readLidStatus(raw: unknown): LidStatusView | null {
  const list = field(raw, "actions");
  const prot = field(raw, "protected");
  if (!Array.isArray(list) || prot === undefined) return null;
  const actions: LidActionView[] = [];
  for (const item of list) {
    const id = field(item, "id");
    if (!isActionId(id)) continue;
    const supported = field(item, "supported");
    const reason = field(item, "reason");
    actions.push({
      id,
      enabled: field(item, "enabled") === true,
      supported: typeof supported === "boolean" ? supported : undefined,
      reason: typeof reason === "string" ? reason : undefined,
      limits: strings(field(item, "limits")),
    });
  }
  return {
    closed: field(raw, "closed") === true,
    actions,
    builtIn: strings(field(prot, "built_in")),
    extra: strings(field(prot, "extra")),
    last: readRun(field(raw, "last")),
  };
}

/** Fixed codes the capability reports for a skipped, failed or limited action, as message keys. */
export const REASON_KEYS: Readonly<Record<string, MessageKey>> = {
  unsupported_platform: "power.lid.reason.unsupported_platform",
  helper_unavailable: "power.lid.reason.helper_unavailable",
  tool_missing: "power.lid.reason.tool_missing",
  already_on: "power.lid.reason.already_on",
  state_unknown: "power.lid.reason.state_unknown",
  protected_state: "power.lid.reason.protected_state",
  docker_busy: "power.lid.reason.docker_busy",
  docker_unknown: "power.lid.reason.docker_unknown",
  process_list_unavailable: "power.lid.reason.process_list_unavailable",
  audio_unavailable: "power.lid.reason.audio_unavailable",
  assertions_unknown: "power.lid.reason.assertions_unknown",
  holds_assertion: "power.lid.reason.holds_assertion",
  output_changed: "power.lid.reason.output_changed",
  retry_or_alert: "power.lid.reason.retry_or_alert",
  not_ours: "power.lid.reason.not_ours",
  no_targets: "power.lid.reason.no_targets",
  nothing_to_do: "power.lid.reason.nothing_to_do",
  journal_unwritable: "power.lid.reason.journal_unwritable",
  not_applied: "power.lid.reason.not_applied",
  apply_failed: "power.lid.reason.apply_failed",
  undo_failed: "power.lid.reason.undo_failed",
  brightness_tool_missing: "power.lid.limit.brightness_tool_missing",
  keyboard_backlight_unsupported: "power.lid.limit.keyboard_backlight_unsupported",
  default_output_only: "power.lid.limit.default_output_only",
  output_identity_unknown: "power.lid.limit.output_identity_unknown",
  brightness_tool_untrusted: "power.lid.limit.brightness_tool_untrusted",
};

/** Notes worth showing in the last-event list (the other notes are limits already shown above). */
export const WARNING_NOTES: readonly string[] = [
  "output_identity_unknown",
  "brightness_tool_untrusted",
];

export function reasonKey(code: string | undefined): MessageKey {
  return (
    (code !== undefined && Object.hasOwn(REASON_KEYS, code) ? REASON_KEYS[code] : undefined) ??
    "power.lid.reason.other"
  );
}

export const ACTION_KEYS: Readonly<Record<LidActionId, { title: MessageKey; help: MessageKey }>> = {
  display: { title: "power.lid.display.title", help: "power.lid.display.help" },
  freeze_apps: { title: "power.lid.freeze.title", help: "power.lid.freeze.help" },
  mute: { title: "power.lid.mute.title", help: "power.lid.mute.help" },
  low_power: { title: "power.lid.lowPower.title", help: "power.lid.lowPower.help" },
  docker_freeze: { title: "power.lid.docker.title", help: "power.lid.docker.help" },
  app_nap: { title: "power.lid.nap.title", help: "power.lid.nap.help" },
};

export const FREEZABLE_NAMES: Readonly<Record<string, string>> = {
  slack: "Slack",
  whatsapp: "WhatsApp",
  discord: "Discord",
};
