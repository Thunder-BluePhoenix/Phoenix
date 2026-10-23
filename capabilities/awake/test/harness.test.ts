// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The capability inside the real capability manager, bus and permission gateway (in memory), on a
// fake machine: confirmation each time, events on the bus, kill switch and disable releasing.
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, describe, expect, it } from "vitest";
import { createAwakeCapability } from "../src";
import { FakeFeed, FakeSystem, settle } from "../testing/fakes";

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

async function ready() {
  const sys = new FakeSystem();
  const feed = new FakeFeed();
  const awake = createAwakeCapability({
    env: sys.env,
    feed: () => feed,
    battery: () => Promise.resolve({ kind: "none" }),
    modules: [],
  });
  h = createHarness({ modules: [awake] });
  // The real bus is what the manager hands the kill-switch event to; forward it to the fake feed
  // the session listens on, as Core's bus does.
  h.bus.subscribe("test.feed", "*", (e) => feed.publish(e.event_type, e.payload));
  await h.enable("awake");
  return { h, sys };
}

describe("awake in the capability manager", () => {
  it("start asks for confirmation, publishes session events, and end releases", async () => {
    const { h, sys } = await ready();
    const denied = await h.run("awake", "start", { minutes: 30 }, false);
    expect(denied.status).toBe("failed");
    expect(sys.children).toHaveLength(0);

    const op = await h.run("awake", "start", { minutes: 30, reason: "build" });
    expect(op.status).toBe("succeeded");
    expect(sys.alive).toHaveLength(1);
    expect(h.types("awake")).toEqual(["awake.session.started"]);

    // Every command asks again: nothing is remembered from the first approval.
    const again = await h.run("awake", "extend", { minutes: 5 }, false);
    expect(again.status).toBe("failed");
    expect(sys.children).toHaveLength(1);

    const ended = await h.run("awake", "end");
    expect(ended.status).toBe("succeeded");
    expect(sys.alive).toHaveLength(0);
    expect(h.types("awake")).toEqual(["awake.session.started", "awake.session.ended"]);
  });

  it("the confirmation prompt for start and extend names the minutes; end's prompt is unchanged", async () => {
    const { h } = await ready();
    const summaries: string[] = [];
    const orig = h.permissions.authorize.bind(h.permissions);
    h.permissions.authorize = (request, signal) => {
      summaries.push(request.summary);
      return orig(request, signal);
    };
    await h.run("awake", "start", { minutes: 480, reason: "build" });
    await h.run("awake", "extend", { minutes: 90 });
    await h.run("awake", "end");
    expect(summaries).toHaveLength(3);
    expect(summaries[0]).toMatch(/\[minutes: 480\]$/);
    expect(summaries[0]).not.toContain("build");
    expect(summaries[1]).toMatch(/\[minutes: 90\]$/);
    expect(summaries[2]).not.toContain("[");
  });

  it("status is a read: it runs without asking", async () => {
    const { h } = await ready();
    const op = h.manager.invoke("awake", "status", {});
    // Never approved by the test: it can only succeed if no confirmation was asked.
    for (let i = 0; i < 200 && (op.status === "pending" || op.status === "running"); i++) {
      await settle();
    }
    expect(h.permissions.pendingConfirmations()).toHaveLength(0);
    expect(op.status).toBe("succeeded");
  });

  // The manager calls the capability's `stopping` hook before it aborts the signal, so the
  // context can still publish: disable, the emergency stop and Core exit each release the hold and
  // publish exactly one awake.session.ended (source awake) that says why. capability.disabled
  // records the same reason from the manager.
  const endedEvents = (h: Harness) =>
    h.events.filter((e) => e.event_type === "awake.session.ended");

  it("disabling the capability releases the hold and publishes one awake.session.ended (disabled)", async () => {
    const { h, sys } = await ready();
    await h.run("awake", "start", { minutes: 30 });
    await h.manager.disable("awake");
    await h.drain();
    expect(sys.alive).toHaveLength(0);
    expect(sys.children[0]?.killed).toBe(1);
    expect(endedEvents(h)).toHaveLength(1);
    expect(endedEvents(h)[0]).toMatchObject({ source: "awake", payload: { reason: "disabled" } });
    const disabled = h.events.find((e) => e.event_type === "capability.disabled");
    expect(disabled?.payload.reason).toBe("user");
  });

  it("the emergency stop releases the hold and publishes one awake.session.ended (kill_switch)", async () => {
    const { h, sys } = await ready();
    await h.run("awake", "start", { minutes: 30 });
    h.permissions.engageKillSwitch();
    await h.drain();
    await settle();
    expect(sys.alive).toHaveLength(0);
    expect(endedEvents(h)).toHaveLength(1);
    expect(endedEvents(h)[0]).toMatchObject({
      source: "awake",
      payload: { reason: "kill_switch" },
    });
    const disabled = h.events.find((e) => e.event_type === "capability.disabled");
    expect(disabled?.payload.reason).toBe("kill_switch");
  });

  it("closing the manager (Core exit) releases the hold and publishes one awake.session.ended (shutdown)", async () => {
    const { h, sys } = await ready();
    await h.run("awake", "start", { minutes: 30 });
    await h.manager.close();
    expect(sys.alive).toHaveLength(0);
    expect(endedEvents(h)).toHaveLength(1);
    expect(endedEvents(h)[0]).toMatchObject({ source: "awake", payload: { reason: "shutdown" } });
  });

  it("disabling with no session publishes no awake.session.ended", async () => {
    const { h } = await ready();
    await h.manager.disable("awake");
    await h.drain();
    expect(endedEvents(h)).toHaveLength(0);
  });

  it("a normal end is not announced a second time by a later disable", async () => {
    const { h } = await ready();
    await h.run("awake", "start", { minutes: 30 });
    await h.run("awake", "end");
    await h.manager.disable("awake");
    await h.drain();
    expect(endedEvents(h)).toHaveLength(1);
    expect(endedEvents(h)[0]?.payload.reason).toBe("cancelled");
  });
});
