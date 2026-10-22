// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// What the scheduler needs from its host. Every port is injected: this module never runs
// pmset, caffeinate, launchctl, rtcwake, schtasks or any other command, and never reads the
// system clock or battery itself.
import type { SessionEndReason } from "@phoenix/capability-awake";

/**
 * Holds the machine awake. The production implementation is a thin adapter over the Phase 72
 * keep-awake session (`awakeControllerFromSession`); tests use a recording fake. `start` throws
 * an `AwakeError` when it refuses (a session already runs, battery floor).
 */
export interface AwakeController {
  /** Hold for `minutes` (whole, at least 1). Resolves with an id that names this hold only. */
  start(minutes: number, label: string): Promise<string>;
  /** Adds `minutes` to the hold `id`. Throws if it is no longer running. */
  extend(id: string, minutes: number): void;
  /** Releases the hold `id`. Idempotent, and a no-op for a hold that is not ours or is gone. */
  end(id: string, reason: SessionEndReason): void;
  /** Whether hold `id` is still running (false once the user, the battery floor or expiry ended it). */
  alive(id: string): boolean;
}

/** The part of the Phase 72 `SessionController` the adapter uses. */
export interface KeepAwakeSession {
  start(mode: "timed", minutes: number, label: string | undefined): Promise<SessionStarted>;
  extend(minutes: number): unknown;
  end(reason: SessionEndReason): boolean;
  active(): { id: string } | null;
}

export interface SessionStarted {
  session?: { id: string };
}

/**
 * Asks the OS to wake the machine at an absolute time (`pmset schedule wake` on macOS, an RTC
 * alarm on Linux, a Task Scheduler wake task on Windows). No adapter ships in this repository;
 * the scheduler only ever calls these two methods, and a failure is reported, never fatal.
 */
export interface WakeScheduler {
  /** Registers (or replaces) the wake named `key` for epoch-ms `at`. */
  schedule(request: { key: string; at: number }): Promise<void>;
  cancel(key: string): Promise<void>;
}

/** Durable copy of the user's schedules. `load` returns whatever was saved (untrusted). */
export interface ScheduleStore {
  load(): Promise<unknown>;
  save(state: PersistedState): Promise<void>;
}

export interface PersistedState {
  version: 1;
  enabled: boolean;
  schedules: Record<string, unknown>[];
  /** Occurrence key and the epoch ms after which the skip no longer matters. */
  skips: [string, number][];
}

/** A change worth an audit row or a bus event. `detail` holds ids, counts and codes only. */
export interface ScheduleEvent {
  type:
    | "enabled"
    | "disabled"
    | "schedule.saved"
    | "schedule.removed"
    | "window.skipped"
    | "window.unskipped"
    | "hold.started"
    | "hold.extended"
    | "hold.released"
    | "hold.waiting"
    | "wake.scheduled"
    | "wake.cancelled"
    | "wake.failed"
    | "store.error"
    | "store.dropped";
  at: number;
  detail: Record<string, string | number | boolean | null>;
}
