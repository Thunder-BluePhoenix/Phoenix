// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { DeadLetterStore, EventStore, openDatabase } from "@phoenix/persistence";
import { createEvent, ErrorCode, type PhoenixEvent } from "@phoenix/protocol";
import { describe, expect, it } from "vitest";
import { EventBus, matchesPattern, RecentIds } from "../src";

const ev = (event_type = "build.started", extra: Partial<PhoenixEvent> = {}) =>
  createEvent({ event_type, source: "terminal", severity: "info", ...extra });

function setup(opts: ConstructorParameters<typeof EventBus>[0] = {}) {
  const db = openDatabase(":memory:");
  const store = new EventStore(db);
  const deadLetters = new DeadLetterStore(db);
  const bus = new EventBus({ store, deadLetters, retryDelayMs: 0, ...opts });
  return { bus, store, deadLetters };
}

describe("patterns", () => {
  it("matches wildcard, prefix and exact", () => {
    expect(matchesPattern("*", "a.b")).toBe(true);
    expect(matchesPattern("kage.*", "kage.meeting.started")).toBe(true);
    expect(matchesPattern("kage.*", "kagex.started")).toBe(false);
    expect(matchesPattern("build.failed", "build.failed")).toBe(true);
    expect(matchesPattern("build.failed", "build.failed.x")).toBe(false);
  });
});

describe("routing", () => {
  it("delivers to matching subscribers only, in order", async () => {
    const { bus } = setup();
    const builds: string[] = [];
    const all: string[] = [];
    bus.subscribe("builds", "build.*", (e) => void builds.push(e.event_type));
    bus.subscribe("all", "*", (e) => void all.push(e.event_type));
    bus.publish(ev("build.started"));
    bus.publish(ev("kage.meeting.started"));
    bus.publish(ev("build.passed"));
    await bus.drain();
    expect(builds).toEqual(["build.started", "build.passed"]);
    expect(all).toEqual(["build.started", "kage.meeting.started", "build.passed"]);
  });

  it("publish returns before handlers run", async () => {
    const { bus } = setup();
    let ran = false;
    bus.subscribe("s", "*", () => void (ran = true));
    bus.publish(ev());
    expect(ran).toBe(false);
    await bus.drain();
    expect(ran).toBe(true);
  });

  it("unsubscribe stops delivery", async () => {
    const { bus } = setup();
    const seen: string[] = [];
    const off = bus.subscribe("s", "*", (e) => void seen.push(e.event_id));
    off();
    bus.publish(ev());
    await bus.drain();
    expect(seen).toEqual([]);
  });

  it("rejects duplicate subscriber ids and invalid patterns", () => {
    const { bus } = setup();
    bus.subscribe("s", "*", () => {});
    expect(() => bus.subscribe("s", "*", () => {})).toThrow();
    expect(() => bus.subscribe("t", "Build.*", () => {})).toThrow();
    expect(() => bus.subscribe("u", [], () => {})).toThrow();
  });
});

