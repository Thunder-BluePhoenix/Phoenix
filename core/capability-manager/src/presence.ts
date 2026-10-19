// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/**
 * Whether anything is watching Core right now (an open window, a connected client).
 * Pollers of remote services read it so they stop calling out when nobody would see the result.
 * Starts as "watched" so a capability enabled before the first client connects still works.
 */
export class ViewerPresence {
  private watching = true;
  private readonly waiters = new Set<() => void>();

  get watched(): boolean {
    return this.watching;
  }

  /** Reports how many clients are connected. Waiters are released the moment it becomes > 0. */
  setClients(count: number): void {
    this.watching = count > 0;
    if (!this.watching) return;
    for (const wake of [...this.waiters]) wake();
  }

  /** Resolves when something is watching (immediately if it already is), or when `signal` aborts. */
  untilWatched(signal: AbortSignal): Promise<void> {
    if (this.watching || signal.aborted) return Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    const done = () => {
      this.waiters.delete(done);
      signal.removeEventListener("abort", done);
      resolve();
    };
    this.waiters.add(done);
    signal.addEventListener("abort", done, { once: true });
    return promise;
  }
}
