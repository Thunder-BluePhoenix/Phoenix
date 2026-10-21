// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** Who started a journalled change: this Phoenix, a Phoenix that is gone, or another one. */
export type PendingOwner = "self" | "dead" | "other";

/** One system change the recovery journal still has to undo. `kind` may be a value this UI does not know. */
export interface PendingChange {
  id: string;
  kind: string;
  /** Epoch milliseconds; 0 when unknown. */
  at: number;
  session: string | null;
  owner: PendingOwner;
  /** True when this Phoenix has no way to undo `kind`: only then can the entry be discarded. */
  discardable: boolean;
}

export interface RecoveryJournal {
  pending: PendingChange[];
  untrusted: number;
  partial_tail: boolean;
  size_bytes: number;
}

export type LidState = "open" | "closed" | "unknown" | "unsupported";

export interface RecoveryLid {
  supported: boolean;
  state: LidState;
}

export interface LidClosedStatus {
  engaged: boolean;
  since: string | null;
  session_id: string | null;
}

export type BatteryReading =
  | { kind: "battery"; percent: number | null; on_battery: boolean | null }
  | { kind: "none" }
  | { kind: "unknown" };

export type ThermalReading =
  { kind: "level"; level: string } | { kind: "unsupported" } | { kind: "unknown" };

export interface FloorReadings {
  battery: BatteryReading;
  thermal: ThermalReading;
}

export interface RecoveryFloors {
  enabled: boolean;
  low_power_percent: number;
  end_percent: number;
  thermal_low_power_level: string;
  thermal_end_level: string;
  low_power_active: boolean;
  last: FloorReadings | null;
}

export interface RecoverySafety {
  acknowledged: boolean;
  version: number;
  acknowledged_at: string | null;
  /** SHA-256 of the warning wording the acknowledgement is bound to; `null` when Core did not send one. */
  text_sha256: string | null;
}

/** What the `recovery.status` command reports, after `readRecoveryStatus`. */
export interface RecoveryStatus {
  session_active: boolean;
  /** The journal this Phoenix writes; compare with the WATCH line of install-helper.sh --print-plan. */
  journal_path: string | null;
  /** A recovery undo found the lock held by another process, so nothing was undone. */
  lock_blocked: boolean;
  /** `pmset` says sleep is disabled but the journal has no record of it; `null` when unknown. */
  sleep_disabled_unjournaled: boolean | null;
  journal: RecoveryJournal;
  can_quit: boolean;
  /** `null` while Phoenix does not know whether the privileged helper is installed. */
  helper_installed: boolean | null;
  lid: RecoveryLid;
  lid_closed: LidClosedStatus;
  floors: RecoveryFloors | null;
  safety: RecoverySafety;
}

const MAX_TEXT = 200;
const MAX_PENDING = 200;
const MAX_COUNT = 1_000_000;
const MAX_EPOCH_MS = 8.64e15;

const OWNERS: Record<PendingOwner, true> = { self: true, dead: true, other: true };
const LID_STATES: Record<LidState, true> = {
  open: true,
  closed: true,
  unknown: true,
  unsupported: true,
};

function record(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v.slice(0, MAX_TEXT) : null;
}

function bool(v: unknown): boolean {
  return v === true;
}

