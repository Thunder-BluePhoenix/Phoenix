// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Loop and stall detection (Phase 77): the pure detectors with an injected clock, then the service
// raising WARNING events from scripted fake steps over the real event bus ("simulated": no real
// agent, no real time passes).
import { setImmediate } from "node:timers/promises";
import { EventBus } from "@phoenix/event-bus";
import { silentLogger } from "@phoenix/logging";
import { openDatabase, SettingsStore, type Database } from "@phoenix/persistence";
import { createEvent, type PhoenixEvent } from "@phoenix/protocol";
import { StateEngine } from "@phoenix/state-engine";
import { afterEach, describe, expect, it } from "vitest";
import {
  AgentSafety,
  DEFAULT_DETECTOR_SETTINGS,
  FileDeltas,
  SafetyDetectors,
  SAFETY_SOURCE,
  type StepObservation,
} from "../src/agent-safety";

const MIN = 60_000;
const run = (target: string): StepObservation => ({
  agent: "claude-code",
  sessionId: "s1",
  kind: "run",
  target,
});
const edit = (path: string, added: number, removed: number): StepObservation => ({
  agent: "claude-code",
  sessionId: "s1",
  kind: "edit",
  target: path,
  file: { path, added, removed },
});

describe("loop detection", () => {
  it("flags the same command the 3rd time in a row, once per episode", () => {
    const d = new SafetyDetectors();
    expect(d.step(run("npm test"), 0)).toEqual([]);
    expect(d.step(run("npm test"), 1)).toEqual([]);
    const found = d.step(run("npm test"), 2);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ type: "loop", kind: "command" });
    expect(found[0]!.reason).toContain("3 times");
    // The 4th and 5th run are the same episode: no repeated warning.
    expect(d.step(run("npm test"), 3)).toEqual([]);
    expect(d.step(run("npm test"), 4)).toEqual([]);
  });

  it("a different command in between ends the streak, and a new streak is a new episode", () => {
    const d = new SafetyDetectors();
    d.step(run("npm test"), 0);
    d.step(run("npm test"), 1);
    expect(d.step(run("ls"), 2)).toEqual([]);
    expect(d.step(run("npm test"), 3)).toEqual([]); // back to 1
    d.step(run("npm test"), 4);
    expect(d.step(run("npm test"), 5)).toHaveLength(1);
    d.step(run("ls"), 6);
    d.step(run("npm test"), 7);
    d.step(run("npm test"), 8);
    expect(d.step(run("npm test"), 9)).toHaveLength(1); // a second episode warns again
  });

  it("reads and edits between two runs do not hide the loop", () => {
    const d = new SafetyDetectors();
    d.step(run("pnpm build"), 0);
    d.step({ ...run(""), kind: "read", target: "src/a.ts" }, 1);
    d.step(run("pnpm build"), 2);
    d.step(edit("src/a.ts", 1, 1), 3);
    expect(d.step(run("pnpm build"), 4)).toHaveLength(1);
  });

  it("honours the configured threshold", () => {
    const d = new SafetyDetectors({ ...DEFAULT_DETECTOR_SETTINGS, loopThreshold: 2 });
    d.step(run("make"), 0);
    expect(d.step(run("make"), 1)).toHaveLength(1);
  });

  it("flags a file edited back and forth (+a -r then +r -a) N times, and not ordinary progress", () => {
    const d = new SafetyDetectors();
    expect(d.step(edit("a.ts", 3, 1), 0)).toEqual([]);
    expect(d.step(edit("a.ts", 1, 3), 1)).toEqual([]); // one reversal
    const found = d.step(edit("a.ts", 3, 1), 2); // second reversal = 3 edits that undo each other
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ type: "loop", kind: "file" });
    expect(d.step(edit("a.ts", 1, 3), 3)).toEqual([]); // same episode

    const p = new SafetyDetectors();
    for (let i = 0; i < 6; i++) expect(p.step(edit("b.ts", 3, 1), i)).toEqual([]); // same size each time is progress
    for (let i = 0; i < 6; i++) expect(p.step(edit("c.ts", i + 1, 0), i)).toEqual([]);
  });

  it("interleaved edits of other files do not break the per-file pattern", () => {
    const d = new SafetyDetectors();
    d.step(edit("a.ts", 2, 5), 0);
    d.step(edit("z.ts", 1, 0), 1);
    d.step(edit("a.ts", 5, 2), 2);
    d.step(edit("z.ts", 4, 0), 3);
    expect(d.step(edit("a.ts", 2, 5), 4)).toHaveLength(1);
  });

  it("derives per-step line counts from cumulative totals and refuses to guess across a gap", () => {
    const f = new FileDeltas();
    expect(f.delta({ path: "a", added: 3, removed: 1, edits: 1 })).toEqual({
      path: "a",
      added: 3,
      removed: 1,
    });
    expect(f.delta({ path: "a", added: 4, removed: 4, edits: 2 })).toEqual({
      path: "a",
      added: 1,
      removed: 3,
    });
    // Edit 3 was never seen: edits jumped by two.
    expect(f.delta({ path: "a", added: 9, removed: 9, edits: 4 })).toBeUndefined();
    // A file first seen at edit 5 (the session started before Phoenix looked): not measurable.
    expect(f.delta({ path: "n", added: 5, removed: 5, edits: 5 })).toBeUndefined();
  });
});

