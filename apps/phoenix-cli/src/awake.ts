// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { CoreClient } from "./client";
import { CoreError, RefusedError, UsageError } from "./errors";
import { clean, formatDuration, isRecord } from "./format";

/** The limits the keep-awake capability enforces (`capabilities/awake`); Core checks them again. */
export const MIN_MINUTES = 1;
export const MAX_MINUTES = 10_080;
export const MAX_REASON = 80;

const UNIT_MINUTES = { m: 1, h: 60, d: 1440 } as const;

/**
 * "90" and "90m" are minutes, "2h" hours, "1d" days. Whole numbers only: "1.5h" is refused rather
 * than rounded, because the person approving sees minutes and must get exactly what they typed.
 */
export function parseDuration(text: string | undefined): number {
  const match = /^(\d{1,6})([mhd]?)$/.exec(text ?? "");
  if (!match) {
    throw new UsageError(
      `"${clean(text, 40)}" is not a duration. Use whole minutes, hours or days: 90, 90m, 2h, 1d`,
    );
  }
  const unit = (match[2] || "m") as keyof typeof UNIT_MINUTES;
  const minutes = Number(match[1]) * UNIT_MINUTES[unit];
  if (minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
    throw new UsageError(`The duration must be from ${MIN_MINUTES} minute to 7 days (1d..7d)`);
  }
  return minutes;
}

export function parseReason(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  if (text.length === 0 || text.length > MAX_REASON) {
    throw new UsageError(`--reason must be 1 to ${MAX_REASON} characters`);
  }
  // Core refuses control and invisible characters too; failing here gives a clearer message.
  if (clean(text, MAX_REASON + 1) !== text) {
    throw new UsageError("--reason must be one line without control or invisible characters");
  }
  return text;
}

export interface AwakeView {
  active: boolean;
  mode?: string;
  label?: string;
  endsAt?: string | null;
  remainingSeconds?: number | null;
  agentsWorking?: number;
  batteryFloorPercent?: number;
  ended?: boolean;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Reads the capability's status shape; anything else is a protocol error, never "not running". */
export function parseAwake(value: unknown): AwakeView {
  if (!isRecord(value) || typeof value.active !== "boolean") {
    throw new CoreError("protocol", "Core answered the keep-awake status in an unexpected shape");
  }
  const session = isRecord(value.session) ? value.session : undefined;
  if (value.active && !session) {
    throw new CoreError("protocol", "Core answered the keep-awake status in an unexpected shape");
  }
  const floor = number(value.battery_floor_percent);
  const remaining = number(session?.remaining_seconds);
  const working = number(session?.agents_working);
  return {
    active: value.active,
    ...(typeof session?.mode === "string" ? { mode: session.mode } : {}),
    ...(typeof session?.label === "string" ? { label: session.label } : {}),
    ...(session && (typeof session.ends_at === "string" || session.ends_at === null)
      ? { endsAt: session.ends_at }
      : {}),
    ...(remaining !== undefined ? { remainingSeconds: remaining } : {}),
    ...(working !== undefined ? { agentsWorking: working } : {}),
    ...(floor !== undefined ? { batteryFloorPercent: floor } : {}),
    ...(typeof value.ended === "boolean" ? { ended: value.ended } : {}),
  };
}

export function renderAwake(view: AwakeView): string {
  if (!view.active) {
    return `Keep awake: not running${view.batteryFloorPercent === undefined ? "" : ` (battery floor ${view.batteryFloorPercent}%)`}\n`;
  }
  const holding =
    view.mode === "agents_grace"
      ? ` while ${view.agentsWorking ?? 0} coding agent(s) work, then a grace period`
      : "";
  const left =
    view.remainingSeconds === null || view.remainingSeconds === undefined
      ? view.mode === "agents_grace"
        ? ""
        : ", end time unknown"
      : `, ${formatDuration(view.remainingSeconds * 1000)} left`;
  const label = view.label ? ` for "${clean(view.label, MAX_REASON)}"` : "";
  return `Keep awake: running${label}${holding}${left}\n`;
}

/** How a capability command can end, and how often the CLI looks. */
export interface CommandRun {
  client: CoreClient;
  capability: string;
  command: string;
  input: Record<string, unknown>;
  signal: AbortSignal;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Told once when Core is waiting for the person to approve in the app. */
  waiting: (id: string) => void;
  /** Give up waiting after this long; Core's own confirmation expiry is five minutes. */
  maxWaitMs: number;
  intervalMs: number;
}

/**
 * Starts a capability command and waits for its operation to finish. The CLI never decides the
 * confirmation Core raises for it: the person answers in Phoenix (or `phoenix approvals`), and this
 * only reports what Core says happened.
 */
export async function runCommand(run: CommandRun): Promise<unknown> {
  const path = `/api/capabilities/${encodeURIComponent(run.capability)}/commands/${encodeURIComponent(run.command)}`;
  const started = await run.client.request("POST", path, { input: run.input }, run.signal);
  if (!isRecord(started) || typeof started.id !== "string") {
    throw new CoreError("protocol", "Core did not return an operation for the command");
  }
  const operation = `/api/operations/${encodeURIComponent(started.id)}`;
  let announced = false;
  for (let waited = 0; ; waited += run.intervalMs) {
    const op = await run.client.request("GET", operation, undefined, run.signal);
    if (!isRecord(op)) throw new CoreError("protocol", "Core answered the operation badly");
    if (op.status === "succeeded") return op.result;
    if (op.status === "failed") throw failed(op);
    if (!announced && op.status === "pending") {
      announced = true;
      run.waiting(started.id);
    }
    if (waited >= run.maxWaitMs) {
      throw new RefusedError(
        "Core is still waiting for you to approve it; nothing was changed by this command yet. Approve or deny it in Phoenix or with `phoenix approvals`.",
      );
    }
    await run.sleep(run.intervalMs, run.signal);
  }
}

function failed(op: Record<string, unknown>): Error {
  const error = isRecord(op.error) ? op.error : {};
  const code = typeof error.code === "string" ? error.code : "";
  const message = clean(typeof error.message === "string" ? error.message : "The command failed");
  // A user's "no" and an emergency stop are decisions, not faults: exit "refused", not "failed".
  if (code === "PERMISSION_DENIED" || code === "SECURITY_POLICY_BLOCKED") {
    return new RefusedError(message);
  }
  if (op.outcomeUnknown === true) {
    return new CoreError(
      "rejected",
      `${message}. Core cannot tell whether it took effect; check with: phoenix awake status`,
      undefined,
      code,
    );
  }
  return new CoreError("rejected", message, undefined, code);
}
