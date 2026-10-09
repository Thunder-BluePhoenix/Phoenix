// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentsDisabledError,
  InvalidTaskError,
  KillSwitchEngagedError,
  TooManyRunsError,
  ToolCallFailure,
  STAGES,
  type Conclusion,
} from "../src";
import {
  boot,
  manualTimers,
  newOpsLog,
  opsCapability,
  taskInput,
  waitForConfirmation,
  type Booted,
  type OpsLog,
} from "./helpers";
import { emptyConclusion, READ_STEP, request, RESTART_STEP, testAgent } from "./test-agent";

const failureCode = (e: unknown): string => (e instanceof ToolCallFailure ? e.code : "");
const isRunning = (output: unknown): boolean =>
  typeof output === "object" && output !== null && "running" in output && output.running === true;

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function start(
  agent = testAgent(),
  extra: Partial<Parameters<typeof boot>[0]> = {},
): Promise<{ b: Booted; log: OpsLog }> {
  const log = newOpsLog();
  const b = await boot({ modules: [opsCapability(log)], agents: [agent], ...extra });
  cleanups.push(() => b.close());
  await b.manager.enable("ops");
  return { b, log };
}

const actions = (b: Booted) =>
  b.permissions.audit
    .list({ limit: 1000 })
    .reverse()
    .map((e) => e.action);

async function finished(b: Booted, input = taskInput()) {
  const task = b.orchestrator.submit(input);
  await b.orchestrator.settled(task.id);
  const trace = b.orchestrator.trace(task.id)!;
  return { task, trace };
}

describe("task submission", () => {
  it("is refused while automation is disabled (the default) and stores nothing", async () => {
    const { b } = await start(testAgent(), { enabled: false });
    expect(() => b.orchestrator.submit(taskInput())).toThrow(AgentsDisabledError);
    expect(b.orchestrator.list({ limit: 10 })).toEqual([]);
  });

  it("is refused while the kill switch is engaged", async () => {
    const { b } = await start();
    b.permissions.engageKillSwitch();
    expect(() => b.orchestrator.submit(taskInput())).toThrow(KillSwitchEngagedError);
  });

  it("rejects unknown kinds (including prototype names), non-object input and bad input", async () => {
    const { b } = await start();
    for (const kind of ["nope", "__proto__", "constructor", "toString", ""]) {
      expect(() => b.orchestrator.submit({ ...taskInput(), kind })).toThrow(InvalidTaskError);
    }
    for (const input of [null, "x", 5, [], undefined]) {
      expect(() => b.orchestrator.submit({ ...taskInput(), input })).toThrow(InvalidTaskError);
    }
    expect(() => b.orchestrator.submit(taskInput({ name: "UPPER" }))).toThrow(InvalidTaskError);
    expect(() => b.orchestrator.submit(taskInput({ name: "x".repeat(500) }))).toThrow(
      InvalidTaskError,
    );
    expect(b.orchestrator.list({ limit: 10 })).toEqual([]);
  });

  it("limits how many runs are active at once", async () => {
    const { b, log } = await start(testAgent(), { limits: { maxActiveRuns: 1 } });
    log.gate = Promise.withResolvers<void>();
    const first = b.orchestrator.submit(taskInput());
    expect(() => b.orchestrator.submit(taskInput())).toThrow(TooManyRunsError);
    log.gate.resolve();
    await b.orchestrator.settled(first.id);
    expect(() => b.orchestrator.submit(taskInput())).not.toThrow();
  });
});