function triBool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/** A finite number clamped into [min, max]; `fallback` when it is not a number. */
function clamped(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function isoOrNull(v: unknown): string | null {
  const s = text(v);
  return s !== null && Number.isFinite(Date.parse(s)) ? s : null;
}

function readPending(raw: unknown): PendingChange {
  const r = record(raw) ?? {};
  const owner = typeof r.owner === "string" && Object.hasOwn(OWNERS, r.owner) ? r.owner : "other";
  return {
    id: text(r.id) ?? "",
    kind: text(r.kind) ?? "",
    at: Math.floor(clamped(r.at, 0, MAX_EPOCH_MS, 0)),
    session: text(r.session),
    owner: owner as PendingOwner,
    discardable: r.discardable === true,
  };
}

function readJournal(raw: unknown): RecoveryJournal | null {
  const r = record(raw);
  if (r === null || !Array.isArray(r.pending)) return null;
  return {
    pending: r.pending.slice(0, MAX_PENDING).map(readPending),
    untrusted: Math.floor(clamped(r.untrusted, 0, MAX_COUNT, 0)),
    partial_tail: bool(r.partial_tail),
    size_bytes: Math.floor(clamped(r.size_bytes, 0, Number.MAX_SAFE_INTEGER, 0)),
  };
}

function readBattery(raw: unknown): BatteryReading {
  const r = record(raw);
  if (r === null) return { kind: "unknown" };
  if (r.kind === "none") return { kind: "none" };
  if (r.kind !== "battery") return { kind: "unknown" };
  return {
    kind: "battery",
    percent:
      typeof r.percent === "number" && Number.isFinite(r.percent)
        ? clamped(r.percent, 0, 100, 0)
        : null,
    on_battery: triBool(r.on_battery),
  };
}

function readThermal(raw: unknown): ThermalReading {
  const r = record(raw);
  if (r === null) return { kind: "unknown" };
  if (r.kind === "unsupported") return { kind: "unsupported" };
  const level = text(r.level);
  return r.kind === "level" && level !== null ? { kind: "level", level } : { kind: "unknown" };
}

function readFloors(raw: unknown): RecoveryFloors | null {
  const r = record(raw);
  if (r === null) return null;
  const last = record(r.last);
  return {
    enabled: bool(r.enabled),
    low_power_percent: clamped(r.low_power_percent, 0, 100, 0),
    end_percent: clamped(r.end_percent, 0, 100, 0),
    thermal_low_power_level: text(r.thermal_low_power_level) ?? "",
    thermal_end_level: text(r.thermal_end_level) ?? "",
    low_power_active: bool(r.low_power_active),
    last:
      last === null
        ? null
        : { battery: readBattery(last.battery), thermal: readThermal(last.thermal) },
  };
}

function readSafety(raw: unknown): RecoverySafety | null {
  const r = record(raw);
  if (r === null || typeof r.version !== "number" || !Number.isSafeInteger(r.version)) return null;
  if (r.version < 0) return null;
  return {
    acknowledged: bool(r.acknowledged),
    version: r.version,
    acknowledged_at: isoOrNull(r.acknowledged_at),
    text_sha256:
      typeof r.text_sha256 === "string" && /^[0-9a-f]{64}$/.test(r.text_sha256)
        ? r.text_sha256
        : null,
  };
}

/**
 * A `recovery.status` result checked field by field. Without a readable journal or safety block it
 * returns null (nothing is guessed about what is waiting to be undone, and no acknowledgement is
 * sent for a version that cannot be read). Every other field falls back to its safe reading:
 * not installed, not supported, not engaged. Strings are clipped and only ever shown as text.
 */
export function readRecoveryStatus(raw: unknown): RecoveryStatus | null {
  const r = record(raw);
  if (r === null) return null;
  const journal = readJournal(r.journal);
  const safety = readSafety(r.safety);
  if (journal === null || safety === null) return null;
  const helper = record(r.helper);
  const lid = record(r.lid);
  const lidClosed = record(r.lid_closed);
  const lock = record(r.recovery_lock);
  const lidState =
    lid !== null && typeof lid.state === "string" && Object.hasOwn(LID_STATES, lid.state)
      ? lid.state
      : "unknown";
  return {
    session_active: bool(r.session_active),
    journal_path: text(r.journal_path),
    lock_blocked: lock !== null && bool(lock.blocked),
    sleep_disabled_unjournaled: triBool(r.sleep_disabled_unjournaled),
    journal,
    can_quit: bool(r.can_quit),
    helper_installed: helper === null ? null : triBool(helper.installed),
    lid: { supported: lid !== null && bool(lid.supported), state: lidState as LidState },
    lid_closed: {
      engaged: lidClosed !== null && bool(lidClosed.engaged),
      since: lidClosed === null ? null : isoOrNull(lidClosed.since),
      session_id: lidClosed === null ? null : text(lidClosed.session_id),
    },
    floors: readFloors(r.floors),
    safety,
  };
}
