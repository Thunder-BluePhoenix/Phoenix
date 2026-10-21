// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The one keep-awake session. A session is ALWAYS bounded (no indefinite mode):
//   timed          ends at a fixed time; `extend` adds minutes up to a cap.
//   agents_grace   holds while any coding agent is working, ends `minutes` after the last one stops.
// Every way a session can end (end, expiry, disable, kill switch, shutdown, battery floor, a dead
// or unstartable inhibitor) goes through `end()`, which releases the hold first and only once.
import { belowFloor, watchBattery, type BatteryWatch } from "./battery";
import { MAX_HOLD_SECONDS, type InhibitHandle, type Inhibitor } from "./inhibit";
import {
  AwakeError,
  type ActiveSession,
  type AgentEventFeed,
  type AwakeClock,
  type BatteryReading,
  type FeedEvent,
  type SessionEndReason,
  type SessionPort,
  type TimerHandle,
} from "./system";

export const MIN_SESSION_MINUTES = 1;
/** Seven days: the longest a session may run in total, and the most `extend` may leave remaining. */
export const MAX_SESSION_MINUTES = 7 * 24 * 60;
export const MAX_LABEL_LENGTH = 80;
/** An agent that reported "working" and then went silent this long is no longer counted. */
export const AGENT_STALE_MS = 60 * 60_000;
/** While agents work, the hold is renewed this often, each time for `AGENT_HOLD_SECONDS`. */
export const AGENT_RENEW_MS = 15 * 60_000;
export const AGENT_HOLD_SECONDS = 30 * 60;
/**
 * Where a hold is not tied to Core's pid (Linux, Windows), no single hold may outlast this: a
 * killed Core leaves the machine awake for at most this long, and the controller renews the hold
 * (make before break) every `AGENT_RENEW_MS`. Same piece size agents_grace has always used.
 */
export const MAX_HOLD_PIECE_SECONDS = AGENT_HOLD_SECONDS;
/** The agents capability's id: the only source whose `agent.*` events count as agent work. */
export const AGENTS_CAPABILITY_ID = "agents";
/** A hold's own timer may fire a moment before ours; that still counts as the session running out. */
const HOLD_EXIT_SLACK_MS = 2_000;
const MAX_TRACKED_AGENTS = 200;
const MAX_AGENT_ID_LENGTH = 200;

export type SessionMode = "timed" | "agents_grace";

/**
 * Characters a person cannot see: control, format (zero-width, bidi, tag characters U+E0000..E007F,
 * soft hyphen), line/paragraph separators. This is the same class as `HIDDEN_TEXT_CHARS` in
 * core/runtime/src/agent-approvals.ts, redefined here because capabilities must not import from
 * core/runtime. Added on top of it: variation selectors (U+FE00..FE0F, U+E0100..E01EF, which are
 * `Mn`, not `Cf`) and the combining grapheme joiner U+034F, which render as nothing. Plain spaces
 * and ordinary combining accents stay allowed.
 */
const UNSEEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Variation_Selector}\u034f]/u;

/** Whole minutes in 1..10080; rejects strings, NaN, fractions, negatives and anything huge. */
export function parseMinutes(value: unknown, field = "minutes"): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < MIN_SESSION_MINUTES ||
    value > MAX_SESSION_MINUTES
  ) {
    throw new AwakeError(
      "invalid",
      `${field} must be a whole number from ${MIN_SESSION_MINUTES} to ${MAX_SESSION_MINUTES}`,
    );
  }
  return value;
}

/** A short label the user typed; rejected (not cleaned) if it has control, bidi or zero-width characters. */
export function parseLabel(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_LABEL_LENGTH) {
    throw new AwakeError("invalid", `reason must be text of 1 to ${MAX_LABEL_LENGTH} characters`);
  }
  if (UNSEEN.test(value)) {
    throw new AwakeError("invalid", "reason must not contain control or invisible characters");
  }
  return value;
}

