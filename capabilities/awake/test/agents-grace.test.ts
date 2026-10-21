// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  AGENT_STALE_MS,
  AgentWorkTracker,
  composeAwake,
  type AwakeModule,
  type SessionStatus,
} from "../src";
import { rig, type Rig } from "../testing/ctx";

const MIN = 60_000;

async function grace(r: Rig, minutes = 10): Promise<SessionStatus> {
  return (await r.call("start", { minutes, mode: "agents_grace" })) as SessionStatus;
}
const work = (id: string) => ({ agent_id: id, agent: "claude" });

describe("AgentWorkTracker", () => {
  it("counts working and progress, drops waiting / completed / failed / ended / idle / started", () => {
    const t = new AgentWorkTracker();
    t.apply({ event_type: "agent.working", payload: work("a") }, 0);
    t.apply({ event_type: "agent.progress", payload: work("b") }, 0);
    expect(t.working(0)).toBe(2);
    for (const [i, type] of ["agent.waiting", "agent.completed"].entries()) {
      t.apply({ event_type: type, payload: work(i === 0 ? "a" : "b") }, 1);
    }
    expect(t.working(1)).toBe(0);
    for (const type of ["agent.failed", "agent.ended", "agent.idle", "agent.started"]) {
      t.apply({ event_type: "agent.working", payload: work("c") }, 2);
      t.apply({ event_type: type, payload: work("c") }, 3);
      expect(t.working(3)).toBe(0);
    }
  });
  it("a silent agent stops counting after the stale limit", () => {
    const t = new AgentWorkTracker();
    t.apply({ event_type: "agent.working", payload: work("a") }, 0);
    expect(t.working(AGENT_STALE_MS - 1)).toBe(1);
    expect(t.working(AGENT_STALE_MS)).toBe(0);
  });
  it("ignores events without a usable agent_id and unrelated types", () => {
    const t = new AgentWorkTracker();
    t.apply({ event_type: "agent.working", payload: {} }, 0);
    t.apply({ event_type: "agent.working", payload: { agent_id: 5 } }, 0);
    t.apply({ event_type: "agent.working" }, 0);
    t.apply({ event_type: "git.commit", payload: work("a") }, 0);
    expect(t.working(0)).toBe(0);
  });
  it("is bounded", () => {
    const t = new AgentWorkTracker();
    for (let i = 0; i < 1000; i++)
      t.apply({ event_type: "agent.working", payload: work(`a${i}`) }, 0);
    expect(t.working(0)).toBeLessThanOrEqual(200);
  });
});

