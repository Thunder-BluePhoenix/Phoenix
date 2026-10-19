// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { CapabilityContext } from "@phoenix/sdk";
import { ServiceError } from "./error";

/** Waits `ms`, or less if `signal` aborts. Tests replace it to control time. */
export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

export const realSleep: Sleep = (ms, signal) => {
  const { promise, resolve } = Promise.withResolvers<void>();
  const timer = setTimeout(resolve, ms);
  signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      resolve();
    },
    { once: true },
  );
  return promise;
};

export const MAX_FAILURE_BACKOFF_MS = 5 * 60_000;
const AUTH_BACKOFF_MS = 5 * 60_000;
const MAX_RETRY_AFTER_WAIT_MS = 60 * 60_000;

/**
 * How long to wait before the next poll. Never shorter than the interval; doubles with each failure
 * in a row (capped); waits longer after 401 (a credential does not fix itself) and for as long as
 * the service asked in Retry-After.
 */
export function nextDelay(intervalMs: number, failures: number, last?: ServiceError): number {
  let delay = intervalMs;
  if (failures > 0) {
    delay = Math.max(delay, Math.min(intervalMs * 2 ** failures, MAX_FAILURE_BACKOFF_MS));
  }
  if (last?.kind === "auth") delay = Math.max(delay, AUTH_BACKOFF_MS);
  if (last?.retryAfterMs !== undefined) {
    delay = Math.max(delay, Math.min(last.retryAfterMs, MAX_RETRY_AFTER_WAIT_MS));
  }
  return delay;
}

/**
 * Runs `cycle` forever until the capability is stopped. Before each cycle it waits until something
 * is watching Core (`ctx.untilWatched`), so a service is not called while nobody would see the
 * result. `cycle` resolves with the delay before the next one.
 */
export function startPolling(
  ctx: CapabilityContext,
  cycle: () => Promise<number>,
  sleep: Sleep = realSleep,
): void {
  void (async () => {
    while (!ctx.signal.aborted) {
      await ctx.untilWatched();
      if (ctx.signal.aborted) break;
      let delay: number;
      try {
        delay = await cycle();
      } catch (err) {
        ctx.logger.warn("poll cycle failed", {
          error: err instanceof Error ? err.name : "unknown",
        });
        delay = MAX_FAILURE_BACKOFF_MS;
      }
      await sleep(delay, ctx.signal);
    }
  })();
}

/** What changed for one tracked item between two polls. */
export interface Change<T> {
  item: T;
  /** The first time the item is seen after Phoenix started watching. */
  kind: "new" | "changed";
  previous?: string;
}

/**
 * Remembers the last state of each item so the poller announces a change once.
 * History rule: an item first seen with a timestamp older than `liveSince` is recorded silently,
 * so enabling a capability does not replay last week's deployments as news.
 */
export class ChangeTracker<T> {
  private readonly states = new Map<string, string>();

  constructor(
    private readonly options: {
      key: (item: T) => string;
      state: (item: T) => string;
      /** Epoch ms of the item, for the history rule. */
      at: (item: T) => number;
      liveSince: number;
      /** Oldest entries are forgotten beyond this many, so memory stays bounded. */
      max?: number;
    },
  ) {}

  update(items: readonly T[]): Change<T>[] {
    const changes: Change<T>[] = [];
    const max = this.options.max ?? 500;
    for (const item of items) {
      const key = this.options.key(item);
      const state = this.options.state(item);
      const before = this.states.get(key);
      if (before === undefined) {
        if (this.options.at(item) >= this.options.liveSince) changes.push({ item, kind: "new" });
      } else if (before !== state) {
        changes.push({ item, kind: "changed", previous: before });
      }
      this.states.delete(key);
      this.states.set(key, state);
    }
    while (this.states.size > max) this.states.delete(this.states.keys().next().value as string);
    return changes;
  }
}
