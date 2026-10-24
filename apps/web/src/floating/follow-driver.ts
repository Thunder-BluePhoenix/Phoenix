// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Drives the Phase 59 follow-the-pointer / fly-home state machine (`followStep`, pet/runtime) for
// the floating Fawkes window. The machine decides; this class does the I/O it asks for: it polls
// the pointer through the `FollowShell`, and moves the window with the existing `moveBy` command
// (a screen-space delta in CSS pixels). Nothing here knows Tauri, React or the clock: timers are
// injected, so tests run it without waiting.
//
// What stops it, always, whatever the machine says: the user's opt-in is off, quiet mode or the
// emergency stop (`suspended`), the window is hidden, the window cannot be read or the pointer
// cannot be read five times in a row (a system that will not report the pointer, such as some
// Wayland sessions, is left alone rather than guessed at). Under reduced motion every move is
// instant and happens only once the pointer has rested, never as a continuous glide.
import {
  followStep,
  INITIAL_FOLLOW_STATE,
  type FollowCommand,
  type FollowEvent,
  type FollowState,
} from "@phoenix/pet-runtime";
import type { Area, FollowShell, PhysicalPoint, WindowPlace } from "./follow-shell";

export interface FollowTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const realTimers: FollowTimers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as never),
};

/** How often the pointer is read while following. */
export const POLL_MS = 100;
/** How often an animated flight takes a step (about 30 frames a second). */
export const FRAME_MS = 33;
/** How often the window's visibility is read while the feature is on. */
export const VISIBLE_MS = 1_000;
/** Polls with the pointer still before a reduced-motion move happens. */
export const SETTLE_POLLS = 2;
/** Pointer reads that fail in a row before the driver gives up until restarted. */
export const MAX_READ_FAILURES = 5;
/** Fawkes sits this far (CSS pixels) right of and below the pointer, never under it. */
export const OFFSET_CSS_PX = 16;
/** Share of the remaining distance covered in one frame, and the least a frame moves. */
export const EASE = 0.3;
export const MIN_STEP_PX = 3;
/** Within this many physical pixels the flight has arrived. */
export const ARRIVE_PX = 2;

/** `point` as the window's top-left corner, kept so the whole window stays inside `area`. */
export function clampTo(
  point: PhysicalPoint,
  window: { width: number; height: number },
  area: Area,
): PhysicalPoint {
  const clamp = (value: number, low: number, size: number, span: number) =>
    span >= size ? Math.min(Math.max(value, low), low + span - size) : low;
  return {
    x: clamp(point.x, area.x, window.width, area.width),
    y: clamp(point.y, area.y, window.height, area.height),
  };
}

export interface FollowDriverOptions {
  shell: FollowShell;
  /** The existing window-move command: a screen-space delta in CSS pixels. */
  moveBy: (dx: number, dy: number) => void;
  timers?: FollowTimers;
}

export class FollowDriver {
  private state: FollowState = { ...INITIAL_FOLLOW_STATE };
  private enabled = false;
  /** Suspended until the page has said that Phoenix is not quiet. */
  private suspended = true;
  /** Hidden until the first visibility read says the window is shown. */
  private hidden = true;
  private disposed = false;
  private home: PhysicalPoint | null = null;
  private place: WindowPlace | null = null;
  private dest: PhysicalPoint | null = null;
  private lastCursor: PhysicalPoint | null = null;
  private placedFor: PhysicalPoint | null = null;
  private stable = 0;
  private failures = 0;
  private pollTimer: unknown = null;
  private frameTimer: unknown = null;
  private visibleTimer: unknown = null;
  private polling = false;
  /** Bumped whenever a pending asynchronous step must not finish (stop, drag, switch off). */
  private epoch = 0;
  private readonly timers: FollowTimers;
  private readonly shell: FollowShell;
  private readonly moveBy: (dx: number, dy: number) => void;

  constructor(options: FollowDriverOptions) {
    this.shell = options.shell;
    this.moveBy = options.moveBy;
    this.timers = options.timers ?? realTimers;
  }

  /** The machine's current state (for tests and the page). */
  get snapshot(): Readonly<FollowState> {
    return this.state;
  }

  /** True while the driver has given up because the system would not report the pointer. */
  get unavailable(): boolean {
    return this.failures >= MAX_READ_FAILURES;
  }

