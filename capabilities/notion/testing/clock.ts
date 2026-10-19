// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { expect, vi } from "vitest";

/** Replaces the capability's timers: every wait is recorded and ends only when the test says so. */
export class Clock {
  now: number;
  readonly sleeps: number[] = [];
  private pending: PromiseWithResolvers<void> | undefined;

  constructor(start: number) {
    this.now = start;
  }

  readonly sleep = (ms: number, signal: AbortSignal): Promise<void> => {
    this.sleeps.push(ms);
    const wait = Promise.withResolvers<void>();
    this.pending = wait;
    signal.addEventListener("abort", () => wait.resolve(), { once: true });
    return wait.promise;
  };

  /** Ends the current wait; resolves once the next poll cycle has finished and a new wait began. */
  async tick(): Promise<void> {
    const before = this.sleeps.length;
    this.pending?.resolve();
    await vi.waitFor(() => expect(this.sleeps.length).toBeGreaterThan(before));
  }

  /** Ends the current wait without expecting a new one (the poller may be paused). */
  release(): void {
    this.pending?.resolve();
  }

  /** Resolves once the first poll cycle has finished. */
  first(): Promise<void> {
    return vi.waitFor(() => expect(this.sleeps.length).toBeGreaterThan(0));
  }
}
