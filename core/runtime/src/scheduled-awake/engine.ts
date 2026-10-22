// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// ScheduledAwake: holds the machine awake during the user's opt-in schedule windows, through an
// injected AwakeController, and pauses when power says no. It is a reconcile loop: every
// reconcile reads the clock and the power source, works out which windows apply right now, and
// makes the controller match (start, extend, release). Timers only decide WHEN to reconcile, so a
// late timer (the machine slept) or a clock jump cannot leave a hold in the wrong state.
//
// Nothing in this file touches the OS. Opt-in is explicit: a new scheduler is off and holds
// nothing until `setEnabled(true)`.
import { AwakeError, type AwakeClock, type SessionEndReason } from "@phoenix/capability-awake";
import {
  judgePower,
  UNKNOWN_READS_TOLERATED,
  type PowerBlock,
  type PowerSnapshot,
  type PowerSource,
} from "./power";
import type {
  AwakeController,
  PersistedState,
  ScheduleEvent,
  ScheduleStore,
  WakeScheduler,
} from "./ports";
import {
  MAX_SCHEDULES,
  PLAN_HORIZON_DAYS,
  mergeWindows,
  minutesBetween,
  occurrencesOf,
  parseScheduleInput,
  scheduleToInput,
  type MergedWindow,
  type ScheduleSpec,
  type ScheduleWindow,
} from "./schedule";
import { DAY_MS, MINUTE_MS, parseDate } from "./time";

/** While holding or waiting, power and the hold are re-checked this often. */
export const ACTIVE_RECHECK_MS = MINUTE_MS;
/** While idle, the plan is rebuilt this often (catches clock and zone-rule changes). */
export const IDLE_RECHECK_MS = 15 * MINUTE_MS;
/** One controller hold is at most this long; longer windows are extended as they run. */
export const MAX_HOLD_MINUTES = 24 * 60;
/** Schedules that together would hold the machine awake longer than this without a break are refused. */
export const MAX_CONTINUOUS_MINUTES = 24 * 60;
export const WAKE_LEAD_MS = 2 * MINUTE_MS;
export const WAKE_RETRY_MS = 10 * MINUTE_MS;
export const MAX_WAKES = 8;
export const MAX_SKIPS = 64;
export const UPCOMING_LIMIT = 20;
export const MERGED_LIMIT = 5;
const HORIZON_MS = PLAN_HORIZON_DAYS * DAY_MS;
const MAX_LABEL = 80;
const STATE_VERSION = 1;
const SKIP_KEY = /^[a-z0-9][a-z0-9-]{0,39}@\d{4}-\d{2}-\d{2}$/;

export type WaitingReason = PowerBlock | "busy" | "battery_floor" | "start_failed";

export interface SchedulerOptions {
  clock: AwakeClock;
  controller: AwakeController;
  power: PowerSource;
  /** Absent: schedules live in memory only and are lost on restart. */
  store?: ScheduleStore;
  /** Absent: `wake: true` schedules are kept but nothing is registered with the OS. */
  wake?: WakeScheduler;
  /** The host's audit / bus sink. Called synchronously; a throw is swallowed. */
  emit: (event: ScheduleEvent) => void;
}

export interface UpcomingWindow extends ScheduleWindow {
  skipped: boolean;
}

export interface SchedulerStatus {
  enabled: boolean;
  /** off: not opted in. idle: nothing applies now. holding: the machine is held. waiting: a window applies but is paused. */
  state: "off" | "idle" | "holding" | "waiting";
  waitingReason: WaitingReason | null;
  holdEndsAt: number | null;
  schedules: ScheduleSpec[];
  /** Next windows (unmerged), skipped ones included and flagged. */
  upcoming: UpcomingWindow[];
  /** Next windows after skips and the merge rule. Power is not applied here. */
  merged: MergedWindow[];
  skips: string[];
  wakeAvailable: boolean;
  wakes: { key: string; at: number }[];
}