/**
 * Which agents are working right now, from the agents capability's lifecycle events. Pure: time is
 * passed in. Only `agent.working` / `agent.progress` count as working; a waiting, idle, started,
 * completed, failed or ended agent does not (a waiting agent needs a person, not a awake machine).
 */
export class AgentWorkTracker {
  private readonly seen = new Map<string, number>();

  apply(event: FeedEvent, now: number): void {
    const id = event.payload?.agent_id;
    if (typeof id !== "string" || id.length === 0 || id.length > MAX_AGENT_ID_LENGTH) return;
    switch (event.event_type) {
      case "agent.working":
      case "agent.progress":
        this.seen.delete(id);
        this.seen.set(id, now);
        while (this.seen.size > MAX_TRACKED_AGENTS) {
          const oldest = this.seen.keys().next();
          if (oldest.done) break;
          this.seen.delete(oldest.value);
        }
        return;
      case "agent.started":
      case "agent.waiting":
      case "agent.idle":
      case "agent.completed":
      case "agent.failed":
      case "agent.ended":
        this.seen.delete(id);
        return;
      default:
    }
  }

  /** Number of agents working, dropping any silent for `AGENT_STALE_MS`. */
  working(now: number): number {
    for (const [id, at] of this.seen) if (now - at >= AGENT_STALE_MS) this.seen.delete(id);
    return this.seen.size;
  }
}

export interface SessionControllerOptions {
  clock: AwakeClock;
  inhibitor: Inhibitor;
  battery: () => Promise<BatteryReading>;
  floor: number;
  batteryPollMs: number;
  /** Absent: agents_grace is refused, and the kill switch is only seen through disable/shutdown. */
  feed: AgentEventFeed | undefined;
  /** Publishes awake.session.* events. Failures are the caller's to swallow. */
  emit: (type: string, session: SessionEventFields) => void;
  newId: () => string;
}

/** What the controller tells the event publisher; index.ts shapes it into an event. */
export interface SessionEventFields {
  session_id: string;
  mode: SessionMode;
  label: string | undefined;
  minutes: number;
  ends_at: string | null;
  remaining_seconds: number | null;
  reason?: SessionEndReason;
}

export interface SessionStatus {
  active: boolean;
  session?: {
    id: string;
    mode: SessionMode;
    label?: string;
    started_at: string;
    ends_at: string | null;
    remaining_seconds: number | null;
    agents_working?: number;
    grace_minutes?: number;
  };
  battery_floor_percent: number;
  min_minutes: number;
  max_minutes: number;
}

interface Session {
  id: string;
  mode: SessionMode;
  label: string | undefined;
  startedAt: number;
  endsAt: number | null;
  /** Minutes asked for at start (grace minutes for agents_grace). */
  minutes: number;
  hardCap: number;
  tracker: AgentWorkTracker;
  hold: InhibitHandle;
  /** Epoch ms the current hold's own timer runs out. */
  holdEndsAt: number;
  deadline: TimerHandle | undefined;
  renew: TimerHandle | undefined;
  watch: BatteryWatch;
  unsubscribe: (() => void) | undefined;
}

const SUBSCRIBER_ID = "awake-session";
const KILL_SWITCH_EVENT = "security.kill_switch.engaged";
/** Reasons that mean the capability is going away: a start still in flight must not outlive it. */
const CANCELS_PENDING_START: ReadonlySet<SessionEndReason> = new Set([
  "disabled",
  "shutdown",
  "kill_switch",
]);

export class SessionController implements SessionPort {
  private session: Session | undefined;
  private starting = false;
  /** Set by shutdown / disable / kill switch while a start is waiting on the battery read. */
  private startCancelled = false;

  constructor(private readonly o: SessionControllerOptions) {}

  active(): ActiveSession | null {
    const s = this.session;
    return s ? { id: s.id, mode: s.mode, startedAt: s.startedAt, endsAt: s.endsAt } : null;
  }

