// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ViewerPresence } from "@phoenix/capability-manager";
import { silentLogger } from "@phoenix/logging";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import type { CapabilityContext } from "@phoenix/sdk";
import { describe, expect, it } from "vitest";
import { ChangeTracker, nextDelay, ServiceError, startPolling, type Sleep } from "../src";

function fakeContext(presence: ViewerPresence) {
  const abort = new AbortController();
  const ctx: CapabilityContext = {
    id: "fake",
    config: {},
    logger: silentLogger,
    signal: abort.signal,
    secret: async () => undefined,
    watched: () => presence.watched,
    untilWatched: () => presence.untilWatched(abort.signal),
    emit: () => ({ ok: false, error: new PhoenixError(ErrorCode.INTERNAL_ERROR) }),
  };
  return { ctx, abort };
}

/** A sleep that never finishes by itself: the test decides when each wait ends. */
function manualSleep() {
  const waits: { ms: number; release: () => void }[] = [];
  const sleep: Sleep = (ms, signal) => {
    const { promise, resolve } = Promise.withResolvers<void>();
    waits.push({ ms, release: resolve });
    signal.addEventListener("abort", () => resolve(), { once: true });
    return promise;
  };
  return { sleep, waits };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("nextDelay", () => {
  const err = (kind: ServiceError["kind"], retryAfterMs?: number) =>
    new ServiceError("S", kind, "m", retryAfterMs);

  it("is the interval when all is well", () => {
    expect(nextDelay(30_000, 0)).toBe(30_000);
  });

  it("doubles with each failure in a row, capped at five minutes", () => {
    expect(nextDelay(30_000, 1)).toBe(60_000);
    expect(nextDelay(30_000, 2)).toBe(120_000);
    expect(nextDelay(30_000, 10)).toBe(300_000);
  });

  it("waits at least five minutes after an auth failure", () => {
    expect(nextDelay(30_000, 1, err("auth"))).toBe(300_000);
  });

  it("honours Retry-After but never longer than an hour", () => {
    expect(nextDelay(30_000, 1, err("rate_limit", 600_000))).toBe(600_000);
    expect(nextDelay(30_000, 1, err("rate_limit", 99_999_999))).toBe(3_600_000);
  });
});

describe("startPolling", () => {
  it("makes no call while nothing is watching, and resumes the moment something is", async () => {
    const presence = new ViewerPresence();
    presence.setClients(0);
    const { ctx, abort } = fakeContext(presence);
    const { sleep, waits } = manualSleep();
    let cycles = 0;
    startPolling(
      ctx,
      async () => {
        cycles++;
        return 1000;
      },
      sleep,
    );
    await settle();
    expect(cycles).toBe(0);
    presence.setClients(1);
    await settle();
    expect(cycles).toBe(1);
    expect(waits.at(-1)?.ms).toBe(1000);
    waits.at(-1)?.release();
    await settle();
    expect(cycles).toBe(2);
    // The last viewer leaves: the next cycle must not run.
    presence.setClients(0);
    waits.at(-1)?.release();
    await settle();
    expect(cycles).toBe(2);
    abort.abort();
    await settle();
    expect(cycles).toBe(2);
  });

  it("keeps polling after a cycle throws, backing off", async () => {
    const presence = new ViewerPresence();
    const { ctx, abort } = fakeContext(presence);
    const { sleep, waits } = manualSleep();
    let cycles = 0;
    startPolling(
      ctx,
      async () => {
        cycles++;
        if (cycles === 1) throw new Error("boom");
        return 1000;
      },
      sleep,
    );
    await settle();
    expect(cycles).toBe(1);
    expect(waits.at(-1)?.ms).toBe(300_000);
    waits.at(-1)?.release();
    await settle();
    expect(cycles).toBe(2);
    abort.abort();
  });

  it("stops when the capability is stopped while waiting for a viewer", async () => {
    const presence = new ViewerPresence();
    presence.setClients(0);
    const { ctx, abort } = fakeContext(presence);
    const { sleep } = manualSleep();
    let cycles = 0;
    startPolling(ctx, async () => (cycles++, 1000), sleep);
    await settle();
    abort.abort();
    presence.setClients(1);
    await settle();
    expect(cycles).toBe(0);
  });
});

describe("ChangeTracker", () => {
  interface Deploy {
    id: string;
    state: string;
    at: number;
  }
  const tracker = (liveSince: number, max?: number) =>
    new ChangeTracker<Deploy>({
      key: (d) => d.id,
      state: (d) => d.state,
      at: (d) => d.at,
      liveSince,
      ...(max !== undefined ? { max } : {}),
    });

  it("does not announce history that was already there when watching began", () => {
    const t = tracker(1000);
    expect(t.update([{ id: "a", state: "ready", at: 10 }])).toEqual([]);
    expect(t.update([{ id: "a", state: "ready", at: 10 }])).toEqual([]);
  });

  it("announces a new item at or after liveSince, then each state change once", () => {
    const t = tracker(1000);
    const first = t.update([{ id: "b", state: "building", at: 1000 }]);
    expect(first.map((c) => c.kind)).toEqual(["new"]);
    expect(t.update([{ id: "b", state: "building", at: 1000 }])).toEqual([]);
    const next = t.update([{ id: "b", state: "ready", at: 1000 }]);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ kind: "changed", previous: "building" });
  });

  it("announces a change to an item that predates liveSince", () => {
    const t = tracker(1000);
    t.update([{ id: "old", state: "building", at: 1 }]);
    expect(t.update([{ id: "old", state: "failed", at: 1 }])).toHaveLength(1);
  });

  it("keeps its memory bounded", () => {
    const t = tracker(0, 3);
    for (let i = 0; i < 10; i++) t.update([{ id: `d${i}`, state: "ready", at: 1 }]);
    // d0 was forgotten, so it looks new again; recent ones are still known.
    expect(t.update([{ id: "d9", state: "ready", at: 1 }])).toEqual([]);
    expect(t.update([{ id: "d0", state: "ready", at: 1 }])).toHaveLength(1);
  });
});