interface Hold {
  id: string;
  /** End of the contiguous allowed coverage; the hold is released at this instant. */
  chainEnd: number;
  /** When the controller's own hold runs out. */
  requestedEnd: number;
}

function holdLabel(spec: ScheduleSpec | undefined, id: string): string {
  return `Scheduled: ${spec?.label ?? id}`.slice(0, MAX_LABEL);
}

function releaseReasonFor(block: PowerBlock | null): SessionEndReason {
  return block === "needs_charger" || block === "battery_low" || block === "power_unknown"
    ? "battery"
    : "cancelled";
}

export class ScheduledAwake {
  private enabled = false;
  private readonly schedules = new Map<string, ScheduleSpec>();
  /** Occurrence key -> epoch ms after which the skip is forgotten (the occurrence's end). */
  private readonly skips = new Map<string, number>();
  private hold: Hold | null = null;
  private waiting: WaitingReason | null = null;
  /** Schedules that were last paused for a low battery: they resume only with a margin. */
  private readonly lowBattery = new Set<string>();
  private unknownStreak = 0;
  /** After a hold is ended by someone else, windows that began at or before this instant stay off. */
  private suppressedAt = -Infinity;
  private readonly wakes = new Map<string, number>();
  private readonly wakeRetryAt = new Map<string, number>();
  private timer: ReturnType<AwakeClock["setTimer"]> | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private started = false;
  private stopped = false;
  private releaseHint: SessionEndReason | undefined;

  constructor(private readonly o: SchedulerOptions) {}

  // ── Lifecycle ───────────────────────────────────────────────────────────

  /** Loads saved schedules (invalid or unsafe ones are dropped, reported) and begins. Idempotent. */
  start(): Promise<void> {
    return this.enqueue(async () => {
      if (this.started || this.stopped) return;
      this.started = true;
      await this.restore();
      await this.reconcile();
    });
  }

  /** Releases the hold, cancels OS wakes and stops timers. The scheduler cannot be restarted. */
  stop(): Promise<void> {
    this.stopped = true;
    this.disarm();
    // Release synchronously first: shutdown must not wait behind a slow power read.
    this.releaseHold("shutdown", "shutdown");
    return this.enqueue(async () => {
      await this.cancelAllWakes();
    });
  }

  // ── Commands (the host puts a confirmation + audit gate in front of each) ─

  /** The opt-in switch. Off releases any hold and cancels registered wakes. */
  setEnabled(on: boolean): Promise<SchedulerStatus> {
    return this.mutate(() => {
      if (this.enabled === on) return;
      this.enabled = on;
      this.emit(on ? "enabled" : "disabled", {});
      if (!on) this.releaseHint = "disabled";
    });
  }

  /** Adds or replaces a schedule. Throws `AwakeError` (invalid / limit) and changes nothing. */
  upsertSchedule(input: unknown): Promise<SchedulerStatus> {
    return this.mutate(() => {
      const spec = parseScheduleInput(input);
      if (!this.schedules.has(spec.id) && this.schedules.size >= MAX_SCHEDULES) {
        throw new AwakeError("limit", `At most ${MAX_SCHEDULES} schedules are kept`);
      }
      this.checkContinuity([...this.others(spec.id), spec]);
      this.schedules.set(spec.id, spec);
      // The edited schedule may now end earlier or later: let the loop re-judge the hold.
      this.releaseHint = "cancelled";
      this.emit("schedule.saved", { id: spec.id, enabled: spec.enabled });
    });
  }

  removeSchedule(id: string): Promise<SchedulerStatus> {
    return this.mutate(() => {
      if (!this.schedules.delete(id)) {
        throw new AwakeError("invalid", "No such schedule");
      }
      for (const key of [...this.skips.keys()]) {
        if (key.startsWith(`${id}@`)) this.skips.delete(key);
      }
      this.releaseHint = "cancelled";
      this.emit("schedule.removed", { id });
    });
  }