  /** The user's opt-in (Settings). Off by default; nothing is read or moved while it is off. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    this.sync();
  }

  /** Quiet mode, quiet hours, the emergency stop or the demo: no movement at all. */
  setSuspended(on: boolean): void {
    this.suspended = on;
    this.sync();
  }

  /** Whether an urgent state (error, needs you, recording) is showing: Fawkes flies home. */
  setAlert(on: boolean): void {
    this.feed({ type: on ? "alert-raised" : "alert-cleared" });
  }

  setReducedMotion(reduced: boolean): void {
    this.feed({ type: "reduced-motion", reduced });
  }

  dragStarted(): void {
    this.epoch++;
    this.feed({ type: "drag-started" });
  }

  dragEnded(): void {
    // The pointer moved on while Fawkes was held: the next read counts as a change, so a Fawkes
    // that was following goes back to the pointer without waiting for it to move again.
    this.lastCursor = null;
    this.placedFor = null;
    this.stable = 0;
    this.feed({ type: "drag-ended" });
    // Where the person put Fawkes down is home, unless Fawkes is out following the pointer.
    if (this.state.phase === "docked" || this.state.phase === "home-alert") void this.captureHome();
  }

  /** Stops everything. The window stays where it is: the page is going away. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopAll();
  }

  // ── State machine ──────────────────────────────────────────────────────────

  private effective(): boolean {
    return this.enabled && !this.suspended && !this.hidden && !this.disposed && !this.unavailable;
  }

  /** Fawkes is away from home because of following. */
  private isOut(): boolean {
    const phase = this.state.phase;
    return phase === "following" || phase === "returning" || phase === "flying-home";
  }

  private sync(): void {
    if (this.disposed) return;
    const want = this.effective();
    // The visibility probe runs while the feature is on, so a window shown again is noticed.
    if (this.enabled && !this.suspended && this.visibleTimer === null) {
      this.visibleTimer = this.timers.setInterval(() => void this.probeVisible(), VISIBLE_MS);
      void this.probeVisible();
    } else if ((!this.enabled || this.suspended) && this.visibleTimer !== null) {
      this.timers.clearInterval(this.visibleTimer);
      this.visibleTimer = null;
    }
    if (want === this.state.followEnabled) return;
    if (want) {
      const epoch = ++this.epoch;
      void this.captureHome().then(() => {
        if (epoch === this.epoch && this.effective())
          this.feed({ type: "follow-enabled", enabled: true });
      });
      return;
    }
    this.epoch++;
    const wasOut = this.isOut();
    this.stopAll(false);
    this.feed({ type: "follow-enabled", enabled: false });
    // Only the person turning following off sends Fawkes back; quiet, hidden and the emergency stop
    // leave the window exactly where it is.
    if (wasOut && !this.enabled && !this.hidden) void this.goHome();
  }

  private async probeVisible(): Promise<void> {
    let shown = false;
    try {
      shown = await this.shell.visible();
    } catch {
      shown = false;
    }
    if (this.disposed) return;
    if (this.hidden === !shown) return;
    this.hidden = !shown;
    this.sync();
  }

  private feed(event: FollowEvent): void {
    if (this.disposed) return;
    const step = followStep(this.state, event);
    this.state = step.state;
    for (const command of step.commands) this.run(command);
  }

  private run(command: FollowCommand): void {
    switch (command.kind) {
      case "track-cursor":
        if (command.on) this.startPolling();
        else this.stopPolling();
        return;
      case "stop-move":
        this.epoch++;
        this.stopFrames();
        return;
      case "move":
        // A machine that is not allowed to move (switched off, quiet, hidden) moves nothing.
        if (this.effective()) void this.startMove(command.to, command.animate);
        return;
    }
  }

  // ── Reading ────────────────────────────────────────────────────────────────

  private async readPlace(): Promise<WindowPlace | null> {
    try {
      const place = await this.shell.window();
      if (place) this.place = place;
      return place;
    } catch {
      return null;
    }
  }

  private async captureHome(): Promise<void> {
    const place = await this.readPlace();
    if (place) this.home = { x: place.x, y: place.y };
  }

