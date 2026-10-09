// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ToolGatewayError } from "@phoenix/ai-tool-gateway";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApprovalOutcome, WorkflowDefinition } from "../src";
import { definitionHash } from "../src/canonical";
import { buildMetrics, percentile } from "../src/views";
import { StepRunner, type RunnerDeps } from "../src/runner";
import { newRunState } from "../src/run-state";
import {
  agent,
  boot,
  buildFailed,
  closeAll,
  deployFailedWorkflow,
  devWorkflow,
  fakeAi,
  ManualClock,
  newCalls,
  tempDir,
  user,
  type Core,
} from "./fixtures";

const cleanups: (() => void)[] = [];
afterEach(async () => {
  await closeAll();
  for (const c of cleanups.splice(0)) c();
});
const setup = () => {
  const t = tempDir();
  cleanups.push(t.cleanup);
  return t;
};
const go = async (core: Core) => {
  core.engine.recover();
  core.engine.start();
};
const settle = async (core: Core) => {
  for (let i = 0; i < 3; i++) {
    await core.bus.drain();
    await core.engine.idle();
  }
};

const approve = () => true;
/** A workflow of write steps with declared undos: restart (undo_restart), then `echo`. */
function undoable(over: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return devWorkflow(
    "undoable",
    [
      { id: "gate", type: "approval", summary: "go?" },
      {
        id: "restart",
        type: "action",
        tool: "deploys.restart",
        compensate: { tool: "deploys.undo_restart" },
      },
      {
        id: "note",
        type: "action",
        tool: "deploys.echo",
        input: { note: "hello" },
        compensate: { tool: "deploys.undo_restart" },
      },
      { id: "done", type: "result", outcome: "success", summary: "ok" },
    ],
    ["deploys.restart", "deploys.undo_restart", "deploys.echo"],
    over,
  );
}