  /** Skips one upcoming or running occurrence (`<schedule id>@YYYY-MM-DD`). Idempotent. */
  skipWindow(key: string): Promise<SchedulerStatus> {
    return this.mutate(() => {
      const now = this.o.clock.now();
      const found = this.occurrencesFrom(now, true).find((w) => w.key === key);
      if (!found) throw new AwakeError("invalid", "No such upcoming window");
      if (this.skips.has(key)) return;
      if (this.skips.size >= MAX_SKIPS) throw new AwakeError("limit", "Too many skipped windows");
      this.skips.set(key, found.endsAt);
      this.releaseHint = "cancelled";
      this.emit("window.skipped", { key });
    });
  }

  unskipWindow(key: string): Promise<SchedulerStatus> {
    return this.mutate(() => {
      if (this.skips.delete(key)) this.emit("window.unskipped", { key });
    });
  }

  /** Ends whatever is running now and skips the occurrences that cover this moment. */
  cancelCurrent(): Promise<{ status: SchedulerStatus; skipped: string[] }> {
    const skipped: string[] = [];
    return this.mutate(() => {
      const now = this.o.clock.now();
      for (const w of this.occurrencesFrom(now, true)) {
        if (w.startsAt > now || this.skips.has(w.key)) continue;
        if (this.skips.size >= MAX_SKIPS) throw new AwakeError("limit", "Too many skipped windows");
        this.skips.set(w.key, w.endsAt);
        skipped.push(w.key);
        this.emit("window.skipped", { key: w.key });
      }
      this.releaseHint = "cancelled";
    }).then((status) => ({ status, skipped }));
  }

  /** Re-reads the clock and power now; the host calls this on wake-from-sleep or a power change. */
  refresh(): Promise<SchedulerStatus> {
    return this.mutate(() => {});
  }

  // ── Reads ───────────────────────────────────────────────────────────────

  status(): SchedulerStatus {
    const now = this.o.clock.now();
    const all = this.occurrencesFrom(now, true);
    const live = all.filter((w) => !this.skips.has(w.key));
    const state: SchedulerStatus["state"] = !this.enabled
      ? "off"
      : this.hold
        ? "holding"
        : this.waiting
          ? "waiting"
          : "idle";
    return {
      enabled: this.enabled,
      state,
      waitingReason: this.hold ? null : this.waiting,
      holdEndsAt: this.hold?.chainEnd ?? null,
      schedules: [...this.schedules.values()],
      upcoming: all.slice(0, UPCOMING_LIMIT).map((w) => ({ ...w, skipped: this.skips.has(w.key) })),
      merged: mergeWindows(live).slice(0, MERGED_LIMIT),
      skips: [...this.skips.keys()],
      wakeAvailable: this.o.wake !== undefined,
      wakes: [...this.wakes].map(([key, at]) => ({ key, at })),
    };
  }

