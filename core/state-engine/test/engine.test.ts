// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { readFileSync } from "node:fs";
import {
  createEvent,
  FAWKES_STATES,
  STATE_PRIORITY,
  type FawkesState,
  type PhoenixEvent,
} from "@phoenix/protocol";
import { describe, expect, it } from "vitest";
import { renderExplanation, StateEngine, type MappingRule, type StateSnapshot } from "../src";

function clock(start = Date.parse("2026-10-03T12:00:00Z")) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const ev = (event_type: string, extra: Partial<PhoenixEvent> = {}) =>
  createEvent({ event_type, source: "terminal", severity: "info", ...extra });

describe("Appendix A event matrix", () => {
  const fixtures = JSON.parse(
    readFileSync(
      new URL("../../../protocol/fixtures/appendix-a.events.json", import.meta.url),
      "utf8",
    ),
  ) as PhoenixEvent[];
  const expected: Record<string, FawkesState> = {
    "git.commit.created": "IDLE",
    "build.started": "WORKING",
    "build.failed": "ERROR",
    "build.passed": "SUCCESS",
    "agent.started": "THINKING",
    "agent.waiting": "WAITING",
    "deploy.started": "DEPLOYING",
    "deploy.failed": "ERROR",
    "kage.meeting.recording": "RECORDING",
    "kage.summary.ready": "SUCCESS",
    "frappe.site.unhealthy": "ERROR",
  };

  it.each(fixtures.map((f) => [f.event_type, f] as const))("%s", (type, fixture) => {
    const engine = new StateEngine({ now: clock().now });
    engine.handle(fixture);
    expect(engine.snapshot().state).toBe(expected[type]);
    expect(engine.snapshot().explanation.length).toBeGreaterThan(0);
  });
});

describe("priority (ADR-0019)", () => {
  const states = FAWKES_STATES.filter((s) => s !== "IDLE");
  const mapping: MappingRule[] = states.map((s) => ({
    match: `test_${s.toLowerCase()}.set`,
    effect: { state: s },
  }));
  const pairs = states.flatMap((a) => states.filter((b) => a !== b).map((b) => [a, b] as const));

  it.each(pairs)("%s then %s → higher priority wins", (a, b) => {
    const engine = new StateEngine({ mapping, now: clock().now });
    engine.handle(ev(`test_${a.toLowerCase()}.set`));
    engine.handle(ev(`test_${b.toLowerCase()}.set`));
    const winner = STATE_PRIORITY[a] < STATE_PRIORITY[b] ? a : b;
    expect(engine.snapshot().state).toBe(winner);
  });

  it("is IDLE with no conditions", () => {
    expect(new StateEngine().snapshot()).toMatchObject({ state: "IDLE", recording: false });
  });

  it("ties go to the most recent update", () => {
    const c = clock();
    const engine = new StateEngine({ now: c.now });
    engine.handle(ev("build.started", { subject: "a" }));
    c.advance(10);
    engine.handle(ev("build.started", { subject: "b", source: "ci" }));
    expect(engine.snapshot().source).toBe("ci");
  });
});