describe("agents_grace session", () => {
  it("starts in its grace phase, holds while an agent works, and ends `minutes` after the last one stops", async () => {
    const r = await rig();
    const s = await grace(r, 10);
    expect(s.session?.mode).toBe("agents_grace");
    expect(s.session?.ends_at).not.toBeNull();

    await r.feed.publish("agent.working", work("a"));
    expect(((await r.call("status")) as SessionStatus).session).toMatchObject({
      ends_at: null,
      agents_working: 1,
    });
    // Two hours of work, with the agent's heartbeat (agent.progress) arriving every 30 minutes.
    for (let i = 0; i < 4; i++) {
      await r.sys.clock.advance(30 * MIN);
      await r.feed.publish("agent.progress", work("a"));
    }
    expect(r.sys.alive).toHaveLength(1);
    expect(r.fake.types()).not.toContain("awake.session.ended");

    await r.feed.publish("agent.completed", work("a"));
    const after = ((await r.call("status")) as SessionStatus).session;
    expect(after?.remaining_seconds).toBe(10 * 60);
    await r.sys.clock.advance(9 * MIN);
    expect(r.sys.alive).toHaveLength(1);
    await r.sys.clock.advance(1 * MIN);
    expect(r.sys.alive).toHaveLength(0);
    expect(r.fake.last("awake.session.ended").payload).toMatchObject({ reason: "agents_done" });
  });

  it("a new agent during the grace period cancels the countdown", async () => {
    const r = await rig();
    await grace(r, 10);
    await r.sys.clock.advance(8 * MIN);
    await r.feed.publish("agent.working", work("b"));
    await r.sys.clock.advance(60 * MIN);
    expect(r.sys.alive).toHaveLength(1);
    expect(((await r.call("status")) as SessionStatus).session?.ends_at).toBeNull();
  });

  it("stays held while any one of several agents still works", async () => {
    const r = await rig();
    await grace(r, 5);
    await r.feed.publish("agent.working", work("a"));
    await r.feed.publish("agent.working", work("b"));
    await r.feed.publish("agent.completed", work("a"));
    await r.sys.clock.advance(60 * MIN);
    expect(r.sys.alive).toHaveLength(1);
    await r.feed.publish("agent.failed", work("b"));
    await r.sys.clock.advance(5 * MIN);
    expect(r.sys.alive).toHaveLength(0);
  });

  it("with no agent ever working it ends after the grace minutes", async () => {
    const r = await rig();
    await grace(r, 3);
    await r.sys.clock.advance(3 * MIN);
    expect(r.sys.alive).toHaveLength(0);
    expect(r.fake.last("awake.session.ended").payload).toMatchObject({ reason: "agents_done" });
  });

  it("renews its hold periodically while agents work, one live child at a time", async () => {
    const r = await rig();
    await grace(r, 10);
    await r.feed.publish("agent.working", work("a"));
    await r.sys.clock.advance(50 * MIN);
    expect(r.sys.alive).toHaveLength(1);
    expect(r.sys.children.length).toBeGreaterThan(3);
  });

  it("a working agent that went silent for an hour no longer holds the machine", async () => {
    const r = await rig();
    await grace(r, 5);
    await r.feed.publish("agent.working", work("a"));
    await r.sys.clock.advance(AGENT_STALE_MS + 20 * MIN);
    expect(r.sys.alive).toHaveLength(0);
  });

  it("is refused when the agent event feed is not connected", async () => {
    const r = await rig({ noFeed: true });
    await expect(grace(r)).rejects.toMatchObject({ kind: "unavailable" });
    expect(r.sys.children).toHaveLength(0);
  });

  it("cannot be extended; releases and unsubscribes on end", async () => {
    const r = await rig();
    await grace(r);
    await expect(r.call("extend", { minutes: 5 })).rejects.toMatchObject({ kind: "conflict" });
    expect(r.feed.subscribers).toBe(1);
    await r.call("end");
    expect(r.feed.subscribers).toBe(0);
    expect(r.sys.alive).toHaveLength(0);
  });

  it("ignores agent events after it has ended", async () => {
    const r = await rig();
    await grace(r);
    await r.call("end");
    await r.feed.publish("agent.working", work("a"));
    expect(r.sys.children).toHaveLength(1);
  });
});

describe("agents_grace only trusts the agents capability (finding 11)", () => {
  it("agent.* events from another source neither hold nor extend the session", async () => {
    const r = await rig();
    await grace(r, 5);
    await r.feed.publish("agent.working", work("evil"), "someother");
    await r.feed.publish("agent.working", work("evil"), "core");
    await r.feed.publish("agent.working", work("evil"), "");
    await r.sys.clock.advance(60 * MIN);
    expect(r.sys.alive).toHaveLength(0);
    expect(r.fake.last("awake.session.ended").payload).toMatchObject({ reason: "agents_done" });
  });

  it("an event with no source at all is ignored", async () => {
    const r = await rig();
    await grace(r, 5);
    const handler = r.feed.handlers.get("awake-session");
    await handler?.({ event_type: "agent.working", payload: work("a") });
    expect(((await r.call("status")) as SessionStatus).session?.agents_working).toBe(0);
  });

  it("the agents capability's events still count", async () => {
    const r = await rig();
    await grace(r, 5);
    await r.feed.publish("agent.working", work("a"), "agents");
    expect(((await r.call("status")) as SessionStatus).session?.agents_working).toBe(1);
  });

  it("a hostile source cannot cancel a running countdown either", async () => {
    const r = await rig();
    await grace(r, 5);
    await r.feed.publish("agent.working", work("a"));
    await r.feed.publish("agent.completed", work("a"));
    await r.feed.publish("agent.working", work("b"), "other");
    await r.sys.clock.advance(5 * MIN);
    expect(r.sys.alive).toHaveLength(0);
  });
});