  status(): SessionStatus {
    const s = this.session;
    const base = {
      battery_floor_percent: this.o.floor,
      min_minutes: MIN_SESSION_MINUTES,
      max_minutes: MAX_SESSION_MINUTES,
    };
    if (!s) return { active: false, ...base };
    return {
      active: true,
      session: {
        id: s.id,
        mode: s.mode,
        ...(s.label ? { label: s.label } : {}),
        started_at: new Date(s.startedAt).toISOString(),
        ends_at: s.endsAt === null ? null : new Date(s.endsAt).toISOString(),
        remaining_seconds: this.remaining(s),
        ...(s.mode === "agents_grace"
          ? { agents_working: s.tracker.working(this.o.clock.now()), grace_minutes: s.minutes }
          : {}),
      },
      ...base,
    };
  }

  /**
   * Starts a session. `signal` is the calling command's signal: a disable or the kill switch
   * aborts it, and a start that sees it aborted after any await gives up with `cancelled` before it
   * holds anything (the battery read is slow, and a disable landing in that window finds no session
   * to end).
   */
  async start(
    mode: SessionMode,
    minutes: number,
    label: string | undefined,
    signal?: AbortSignal,
  ): Promise<SessionStatus> {
    if (this.session || this.starting) {
      throw new AwakeError(
        "conflict",
        "A keep-awake session is already running. Extend it or end it first.",
      );
    }
    if (mode === "agents_grace" && !this.o.feed) {
      throw new AwakeError(
        "unavailable",
        "Agent events are not connected, so agents_grace is unavailable",
      );
    }
    this.starting = true;
    this.startCancelled = false;
    try {
      const reading = await this.o.battery();
      this.refuseIfCancelled(signal);
      if (belowFloor(reading, this.o.floor)) {
        throw new AwakeError(
          "battery_low",
          `The battery is below ${this.o.floor}%. Plug in to start a session.`,
        );
      }
      const now = this.o.clock.now();
      const hardCap = now + MAX_SESSION_MINUTES * 60_000;
      const endsAt = now + minutes * 60_000;
      const holdSeconds = this.holdSecondsFor(mode, endsAt, hardCap, now);
      const hold = this.o.inhibitor.acquire(holdSeconds);
      const session: Session = {
        id: this.o.newId(),
        mode,
        label,
        startedAt: now,
        endsAt,
        minutes,
        hardCap,
        tracker: new AgentWorkTracker(),
        hold,
        holdEndsAt: now + holdSeconds * 1000,
        deadline: undefined,
        renew: undefined,
        watch: { stop() {} },
        unsubscribe: undefined,
      };
      this.session = session;
      this.watchHold(session, hold);
      session.watch = watchBattery({
        read: this.o.battery,
        clock: this.o.clock,
        floor: this.o.floor,
        pollMs: this.o.batteryPollMs,
        initialUnknown: reading.kind === "unknown" ? 1 : 0,
        onTrip: () => this.end("battery"),
      });
      this.listen(session);
      if (mode === "agents_grace" || !this.o.inhibitor.parentBound) this.armRenew(session);
      this.armDeadline(session);
      this.o.emit("awake.session.started", this.fields(session, minutes));
    } finally {
      this.starting = false;
    }
    return this.status();
  }

  /** Adds minutes to a timed session. The remaining time never exceeds `MAX_SESSION_MINUTES`. */
  extend(minutes: number): SessionStatus {
    const s = this.session;
    if (!s) throw new AwakeError("no_session", "No keep-awake session is running");
    if (s.mode !== "timed" || s.endsAt === null) {
      throw new AwakeError("conflict", "Only a timed session can be extended");
    }
    const now = this.o.clock.now();
    const endsAt = s.endsAt + minutes * 60_000;
    if (endsAt - now > MAX_SESSION_MINUTES * 60_000) {
      throw new AwakeError(
        "limit",
        `A session can have at most ${MAX_SESSION_MINUTES} minutes left; it has ${Math.ceil((s.endsAt - now) / 60_000)}`,
      );
    }
    // Make before break: the new hold must run before the old one is let go.
    this.swapHold(s, this.holdSecondsFor(s.mode, endsAt, s.hardCap, now));
    s.endsAt = endsAt;
    this.armDeadline(s);
    this.o.emit("awake.session.extended", this.fields(s, minutes));
    return this.status();
  }