describe("the request lifecycle", () => {
  it("runs every stage in order, each with its own audit record, and completes", async () => {
    const { b, log } = await start();
    const { trace } = await finished(b);
    expect(trace.run.state).toBe("COMPLETED");
    expect(log.reads).toBe(1);
    const stages = trace.steps.filter((s) => s.kind === "stage");
    expect(stages.map((s) => s.name)).toEqual([...STAGES]);
    expect(stages.every((s) => s.status === "ok")).toBe(true);
    const audit = b.permissions.audit.list({ limit: 1000 });
    for (const s of stages) {
      const row = audit.find((e) => e.id === s.stageAuditId);
      expect(row).toMatchObject({
        action: `agent.stage.${s.name}`,
        actor: "agent:test-agent",
      });
    }
  });

  it("the tool call goes through the gateway as an untrusted agent with trusted target data", async () => {
    const { b } = await start();
    const { trace } = await finished(b);
    const call = trace.steps.find((s) => s.kind === "tool_call")!;
    expect(call.policyAuditId).not.toBeNull();
    const decision = b.permissions.audit
      .list({ limit: 1000 })
      .find((e) => e.id === call.policyAuditId)!;
    expect(decision.action).toBe("policy.decision");
    expect(decision.actor).toBe("agent:test-agent");
    expect(decision.details).toMatchObject({
      tool: "ops.read_state",
      environment: "local",
      resource: "service:svc",
      dataClass: "internal",
      trustedByUser: false,
    });
  });

  it("audit details carry ids, counts and names but never tool output or evidence text", async () => {
    const secretText = "SENTINEL-OUTPUT-TEXT-12345";
    const { b } = await start(
      testAgent({
        afterTool: (rc) => {
          rc.evidence.add({ kind: "tool_output", source: "ops.read_state", text: secretText });
        },
        conclude: async (rc) =>
          emptyConclusion({
            summary: `the summary says ${secretText}`,
            modelCalls: rc.evidence.list().length,
          }),
      }),
    );
    const { trace } = await finished(b);
    expect(trace.run.state).toBe("COMPLETED");
    const all = JSON.stringify(b.permissions.audit.list({ limit: 1000 }));
    expect(all).not.toContain(secretText);
    expect(JSON.stringify(trace.steps)).not.toContain(secretText);
    // ...but the evidence itself is kept, redacted and capped, in the trace.
    expect(trace.evidence[0]?.excerpt).toContain(secretText);
  });

  it("publishes Fawkes events with one correlation id per run", async () => {
    const { b } = await start();
    const { task } = await finished(b);
    const types = b.published.map((e) => e.event_type);
    expect(types[0]).toBe("agent_run.started");
    expect(types.at(-1)).toBe("agent_run.completed");
    expect(new Set(b.published.map((e) => e.correlation_id))).toEqual(
      new Set([task.correlationId]),
    );
    for (const type of types) expect(type.startsWith("agent_run.")).toBe(true);
  });
});