describe("stall detection", () => {
  it("flags waiting on the user longer than T once, and re-arms after the agent moves again", () => {
    const d = new SafetyDetectors();
    d.waiting("claude-code", "s1", 0);
    expect(d.check(9 * MIN)).toEqual([]);
    const found = d.check(10 * MIN);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ type: "stall", kind: "waiting" });
    expect(found[0]!.reason).toContain("10 min");
    expect(d.check(40 * MIN)).toEqual([]); // same episode, even though idle time also passed
    d.resumed("claude-code", "s1", 41 * MIN);
    d.waiting("claude-code", "s1", 42 * MIN);
    expect(d.check(52 * MIN)).toHaveLength(1);
  });

  it("flags an active session with no activity for T2, not a session that finished", () => {
    const d = new SafetyDetectors();
    d.step(run("ls"), 0);
    d.step({ ...run("ls"), sessionId: "done" }, 0);
    d.finished("claude-code", "done", MIN);
    expect(d.check(29 * MIN)).toEqual([]);
    const found = d.check(30 * MIN);
    expect(found.map((f) => [f.sessionId, f.kind])).toEqual([["s1", "idle"]]);
    expect(d.check(90 * MIN)).toEqual([]);
    d.step(run("ls"), 91 * MIN); // activity ends the episode
    expect(d.check(121 * MIN)).toHaveLength(1);
  });

  it("forgets sessions that stay silent for a long time, so the table is bounded", () => {
    const d = new SafetyDetectors();
    for (let i = 0; i < 300; i++) d.step({ ...run("x"), sessionId: `s${i}` }, i);
    expect(d.size()).toBeLessThanOrEqual(200);
    d.check(DEFAULT_DETECTOR_SETTINGS.forgetMs + 10_000);
    expect(d.size()).toBe(0);
  });
});

// ── The service: events in, WARNING events out ──────────────────────────────────────────────────

const dbs: Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function rig() {
  const db = openDatabase(":memory:");
  dbs.push(db);
  const bus = new EventBus();
  const clock = { now: Date.parse("2026-10-20T10:00:00Z") };
  const warnings: PhoenixEvent[] = [];
  bus.subscribe("test", ["agent.safety.loop", "agent.safety.stall"], (e) => {
    warnings.push(e);
  });
  const prefs = { enabled: true, min_severity: "warning" as const, muted_sources: [] as string[] };
  const state = new StateEngine({ now: () => clock.now });
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
    notifications: {
      preferences: () => ({ ...prefs }),
      setPreferences: (input) => {
        Object.assign(prefs, input);
        return { ...prefs };
      },
    },
    state,
  });
  const publish = async (type: string, payload: Record<string, unknown>, source = "core") => {
    bus.publish(createEvent({ event_type: type, source, severity: "info", payload }), {
      ephemeral: true,
    });
    await bus.drain();
  };
  const step = (kind: string, target: string, extra: Record<string, unknown> = {}) =>
    publish("agent.session.step", {
      agent: "claude-code",
      session_id: "s1",
      project: "/work/some-project",
      n: 1,
      kind,
      tool: kind === "run" ? "Bash" : "Edit",
      target,
      at: "2026-10-20T10:00:00Z",
      ...extra,
    });
  /** Advances the clock, runs the periodic check and lets the bus deliver what it raised. */
  const tick = async (ms: number) => {
    clock.now += ms;
    safety.tick();
    await bus.drain();
  };
  return { safety, bus, clock, warnings, prefs, state, publish, step, tick, db };
}