  private startPolling(): void {
    if (this.pollTimer !== null) return;
    this.stable = 0;
    this.lastCursor = null;
    this.placedFor = null;
    this.pollTimer = this.timers.setInterval(() => void this.poll(), POLL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer === null) return;
    this.timers.clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private async poll(): Promise<void> {
    // A slow read never stacks another behind it.
    if (this.polling || !this.effective()) return;
    this.polling = true;
    try {
      let cursor: PhysicalPoint | null = null;
      try {
        cursor = await this.shell.cursor();
      } catch {
        cursor = null;
      }
      if (this.disposed || this.pollTimer === null) return;
      if (!cursor) {
        this.failures++;
        if (this.unavailable) this.sync();
        return;
      }
      this.failures = 0;
      const moved =
        !this.lastCursor || cursor.x !== this.lastCursor.x || cursor.y !== this.lastCursor.y;
      this.stable = moved ? 0 : this.stable + 1;
      this.lastCursor = cursor;
      const differs =
        !this.placedFor || cursor.x !== this.placedFor.x || cursor.y !== this.placedFor.y;
      // Animated: follow every change. Reduced motion: wait until the pointer has rested.
      const due = this.state.reducedMotion ? this.stable === SETTLE_POLLS && differs : moved;
      if (due) {
        this.placedFor = cursor;
        this.feed({ type: "cursor-moved" });
      }
    } finally {
      this.polling = false;
    }
  }

  // ── Moving ─────────────────────────────────────────────────────────────────

  private async startMove(to: "cursor" | "home", animate: boolean): Promise<void> {
    const epoch = ++this.epoch;
    this.stopFrames();
    const place = await this.readPlace();
    if (epoch !== this.epoch || !this.effective()) return;
    let dest: PhysicalPoint | null = null;
    if (to === "home") dest = this.home;
    else {
      let cursor: PhysicalPoint | null = null;
      try {
        cursor = await this.shell.cursor();
      } catch {
        cursor = null;
      }
      if (epoch !== this.epoch || !this.effective()) return;
      const scale = place?.scale ?? 1;
      if (cursor) {
        const wanted = { x: cursor.x + OFFSET_CSS_PX * scale, y: cursor.y + OFFSET_CSS_PX * scale };
        let area: Area | null = null;
        try {
          area = await this.shell.area(cursor);
        } catch {
          area = null;
        }
        if (epoch !== this.epoch || !this.effective()) return;
        dest = place && area ? clampTo(wanted, place, area) : wanted;
      }
    }
    if (!place || !dest) {
      // Nothing to aim at or nothing to move: the trip is over (the machine must not wait on it).
      this.feed({ type: "arrived" });
      return;
    }
    this.dest = dest;
    if (!animate) {
      this.jumpTo(dest, place);
      this.feed({ type: "arrived" });
      return;
    }
    this.frameTimer = this.timers.setInterval(() => this.frame(epoch), FRAME_MS);
  }

  /** Moves the window by the whole difference at once. */
  private jumpTo(dest: PhysicalPoint, place: WindowPlace): void {
    const px = Math.round(dest.x - place.x);
    const py = Math.round(dest.y - place.y);
    if (px === 0 && py === 0) return;
    this.moveBy(px / place.scale, py / place.scale);
    this.place = { ...place, x: place.x + px, y: place.y + py };
  }

  private frame(epoch: number): void {
    const place = this.place;
    const dest = this.dest;
    if (epoch !== this.epoch || !this.effective() || !place || !dest) {
      this.stopFrames();
      return;
    }
    const dx = dest.x - place.x;
    const dy = dest.y - place.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= ARRIVE_PX) {
      // The last pixels in one move, so the flight ends exactly on its target.
      this.jumpTo(dest, place);
      this.stopFrames();
      this.feed({ type: "arrived" });
      return;
    }
    const step = Math.min(distance, Math.max(MIN_STEP_PX, distance * EASE));
    const px = Math.round((dx * step) / distance);
    const py = Math.round((dy * step) / distance);
    this.moveBy(px / place.scale, py / place.scale);
    this.place = { ...place, x: place.x + px, y: place.y + py };
  }

  private stopFrames(): void {
    if (this.frameTimer === null) return;
    this.timers.clearInterval(this.frameTimer);
    this.frameTimer = null;
  }

  private stopAll(clearVisible = true): void {
    this.stopPolling();
    this.stopFrames();
    if (clearVisible && this.visibleTimer !== null) {
      this.timers.clearInterval(this.visibleTimer);
      this.visibleTimer = null;
    }
    this.epoch++;
  }

  /** Puts the window back where following began, in one move. */
  private async goHome(): Promise<void> {
    const home = this.home;
    if (!home) return;
    const place = await this.readPlace();
    if (place) this.jumpTo(home, place);
  }
}