describe("production workflows need the user's authorisation", () => {
  it("an unauthorised production workflow is refused with an event and an audit record saying why", async () => {
    const t = setup();
    const calls = newCalls();
    const core = await boot({ path: t.db, calls, ai: fakeAi });
    await go(core);
    // Saved, the workflow is switched off until the user authorises exactly this content.
    const saved = core.admin.save(user, deployFailedWorkflow());
    expect(saved.definition.enabled).toBe(false);
    core.admin.setEnabled(user, "deploy-failed", true);
    expect(core.engine.listWorkflows()[0]).toMatchObject({ enabled: true, authorised: false });

    core.bus.publish(
      buildFailed(
        {},
        { event_type: "deploy.failed", payload: { environment: "production", service: "api" } },
      ),
    );
    await settle(core);
    const [run] = core.engine.listRuns();
    expect(run).toMatchObject({ status: "refused", terminal: true });
    expect(run?.reason).toMatch(/not authorised: environment is "production"/);
    expect(calls.log).toEqual([]);
    const refusal = core.seen.find((e) => e.event_type === "workflow.run.refused");
    expect(refusal?.payload).toMatchObject({ workflow: "deploy-failed" });
    expect(String(refusal?.payload["reason"])).toMatch(/not authorised/);
    expect(
      core.permissions.audit.list({ limit: 200 }).find((e) => e.action === "workflow.run.refused"),
    ).toMatchObject({
      decision: "denied",
      details: { workflow: "deploy-failed" },
    });
    expect(core.engine.metrics()["deploy-failed"]).toMatchObject({
      runsRefused: 1,
      runsStarted: 0,
    });
  });

  it("runs after authorise(), and editing the definition invalidates the authorisation", async () => {
    const t = setup();
    const core = await boot({ path: t.db, calls: newCalls(), ai: fakeAi, autoAnswer: approve });
    await go(core);
    core.policyAdmin.addRule(user, {
      id: "logs-ok",
      effect: "allow",
      match: { tool: "deploys.logs", environments: ["production"], actorKinds: ["system"] },
    });
    core.admin.save(user, deployFailedWorkflow());
    const auth = core.admin.authorise(user, "deploy-failed");
    core.admin.setEnabled(user, "deploy-failed", true);
    expect(auth).toMatchObject({ authorisedBy: "user:me", expiresAt: null, revokedAt: null });
    expect(core.engine.listWorkflows()[0]).toMatchObject({ authorised: true });

    core.bus.publish(
      buildFailed(
        {},
        { event_type: "deploy.failed", payload: { environment: "production", service: "api" } },
      ),
    );
    await vi.waitFor(async () => {
      await settle(core);
      expect(core.engine.listRuns()[0]?.status).toBe("succeeded");
    });

    // The user (or anyone with the admin object) edits one string: the authorisation no longer applies.
    const edited = deployFailedWorkflow({ version: 2 });
    (edited.steps[2] as { title: string }).title = "A different title";
    core.admin.save(user, edited);
    expect(core.engine.listWorkflows()[0]).toMatchObject({
      version: 2,
      authorised: false,
      enabled: true,
    });
    expect(core.store.authorisations("deploy-failed")[0]?.revokedBy).toBe(
      "system:definition-changed",
    );
    core.bus.publish(
      buildFailed(
        { n: 2 },
        { event_type: "deploy.failed", payload: { environment: "production", service: "api" } },
      ),
    );
    await settle(core);
    expect(core.engine.listRuns()[0]).toMatchObject({ status: "refused" });
  });

  it("is bound to the hash: a row changed behind the admin's back does not inherit the authorisation", async () => {
    const t = setup();
    const core = await boot({ path: t.db, calls: newCalls(), ai: fakeAi });
    await go(core);
    core.admin.save(user, deployFailedWorkflow());
    core.admin.authorise(user, "deploy-failed");
    core.admin.setEnabled(user, "deploy-failed", true);
    const row = core.db.prepare("SELECT definition, hash FROM workflow_definitions").get() as {
      definition: string;
      hash: string;
    };
    const forged = row.definition.replace("Deploy of", "Hacked deploy of");
    core.db.prepare("UPDATE workflow_definitions SET definition = ?").run(forged);
    expect(core.engine.listWorkflows()[0]?.problems.join()).toMatch(/hash/);
    // Even if the hash column is recomputed to match, the authorisation names the old hash.
    core.db
      .prepare("UPDATE workflow_definitions SET hash = ?")
      .run(definitionHash(JSON.parse(forged) as WorkflowDefinition));
    core.admin.setEnabled(user, "deploy-failed", true);
    expect(core.engine.listWorkflows()[0]).toMatchObject({ authorised: false, problems: [] });
    core.bus.publish(
      buildFailed(
        {},
        { event_type: "deploy.failed", payload: { environment: "production", service: "api" } },
      ),
    );
    await settle(core);
    expect(core.engine.listRuns()[0]?.status).toBe("refused");
  });

  it("expires, can be revoked, and revoking stops a run at its next step", async () => {
    const t = setup();
    const clock = new ManualClock();
    const calls = newCalls();
    const core = await boot({ path: t.db, calls, ai: fakeAi, now: clock.now, sleep: clock.sleep });
    await go(core);
    core.admin.save(user, deployFailedWorkflow());
    core.admin.setEnabled(user, "deploy-failed", true);
    expect(() =>
      core.admin.authorise(user, "deploy-failed", { expiresAt: clock.now() - 1 }),
    ).toThrow(/future/);
    core.admin.authorise(user, "deploy-failed", { expiresAt: clock.now() + 60_000 });
    clock.advance(61_000);
    expect(core.engine.listWorkflows()[0]?.authorised).toBe(false);
    core.bus.publish(
      buildFailed(
        {},
        { event_type: "deploy.failed", payload: { environment: "production", service: "api" } },
      ),
    );
    await settle(core);
    expect(core.engine.listRuns()[0]?.status).toBe("refused");

    // Authorise again, let a run reach the approval gate, then revoke while it waits.
    core.policyAdmin.addRule(user, {
      id: "logs-ok",
      effect: "allow",
      match: { tool: "deploys.logs", environments: ["production"], actorKinds: ["system"] },
    });
    core.admin.authorise(user, "deploy-failed");
    core.bus.publish(
      buildFailed(
        { n: 2 },
        { event_type: "deploy.failed", payload: { environment: "production", service: "api" } },
      ),
    );
    await vi.waitFor(() => expect(core.engine.listRuns()[0]?.status).toBe("waiting_approval"));
    expect(core.admin.revoke(user, "deploy-failed")).toBe(1);
    await core.answer(true, "workflows");
    await settle(core);
    const run = core.engine.listRuns()[0]!;
    expect(run.status).toBe("cancelled");
    expect(run.reason).toMatch(/authorisation was revoked/);
    expect(calls.log.map((c) => c.command)).toEqual(["logs"]);
    expect(() => core.admin.revoke(agent, "deploy-failed")).toThrow(/authenticated user/);
  });

  it("a workflow that is not production but calls a critical/production tool needs authorisation too", async () => {
    const t = setup();
    const core = await boot({ path: t.db, calls: newCalls() });
    await go(core);
    const d = devWorkflow(
      "dev-prod-tool",
      [
        { id: "gate", type: "approval", summary: "ok" },
        { id: "rb", type: "action", tool: "deploys.rollback" },
      ],
      ["deploys.rollback"],
      { environment: "dev" },
    );
    expect(core.admin.save(user, d).definition.enabled).toBe(false);
    expect(core.engine.listWorkflows()[0]?.authorisationReasons.join()).toMatch(
      /deploys\.rollback is critical|production action/,
    );
  });
});

