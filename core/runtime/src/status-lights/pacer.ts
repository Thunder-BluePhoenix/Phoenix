// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Rate bound shared by the light transports: callers claim send slots at least `minIntervalMs`
// apart, so a burst of state changes queues instead of strobing a light or flooding a bridge.

export function delay(ms: number, signal: AbortSignal): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  if (signal.aborted) {
    reject(signal.reason);
    return promise;
  }
  const onAbort = () => {
    clearTimeout(timer);
    reject(signal.reason);
  };
  const timer = setTimeout(() => {
    signal.removeEventListener("abort", onAbort);
    resolve();
  }, ms);
  signal.addEventListener("abort", onAbort, { once: true });
  return promise;
}

/** Claims the next send slot synchronously, so concurrent callers queue instead of bursting. */
export function createPacer(minIntervalMs: number): (signal: AbortSignal) => Promise<void> {
  let nextSlot = 0;
  return async (signal) => {
    const now = Date.now();
    const at = Math.max(now, nextSlot);
    nextSlot = at + minIntervalMs;
    if (at > now) await delay(at - now, signal);
  };
}