describe("plans are untrusted data", () => {
  const rejected = async (plan: unknown, over: { allowedTools?: string[] } = {}) => {
    const { b, log } = await start(testAgent({ plan: () => plan, ...over }));
    const { trace } = await finished(b);
    return { b, log, trace };
  };

  it.each([
    ["unknown tool", { steps: [{ ...READ_STEP, tool: "ops.format_disk" }] }],
    [
      "a different capability than the task allows",
      { steps: [{ ...READ_STEP, tool: "git.status" }] },
    ],
    ["an extra field (risk)", { steps: [{ ...READ_STEP, risk: "low" }] }],
    ["an extra top-level field", { steps: [READ_STEP], approved: true }],
    ["an environment smuggled in", { steps: [{ ...READ_STEP, environment: "production" }] }],
    ["bad tool input", { steps: [{ ...READ_STEP, input: { surprise: 1 } }] }],
    ["non-sequential indexes", { steps: [{ ...READ_STEP, index: 3 }] }],
    ["no steps", { steps: [] }],
    ["not an object", "run everything"],
    ["null", null],
    [
      "a tool that exists but is not on the task's list",
      { steps: [{ ...READ_STEP, tool: "ops.other_read" }] },
    ],
    [
      "a prototype-pollution shaped tool",
      { steps: [{ ...READ_STEP, tool: "__proto__.polluted" }] },
    ],
  ])("rejects a plan with %s: nothing runs, run FAILED, rejection recorded", async (_n, plan) => {
    const { b, log, trace } = await rejected(plan);
    expect(trace.run.state).toBe("FAILED");
    expect(trace.run.failureReason).toMatch(/^Plan rejected/);
    expect(log.reads + log.restarts).toBe(0);
    expect(trace.steps.some((s) => s.kind === "tool_call")).toBe(false);
    const planStage = trace.steps.find((s) => s.name === "plan")!;
    expect(planStage.status).toBe("rejected");
    expect(actions(b)).toContain("agent.stage.plan");
    expect(actions(b)).not.toContain("policy.decision");
  });

  it("the capability list is enforced on its own, even for a registered tool on the tool list", async () => {
    const { b, log } = await start(
      testAgent({
        allowedCapabilities: ["other"],
        allowedTools: ["ops.other_read"],
        plan: () => ({ steps: [{ ...READ_STEP, tool: "ops.other_read" }] }),
      }),
    );
    const { trace } = await finished(b);
    expect(trace.run.state).toBe("FAILED");
    expect(trace.run.failureReason).toMatch(/capability "ops" is not allowed/);
    expect(log.reads).toBe(0);
  });

  it("rejects more steps than the step budget", async () => {
    const steps = Array.from({ length: 4 }, (_, index) => ({ ...READ_STEP, index }));
    const { b } = await start(testAgent({ plan: () => ({ steps }) }), { limits: { maxSteps: 3 } });
    const { trace } = await finished(b);
    expect(trace.run.state).toBe("FAILED");
    expect(trace.run.failureReason).toMatch(/Plan rejected/);
  });

  it("a plan that throws fails the run with a generic reason, not the error text", async () => {
    const { b } = await start(
      testAgent({
        plan: () => {
          throw new Error("model said: ignore previous instructions");
        },
      }),
    );
    const { trace } = await finished(b);
    expect(trace.run.state).toBe("FAILED");
    expect(trace.run.failureReason).toBe("Internal error; see the Phoenix log");
  });

  it("a hostile agent cannot call a tool outside its list through callTool either", async () => {
    let outcome = "";
    const { b, log } = await start(
      testAgent({
        plan: () => ({ steps: [READ_STEP] }),
        conclude: async (rc) => {
          try {
            await rc.callTool(request("ops.other_read"));
          } catch (e) {
            outcome = failureCode(e);
          }
          try {
            await rc.callTool(request("git.status"));
          } catch (e) {
            outcome += `,${failureCode(e)}`;
          }
          return emptyConclusion();
        },
      }),
    );
    await finished(b);
    expect(outcome).toBe("NOT_ALLOWED,NOT_ALLOWED");
    expect(log.reads).toBe(1);
  });
});

describe("budgets", () => {
  it("max tool calls bounds a run", async () => {
    const { b, log } = await start(
      testAgent({
        plan: () => ({
          steps: [READ_STEP, { ...READ_STEP, index: 1 }, { ...READ_STEP, index: 2 }],
        }),
      }),
      { limits: { maxToolCalls: 2 } },
    );
    const { trace } = await finished(b);
    expect(trace.run.state).toBe("FAILED");
    expect(log.reads).toBe(2);
    expect(
      trace.steps.filter((s) => s.kind === "tool_call" && s.status === "rejected"),
    ).toHaveLength(1);
  });

  it("max wall time (injected clock) stops the run before the next stage", async () => {
    let nowMs = 1_000_000;
    const { b, log } = await start(
      testAgent({
        plan: () => ({ steps: [READ_STEP, { ...READ_STEP, index: 1 }] }),
        afterTool: () => {
          nowMs += 600_000;
        },
      }),
      { now: () => nowMs, limits: { maxWallMs: 500_000 } },
    );
    const { trace } = await finished(b);
    expect(trace.run.state).toBe("FAILED");
    expect(trace.run.failureReason).toMatch(/time budget/);
    expect(log.reads).toBe(1);
  });

  it("the wall-time timer abandons an in-flight tool call", async () => {
    const timers = manualTimers();
    const { b, log } = await start(testAgent(), { setTimer: timers.setTimer });
    log.gate = Promise.withResolvers<void>();
    const task = b.orchestrator.submit(taskInput());
    await vi.waitFor(() => expect(log.reads).toBe(1));
    timers.fire();
    await b.orchestrator.settled(task.id);
    const trace = b.orchestrator.trace(task.id)!;
    expect(trace.run.state).toBe("FAILED");
    expect(trace.run.failureReason).toMatch(/time budget/);
    expect(trace.steps.find((s) => s.kind === "tool_call")?.status).toBe("abandoned");
    log.gate.resolve();
  });
});