describe("agent.safety.loop / agent.safety.stall events", () => {
  it("a simulated command loop raises one WARNING from Core, and not a second for the same episode", async () => {
    const r = rig();
    for (let i = 0; i < 5; i++) await r.step("run", "npm test");
    expect(r.warnings).toHaveLength(1);
    const w = r.warnings[0]!;
    expect(w).toMatchObject({
      event_type: "agent.safety.loop",
      source: "core",
      severity: "warning",
      subject: SAFETY_SOURCE,
    });
    expect(w.payload).toMatchObject({
      agent: "claude-code",
      session_id: "s1",
      kind: "command",
      repository: "some-project",
    });
    expect(String(w.payload.reason)).toContain("npm test");
  });

  it("a simulated back-and-forth edit raises a file loop warning, from cumulative step totals", async () => {
    const path = "/work/some-project/a.ts";
    const r = rig();
    const totals = [
      { added: 4, removed: 1 }, // +4 -1
      { added: 5, removed: 5 }, // +1 -4: the reverse of the first edit
    ];
    for (const [i, t] of totals.entries())
      await r.step("edit", path, { file: { path, edits: i + 1, ...t } });
    expect(r.warnings).toEqual([]); // one reversal is not yet a loop
    await r.step("edit", path, { file: { path, edits: 3, added: 9, removed: 6 } }); // +4 -1 again
    expect(r.warnings.map((w) => [w.event_type, w.payload.kind])).toEqual([
      ["agent.safety.loop", "file"],
    ]);
    await r.step("edit", path, { file: { path, edits: 4, added: 10, removed: 10 } }); // +1 -4: same episode
    expect(r.warnings).toHaveLength(1);
  });

  it("a simulated wait and a simulated silence each raise a stall warning once", async () => {
    const r = rig();
    await r.publish("agent.working", { agent: "claude-code", agent_id: "w1" }, "agents");
    await r.publish("agent.waiting", { agent: "claude-code", agent_id: "w1" }, "agents");
    await r.step("run", "ls", { session_id: "quiet" });
    await r.tick(9 * MIN);
    expect(r.warnings).toEqual([]);
    await r.tick(2 * MIN); // 11 min: the wait passed 10 min
    expect(r.warnings.map((w) => [w.event_type, w.payload.kind, w.payload.session_id])).toEqual([
      ["agent.safety.stall", "waiting", "w1"],
    ]);
    await r.tick(30 * MIN); // 41 min: "quiet" passed 30 min of silence
    expect(r.warnings.map((w) => w.payload.kind)).toEqual(["waiting", "idle"]);
    await r.tick(60 * MIN);
    expect(r.warnings).toHaveLength(2);
  });

  it("an approval request puts the asking session in waiting; answering it resumes", async () => {
    const r = rig();
    await r.step("run", "ls"); // establishes the session in /work/some-project
    await r.publish("agent.approval.requested", {
      id: "apr_1",
      agent: "claude-code",
      project: "/work/some-project",
      tool: "Bash",
      kind: "permission",
    });
    await r.tick(11 * MIN);
    expect(r.warnings.map((w) => w.payload.kind)).toEqual(["waiting"]);

    const again = rig();
    await again.step("run", "ls");
    await again.publish("agent.approval.requested", {
      id: "apr_2",
      agent: "claude-code",
      project: "/work/some-project",
      tool: "Bash",
      kind: "permission",
    });
    again.clock.now += 5 * MIN;
    await again.publish("agent.approval.resolved", {
      id: "apr_2",
      outcome: "allow",
      decided_by: "user",
    });
    await again.tick(20 * MIN);
    expect(again.warnings.map((w) => w.payload.kind)).toEqual([]); // 20 min since resuming < 30
  });

  it("ignores look-alike events from other sources", async () => {
    const r = rig();
    for (let i = 0; i < 4; i++)
      await r.publish(
        "agent.session.step",
        { agent: "claude-code", session_id: "x", project: "/p", kind: "run", target: "t" },
        "terminal",
      );
    await r.publish("agent.waiting", { agent: "claude-code", agent_id: "x" }, "terminal");
    await r.tick(60 * MIN);
    expect(r.warnings).toEqual([]);
  });

  it("the warning sets Fawkes to WARNING with the reason (state rule, no edit of the default mapping)", async () => {
    const r = rig();
    for (let i = 0; i < 3; i++) await r.step("run", "make");
    const event = r.warnings[0]!;
    r.state.handle(event);
    expect(r.state.snapshot().state).toBe("WARNING");
    expect(r.state.snapshot().explanation).toContain("make");
  });

  it("notification is optional: the setting adds or removes the net's source from muted sources", async () => {
    const r = rig();
    expect((await r.safety.status()).settings.notify).toBe(true);
    r.safety.configure({ notify: false });
    expect(r.prefs.muted_sources).toEqual([SAFETY_SOURCE]);
    expect((await r.safety.status()).settings.notify).toBe(false);
    r.safety.configure({ notify: true });
    expect(r.prefs.muted_sources).toEqual([]);
  });

  it("validates settings strictly", async () => {
    const r = rig();
    for (const body of [
      { loop_threshold: 1 },
      { idle_min: 0 },
      { retention_days: 1.5 },
      { enabled: "yes" },
      { surprise: 1 },
      [],
    ])
      expect(() => r.safety.configure(body)).toThrow();
    expect(r.safety.configure({ loop_threshold: 5, retention_days: 30 }).settings).toMatchObject({
      loop_threshold: 5,
      retention_days: 30,
    });
    await setImmediate();
  });
});