  // ── Serialisation ───────────────────────────────────────────────────────

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = this.tail.then(job, job);
    this.tail = next.catch(() => undefined);
    return next;
  }

  /** Runs `change` (sync, may throw before changing anything), saves, reconciles, returns status. */
  private mutate(change: () => void): Promise<SchedulerStatus> {
    return this.enqueue(async () => {
      if (this.stopped) throw new AwakeError("unavailable", "The scheduler has stopped");
      change();
      await this.persist();
      await this.reconcile();
      return this.status();
    });
  }

  // ── Plan ────────────────────────────────────────────────────────────────

  private others(id: string): ScheduleSpec[] {
    return [...this.schedules.values()].filter((s) => s.id !== id);
  }

  /** Windows the scheduler acts on: none while it is off, and skipped occurrences removed. */
  private activeWindows(from: number): ScheduleWindow[] {
    return this.enabled ? this.occurrencesFrom(from, false) : [];
  }

  /** Occurrences that end after `from` within the horizon, in start order; skips optionally removed. */
  private occurrencesFrom(from: number, includeSkipped: boolean): ScheduleWindow[] {
    const out: ScheduleWindow[] = [];
    for (const spec of this.schedules.values()) {
      if (!spec.enabled) continue;
      for (const w of occurrencesOf(spec, from, from + HORIZON_MS)) {
        if (includeSkipped || !this.skips.has(w.key)) out.push(w);
      }
    }
    return out.sort((a, b) => a.startsAt - b.startsAt || a.key.localeCompare(b.key));
  }

  /** Refuses a set of schedules whose windows chain into more than the continuous limit. */
  private checkContinuity(specs: readonly ScheduleSpec[]): void {
    const now = this.o.clock.now();
    const ranges: [number, number][] = [[now - DAY_MS, now + HORIZON_MS]];
    for (const spec of specs) {
      if (spec.recurrence.kind !== "once") continue;
      const date = parseDate(spec.recurrence.date);
      if (!date) continue;
      const at = Date.UTC(date.year, date.month - 1, date.day);
      ranges.push([at - 3 * DAY_MS, at + 3 * DAY_MS]);
    }
    for (const [from, to] of ranges) {
      const windows = specs.filter((s) => s.enabled).flatMap((s) => occurrencesOf(s, from, to));
      for (const m of mergeWindows(windows)) {
        if (m.endsAt - m.startsAt > MAX_CONTINUOUS_MINUTES * MINUTE_MS) {
          throw new AwakeError(
            "limit",
            `Those schedules would keep the machine awake for more than ${MAX_CONTINUOUS_MINUTES / 60} hours without a break`,
          );
        }
      }
    }
  }

  // ── Reconcile ───────────────────────────────────────────────────────────

  private async readPower(): Promise<PowerSnapshot> {
    try {
      return await this.o.power.read();
    } catch {
      return { battery: { kind: "unknown" }, lowPowerMode: null };
    }
  }

  private async reconcile(): Promise<void> {
    if (this.stopped) return;
    this.disarm();
    const hint = this.releaseHint;
    this.releaseHint = undefined;
    this.pruneSkips(this.o.clock.now());

    if (this.hold && !this.o.controller.alive(this.hold.id)) {
      // Ended by someone else (the user's `end`, the battery floor, expiry just before our timer).
      const lostAt = this.o.clock.now();
      this.emit("hold.released", {
        id: this.hold.id,
        reason: lostAt >= this.hold.chainEnd ? "window_ended" : "lost",
      });
      if (lostAt < this.hold.chainEnd) this.suppressedAt = lostAt;
      this.hold = null;
    }

    const snapshot = await this.readPower();
    const now = this.o.clock.now();
    if (this.stopped) return;
    this.unknownStreak = snapshot.battery.kind === "unknown" ? this.unknownStreak + 1 : 0;
    const tolerate =
      snapshot.battery.kind === "unknown" &&
      this.hold !== null &&
      this.unknownStreak <= UNKNOWN_READS_TOLERATED;

    const candidates = this.activeWindows(now).filter((w) => w.startsAt > this.suppressedAt);
    const allowed: ScheduleWindow[] = [];
    let blocked: PowerBlock | null = null;
    const nowLow = new Set<string>();
    for (const w of candidates) {
      const spec = this.schedules.get(w.scheduleId);
      if (!spec) continue;
      const verdict = tolerate
        ? ({ allowed: true } as const)
        : judgePower(spec.power, snapshot, this.lowBattery.has(spec.id));
      if (verdict.allowed) {
        allowed.push(w);
        continue;
      }
      if (verdict.reason === "battery_low") nowLow.add(spec.id);
      if (w.startsAt <= now) blocked ??= verdict.reason;
    }
    this.lowBattery.clear();
    for (const id of nowLow) this.lowBattery.add(id);

    const current = mergeWindows(allowed).find((m) => m.startsAt <= now && m.endsAt > now);
    this.waiting = current ? null : blocked;

    if (this.hold && !current) {
      const expired = now >= this.hold.chainEnd;
      this.releaseHold(
        expired ? "expired" : (hint ?? releaseReasonFor(blocked)),
        expired ? "window_ended" : (blocked ?? "changed"),
      );
    } else if (this.hold && current) {
      this.hold.chainEnd = current.endsAt;
      await this.extendHold(current, now);
    }
    if (!this.hold && current && !this.stopped) await this.startHold(current, now);

    await this.syncWakes(now);
    this.arm(now);
  }

  private async extendHold(current: MergedWindow, now: number): Promise<void> {
    const hold = this.hold;
    if (!hold) return;
    const target = Math.min(current.endsAt, now + MAX_HOLD_MINUTES * MINUTE_MS);
    if (target <= hold.requestedEnd) return;
    const minutes = minutesBetween(hold.requestedEnd, target);
    try {
      this.o.controller.extend(hold.id, minutes);
      hold.requestedEnd += minutes * MINUTE_MS;
      this.emit("hold.extended", { id: hold.id, minutes });
    } catch {
      // The hold ran out between the check and the extend: drop it; the caller starts a fresh one.
      this.emit("hold.released", { id: hold.id, reason: "lost" });
      this.hold = null;
    }
  }

  private async startHold(current: MergedWindow, now: number): Promise<void> {
    const first = current.scheduleIds[0];
    const spec = first === undefined ? undefined : this.schedules.get(first);
    const minutes = Math.min(MAX_HOLD_MINUTES, minutesBetween(now, current.endsAt));
    try {
      const id = await this.o.controller.start(minutes, holdLabel(spec, first ?? "schedule"));
      if (this.stopped) {
        this.o.controller.end(id, "shutdown");
        return;
      }
      this.hold = { id, chainEnd: current.endsAt, requestedEnd: now + minutes * MINUTE_MS };
      this.waiting = null;
      this.emit("hold.started", { id, minutes, schedules: current.scheduleIds.join(",") });
    } catch (error) {
      const kind = error instanceof AwakeError ? error.kind : "other";
      this.waiting =
        kind === "conflict" ? "busy" : kind === "battery_low" ? "battery_floor" : "start_failed";
      this.emit("hold.waiting", { reason: this.waiting, error: kind });
    }
  }

  private releaseHold(reason: SessionEndReason, why: string): void {
    const hold = this.hold;
    if (!hold) return;
    this.hold = null;
    this.o.controller.end(hold.id, reason);
    this.emit("hold.released", { id: hold.id, reason: why });
  }

  private pruneSkips(now: number): void {
    for (const [key, until] of this.skips) {
      const id = key.slice(0, key.indexOf("@"));
      if (until <= now || !this.schedules.has(id)) this.skips.delete(key);
    }
  }

  // ── Timer ───────────────────────────────────────────────────────────────

  private arm(now: number): void {
    if (this.stopped) return;
    let next = now + (this.hold || this.waiting ? ACTIVE_RECHECK_MS : IDLE_RECHECK_MS);
    if (this.hold) next = Math.min(next, this.hold.chainEnd);
    for (const w of this.activeWindows(now)) {
      if (w.startsAt > now) next = Math.min(next, w.startsAt);
      if (w.endsAt > now) next = Math.min(next, w.endsAt);
    }
    const delay = Math.max(1, next - now);
    this.timer = this.o.clock.setTimer(() => {
      this.timer = undefined;
      void this.enqueue(() => this.reconcile()).catch(() => {
        this.emit("store.error", { code: "reconcile_failed" });
        this.arm(this.o.clock.now());
      });
    }, delay);
  }

  private disarm(): void {
    if (this.timer !== undefined) this.o.clock.clearTimer(this.timer);
    this.timer = undefined;
  }

  // ── OS wake registration (through the injected WakeScheduler only) ─────

  private async syncWakes(now: number): Promise<void> {
    const wake = this.o.wake;
    if (!wake) return;
    const desired = new Map<string, number>();
    for (const w of this.activeWindows(now)) {
      const spec = this.schedules.get(w.scheduleId);
      const at = w.startsAt - WAKE_LEAD_MS;
      if (spec?.wake && at > now && desired.size < MAX_WAKES) desired.set(`awake:${w.key}`, at);
    }
    for (const [key] of [...this.wakes]) {
      if (desired.has(key)) continue;
      try {
        await wake.cancel(key);
        this.wakes.delete(key);
        this.emit("wake.cancelled", { key });
      } catch {
        this.emit("wake.failed", { key, op: "cancel" });
      }
    }
    for (const [key, at] of desired) {
      if (this.wakes.get(key) === at) continue;
      if ((this.wakeRetryAt.get(key) ?? 0) > now) continue;
      try {
        await wake.schedule({ key, at });
        this.wakes.set(key, at);
        this.wakeRetryAt.delete(key);
        this.emit("wake.scheduled", { key, at });
      } catch {
        this.wakeRetryAt.set(key, now + WAKE_RETRY_MS);
        this.emit("wake.failed", { key, op: "schedule" });
      }
    }
  }

  private async cancelAllWakes(): Promise<void> {
    const wake = this.o.wake;
    if (!wake) return;
    for (const key of [...this.wakes.keys()]) {
      try {
        await wake.cancel(key);
        this.wakes.delete(key);
        this.emit("wake.cancelled", { key });
      } catch {
        this.emit("wake.failed", { key, op: "cancel" });
      }
    }
  }

  // ── Persistence ─────────────────────────────────────────────────────────

  private async persist(): Promise<void> {
    const store = this.o.store;
    if (!store) return;
    const state: PersistedState = {
      version: STATE_VERSION,
      enabled: this.enabled,
      schedules: [...this.schedules.values()].map(scheduleToInput),
      skips: [...this.skips],
    };
    try {
      await store.save(state);
    } catch {
      this.emit("store.error", { code: "save_failed" });
    }
  }

  /** Reads saved state as untrusted input; whatever does not validate is dropped and reported. */
  private async restore(): Promise<void> {
    const store = this.o.store;
    if (!store) return;
    let raw: unknown;
    try {
      raw = await store.load();
    } catch {
      this.emit("store.error", { code: "load_failed" });
      return;
    }
    if (raw === null || raw === undefined) return;
    if (typeof raw !== "object" || Reflect.get(raw, "version") !== STATE_VERSION) {
      this.emit("store.dropped", { what: "state", why: "unrecognised" });
      return;
    }
    const list: unknown = Reflect.get(raw, "schedules");
    const items = Array.isArray(list) ? list.slice(0, MAX_SCHEDULES) : [];
    items.forEach((item: unknown, index) => {
      try {
        const spec = parseScheduleInput(item);
        this.checkContinuity([...this.others(spec.id), spec]);
        this.schedules.set(spec.id, spec);
      } catch {
        this.emit("store.dropped", { what: "schedule", index });
      }
    });
    const skips: unknown = Reflect.get(raw, "skips");
    if (Array.isArray(skips)) {
      for (const entry of skips.slice(0, MAX_SKIPS)) {
        const key: unknown = Array.isArray(entry) ? entry[0] : undefined;
        const until: unknown = Array.isArray(entry) ? entry[1] : undefined;
        if (typeof key === "string" && SKIP_KEY.test(key) && typeof until === "number") {
          if (Number.isFinite(until)) this.skips.set(key, until);
        }
      }
    }
    // Opt-in survives a restart only when the person had turned it on.
    this.enabled = Reflect.get(raw, "enabled") === true;
  }

  private emit(type: ScheduleEvent["type"], detail: ScheduleEvent["detail"]): void {
    try {
      this.o.emit({ type, at: this.o.clock.now(), detail });
    } catch {
      // An audit sink that throws must not change what the scheduler does.
    }
  }
}