describe("cancellation", () => {
  it("cancels while a tool call is in flight: abandoned, CANCELLED, nothing further runs", async () => {
    let concluded = false;
    const { b, log } = await start(
      testAgent({
        plan: () => ({ steps: [READ_STEP, { ...READ_STEP, index: 1 }] }),
        conclude: async () => {
          concluded = true;
          return emptyConclusion();
        },
      }),
    );
    log.gate = Promise.withResolvers<void>();
    const task = b.orchestrator.submit(taskInput());
    await vi.waitFor(() => expect(log.reads).toBe(1));
    expect(b.orchestrator.cancel(task.id)).toBe(true);
    await b.orchestrator.settled(task.id);
    log.gate.resolve();
    await vi.waitFor(() => expect(b.manager.list().length).toBeGreaterThan(0));
    const trace = b.orchestrator.trace(task.id)!;
    expect(trace.run.state).toBe("CANCELLED");
    expect(log.reads).toBe(1);
    expect(concluded).toBe(false);
    expect(b.published.map((e) => e.event_type).at(-1)).toBe("agent_run.cancelled");
    // every stage still has an audit record, the unreached ones as skipped
    const stages = trace.steps.filter((s) => s.kind === "stage");
    expect(stages.map((s) => s.name).toSorted()).toEqual([...STAGES].toSorted());
    expect(stages.find((s) => s.name === "verify")?.status).toBe("skipped");
  });

  it.each(["classify", "retrieve", "plan", "execute"] as const)(
    "cancelling during %s stops the run there",
    async (stage) => {
      const holder: { cancel: () => void } = { cancel: () => {} };
      const hold = (name: string) => (stage === name ? holder.cancel() : undefined);
      const calls: string[] = [];
      const agent = testAgent({
        plan: () => {
          calls.push("plan");
          hold("plan");
          return { steps: [READ_STEP] };
        },
        conclude: async () => {
          calls.push("conclude");
          hold("execute");
          return emptyConclusion();
        },
      });
      agent.retrieve = () => {
        calls.push("retrieve");
        hold("retrieve");
      };
      const { b } = await start(agent);
      const task = b.orchestrator.submit(taskInput());
      holder.cancel = () => void b.orchestrator.cancel(task.id);
      if (stage === "classify") b.orchestrator.cancel(task.id);
      await b.orchestrator.settled(task.id);
      const trace = b.orchestrator.trace(task.id)!;
      expect(trace.run.state).toBe("CANCELLED");
      expect(
        trace.steps
          .filter((s) => s.kind === "stage")
          .map((s) => s.name)
          .toSorted(),
      ).toEqual([...STAGES].toSorted());
      expect(b.published.at(-1)?.event_type).toBe("agent_run.cancelled");
      expect(trace.steps.find((s) => s.name === "verify")?.status).toBe("skipped");
    },
  );

  it("cancel of a finished or unknown task is false", async () => {
    const { b } = await start();
    const { task } = await finished(b);
    expect(b.orchestrator.cancel(task.id)).toBe(false);
    expect(b.orchestrator.cancel("task_nope")).toBe(false);
  });

  it("engaging the kill switch mid-run cancels it; no further tool call is made", async () => {
    const { b, log } = await start(
      testAgent({ plan: () => ({ steps: [READ_STEP, { ...READ_STEP, index: 1 }] }) }),
    );
    log.gate = Promise.withResolvers<void>();
    const task = b.orchestrator.submit(taskInput());
    await vi.waitFor(() => expect(log.reads).toBe(1));
    b.permissions.engageKillSwitch();
    log.gate.resolve();
    await b.orchestrator.settled(task.id);
    const trace = b.orchestrator.trace(task.id)!;
    expect(trace.run.state).toBe("CANCELLED");
    expect(log.reads).toBe(1);
    expect(trace.run.outcome?.conclusion ?? null).toBeNull();
  });

  it("a kill switch engaged between stages stops the run before the next stage and any tool call", async () => {
    const holder: { b: Booted | null } = { b: null };
    const { b, log } = await start(
      testAgent({
        plan: () => {
          holder.b?.permissions.engageKillSwitch();
          return { steps: [READ_STEP] };
        },
      }),
    );
    holder.b = b;
    const { trace } = await finished(b);
    expect(trace.run.state).toBe("CANCELLED");
    expect(trace.run.failureReason).toBe("the emergency stop is engaged");
    expect(log.reads).toBe(0);
    expect(trace.steps.some((s) => s.kind === "tool_call")).toBe(false);
  });

  it("cancelAll (automation switched off) cancels every active run", async () => {
    const { b, log } = await start();
    log.gate = Promise.withResolvers<void>();
    const a = b.orchestrator.submit(taskInput());
    const c = b.orchestrator.submit(taskInput());
    await vi.waitFor(() => expect(log.reads).toBe(2));
    expect(b.orchestrator.cancelAll("automation was turned off")).toBe(2);
    await b.orchestrator.idle();
    log.gate.resolve();
    expect(b.orchestrator.trace(a.id)!.run.state).toBe("CANCELLED");
    expect(b.orchestrator.trace(c.id)!.run.state).toBe("CANCELLED");
    expect(b.orchestrator.activeCount()).toBe(0);
  });
});