  /** Ends the session and releases the hold. Idempotent. Returns whether a session was running. */
  end(reason: SessionEndReason): boolean {
    const s = this.session;
    if (!s) {
      // A start still reading the battery has no session to end yet: make it give up instead.
      if (this.starting && CANCELS_PENDING_START.has(reason)) this.startCancelled = true;
      return false;
    }
    this.session = undefined;
    try {
      s.hold.release();
    } finally {
      if (s.deadline !== undefined) this.o.clock.clearTimer(s.deadline);
      if (s.renew !== undefined) this.o.clock.clearTimer(s.renew);
      s.watch.stop();
      s.unsubscribe?.();
      const ranMinutes = Math.floor((this.o.clock.now() - s.startedAt) / 60_000);
      this.o.emit("awake.session.ended", {
        ...this.fields(s, ranMinutes),
        ends_at: s.endsAt === null ? null : new Date(s.endsAt).toISOString(),
        remaining_seconds: null,
        reason,
      });
    }
    return true;
  }

  shutdown(): void {
    this.end("shutdown");
  }

  // ── internals ────────────────────────────────────────────────────────────

  private remaining(s: Session): number | null {
    return s.endsAt === null
      ? null
      : Math.max(0, Math.floor((s.endsAt - this.o.clock.now()) / 1000));
  }

  private fields(s: Session, minutes: number): SessionEventFields {
    return {
      session_id: s.id,
      mode: s.mode,
      label: s.label,
      minutes,
      ends_at: s.endsAt === null ? null : new Date(s.endsAt).toISOString(),
      remaining_seconds: this.remaining(s),
    };
  }

  /** The hold ended on its own: if the session is still running that means the hold was lost. */
  private watchHold(s: Session, hold: InhibitHandle): void {
    void hold.exited.then(() => {
      if (this.session !== s || s.hold !== hold) return;
      const due = s.endsAt !== null && this.o.clock.now() >= s.endsAt - HOLD_EXIT_SLACK_MS;
      this.end(due ? this.expiryReason(s) : "inhibitor_lost");
    });
  }

  private refuseIfCancelled(signal: AbortSignal | undefined): void {
    if (signal?.aborted || this.startCancelled || this.session) {
      throw new AwakeError("cancelled", "The keep-awake session was cancelled before it started");
    }
  }

  /**
   * How long the next hold should run. Where the hold is tied to Core's pid it may span the whole
   * wait; otherwise it is capped to `MAX_HOLD_PIECE_SECONDS` and renewed. `endsAt === null` is an
   * agents_grace session with agents working: renewed pieces up to the hard cap. A grace countdown
   * is held a minute past its end.
   */
  private holdSecondsFor(
    mode: SessionMode,
    endsAt: number | null,
    hardCap: number,
    now: number,
  ): number {
    const piece = this.o.inhibitor.parentBound ? MAX_HOLD_SECONDS : MAX_HOLD_PIECE_SECONDS;
    const wanted =
      endsAt === null
        ? Math.min(AGENT_HOLD_SECONDS, Math.ceil((hardCap - now) / 1000))
        : Math.ceil((endsAt - now) / 1000) + (mode === "agents_grace" ? 60 : 0);
    return Math.max(1, Math.min(wanted, piece));
  }

