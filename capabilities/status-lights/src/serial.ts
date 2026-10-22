// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/**
 * One write at a time per key, newest wins. Scheduling a write aborts the one still running for
 * that key and queues behind it, so a slow or stuck device can neither reorder nor pile up writes.
 * `run` owns its error reporting; a throw is swallowed so the queue keeps moving.
 */
export class SerialWriter {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly aborts = new Map<string, AbortController>();
  private readonly inflight = new Set<Promise<void>>();

  schedule(key: string, run: (signal: AbortSignal) => Promise<void>): void {
    const previous = this.tails.get(key);
    this.aborts.get(key)?.abort();
    const ctrl = new AbortController();
    this.aborts.set(key, ctrl);
    const job = (async () => {
      await previous;
      if (ctrl.signal.aborted) return;
      try {
        await run(ctrl.signal);
      } catch {
        // `run` reports its own failures.
      } finally {
        if (this.aborts.get(key) === ctrl) this.aborts.delete(key);
      }
    })();
    this.tails.set(key, job);
    this.inflight.add(job);
    void job.finally(() => {
      this.inflight.delete(job);
      if (this.tails.get(key) === job) this.tails.delete(key);
    });
  }

  /** Aborts the running write for `key`; anything queued behind it is already aborted. */
  cancel(key: string): void {
    this.aborts.get(key)?.abort();
    this.aborts.delete(key);
  }

  cancelAll(): void {
    for (const ctrl of this.aborts.values()) ctrl.abort();
    this.aborts.clear();
  }

  /** Resolves once every scheduled write has finished or been aborted. */
  async drained(): Promise<void> {
    while (this.inflight.size > 0) await Promise.all([...this.inflight]);
  }
}