describe("agents_grace holds are bounded off macOS (finding 2)", () => {
  it.each(["linux", "win32"] as const)(
    "%s: grace and working holds never exceed 30 min",
    async (platform) => {
      const r = await rig({ platform });
      await grace(r, 120);
      await r.feed.publish("agent.working", work("a"));
      for (let i = 0; i < 12; i++) {
        await r.sys.clock.advance(15 * MIN);
        await r.feed.publish("agent.progress", work("a"));
      }
      await r.feed.publish("agent.completed", work("a"));
      await r.sys.clock.advance(60 * MIN);
      expect(r.sys.alive).toHaveLength(1);
      for (const c of r.sys.children) expect(Number(c.args.at(-1))).toBeLessThanOrEqual(30 * 60);
      await r.sys.clock.advance(60 * MIN);
      expect(r.sys.alive).toHaveLength(0);
      expect(r.fake.last("awake.session.ended").payload).toMatchObject({ reason: "agents_done" });
    },
  );
});

describe("composeAwake", () => {
  const mod = (over: Partial<AwakeModule>): AwakeModule => ({
    commands: {},
    commandSpecs: [],
    events: [],
    stateRules: [],
    ...over,
  });
  const spec = (name: string) => ({ name, description: name, side_effect: "read" as const });

  it("merges commands, events, config and secrets from several modules", () => {
    const c = composeAwake([
      mod({
        events: ["a.x"],
        commands: { one: () => 1 },
        commandSpecs: [spec("one")],
        configProperties: { k1: {} },
        secrets: [{ name: "s1", description: "d" }],
      }),
      mod({
        events: ["a.x", "a.y"],
        commands: { two: () => 2 },
        commandSpecs: [spec("two")],
        configProperties: { k2: {} },
      }),
    ]);
    expect(Object.keys(c.commands)).toEqual(["one", "two"]);
    expect(c.events).toEqual(["a.x", "a.y"]);
    expect(Object.keys(c.configProperties)).toEqual(["k1", "k2"]);
    expect(c.secrets).toHaveLength(1);
  });

  it("refuses duplicate commands, config keys and secrets, and spec/handler mismatches", () => {
    const one = mod({ commands: { x: () => 1 }, commandSpecs: [spec("x")] });
    expect(() => composeAwake([one, one])).toThrow(/two modules/);
    expect(() =>
      composeAwake([mod({ configProperties: { k: {} } }), mod({ configProperties: { k: {} } })]),
    ).toThrow(/two modules/);
    const sec = mod({ secrets: [{ name: "s", description: "d" }] });
    expect(() => composeAwake([sec, sec])).toThrow(/two modules/);
    expect(() => composeAwake([mod({ commandSpecs: [spec("y")] })])).toThrow(/no handler/);
    expect(() => composeAwake([mod({ commands: { z: () => 1 } })])).toThrow(/no command spec/);
  });

  it("one module failing to init or shut down never stops the others", async () => {
    const r = await rig({
      modules: [
        mod({
          init() {
            throw new Error("boom");
          },
          shutdown() {
            throw new Error("boom");
          },
        }),
      ],
    });
    await r.call("start", { minutes: 5 });
    await r.disable();
    expect(r.sys.alive).toHaveLength(0);
  });

  it("modules receive the session port and can end the session (floors in later phases)", async () => {
    let port: AwakeModule | undefined;
    const holder: { end?: () => void; active?: () => unknown } = {};
    port = mod({
      init(_ctx, deps) {
        holder.end = () => deps.session.end("thermal");
        holder.active = () => deps.session.active();
      },
    });
    const r = await rig({ modules: [port] });
    await r.call("start", { minutes: 5 });
    expect(holder.active?.()).toMatchObject({ id: "awk_test1", mode: "timed" });
    holder.end?.();
    expect(r.sys.alive).toHaveLength(0);
    expect(r.fake.last("awake.session.ended").payload).toMatchObject({ reason: "thermal" });
    expect(holder.active?.()).toBeNull();
  });
});