describe("approve → execute → verify (a write tool through the real PermissionGateway)", () => {
  const restartAgent = (verifyOpts: { onVerify?: () => void } = {}) =>
    testAgent({
      plan: () => ({ steps: [RESTART_STEP] }),
      conclude: async () => emptyConclusion({ summary: "restarted" }),
      verify: async (rc, conclusion) => {
        verifyOpts.onVerify?.();
        const read = await rc.callTool(request("ops.read_state"));
        const running = isRunning(read.output);
        return {
          conclusion,
          verification: {
            passed: running,
            checks: [{ name: "service_running", passed: running, detail: `running=${running}` }],
          },
        };
      },
    });

  it("approve: WAITING_APPROVAL while the prompt is open, then runs, verifies and completes", async () => {
    const { b, log } = await start(restartAgent());
    const task = b.orchestrator.submit(taskInput());
    const confirmation = await waitForConfirmation(b);
    await vi.waitFor(() =>
      expect(b.orchestrator.trace(task.id)!.run.state).toBe("WAITING_APPROVAL"),
    );
    expect(log.restarts).toBe(0);
    const ctx = b.orchestrator.describeConfirmation(confirmation);
    expect(ctx).toMatchObject({
      task_id: task.id,
      risk: "medium",
      target: "service:svc",
    });
    expect(ctx?.preview).toContain("Restart the service");
    expect(b.published.some((e) => e.event_type === "agent_run.waiting" && e.requires_action)).toBe(
      true,
    );

    b.permissions.resolveConfirmation(confirmation, true);
    await b.orchestrator.settled(task.id);
    const trace = b.orchestrator.trace(task.id)!;
    expect(trace.run.state).toBe("COMPLETED");
    expect(log.restarts).toBe(1);
    expect(log.reads).toBe(1);
    expect(trace.verification).toMatchObject({ passed: true });
    // restart and the verifier's read each have a policy decision; the restart needed approval
    const calls = trace.steps.filter((s) => s.kind === "tool_call");
    expect(calls.map((c) => [c.name, c.status, c.decision])).toEqual([
      ["ops.restart", "ok", "require_approval"],
      ["ops.read_state", "ok", "allow"],
    ]);
  });

  it("reject: the write never runs and the run FAILS", async () => {
    const { b, log } = await start(restartAgent());
    const task = b.orchestrator.submit(taskInput());
    const confirmation = await waitForConfirmation(b);
    b.permissions.resolveConfirmation(confirmation, false);
    await b.orchestrator.settled(task.id);
    const trace = b.orchestrator.trace(task.id)!;
    expect(trace.run.state).toBe("FAILED");
    expect(log.restarts).toBe(0);
    const call = trace.steps.find((s) => s.kind === "tool_call")!;
    expect(call.status).toBe("failed");
    expect(call.detail).toMatchObject({ code: "APPROVAL_REJECTED" });
    expect(call.policyAuditId).not.toBeNull();
  });

  it("expire: an unanswered prompt expires, the write never runs, the run FAILS", async () => {
    const { b, log } = await start(restartAgent(), { confirmationTimeoutMs: 20 });
    const task = b.orchestrator.submit(taskInput());
    await b.orchestrator.settled(task.id);
    expect(b.orchestrator.trace(task.id)!.run.state).toBe("FAILED");
    expect(log.restarts).toBe(0);
    expect(actions(b)).toContain("confirmation.expired");
  });

  it("cancel while waiting: the prompt is withdrawn, the write never runs, CANCELLED", async () => {
    const { b, log } = await start(restartAgent());
    const task = b.orchestrator.submit(taskInput());
    await waitForConfirmation(b);
    await vi.waitFor(() =>
      expect(b.orchestrator.trace(task.id)!.run.state).toBe("WAITING_APPROVAL"),
    );
    b.orchestrator.cancel(task.id);
    await b.orchestrator.settled(task.id);
    expect(b.orchestrator.trace(task.id)!.run.state).toBe("CANCELLED");
    expect(b.permissions.pendingConfirmations()).toEqual([]);
    expect(log.restarts).toBe(0);
    expect(actions(b)).toContain("confirmation.rejected");
  });

  it("cancel that beats the approval event still withdraws the prompt (a write must not run after a cancel)", async () => {
    const { b, log } = await start(restartAgent(), { deafApprovals: true });
    const task = b.orchestrator.submit(taskInput());
    const confirmation = await waitForConfirmation(b);
    b.orchestrator.cancel(task.id);
    await b.orchestrator.settled(task.id);
    expect(b.orchestrator.trace(task.id)!.run.state).toBe("CANCELLED");
    expect(b.permissions.pendingConfirmations()).toEqual([]);
    expect(b.permissions.resolveConfirmation(confirmation, true)).toBe(false);
    expect(log.restarts).toBe(0);
  });

  it("failed verification marks the run FAILED, not COMPLETED", async () => {
    const { b, log } = await start(restartAgent());
    log.restartDoesNothing = true;
    const task = b.orchestrator.submit(taskInput());
    b.permissions.resolveConfirmation(await waitForConfirmation(b), true);
    await b.orchestrator.settled(task.id);
    const trace = b.orchestrator.trace(task.id)!;
    expect(log.restarts).toBe(1);
    expect(trace.run.state).toBe("FAILED");
    expect(trace.run.failureReason).toBe("Verification failed: service_running");
    expect(trace.verification).toMatchObject({ passed: false });
    expect(b.published.at(-1)?.event_type).toBe("agent_run.failed");
    expect(trace.steps.find((s) => s.name === "verify")?.status).toBe("failed");
    expect(trace.steps.find((s) => s.name === "respond")?.status).toBe("skipped");
  });

  it("an informational check (required: false) that fails does not fail the run", async () => {
    const agent = testAgent({
      verify: async (_rc, conclusion) => ({
        conclusion,
        verification: {
          passed: true,
          checks: [{ name: "note", passed: false, detail: "removed a citation", required: false }],
        },
      }),
    });
    const { b } = await start(agent);
    const { trace } = await finished(b);
    expect(trace.run.state).toBe("COMPLETED");
  });

  it("a verifier that reports passed:true is still only as good as its checks: a crash fails the run", async () => {
    const { b } = await start(
      testAgent({
        verify: async () => {
          throw new Error("verifier blew up");
        },
      }),
    );
    const { trace } = await finished(b);
    expect(trace.run.state).toBe("FAILED");
  });
});

