// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { DemoSession } from "./demo";
import type { DemoController } from "./demo-controller";

/** How long one step stays on screen before the next one starts, unless the options say otherwise. */
export const DEFAULT_STEP_INTERVAL_MS = 6000;

/** `idle`: not running. `playing`: a timer is advancing the steps. `paused`: stopped in place. */
export type DemoTimelineStatus = "idle" | "playing" | "paused";

export interface DemoTimelineSnapshot {
  status: DemoTimelineStatus;
  /** The system asks for reduced motion. The timeline never starts by itself in any case, and pressing play still works; only a run in progress is paused when the preference turns on. */
  reducedMotion: boolean;
  intervalMs: number;
}

/** The timer functions the timeline uses; tests pass fake ones (or use fake timers on the globals). */
export interface DemoTimelineTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** The "prefers-reduced-motion: reduce" preference and its changes. */
export interface ReducedMotionSource {
  matches(): boolean;
  subscribe(listener: () => void): () => void;
}

export interface DemoTimelineOptions {
  /** Milliseconds between two steps; a finite number above zero. */
  intervalMs?: number;
  timers?: DemoTimelineTimers;
  reducedMotion?: ReducedMotionSource;
}

const globalTimers: DemoTimelineTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  // The handle is whatever this runtime's setTimeout returned; `never` lets it back in unchanged.
  clearTimeout: (handle) => clearTimeout(handle as never),
};

const NO_MOTION_PREFERENCE: ReducedMotionSource = {
  matches: () => false,
  subscribe: () => () => {},
};

function windowReducedMotion(): ReducedMotionSource {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return NO_MOTION_PREFERENCE;
  }
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  return {
    matches: () => query.matches,
    subscribe: (listener) => {
      query.addEventListener?.("change", listener);
      return () => query.removeEventListener?.("change", listener);
    },
  };
}

/**
 * An optional, user-started, timed run through the demo's walkthrough steps. It never starts by
 * itself: only `play()` starts it, and it plays the same steps through the same controller as the
 * Next button, so the isolation rules of the demo are unchanged.
 *
 * It ends (to `idle`, leaving the screen as it is) the moment anything else drives the walkthrough:
 * a step played by hand, the route changed by hand, the demo stopping or being replaced, a step that
 * fails, or the last step finishing. `stop()` is the user's own stop and also rewinds the walkthrough
 * to its start. `pause()` keeps the position. Nothing outlives `attach()`'s cleanup: the one timer is
 * cleared and every subscription removed.
 */
export class DemoTimeline {
  private snap: DemoTimelineSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly timers: DemoTimelineTimers;
  private readonly motion: ReducedMotionSource;
  private timer: unknown = null;
  private hasTimer = false;
  /** The step the timeline last asked for; a different step in the controller means someone else played. */
  private expected = -1;
  /** True while the timeline's own `controller.play` is in flight. */
  private ownPlay = false;
  /** Bumped on every halt so a step that was in flight when it happened does not touch the new state. */
  private generation = 0;
  private session: DemoSession | null = null;
  private detach: (() => void) | null = null;

  constructor(
    private readonly controller: DemoController,
    options: DemoTimelineOptions = {},
  ) {
    const intervalMs = options.intervalMs ?? DEFAULT_STEP_INTERVAL_MS;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new RangeError("The demo timeline interval must be a finite number above zero");
    }
    this.timers = options.timers ?? globalTimers;
    this.motion = options.reducedMotion ?? windowReducedMotion();
    this.snap = { status: "idle", reducedMotion: this.motion.matches(), intervalMs };
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): DemoTimelineSnapshot => this.snap;

  /** Starts listening to the controller and the motion preference. The returned cleanup undoes all of it. */
  attach(): () => void {
    if (this.detach) return this.detach;
    const offController = this.controller.subscribe(this.onController);
    const offMotion = this.motion.subscribe(this.onMotion);
    this.onMotion();
    this.detach = () => {
      this.halt();
      offController();
      offMotion();
      this.detach = null;
    };
    return this.detach;
  }

  /** Starts, or resumes, advancing the steps. The one way it ever starts. */
  play(): void {
    if (!this.detach || this.snap.status === "playing") return;
    const s = this.controller.getSnapshot();
    const total = s.session?.steps.length ?? 0;
    if (s.phase !== "on" || !s.session || total === 0 || s.playing) return;
    this.session = s.session;
    this.set({ status: "playing" });
    if (s.step >= 0 && s.step < total - 1) {
      // Mid-way (paused, or the user stepped there by hand): keep the step on screen, then go on.
      this.expected = s.step;
      this.schedule();
      return;
    }
    // At the start, or after the last step: (re)start from the first step.
    void this.playStep(0);
  }

  /** Stops advancing and keeps the current step; `play()` goes on from it. */
  pause(): void {
    if (this.snap.status !== "playing") return;
    this.clearTimer();
    this.set({ status: "paused" });
  }

  /** The user's stop: ends the timeline and rewinds the walkthrough to its start. */
  stop(): void {
    if (this.snap.status === "idle") return;
    this.halt();
    this.controller.rewind();
  }

  /** Tells the timeline the hash route changed (without `#`); any route other than the current step's is manual navigation. */
  routeChanged(route: string): void {
    if (this.snap.status === "idle") return;
    const s = this.controller.getSnapshot();
    const step = s.step >= 0 ? s.session?.steps[s.step] : undefined;
    if (step && route !== step.route) this.halt();
  }

  private readonly onController = (): void => {
    if (this.snap.status === "idle") return;
    const s = this.controller.getSnapshot();
    if (
      s.phase !== "on" ||
      s.session !== this.session ||
      s.step !== this.expected ||
      (s.playing && !this.ownPlay)
    ) {
      this.halt();
    }
  };

  private readonly onMotion = (): void => {
    const reducedMotion = this.motion.matches();
    if (reducedMotion !== this.snap.reducedMotion) this.set({ reducedMotion });
    if (reducedMotion) this.pause();
  };

  private readonly tick = (): void => {
    this.hasTimer = false;
    if (this.snap.status !== "playing") return;
    const s = this.controller.getSnapshot();
    if (s.playing) {
      this.schedule();
      return;
    }
    const total = s.session?.steps.length ?? 0;
    if (s.step + 1 >= total) {
      this.halt();
      return;
    }
    void this.playStep(s.step + 1);
  };

  private async playStep(index: number): Promise<void> {
    const generation = this.generation;
    const total = this.controller.getSnapshot().session?.steps.length ?? 0;
    this.expected = index;
    this.ownPlay = true;
    if (index < total - 1) this.schedule();
    await this.controller.play(index);
    if (generation !== this.generation) return;
    this.ownPlay = false;
    const after = this.controller.getSnapshot();
    if (after.error !== null || after.step !== index) {
      this.halt();
      return;
    }
    // The last step has played: the run is over and the screen stays on it.
    if (index >= total - 1 && this.snap.status === "playing") this.halt();
  }

  private schedule(): void {
    this.clearTimer();
    this.timer = this.timers.setTimeout(this.tick, this.snap.intervalMs);
    this.hasTimer = true;
  }

  private clearTimer(): void {
    if (!this.hasTimer) return;
    this.timers.clearTimeout(this.timer);
    this.timer = null;
    this.hasTimer = false;
  }

  private halt(): void {
    this.generation += 1;
    this.clearTimer();
    this.ownPlay = false;
    this.expected = -1;
    this.session = null;
    if (this.snap.status !== "idle") this.set({ status: "idle" });
  }

  private set(patch: Partial<DemoTimelineSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const listener of [...this.listeners]) listener();
  }
}