describe("failure handling and compensation", () => {
  it("a failed step stops the run and undoes succeeded steps in reverse order, once each", async () => {
    const t = setup();
    const calls = newCalls();
    calls.failCommands["echo"] = true;
    const core = await boot({ path: t.db, calls, autoAnswer: approve });
    await go(core);
    core.admin.save(user, undoable());
    core.bus.publish(buildFailed());
    await vi.waitFor(async () => {
      await settle(core);
      expect(core.engine.listRuns()[0]?.terminal).toBe(true);
    });
    const run = core.engine.getRun(core.engine.listRuns()[0]!.id)!;
    expect(run.status).toBe("failed");
    expect(run.steps.map((s) => `${s.phase}:${s.stepId}:${s.status}`)).toEqual([
      "step:gate:succeeded",
      "step:restart:succeeded",
      "step:note:failed",
      "compensation:restart:succeeded",
    ]);
    // `note` failed, so it is not undone; `restart` is undone exactly once.
    expect(calls.log.map((c) => c.command)).toEqual(["restart", "echo", "undo_restart"]);
    expect(calls.log[2]).toEqual({ command: "undo_restart", input: {} });
    expect(core.engine.metrics()["undoable"]).toMatchObject({
      runsFailed: 1,
      runsCompensated: 1,
      runsNeedingAttention: 0,
    });
  });

  it("a failure result step undoes both writes, newest first", async () => {
    const t = setup();
    const calls = newCalls();
    const core = await boot({ path: t.db, calls, autoAnswer: approve });
    await go(core);
    const d = undoable();
    d.steps[3] = { id: "done", type: "result", outcome: "failure", summary: "gave up" };
    core.admin.save(user, d);
    core.bus.publish(buildFailed());
    await vi.waitFor(async () => {
      await settle(core);
      expect(core.engine.listRuns()[0]?.terminal).toBe(true);
    });
    const run = core.engine.getRun(core.engine.listRuns()[0]!.id)!;
    expect(run.status).toBe("failed");
    expect(run.steps.filter((s) => s.phase === "compensation").map((s) => s.stepId)).toEqual([
      "note",
      "restart",
    ]);
    expect(calls.log.map((c) => c.command)).toEqual([
      "restart",
      "echo",
      "undo_restart",
      "undo_restart",
    ]);
    expect(
      core.seen.filter((e) => e.event_type === "workflow.result").map((e) => e.payload["outcome"]),
    ).toEqual(["failure"]);
  });

  it("a failing undo is recorded, the remaining undos still run, and the run needs attention", async () => {
    const t = setup();
    const calls = newCalls();
    calls.failCommands["echo"] = true;
    const core = await boot({ path: t.db, calls, autoAnswer: approve });
    await go(core);
    const d = undoable();
    d.steps = [
      d.steps[0]!,
      d.steps[1]!,
      {
        id: "second",
        type: "action",
        tool: "deploys.restart",
        compensate: { tool: "deploys.echo", input: { note: "undo" } },
      },
      d.steps[2]!,
    ];
    d.declares.tools = ["deploys.restart", "deploys.undo_restart", "deploys.echo"];
    core.admin.save(user, d);
    core.bus.publish(buildFailed());
    await vi.waitFor(async () => {
      await settle(core);
      expect(core.engine.listRuns()[0]?.terminal).toBe(true);
    });
    const run = core.engine.getRun(core.engine.listRuns()[0]!.id)!;
    expect(run.status).toBe("failed_needs_attention");
    expect(run.reason).toMatch(/undo failed for second/);
    expect(
      run.steps.filter((s) => s.phase === "compensation").map((s) => `${s.stepId}:${s.status}`),
    ).toEqual(["second:failed", "restart:succeeded"]);
    expect(core.engine.metrics()["undoable"]).toMatchObject({
      runsNeedingAttention: 1,
      runsCompensated: 0,
    });
    const result = core.seen.find((e) => e.event_type === "workflow.result");
    expect(result).toMatchObject({ requires_action: true, severity: "error" });
  });

  it("a step timeout abandons the in-flight call and counts as failure; a stuck write needs attention and is not undone", async () => {
    const t = setup();
    const clock = new ManualClock();
    const calls = newCalls();
    const core = await boot({
      path: t.db,
      calls,
      now: clock.now,
      sleep: clock.sleep,
      autoAnswer: approve,
    });
    await go(core);
    core.admin.save(
      user,
      devWorkflow(
        "stuck",
        [
          { id: "gate", type: "approval", summary: "go?" },
          {
            id: "ok",
            type: "action",
            tool: "deploys.restart",
            compensate: { tool: "deploys.undo_restart" },
          },
          {
            id: "stuck",
            type: "action",
            tool: "deploys.stuck_write",
            timeout_ms: 2000,
            compensate: { tool: "deploys.undo_restart" },
          },
        ],
        ["deploys.restart", "deploys.undo_restart", "deploys.stuck_write"],
      ),
    );
    core.bus.publish(buildFailed());
    await vi.waitFor(() => expect(calls.held).toHaveLength(1));
    clock.advance(2000);
    await vi.waitFor(async () => {
      await settle(core);
      expect(core.engine.listRuns()[0]?.terminal).toBe(true);
    });
    const run = core.engine.getRun(core.engine.listRuns()[0]!.id)!;
    expect(run.status).toBe("failed_needs_attention");
    expect(run.reason).toMatch(/outcome unknown for stuck/);
    expect(run.steps.find((s) => s.stepId === "stuck")).toMatchObject({
      status: "timed_out",
      destructive: true,
    });
    // The step that timed out is never undone automatically (we do not know if it ran), but the
    // earlier, certain one is.
    expect(run.steps.filter((s) => s.phase === "compensation").map((s) => s.stepId)).toEqual([
      "ok",
    ]);
    expect(core.engine.metrics()["stuck"]).toMatchObject({
      runsNeedingAttention: 1,
      stepsFailed: 1,
    });
  });

  it("never retries a non-idempotent tool, even when the step asks for it", async () => {
    // The validator refuses such a definition; this checks the runner on its own, as the second line.
    const gate = { n: 0 };
    const deps: RunnerDeps = {
      gateway: {
        call: () => {
          gate.n++;
          return Promise.reject(new ToolGatewayError("EXECUTION_FAILED", "boom"));
        },
        tools: () => [],
      },
      catalog: (name) => ({
        name,
        sideEffect: "write",
        permissions: [],
        idempotent: false,
        timeoutMs: 1000,
      }),
      publish: () => ({ ok: true }),
      ai: undefined,
      lookup: undefined,
      sleep: () => Promise.resolve(),
      abandon: undefined,
      approvalWaitMs: 1,
      warn: () => undefined,
    };
    const def = devWorkflow(
      "r",
      [{ id: "a", type: "action", tool: "deploys.restart" }],
      ["deploys.restart"],
    );
    const state = newRunState(
      {
        id: "run_r",
        workflowId: "r",
        definitionHash: "h",
        definition: def,
        status: "running",
        triggerEventId: "evt_r",
        triggerEvent: {},
        correlationId: "workflow-run_r",
        chainDepth: 0,
        currentStep: null,
        reason: null,
        createdAt: 0,
        startedAt: 0,
        updatedAt: 0,
        finishedAt: null,
      },
      {},
    );
    state.approved = true;
    const runner = new StepRunner(deps);
    const prepared = runner.prepareTool(state, "deploys.restart", {}, "x");
    await expect(
      runner.callTool(state, prepared, { retry: { max: 3, backoff_ms: 0 } }),
    ).rejects.toThrow();
    expect(gate.n).toBe(1);

    // Positive control: the same failure on an idempotent tool IS retried.
    const retried = new StepRunner({
      ...deps,
      catalog: (name) => ({
        name,
        sideEffect: "read",
        permissions: [],
        idempotent: true,
        timeoutMs: 1000,
      }),
    });
    const read = retried.prepareTool(state, "deploys.restart", {}, "x");
    gate.n = 0;
    await expect(
      retried.callTool(state, read, { retry: { max: 3, backoff_ms: 0 } }),
    ).rejects.toThrow();
    expect(gate.n).toBe(4);
  });

  it("an approval that expires fails the run and counts as expired", async () => {
    const t = setup();
    const outcomes: ApprovalOutcome[] = ["expired"];
    const core = await boot({
      path: t.db,
      calls: newCalls(),
      approvals: { request: () => Promise.resolve(outcomes.shift() ?? "rejected") },
    });
    await go(core);
    core.admin.save(user, devWorkflow("exp", [{ id: "g", type: "approval", summary: "go?" }], []));
    core.bus.publish(buildFailed());
    await settle(core);
    expect(core.engine.listRuns()[0]).toMatchObject({
      status: "failed",
      reason: expect.stringMatching(/expired/),
    });
    expect(core.engine.metrics()["exp"]).toMatchObject({
      approvalsExpired: 1,
      approvalsWaiting: 0,
    });
  });
});

