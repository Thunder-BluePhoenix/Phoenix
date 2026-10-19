// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Replaces the capability's timers: every wait is recorded and ends only when the test says so.
import { expect, vi } from "vitest";

export class Clock {
  now = Date.parse("2026-10-05T09:00:00Z");
  readonly sleeps: number[] = [];
  private pending: PromiseWithResolvers<void> | undefined;

  readonly sleep = (ms: number, signal: AbortSignal): Promise<void> => {
    this.sleeps.push(ms);
    const wait = Promise.withResolvers<void>();
    this.pending = wait;
    signal.addEventListener("abort", () => wait.resolve(), { once: true });
    return wait.promise;
  };

  /** Ends the current wait without waiting for the next cycle (it may never come). */
  release(): void {
    this.pending?.resolve();
  }

  /** Ends the current wait; resolves once the next poll cycle has finished and a new wait began. */
  async tick(): Promise<void> {
    const before = this.sleeps.length;
    this.release();
    await vi.waitFor(() => expect(this.sleeps.length).toBeGreaterThan(before));
  }

  /** Resolves once the first poll cycle has finished. */
  first(): Promise<void> {
    return vi.waitFor(() => expect(this.sleeps.length).toBeGreaterThan(0));
  }
}