  private swapHold(s: Session, seconds: number): void {
    const held = Math.min(seconds, MAX_HOLD_SECONDS);
    const next = this.o.inhibitor.acquire(held);
    const old = s.hold;
    s.hold = next;
    s.holdEndsAt = this.o.clock.now() + held * 1000;
    this.watchHold(s, next);
    old.release();
  }

  /** A grace countdown that runs out means the agents are done; anything else simply expired. */
  private expiryReason(s: Session): SessionEndReason {
    return s.mode === "agents_grace" && s.endsAt !== null ? "agents_done" : "expired";
  }

  private armDeadline(s: Session): void {
    if (s.deadline !== undefined) this.o.clock.clearTimer(s.deadline);
    const at = Math.min(s.endsAt ?? s.hardCap, s.hardCap);
    s.deadline = this.o.clock.setTimer(
      () => void this.end(this.expiryReason(s)),
      Math.max(0, at - this.o.clock.now()),
    );
  }

  private armRenew(s: Session): void {
    s.renew = this.o.clock.setTimer(() => {
      if (this.session !== s) return;
      if (s.mode === "agents_grace") this.syncAgents(s, true);
      else this.renewTimed(s);
      if (this.session === s) this.armRenew(s);
    }, AGENT_RENEW_MS);
  }

  /** A timed session on a hold that is not pid-bound: the next piece starts before this one ends. */
  private renewTimed(s: Session): void {
    if (s.endsAt === null || s.holdEndsAt >= s.endsAt) return;
    try {
      const now = this.o.clock.now();
      this.swapHold(s, this.holdSecondsFor(s.mode, s.endsAt, s.hardCap, now));
    } catch {
      this.end("inhibitor_lost");
    }
  }

  private listen(s: Session): void {
    const feed = this.o.feed;
    if (!feed) return;
    const patterns =
      s.mode === "agents_grace" ? ["agent.*", KILL_SWITCH_EVENT] : [KILL_SWITCH_EVENT];
    try {
      s.unsubscribe = feed.subscribe(SUBSCRIBER_ID, patterns, (event) => {
        if (this.session !== s) return;
        if (event.event_type === KILL_SWITCH_EVENT) {
          this.end("kill_switch");
          return;
        }
        // Any capability may declare `agent.*` events; only the agents capability's count, or a
        // third one could keep the machine awake for days by faking "working".
        if (event.source !== AGENTS_CAPABILITY_ID) return;
        s.tracker.apply(event, this.o.clock.now());
        this.syncAgents(s, false);
      });
    } catch {
      // A duplicate subscriber id means a stale subscription; the session still works, and
      // disable/shutdown still release the hold.
      s.unsubscribe = undefined;
    }
  }

  /** Reconciles the grace countdown and the hold with how many agents are working now. */
  private syncAgents(s: Session, renewing: boolean): void {
    if (s.mode !== "agents_grace") return;
    const now = this.o.clock.now();
    const working = s.tracker.working(now) > 0;
    try {
      if (working) {
        const resumed = s.endsAt !== null;
        if (renewing || resumed)
          this.swapHold(s, this.holdSecondsFor(s.mode, null, s.hardCap, now));
        s.endsAt = null;
        this.armDeadline(s);
        if (resumed) this.o.emit("awake.session.extended", this.fields(s, 0));
      } else if (s.endsAt === null) {
        const endsAt = Math.min(now + s.minutes * 60_000, s.hardCap);
        this.swapHold(s, this.holdSecondsFor(s.mode, endsAt, s.hardCap, now));
        s.endsAt = endsAt;
        this.armDeadline(s);
        this.o.emit("awake.session.extended", this.fields(s, 0));
      } else if (renewing && s.holdEndsAt < s.endsAt) {
        // Grace countdown on a hold that is not pid-bound: the next piece, still counting down.
        this.swapHold(s, this.holdSecondsFor(s.mode, s.endsAt, s.hardCap, now));
      }
    } catch {
      this.end("inhibitor_lost");
    }
  }
}