describe("tool failures", () => {
  it("a denied call (policy deny rule via kill switch off) fails the run unless the agent says continue", async () => {
    const { b } = await start(testAgent({ plan: () => ({ steps: [RESTART_STEP] }) }));
    const task = b.orchestrator.submit(taskInput());
    b.permissions.resolveConfirmation(await waitForConfirmation(b), false);
    await b.orchestrator.settled(task.id);
    expect(b.orchestrator.trace(task.id)!.run.state).toBe("FAILED");

    const second = await start(
      testAgent({ plan: () => ({ steps: [RESTART_STEP] }), toolFailure: () => "continue" }),
    );
    const t2 = second.b.orchestrator.submit(taskInput());
    second.b.permissions.resolveConfirmation(await waitForConfirmation(second.b), false);
    await second.b.orchestrator.settled(t2.id);
    expect(second.b.orchestrator.trace(t2.id)!.run.state).toBe("COMPLETED");
  });

  it("a disabled capability makes its tools unknown: the plan is rejected", async () => {
    const { b, log } = await start();
    await b.manager.disable("ops");
    const { trace } = await finished(b);
    expect(trace.run.state).toBe("FAILED");
    expect(trace.run.failureReason).toMatch(/Plan rejected/);
    expect(log.reads).toBe(0);
  });
});

