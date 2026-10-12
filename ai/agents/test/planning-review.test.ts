// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { afterEach, describe, expect, it } from "vitest";
import { createPlanningCapability } from "@phoenix/capability-planning";
import { specialistHandoff } from "@phoenix/ai-orchestrator";
import { createPlanningReviewAgent } from "../src";
import { boot, type Booted } from "../../orchestrator/test/helpers";

const ID = `plan_${"a".repeat(32)}`;
const context = {
  plan_id: ID,
  status: "proposed" as const,
  task_count: 2,
  meeting_grounded_count: 3,
  suggested_count: 1,
  user_edited_count: 0,
  criteria_count: 2,
  risk_count: 1,
  open_question_count: 1,
};
let rig: Booted | undefined;
afterEach(async () => {
  await rig?.close();
  rig = undefined;
});

describe("planning review specialist", () => {
  it("observes only opted-in aggregates and returns evidence-bound advisory findings", async () => {
    const agent = createPlanningReviewAgent();
    rig = await boot({
      agents: [agent],
      modules: [createPlanningCapability({ services: () => ({ reviewContext: () => context }) })],
    });
    await rig.manager.enable("plans");
    const task = rig.orchestrator.submit({
      kind: "planning_review",
      input: { plan_id: ID },
      requestedBy: "u",
    });
    await rig.orchestrator.settled(task.id);
    const trace = rig.orchestrator.trace(task.id)!;
    expect(trace.run.state).toBe("COMPLETED");
    expect(trace.steps.filter((s) => s.kind === "tool_call").map((s) => s.name)).toEqual([
      "plans.review_context",
    ]);
    const handoff = specialistHandoff(
      agent.specialist,
      trace.conclusion!,
      new Set(trace.evidence.map((e) => e.id)),
    );
    expect(handoff).toMatchObject({
      plan_id: ID,
      status: "proposed",
      provenance: { source: "plans.review_context", evidence_id: trace.evidence[0]!.id },
    });
    expect(handoff.findings).toHaveLength(2);
    expect(handoff.findings.every((f) => f.evidence_ids[0] === trace.evidence[0]!.id)).toBe(true);
    expect(trace.conclusion?.proposals.every((p) => p.advisory && p.grounded)).toBe(true);
    expect(JSON.stringify(trace)).not.toContain("idempotency_key");
  });

  it("rejects extra or malformed agent input", async () => {
    rig = await boot({
      agents: [createPlanningReviewAgent()],
      modules: [createPlanningCapability()],
    });
    await rig.manager.enable("plans");
    for (const input of [{ plan_id: ID, body: "secret" }, { plan_id: "../plan" }]) {
      expect(() =>
        rig!.orchestrator.submit({ kind: "planning_review", input, requestedBy: "u" }),
      ).toThrow();
    }
  });

  it("fails closed when Core's authorized service is unavailable", async () => {
    rig = await boot({
      agents: [createPlanningReviewAgent()],
      modules: [createPlanningCapability()],
    });
    await rig.manager.enable("plans");
    const task = rig.orchestrator.submit({
      kind: "planning_review",
      input: { plan_id: ID },
      requestedBy: "u",
    });
    await rig.orchestrator.settled(task.id);
    expect(rig.orchestrator.trace(task.id)?.run.state).toBe("FAILED");
    expect(rig.orchestrator.trace(task.id)?.conclusion).toBeNull();
  });

  it("refuses malformed or expanded service output rather than exposing it as evidence", async () => {
    rig = await boot({
      agents: [createPlanningReviewAgent()],
      modules: [
        createPlanningCapability({
          services: () => ({ reviewContext: () => ({ ...context, body: "secret" }) }),
        }),
      ],
    });
    await rig.manager.enable("plans");
    const task = rig.orchestrator.submit({
      kind: "planning_review",
      input: { plan_id: ID },
      requestedBy: "u",
    });
    await rig.orchestrator.settled(task.id);
    const trace = rig.orchestrator.trace(task.id)!;
    expect(trace.run.state).toBe("FAILED");
    expect(trace.conclusion).toBeNull();
    expect(trace.evidence).toEqual([]);
  });
});
