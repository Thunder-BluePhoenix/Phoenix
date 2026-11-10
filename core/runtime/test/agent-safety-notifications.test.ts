// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 77: a loop or stall warning raised by the agent safety net is DELIVERED by the real
// NotificationService (stored, announced as `notification.created`), and not when the user has muted
// the net's source. Simulated: scripted fake steps, an injected clock, no real agent or desktop.
import { EventBus } from "@phoenix/event-bus";
import { silentLogger } from "@phoenix/logging";
import { NotificationService } from "@phoenix/notifications";
import { openDatabase, SettingsStore, type Database } from "@phoenix/persistence";
import { createEvent, type PhoenixEvent } from "@phoenix/protocol";
import { StateEngine } from "@phoenix/state-engine";
import { afterEach, describe, expect, it } from "vitest";
import { AgentSafety, SAFETY_SOURCE } from "../src/agent-safety";
import { startCore, type TestCore } from "./helpers";

const MIN = 60_000;
const dbs: Database[] = [];
const closers: (() => void)[] = [];
let core: TestCore | undefined;
afterEach(async () => {
  for (const close of closers.splice(0)) close();
  for (const db of dbs.splice(0)) db.close();
  await core?.runtime.stop();
  core = undefined;
});

function rig() {
  const db = openDatabase(":memory:");
  dbs.push(db);
  const bus = new EventBus();
  const clock = { now: Date.parse("2026-10-20T10:00:00Z") };
  const state = new StateEngine({ now: () => clock.now });
  const notifications = new NotificationService({
    db,
    bus,
    state,
    logger: silentLogger,
    now: () => clock.now,
  });
  const safety = new AgentSafety({
    db,
    settings: new SettingsStore(db),
    bus,
    logger: silentLogger,
    now: () => clock.now,
    excludesFile: null,
    permissions: {
      isKillSwitchEngaged: () => false,
      authorize: async (request) => ({ id: "a", request, authorizedAt: "t" }),
      recordOutcome: () => {},
    },
    notifications,
    state,
  });
  closers.push(
    () => notifications.close(),
    () => void safety.close(),
  );
  const announced: PhoenixEvent[] = [];
  bus.subscribe("test", "notification.created", (e) => {
    announced.push(e);
  });
  const publish = async (type: string, payload: Record<string, unknown>, source = "core") => {
    bus.publish(createEvent({ event_type: type, source, severity: "info", payload }), {
      ephemeral: true,
    });
    await bus.drain();
  };
  const step = (target: string) =>
    publish("agent.session.step", {
      agent: "claude-code",
      session_id: "s1",
      project: "/work/some-project",
      n: 1,
      kind: "run",
      tool: "Bash",
      target,
      at: "2026-10-20T10:00:00Z",
    });
  const tick = async (ms: number) => {
    clock.now += ms;
    safety.tick();
    await bus.drain();
  };
  return { notifications, safety, announced, publish, step, tick };
}

describe("loop and stall warnings through the real NotificationService", () => {
  it("a command loop becomes one stored, announced notification from the net's source", async () => {
    const r = rig();
    for (let i = 0; i < 5; i++) await r.step("npm test");
    const { notifications, unread } = r.notifications.list();
    expect(unread).toBe(1);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      eventType: "agent.safety.loop",
      source: SAFETY_SOURCE,
      severity: "warning",
      read: false,
    });
    expect(notifications[0]!.title).toContain("npm test");
    expect(r.announced).toHaveLength(1);
    expect(r.announced[0]!.payload.notification).toMatchObject({
      id: notifications[0]!.id,
      eventType: "agent.safety.loop",
    });
  });

  it("a stall becomes a notification too", async () => {
    const r = rig();
    await r.publish("agent.working", { agent: "claude-code", agent_id: "w1" }, "agents");
    await r.publish("agent.waiting", { agent: "claude-code", agent_id: "w1" }, "agents");
    await r.tick(11 * MIN);
    const { notifications } = r.notifications.list();
    expect(notifications.map((n) => [n.eventType, n.source])).toEqual([
      ["agent.safety.stall", SAFETY_SOURCE],
    ]);
    expect(r.announced).toHaveLength(1);
  });

  it("nothing is delivered when the net's source is muted (the `notify` setting off)", async () => {
    const r = rig();
    r.safety.configure({ notify: false });
    expect(r.notifications.preferences().muted_sources).toEqual([SAFETY_SOURCE]);
    for (let i = 0; i < 5; i++) await r.step("npm test");
    expect(r.notifications.list().notifications).toEqual([]);
    expect(r.announced).toEqual([]);
  });

  it("through a real Core: three identical reported commands produce a notification in GET /api/notifications", async () => {
    core = await startCore();
    const body = {
      agent: "claude-code",
      session_id: "5f1c1b0e-6a0e-4f43-8d7d-0a6a3f4b2c11",
      project: "/work/some-project",
      kind: "run",
      tool: "Bash",
      target: "make",
    };
    for (let i = 0; i < 3; i++) {
      const res = await core.api("POST", "/api/agent/live/step", {
        ...body,
        at: new Date().toISOString(),
      });
      expect(res.status).toBe(200);
      await core.runtime.bus.drain();
    }
    const list = (await core.api("GET", "/api/notifications")).json;
    const loops = list.notifications.filter(
      (n: { eventType: string }) => n.eventType === "agent.safety.loop",
    );
    expect(loops).toHaveLength(1);
    expect(loops[0]).toMatchObject({ source: SAFETY_SOURCE, severity: "warning" });
    expect(loops[0].title).toContain("make");
  });
});