describe("lifecycle", () => {
  it("build: started → passed → expires to IDLE", () => {
    const c = clock();
    const engine = new StateEngine({ now: c.now });
    engine.handle(ev("build.started"));
    expect(engine.snapshot().state).toBe("WORKING");
    engine.handle(ev("build.passed"));
    expect(engine.snapshot().state).toBe("SUCCESS");
    c.advance(4_999);
    engine.tick();
    expect(engine.snapshot().state).toBe("SUCCESS");
    c.advance(1);
    engine.tick();
    expect(engine.snapshot().state).toBe("IDLE");
  });

  it("errors persist until acknowledged or superseded", () => {
    const c = clock();
    const engine = new StateEngine({ now: c.now });
    engine.handle(ev("build.failed"));
    c.advance(24 * 3_600_000);
    engine.tick();
    const snap = engine.snapshot();
    expect(snap.state).toBe("ERROR");
    expect(engine.acknowledge(snap.key!)).toBe(true);
    expect(engine.snapshot().state).toBe("IDLE");

    engine.handle(ev("build.failed"));
    engine.handle(ev("build.started"));
    expect(engine.snapshot().state).toBe("WORKING");
  });

  it("acknowledgeErrors clears only errors", () => {
    const engine = new StateEngine({ now: clock().now });
    engine.handle(ev("build.failed"));
    engine.handle(ev("deploy.started", { source: "ci" }));
    expect(engine.acknowledgeErrors()).toBe(1);
    expect(engine.snapshot().state).toBe("DEPLOYING");
  });

  it("full Kage meeting via correlation_id", () => {
    const c = clock();
    const engine = new StateEngine({ now: c.now });
    const k = (t: string) => ev(t, { source: "kage", correlation_id: "m1" });
    const states = [
      "kage.meeting.started",
      "kage.meeting.recording",
      "kage.meeting.ended",
      "kage.transcription.started",
      "kage.transcription.completed",
      "kage.summary.started",
      "kage.summary.ready",
    ].map((t) => {
      engine.handle(k(t));
      return [engine.snapshot().state, engine.snapshot().recording];
    });
    expect(states).toEqual([
      ["WORKING", false],
      ["RECORDING", true],
      ["WORKING", false],
      ["WORKING", false],
      ["WORKING", false],
      ["THINKING", false],
      ["SUCCESS", false],
    ]);
    expect(engine.snapshot().conditions).toHaveLength(1);
  });

  it("recording flag stays true even when ERROR is displayed", () => {
    const engine = new StateEngine({ now: clock().now });
    engine.handle(ev("kage.meeting.recording", { source: "kage", correlation_id: "m1" }));
    engine.handle(ev("build.failed"));
    expect(engine.snapshot()).toMatchObject({ state: "ERROR", recording: true });
  });

  it("separate subjects are tracked independently", () => {
    const engine = new StateEngine({ now: clock().now });
    engine.handle(ev("frappe.site.unhealthy", { source: "frappe", subject: "a.local" }));
    engine.handle(ev("frappe.site.unhealthy", { source: "frappe", subject: "b.local" }));
    engine.handle(ev("frappe.site.healthy", { source: "frappe", subject: "a.local" }));
    expect(engine.snapshot()).toMatchObject({
      state: "ERROR",
      explanation: "Site b.local is unhealthy",
    });
  });

  it("merge conflict resolved clears the warning", () => {
    const engine = new StateEngine({ now: clock().now });
    engine.handle(ev("git.merge_conflict", { source: "git", subject: "phoenix" }));
    expect(engine.snapshot().state).toBe("WARNING");
    engine.handle(ev("git.merge_conflict_resolved", { source: "git", subject: "phoenix" }));
    expect(engine.snapshot().state).toBe("IDLE");
  });
});

describe("timeouts and heartbeats", () => {
  it("a stalled task becomes a WARNING, then expires", () => {
    const c = clock();
    const engine = new StateEngine({ now: c.now, timeoutWarningTtlMs: 1_000 });
    engine.handle(ev("build.started"));
    c.advance(30 * 60_000);
    engine.tick();
    expect(engine.snapshot()).toMatchObject({ state: "WARNING" });
    expect(engine.snapshot().explanation).toMatch(/^No progress/);
    c.advance(1_000);
    engine.tick();
    expect(engine.snapshot().state).toBe("IDLE");
  });

  it("heartbeats keep a task alive and record progress", () => {
    const c = clock();
    const engine = new StateEngine({ now: c.now });
    engine.handle(ev("deploy.started", { payload: { environment: "staging" } }));
    for (let i = 1; i <= 3; i++) {
      c.advance(50 * 60_000);
      engine.handle(ev("deploy.progress", { payload: { progress: i / 4 } }));
      engine.tick();
    }
    expect(engine.snapshot().state).toBe("DEPLOYING");
    expect(engine.snapshot().conditions[0]?.progress).toBe(0.75);
  });

  it("recording never times out", () => {
    const c = clock();
    const engine = new StateEngine({ now: c.now });
    engine.handle(ev("kage.meeting.recording", { source: "kage", correlation_id: "m1" }));
    c.advance(10 * 3_600_000);
    engine.tick();
    expect(engine.snapshot().state).toBe("RECORDING");
  });

  it("heartbeat with no active task is ignored", () => {
    const engine = new StateEngine({ now: clock().now });
    expect(engine.handle(ev("build.progress"))).toBe(false);
    expect(engine.snapshot().state).toBe("IDLE");
  });
});

describe("sleep mode", () => {
  it("only ERROR and RECORDING break through", () => {
    const engine = new StateEngine({ now: clock().now });
    engine.setSleeping(true);
    engine.handle(ev("build.started"));
    expect(engine.snapshot().state).toBe("SLEEPING");
    engine.handle(ev("kage.meeting.recording", { source: "kage", correlation_id: "m" }));
    expect(engine.snapshot().state).toBe("RECORDING");
    engine.handle(ev("build.failed"));
    expect(engine.snapshot().state).toBe("ERROR");
    engine.setSleeping(false);
    expect(engine.snapshot().sleeping).toBe(false);
  });
});

