// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Keep-awake (Phase 72), web side: reads the `awake` capability's status, computes the countdown
// from `ends_at` against an injectable clock, and runs the "hold to end" gesture on an injectable
// timer (so tests never wait). Nothing here starts or ends a session by itself.
import { useCallback, useEffect, useRef, useState } from "react";
import { formatNumber } from "./format";
import { useCapabilities, useCommandResult } from "./hooks";
import type { ActiveLocale } from "../i18n";

export type AwakeMode = "timed" | "agents_grace";

export interface AwakeSessionView {
  id: string;
  mode: AwakeMode;
  label?: string;
  started_at: string;
  /** null while an agents_grace session is held by working agents. */
  ends_at: string | null;
  remaining_seconds: number | null;
  agents_working?: number;
  grace_minutes?: number;
}

export interface AwakeStatus {
  active: boolean;
  session?: AwakeSessionView;
  battery_floor_percent: number;
  min_minutes: number;
  max_minutes: number;
}

export const AWAKE_DEFAULT_MIN_MINUTES = 1;
export const AWAKE_DEFAULT_MAX_MINUTES = 10_080;
/** How long the end button must be held. */
export const HOLD_TO_END_MS = 1_500;

function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" ? Reflect.get(value, key) : undefined;
}

function readSession(raw: unknown): AwakeSessionView | undefined {
  const id = field(raw, "id");
  const mode = field(raw, "mode");
  const startedAt = field(raw, "started_at");
  const endsAt = field(raw, "ends_at");
  if (typeof id !== "string" || (mode !== "timed" && mode !== "agents_grace")) return undefined;
  if (typeof startedAt !== "string" || (endsAt !== null && typeof endsAt !== "string")) {
    return undefined;
  }
  const label = field(raw, "label");
  const remaining = field(raw, "remaining_seconds");
  const working = field(raw, "agents_working");
  const grace = field(raw, "grace_minutes");
  return {
    id,
    mode,
    started_at: startedAt,
    ends_at: endsAt,
    remaining_seconds: typeof remaining === "number" ? remaining : null,
    ...(typeof label === "string" ? { label } : {}),
    ...(typeof working === "number" ? { agents_working: working } : {}),
    ...(typeof grace === "number" ? { grace_minutes: grace } : {}),
  };
}

/** The capability's `status` result, or null if it is not shaped like one. */
export function readAwakeStatus(raw: unknown): AwakeStatus | null {
  const active = field(raw, "active");
  const floor = field(raw, "battery_floor_percent");
  if (typeof active !== "boolean" || typeof floor !== "number") return null;
  const min = field(raw, "min_minutes");
  const max = field(raw, "max_minutes");
  const session = active ? readSession(field(raw, "session")) : undefined;
  if (active && !session) return null;
  return {
    active,
    ...(session ? { session } : {}),
    battery_floor_percent: floor,
    min_minutes: typeof min === "number" ? min : AWAKE_DEFAULT_MIN_MINUTES,
    max_minutes: typeof max === "number" ? max : AWAKE_DEFAULT_MAX_MINUTES,
  };
}

/** Whole seconds left until `endsAt` (ISO), never negative; null for no end or a bad date. */
export function secondsLeft(endsAt: string | null, nowMs: number): number | null {
  if (endsAt === null) return null;
  const end = Date.parse(endsAt);
  return Number.isNaN(end) ? null : Math.max(0, Math.ceil((end - nowMs) / 1000));
}

/** "1:05:03" with the digits of the language; hours are not padded. */
export function formatCountdown(totalSeconds: number, locale?: ActiveLocale): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const two = { minimumIntegerDigits: 2 };
  const h = formatNumber(Math.floor(s / 3600), locale);
  const m = formatNumber(Math.floor((s % 3600) / 60), locale, two);
  const sec = formatNumber(s % 60, locale, two);
  return `${h}:${m}:${sec}`;
}

/** A parsed whole number of minutes in range, or null. Only digits are accepted. */
export function parseMinutesInput(text: string, min: number, max: number): number | null {
  if (!/^\d{1,6}$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= min && n <= max ? n : null;
}

// ── Injectable time ──────────────────────────────────────────────────────────

export interface AwakeUiClock {
  now(): number;
  /** Calls `fn` every `ms` until the returned function is called. */
  every(fn: () => void, ms: number): () => void;
}

export const realUiClock: AwakeUiClock = {
  now: () => Date.now(),
  every(fn, ms) {
    const id = window.setInterval(fn, ms);
    return () => window.clearInterval(id);
  },
};

export interface HoldTimer {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const realHoldTimer: HoldTimer = {
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (handle) => window.clearTimeout(typeof handle === "number" ? handle : undefined),
};

/** The current time in ms, re-read every second while `active`. */
export function useNow(clock: AwakeUiClock, active: boolean): number {
  const [now, setNow] = useState(() => clock.now());
  useEffect(() => {
    if (!active) return;
    setNow(clock.now());
    return clock.every(() => setNow(clock.now()), 1000);
  }, [clock, active]);
  return now;
}

export interface HoldToEnd {
  holding: boolean;
  /** Starts the hold (pointer down, Space/Enter down). A second start while holding does nothing. */
  begin(): void;
  /** Aborts the hold (pointer up or leave, key up, blur). Does nothing once it has completed. */
  cancel(): void;
}

/**
 * A press that only counts after `holdMs` of continuous holding. `onComplete` runs once per
 * completed hold; releasing early, leaving the button or losing focus cancels it.
 */
export function useHoldToEnd(
  onComplete: () => void,
  timer: HoldTimer,
  holdMs: number = HOLD_TO_END_MS,
): HoldToEnd {
  const [holding, setHolding] = useState(false);
  const handle = useRef<unknown>(undefined);
  const running = useRef(false);
  const done = useRef(onComplete);
  done.current = onComplete;

  const cancel = useCallback(() => {
    if (!running.current) return;
    running.current = false;
    timer.clear(handle.current);
    handle.current = undefined;
    setHolding(false);
  }, [timer]);

  const begin = useCallback(() => {
    if (running.current) return;
    running.current = true;
    setHolding(true);
    handle.current = timer.set(() => {
      running.current = false;
      handle.current = undefined;
      setHolding(false);
      done.current();
    }, holdMs);
  }, [timer, holdMs]);

  useEffect(() => cancel, [cancel]);
  return { holding, begin, cancel };
}

// ── Status ───────────────────────────────────────────────────────────────────

export type AwakeAvailability = "absent" | "disabled" | "ready";

export interface AwakeStatusView {
  availability: AwakeAvailability;
  status: AwakeStatus | null;
  error: string | null;
  reload(): Promise<void>;
}

/** The capability's state and its status, refreshed on every awake.session.* event. */
export function useAwakeStatus(): AwakeStatusView {
  const { data: caps } = useCapabilities();
  const cap = caps.find((c) => c.id === "awake");
  const on = cap?.status === "enabled";
  const { data, error, reload } = useCommandResult<unknown>("awake", "status", on, (type) =>
    type.startsWith("awake.session."),
  );
  return {
    availability: cap === undefined ? "absent" : on ? "ready" : "disabled",
    status: on ? readAwakeStatus(data) : null,
    error,
    reload,
  };
}