describe("the trace survives a restart", () => {
  it("a finished run replays from SQLite after the process is gone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phoenix-orch-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "phoenix.sqlite");
    const first = await boot({
      modules: [opsCapability(newOpsLog())],
      agents: [
        testAgent({
          afterTool: (rc) => {
            rc.evidence.add({
              kind: "tool_output",
              source: "ops.read_state",
              text: "state: stopped",
            });
          },
          conclude: async () =>
            emptyConclusion({
              proposals: [
                {
                  text: "restart it",
                  rationale: "stopped",
                  evidenceIds: ["E1"],
                  advisory: true,
                  grounded: true,
                },
              ],
            }),
        }),
      ],
      databasePath: path,
    });
    await first.manager.enable("ops");
    const task = first.orchestrator.submit(taskInput());
    await first.orchestrator.settled(task.id);
    const before = first.orchestrator.trace(task.id)!;
    await first.close();

    const second = await boot({
      modules: [opsCapability(newOpsLog())],
      agents: [testAgent()],
      databasePath: path,
    });
    cleanups.push(() => second.close());
    const after = second.orchestrator.trace(task.id)!;
    expect(after).toEqual(before);
    expect(after.run.state).toBe("COMPLETED");
    expect(after.evidence).toHaveLength(1);
    expect(after.conclusion?.proposals[0]?.evidenceIds).toEqual(["E1"]);
    // every tool call still points at a policy decision that is still in the audit log
    const audit = second.permissions.audit.list({ limit: 1000 });
    for (const step of after.steps.filter((s) => s.kind === "tool_call")) {
      expect(audit.find((e) => e.id === step.policyAuditId)?.action).toBe("policy.decision");
    }
    for (const step of after.steps.filter((s) => s.kind === "stage")) {
      expect(audit.find((e) => e.id === step.stageAuditId)?.action).toBe(
        `agent.stage.${step.name}`,
      );
    }
  });

  it("a run that was in progress when the process died is closed as FAILED, on record", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phoenix-orch-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "phoenix.sqlite");
    const log = newOpsLog();
    const first = await boot({
      modules: [opsCapability(log)],
      agents: [testAgent()],
      databasePath: path,
    });
    await first.manager.enable("ops");
    log.gate = Promise.withResolvers<void>();
    const task = first.orchestrator.submit(taskInput());
    await vi.waitFor(() => expect(log.reads).toBe(1));
    // Simulate a crash: read the database as another process would, without letting the run finish.
    const second = await boot({
      modules: [opsCapability(newOpsLog())],
      agents: [testAgent()],
      databasePath: path,
    });
    cleanups.push(() => second.close());
    const trace = second.orchestrator.trace(task.id)!;
    expect(trace.run.state).toBe("FAILED");
    expect(trace.run.failureReason).toBe("Phoenix stopped while this run was in progress");
    expect(
      second.permissions.audit.list({ limit: 1000 }).some((e) => e.action === "agent.stage.audit"),
    ).toBe(true);
    log.gate.resolve();
    await first.close();
  });
});

describe("listing", () => {
  it("lists newest first, filters by state and bounds the limit", async () => {
    const { b } = await start();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await finished(b)).task.id);
    expect(b.orchestrator.list({ limit: 10 }).map((r) => r.task.id)).toEqual(ids.toReversed());
    expect(b.orchestrator.list({ limit: 2 })).toHaveLength(2);
    expect(b.orchestrator.list({ state: "FAILED", limit: 10 })).toEqual([]);
    expect(b.orchestrator.list({ state: "COMPLETED", limit: 10 })).toHaveLength(3);
  });
});

describe("conclusion is stored redacted", () => {
  it("secret-shaped text in the conclusion is redacted in the stored outcome", async () => {
    const token = ["gh", "p_", "abcdefghijklmnopqrstuvwxyz0123"].join("");
    const conclusion: Conclusion = emptyConclusion({ summary: `leaked ${token}` });
    const { b } = await start(testAgent({ conclude: async () => conclusion }));
    const { trace } = await finished(b);
    expect(JSON.stringify(trace.conclusion)).not.toContain(token);
  });
});