describe("robustness", () => {
  it("ignores unknown events", () => {
    const engine = new StateEngine();
    expect(engine.handle(ev("totally.unknown.event"))).toBe(false);
    expect(engine.snapshot().state).toBe("IDLE");
  });

  it("never throws on malformed input", () => {
    const engine = new StateEngine();
    for (const bad of [null, {}, { event_type: 5 }, { event_type: "build.started" }]) {
      expect(() => engine.handle(bad as unknown as PhoenixEvent)).not.toThrow();
    }
  });

  it("requires_action on an unmapped event → WAITING", () => {
    const engine = new StateEngine();
    engine.handle(ev("custom.approval.needed", { requires_action: true }));
    expect(engine.snapshot().state).toBe("WAITING");
  });

  it("ignores its own pet.* events", () => {
    const engine = new StateEngine();
    expect(engine.handle(ev("pet.state.changed", { requires_action: true }))).toBe(false);
  });

  it("capability rules take precedence", () => {
    const engine = new StateEngine();
    engine.addRules([{ match: "build.started", effect: { state: "THINKING" } }]);
    engine.handle(ev("build.started"));
    expect(engine.snapshot().state).toBe("THINKING");
  });
});

describe("change notifications", () => {
  it("fires only on real changes; listener errors are contained", () => {
    const engine = new StateEngine({ now: clock().now });
    const seen: StateSnapshot[] = [];
    engine.onChange(() => {
      throw new Error("bad listener");
    });
    engine.onChange((s) => void seen.push(s));
    engine.handle(ev("build.started"));
    engine.handle(ev("build.progress"));
    engine.tick();
    engine.handle(ev("build.failed"));
    expect(seen.map((s) => s.state)).toEqual(["WORKING", "ERROR"]);
  });

  it("keeps 'since' stable while the displayed state is unchanged", () => {
    const c = clock();
    const engine = new StateEngine({ now: c.now });
    engine.handle(ev("build.started"));
    const since = engine.snapshot().since;
    c.advance(1000);
    engine.handle(ev("build.progress"));
    expect(engine.snapshot().since).toBe(since);
  });
});

describe("renderExplanation", () => {
  const e = ev("deploy.started", { payload: { environment: "prod", long: "x".repeat(500) } });
  it("fills placeholders and drops missing ones", () => {
    expect(renderExplanation("Deploying to {payload.environment}", e)).toBe("Deploying to prod");
    expect(renderExplanation("Build running ({payload.missing})", e)).toBe("Build running");
    expect(renderExplanation("Command failed: {payload.missing}", e)).toBe("Command failed");
  });
  it("truncates long untrusted values", () => {
    expect(renderExplanation("{payload.long}", e).length).toBeLessThanOrEqual(80);
  });
});

describe("security mapping", () => {
  it("confirmation request → WAITING until resolved", () => {
    const engine = new StateEngine();
    const base = { source: "core", correlation_id: "conf_1" };
    engine.handle(
      ev("security.confirmation.requested", {
        ...base,
        requires_action: true,
        payload: { summary: "Create issue" },
      }),
    );
    expect(engine.snapshot()).toMatchObject({
      state: "WAITING",
      explanation: "Approval needed: Create issue",
    });
    engine.handle(ev("security.confirmation.resolved", base));
    expect(engine.snapshot().state).toBe("IDLE");
  });

  it("kill switch shows a persistent warning", () => {
    const engine = new StateEngine();
    engine.handle(ev("security.kill_switch.engaged", { source: "core" }));
    expect(engine.snapshot().state).toBe("WARNING");
    engine.handle(ev("security.kill_switch.disengaged", { source: "core" }));
    expect(engine.snapshot().state).toBe("IDLE");
  });
});

describe("active tasks", () => {
  it("lists long-running work and notifies on progress, not on keep-alives", () => {
    const c = clock();
    const engine = new StateEngine({ now: c.now });
    const updates: number[] = [];
    engine.onTasksChange((t) => void updates.push(t.length));
    engine.handle(ev("deploy.started", { payload: { environment: "staging" } }));
    engine.handle(ev("deploy.progress", { payload: { progress: 0.5 } }));
    c.advance(10);
    engine.handle(ev("deploy.progress", { payload: { progress: 0.5 } }));
    engine.handle(ev("build.failed", { source: "ci" }));
    expect(engine.tasks()).toEqual([
      expect.objectContaining({ state: "DEPLOYING", title: "Deploying to staging", progress: 0.5 }),
    ]);
    engine.handle(ev("deploy.succeeded"));
    expect(engine.tasks()).toEqual([]);
    expect(updates).toEqual([1, 1, 0]);
  });
});