describe("kill switch", () => {
  it("cancels running workflows, rejects waiting approvals and refuses new runs", async () => {
    const t = setup();
    const calls = newCalls();
    const core = await boot({ path: t.db, calls });
    await go(core);
    core.admin.save(
      user,
      devWorkflow("hung", [{ id: "h", type: "action", tool: "deploys.hang" }], ["deploys.hang"], {
        environment: "local",
      }),
    );
    core.admin.save(
      user,
      devWorkflow(
        "waiting",
        [
          { id: "g", type: "approval", summary: "go?" },
          { id: "n", type: "notify", title: "t", message: "m" },
        ],
        [],
        { environment: "local" },
      ),
    );
    core.bus.publish(buildFailed());
    await vi.waitFor(() => {
      const statuses = Object.fromEntries(
        core.engine.listRuns().map((r) => [r.workflowId, r.status]),
      );
      expect(statuses).toEqual({ hung: "running", waiting: "waiting_approval" });
    });

    core.permissions.engageKillSwitch("user", "test");
    await settle(core);
    const runs = Object.fromEntries(core.engine.listRuns().map((r) => [r.workflowId, r]));
    expect(runs["hung"]).toMatchObject({ status: "cancelled" });
    expect(runs["hung"]?.reason).toMatch(/Emergency stop/);
    expect(runs["waiting"]).toMatchObject({ status: "cancelled" });
    expect(core.permissions.pendingConfirmations()).toEqual([]);
    expect(core.engine.getRun(runs["waiting"]!.id)?.steps.at(-1)).toMatchObject({
      stepId: "g",
      status: "rejected",
    });
    expect(core.engine.getRun(runs["hung"]!.id)?.steps.at(-1)).toMatchObject({
      stepId: "h",
      status: "failed",
    });

    core.bus.publish(buildFailed({ again: true }));
    await settle(core);
    const refused = core.engine.listRuns().filter((r) => r.status === "refused");
    expect(refused).toHaveLength(2);
    expect(refused[0]?.reason).toBe("Emergency stop is engaged");
    expect(calls.log.filter((c) => c.command === "hang")).toHaveLength(1);

    core.permissions.disengageKillSwitch();
    core.bus.publish(buildFailed({ third: true }));
    await core.bus.drain();
    // Back to normal: the new event starts runs again (they now wait on a hung read / an approval).
    // The workflow that needs no capability starts again. The one that needs `deploys` is refused
    // for a different, honest reason: the capability manager disabled the capability on the stop.
    await vi.waitFor(() =>
      expect(
        core.engine.listRuns({ workflowId: "waiting", status: "waiting_approval" }),
      ).toHaveLength(1),
    );
    const hung = core.engine.listRuns({ workflowId: "hung" })[0];
    expect(hung?.reason).toMatch(/not an available tool/);
    expect(
      core.engine
        .listRuns()
        .filter((r) => r.reason === "Emergency stop is engaged" && r.status === "refused"),
    ).toHaveLength(2);
  });

  it("makes no undo call after the stop, and says which steps were left", async () => {
    const t = setup();
    const calls = newCalls();
    const core = await boot({ path: t.db, calls, autoAnswer: approve });
    await go(core);
    core.admin.save(
      user,
      devWorkflow(
        "ks-undo",
        [
          { id: "g", type: "approval", summary: "go?" },
          {
            id: "w",
            type: "action",
            tool: "deploys.restart",
            compensate: { tool: "deploys.undo_restart" },
          },
          { id: "h", type: "action", tool: "deploys.hang" },
        ],
        ["deploys.restart", "deploys.undo_restart", "deploys.hang"],
      ),
    );
    core.bus.publish(buildFailed());
    await vi.waitFor(() => expect(calls.held).toHaveLength(1));
    core.permissions.engageKillSwitch();
    await settle(core);
    const run = core.engine.getRun(core.engine.listRuns()[0]!.id)!;
    expect(run.status).toBe("failed_needs_attention");
    expect(run.reason).toMatch(/Emergency stop.*not undone: w/);
    expect(calls.log.map((c) => c.command)).toEqual(["restart", "hang"]);
    expect(run.steps.some((s) => s.phase === "compensation")).toBe(false);
  });

  it("the real kill switch blocks a tool call that races it", async () => {
    const t = setup();
    const calls = newCalls();
    const core = await boot({ path: t.db, calls });
    await go(core);
    core.permissions.engageKillSwitch();
    await expect(
      core.gateway.call({
        actor: { kind: "system", id: "workflow-run_z", trustedByUser: false },
        tool: "deploys.logs",
        input: {},
        environment: "local",
      }),
    ).rejects.toMatchObject({ code: "DENIED" });
    expect(calls.log).toEqual([]);
  });
});