describe("validation and security", () => {
  it("rejects invalid events with INVALID_EVENT", () => {
    const { bus } = setup();
    const r = bus.publish({ event_type: "nope" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(ErrorCode.INVALID_EVENT);
    expect(bus.metrics().rejected).toBe(1);
  });

  it("rejects events carrying secrets", () => {
    const { bus } = setup();
    const r = bus.publish(ev("build.started", { payload: { token: "x" } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(ErrorCode.SECURITY_POLICY_BLOCKED);
  });

  it("blocks spoofed sources", () => {
    const { bus } = setup();
    const r = bus.publish(ev("kage.meeting.started"), { expectedSource: "kage" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(ErrorCode.SECURITY_POLICY_BLOCKED);
  });
});

describe("deduplication and persistence", () => {
  it("delivers each event_id once", async () => {
    const { bus } = setup();
    let n = 0;
    bus.subscribe("s", "*", () => void n++);
    const e = ev();
    expect(bus.publish(e).ok).toBe(true);
    const dup = bus.publish(e);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe(ErrorCode.EVENT_DUPLICATE);
    await bus.drain();
    expect(n).toBe(1);
  });

  it("deduplicates against the durable store after a restart", () => {
    const db = openDatabase(":memory:");
    const e = ev();
    new EventBus({ store: new EventStore(db) }).publish(e);
    const restarted = new EventBus({ store: new EventStore(db) });
    expect(restarted.publish(e).ok).toBe(false);
  });

  it("persists durable events but not ephemeral ones", () => {
    const { bus, store } = setup();
    const durable = bus.publish(ev());
    bus.publish(ev("pet.state.changed"), { ephemeral: true });
    expect(durable.ok && durable.seq).toBe(1);
    expect(store.count()).toBe(1);
  });

  it("drops expired events", async () => {
    const { bus, store } = setup();
    let n = 0;
    bus.subscribe("s", "*", () => void n++);
    bus.publish(ev("build.started", { timestamp: "2020-01-01T00:00:00Z", ttl_ms: 1000 }));
    await bus.drain();
    expect(n).toBe(0);
    expect(store.count()).toBe(0);
    expect(bus.metrics().expired).toBe(1);
  });

  it("RecentIds evicts the oldest id", () => {
    const r = new RecentIds(2);
    r.add("a");
    r.add("b");
    r.add("c");
    expect(r.has("a")).toBe(false);
    expect(r.has("c")).toBe(true);
    expect(r.size).toBe(2);
  });
});

describe("isolation, retry and dead letters", () => {
  it("a throwing subscriber does not affect others", async () => {
    const { bus } = setup();
    const seen: string[] = [];
    bus.subscribe("bad", "*", () => {
      throw new Error("boom");
    });
    bus.subscribe("good", "*", (e) => void seen.push(e.event_type));
    bus.publish(ev("build.started"));
    bus.publish(ev("build.passed"));
    await bus.drain();
    expect(seen).toEqual(["build.started", "build.passed"]);
  });

  it("retries a durable delivery and succeeds", async () => {
    const { bus, deadLetters } = setup({ maxAttempts: 3 });
    let calls = 0;
    bus.subscribe("flaky", "*", async () => {
      calls++;
      if (calls < 3) throw new Error("transient");
    });
    bus.publish(ev());
    await bus.drain();
    expect(calls).toBe(3);
    expect(deadLetters.list()).toHaveLength(0);
    expect(bus.metrics()).toMatchObject({ delivered: 1, handlerFailures: 2 });
  });

  it("dead-letters after max attempts", async () => {
    const { bus, deadLetters } = setup({ maxAttempts: 2 });
    bus.subscribe("broken", "*", () => Promise.reject(new Error("always")));
    const e = ev();
    bus.publish(e);
    await bus.drain();
    expect(deadLetters.list()[0]).toMatchObject({
      eventId: e.event_id,
      subscriber: "broken",
      error: "always",
      attempts: 2,
    });
    expect(bus.metrics().deadLettered).toBe(1);
  });

  it("does not retry ephemeral events", async () => {
    const { bus, deadLetters } = setup({ maxAttempts: 5 });
    let calls = 0;
    bus.subscribe("s", "*", () => {
      calls++;
      throw new Error("x");
    });
    bus.publish(ev("pet.state.changed"), { ephemeral: true });
    await bus.drain();
    expect(calls).toBe(1);
    expect(deadLetters.list()).toHaveLength(0);
  });

  it("a slow subscriber does not delay a fast one", async () => {
    const { bus } = setup();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    bus.subscribe("slow", "*", async () => {
      await gate;
      order.push("slow");
    });
    bus.subscribe("fast", "*", () => void order.push("fast"));
    bus.publish(ev());
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual(["fast"]);
    release();
    await bus.drain();
    expect(order).toEqual(["fast", "slow"]);
  });
});
