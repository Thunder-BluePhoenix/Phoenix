// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agent,
  boot,
  closeAll,
  deployFailedWorkflow,
  fakeAi,
  newCalls,
  tempDir,
  triggerEvent,
  user,
  type Core,
} from "./fixtures";

const cleanups: (() => void)[] = [];
afterEach(async () => {
  await closeAll();
  for (const c of cleanups.splice(0)) c();
});

async function ready(
  path: string,
  calls = newCalls(),
): Promise<{ core: Core; calls: typeof calls }> {
  const core = await boot({ path, calls, ai: fakeAi });
  core.engine.recover();
  core.engine.start();
  // Reading production is high risk, so it asks every time unless the user has allowed it.
  core.policyAdmin.addRule(user, {
    id: "workflows-read-production-logs",
    effect: "allow",
    match: { tool: "deploys.logs", environments: ["production"], actorKinds: ["system"] },
  });
  core.admin.save(user, deployFailedWorkflow());
  core.admin.authorise(user, "deploy-failed");
  core.admin.setEnabled(user, "deploy-failed", true);
  return { core, calls };
}

const fail = (extra: Record<string, unknown> = {}) =>
  triggerEvent("deploy.failed", { environment: "production", service: "api", ...extra });

describe("example: production deploy fails -> logs -> diagnose -> notify -> plan -> approval", () => {
  it("runs end to end and waits for the approval, then rolls back when approved", async () => {
    const t = tempDir();
    cleanups.push(t.cleanup);
    const { core, calls } = await ready(t.db);

    core.bus.publish(fail());
    await core.answer(true, "workflows");

    // The state-changing tool then asks through the capability manager's own confirmation (ADR-0006).
    await core.answer(true, "deploys");
    await core.engine.idle();

    const [summary] = core.engine.listRuns();
    expect(summary?.status).toBe("succeeded");
    const run = core.engine.getRun(summary!.id)!;
    expect(run.correlationId).toBe(`workflow-${run.id}`);
    expect(run.steps.map((s) => `${s.stepId}:${s.status}`)).toEqual([
      "logs:succeeded",
      "diagnose:succeeded",
      "tell:succeeded",
      "plan:succeeded",
      "gate:succeeded",
      "rollback:succeeded",
      "done:succeeded",
    ]);
    expect(run.steps.find((s) => s.stepId === "diagnose")?.output).toContain("migration 42 failed");
    expect(run.steps.find((s) => s.stepId === "diagnose")?.output).toContain("Fake · test");
    expect(run.steps.find((s) => s.stepId === "rollback")?.destructive).toBe(true);
    expect(calls.log.map((c) => c.command)).toEqual(["logs", "rollback"]);

    // Events: notify before the approval request, result at the end, one correlation id on all of them.
    await core.bus.drain();
    const mine = core.seen.filter((e) => e.correlation_id === run.correlationId);
    expect(mine.map((e) => e.event_type)).toEqual([
      "workflow.notify",
      "workflow.approval.requested",
      "workflow.result",
    ]);
    expect(mine[0]).toMatchObject({
      severity: "error",
      requires_action: true,
      payload: {
        title: "Deploy of api failed",
        message: "Likely cause: migration 42 failed (high)",
      },
    });
    expect(mine[2]?.payload).toMatchObject({ outcome: "success" });

    // Audit: one policy decision per tool call, each carrying this run's correlation id as actor.
    const audit = core.permissions.audit.list({ limit: 1000 }).reverse(); // oldest first
    const decisions = audit.filter(
      (e) => e.action === "policy.decision" && e.actor === `system:${run.correlationId}`,
    );
    expect(decisions.map((d) => d.details["tool"])).toEqual(["deploys.logs", "deploys.rollback"]);
  });

  it("a rejected approval ends the run as rejected and the recovery tool never runs", async () => {
    const t = tempDir();
    cleanups.push(t.cleanup);
    const { core, calls } = await ready(t.db);
    core.bus.publish(fail());
    await core.answer(false, "workflows");
    await core.engine.idle();
    const [summary] = core.engine.listRuns();
    expect(summary).toMatchObject({ status: "rejected" });
    expect(calls.log.map((c) => c.command)).toEqual(["logs"]);
    expect(core.engine.getRun(summary!.id)?.steps.at(-1)).toMatchObject({
      stepId: "gate",
      status: "rejected",
    });
    expect(core.engine.metrics()["deploy-failed"]).toMatchObject({
      runsRejected: 1,
      approvalsRejected: 1,
    });
  });

  it("shows the pending approval in the history and the metrics while it waits, and survives a restart as interrupted", async () => {
    const t = tempDir();
    cleanups.push(t.cleanup);
    const { core } = await ready(t.db);
    core.bus.publish(fail());
    await vi.waitFor(() => expect(core.engine.listRuns()[0]?.status).toBe("waiting_approval"));
    const waiting = core.engine.listRuns()[0]!;
    expect(core.engine.getRun(waiting.id)?.steps.at(-1)).toMatchObject({
      stepId: "gate",
      status: "waiting",
    });
    expect(core.engine.metrics()["deploy-failed"]?.approvalsWaiting).toBe(1);
    expect(core.permissions.pendingConfirmations()[0]).toMatchObject({ capabilityId: "workflows" });

    await core.crash();
    const again = await boot({ path: t.db, calls: newCalls(), ai: fakeAi });
    const report = again.engine.recover();
    expect(report).toEqual({ interrupted: [waiting.id], needsAttention: [] });
    const view = again.engine.getRun(waiting.id)!;
    expect(view.status).toBe("interrupted");
    expect(view.steps.at(-1)).toMatchObject({ stepId: "gate", status: "expired" });
    expect(view.steps.map((s) => s.stepId)).toContain("diagnose");
    expect(again.engine.metrics()["deploy-failed"]).toMatchObject({
      runsInterrupted: 1,
      approvalsWaiting: 0,
    });
  });

  it("ignores events that do not match the trigger", async () => {
    const t = tempDir();
    cleanups.push(t.cleanup);
    const { core } = await ready(t.db);
    core.bus.publish(triggerEvent("deploy.failed", { environment: "staging", service: "api" }));
    core.bus.publish(triggerEvent("deploy.succeeded", { environment: "production" }));
    await core.bus.drain();
    await core.engine.idle();
    expect(core.engine.listRuns()).toEqual([]);
  });

  it("an agent cannot create, enable or authorise a workflow", async () => {
    const t = tempDir();
    cleanups.push(t.cleanup);
    const { core } = await ready(t.db);
    for (const act of [
      () => core.admin.save(agent, deployFailedWorkflow({ id: "x" })),
      () => core.admin.setEnabled(agent, "deploy-failed", false),
      () => core.admin.authorise(agent, "deploy-failed"),
      () => core.admin.revoke(agent, "deploy-failed"),
      () => core.admin.remove(agent, "deploy-failed"),
      () =>
        core.admin.save(
          { kind: "user", id: "me", trustedByUser: false },
          deployFailedWorkflow({ id: "y" }),
        ),
    ])
      expect(act).toThrow(/authenticated user/);
    expect(core.engine.listWorkflows().map((w) => w.id)).toEqual(["deploy-failed"]);
    expect(core.engine.listWorkflows()[0]).toMatchObject({ enabled: true, authorised: true });
    expect(
      core.permissions.audit.list({ limit: 1000 }).filter((e) => e.action.endsWith(".refused")),
    ).toHaveLength(6);
  });
});