describe("metrics", () => {
  it("reports counts, step failure rate, duration percentiles and approvals; counters survive a restart", async () => {
    const t = setup();
    const clock = new ManualClock();
    const calls = newCalls();
    const core = await boot({ path: t.db, calls, now: clock.now, sleep: clock.sleep });
    await go(core);
    core.admin.save(
      user,
      devWorkflow(
        "m",
        [
          { id: "r", type: "action", tool: "deploys.flaky" },
          { id: "n", type: "notify", title: "t", message: "m" },
        ],
        ["deploys.flaky"],
        { environment: "local" },
      ),
    );
    const durations = [10, 20, 30, 40, 100];
    for (const [i, d] of durations.entries()) {
      core.bus.publish(buildFailed({ i }));
      await core.bus.drain();
      await core.engine.idle();
      void d;
      clock.advance(100);
    }
    calls.failFlaky = 1;
    core.bus.publish(buildFailed({ i: 99 }));
    await settle(core);
    const m = core.engine.metrics()["m"]!;
    expect(m).toMatchObject({
      runsStarted: 6,
      runsSucceeded: 5,
      runsFailed: 1,
      stepsSucceeded: 10,
      stepsFailed: 1,
      approvalsWaiting: 0,
    });
    expect(m.stepFailureRate).toBeCloseTo(1 / 11, 5);
    expect(m.duration?.samples).toBe(6);
    await core.close();
    const again = await boot({ path: t.db, calls: newCalls(), now: clock.now });
    again.engine.recover();
    expect(again.engine.metrics()["m"]).toEqual(m);
  });

  it("percentiles come from the injected clock", async () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(percentile([7], 99)).toBe(7);
    expect(percentile([], 50)).toBe(0);
    expect(buildMetrics({ steps_failed: 1, steps_succeeded: 3 }, [30, 10, 20], 2)).toMatchObject({
      stepFailureRate: 0.25,
      approvalsWaiting: 2,
      duration: { p50: 20, p90: 30, p99: 30, samples: 3 },
    });
    expect(buildMetrics(undefined, [], 0).duration).toBeNull();
  });
});
