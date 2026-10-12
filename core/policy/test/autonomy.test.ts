// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  AutonomyController,
  PolicyEngine,
  type AutonomySetting,
  type Actor,
  type ToolRequest,
} from "../src";

const user: Actor = { kind: "user", id: "owner", trustedByUser: true };
const agent: Actor = { kind: "agent", id: "fawkes", trustedByUser: false };
const limits = { maxActions: 2, maxDurationMs: 1000 };

function fixture() {
  let now = 1000;
  let killed = false;
  const saved = new Map<string, AutonomySetting>();
  const records: { action: string; decision: string }[] = [];
  const store = {
    autonomySetting: (id: string, environment: string) => saved.get(`${id}/${environment}`),
    saveAutonomySetting: (s: AutonomySetting) => {
      saved.set(`${s.capabilityId}/${s.environment}`, s);
    },
  };
  const audit = {
    record: (entry: { action: string; decision: string }) => {
      records.push(entry);
      return { id: records.length };
    },
  };
  const autonomy = new AutonomyController(
    store,
    audit,
    () => killed,
    () => now,
  );
  const policy = new PolicyEngine({
    store: { rules: () => [], activeApprovals: () => [] } as never,
    audit,
    isKillSwitchEngaged: () => killed,
    isKnownTool: () => true,
    autonomy,
    now: () => now,
  });
  const request = (): ToolRequest => ({
    actor: agent,
    tool: "git.status",
    capabilityId: "git",
    command: "status",
    sideEffect: "read",
    permissions: [],
    environment: "local",
    autonomy: { runId: "run_one", level: "observe" },
    at: new Date(now),
  });
  return {
    autonomy,
    policy,
    request,
    records,
    clock: (value: number) => {
      now = value;
    },
    kill: () => {
      killed = true;
    },
  };
}

describe("controlled autonomy", () => {
  it("refuses executable levels even after configuration and approval", () => {
    const f = fixture();
    f.autonomy.configure(user, "git", "local", "autonomous_workflow", limits);
    expect(f.autonomy.refusal(["git"], "local", "bounded_execute")).toContain("audited OS sandbox");
    expect(() =>
      f.autonomy.begin(agent, "run_one", ["git"], "local", "autonomous_workflow"),
    ).toThrow(/audited OS sandbox/);
    expect(
      f.records.some(
        (record) => record.action === "autonomy.run.refused" && record.decision === "denied",
      ),
    ).toBe(true);
  });

  it("enforces scope, count, deadline and stop without counting previews", () => {
    const f = fixture();
    f.autonomy.configure(user, "git", "local", "observe", limits);
    f.autonomy.begin(agent, "run_one", ["git"], "local", "observe");
    expect(f.policy.evaluate(f.request()).effect).toBe("allow");
    expect(f.policy.evaluate(f.request()).effect).toBe("allow");
    expect(f.policy.decide(f.request()).decision.effect).toBe("allow");
    expect(f.policy.decide(f.request()).decision.effect).toBe("allow");
    expect(f.policy.decide(f.request()).decision).toMatchObject({
      effect: "deny",
      matched: ["builtin:autonomy"],
    });
    expect(
      f.policy.evaluate({
        ...f.request(),
        capabilityId: "other",
        command: "status",
        tool: "other.status",
      }).effect,
    ).toBe("deny");
    f.autonomy.stop(user, "run_one");
    expect(f.policy.evaluate(f.request()).reasons[0]).toMatch(/stopped/);
    expect(() => f.autonomy.stop(agent, "run_one")).toThrow(/trusted user/);
  });

  it("refuses time exhaustion and emergency stop before actions", () => {
    const f = fixture();
    f.autonomy.configure(user, "git", "local", "propose", limits);
    f.autonomy.begin(agent, "run_one", ["git"], "local", "observe");
    f.clock(2000);
    expect(f.policy.decide(f.request()).decision.reasons[0]).toMatch(/time limit/);
    f.kill();
    expect(f.policy.evaluate(f.request()).matched).toEqual(["builtin:kill-switch"]);
  });

  it("refuses writes regardless of a read-only run setting", () => {
    const f = fixture();
    f.autonomy.configure(user, "git", "local", "observe", limits);
    f.autonomy.begin(agent, "run_one", ["git"], "local", "observe");
    const write = {
      ...f.request(),
      tool: "git.patch",
      command: "patch",
      sideEffect: "write" as const,
    };
    expect(f.policy.decide(write).decision.reasons[0]).toMatch(/audited OS sandbox/);
  });
});
