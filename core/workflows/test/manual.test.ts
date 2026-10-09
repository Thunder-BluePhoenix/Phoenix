// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// `startManual` and `cancelRun`: the user's own way to start and stop one run. A manual start must
// pass every gate a bus trigger passes, and neither method may be callable by a non-user actor.
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowError } from "../src";
import {
  agent,
  boot,
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
const go = (core: Core) => {
  core.engine.recover();
  core.engine.start();
};
const settle = async (core: Core) => {
  for (let i = 0; i < 3; i++) {
    await core.bus.drain();
    await core.engine.idle();
  }
};

const echo = (id: string, over: Parameters<typeof devWorkflow>[3] = {}) =>
  devWorkflow(
    id,
    [{ id: "logs", type: "action", tool: "deploys.logs", input: {} }],
    ["deploys.logs"],
    { environment: "local", ...over },
  );

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    return err instanceof WorkflowError ? err.code : "other";
  }
  return undefined;
};

describe("startManual: the same gates as a trigger", () => {
  it("starts a run for a user with a clearly marked synthetic trigger and audits the user", async () => {
    const t = setup();
    const calls = newCalls();
    const core = await boot({ path: t.db, calls, autoAnswer: () => true });
    go(core);
    core.admin.save(
      user,
      devWorkflow("hello", [{ id: "n", type: "notify", title: "t", message: "m" }], [], {
        environment: "local",
      }),
    );
    const { run, refused } = core.engine.startManual(user, "hello", { service: "api" });
    expect(refused).toBe(false);
    expect(run.triggerEventId).toMatch(/^manual_[0-9a-f]{32}$/);
    await vi.waitFor(async () => {
      await settle(core);
      expect(core.engine.getRun(run.id)?.status).toBe("succeeded");
    });
    expect(core.engine.getRun(run.id)?.trigger).toContain('"service":"api"');
    expect(core.engine.getRun(run.id)?.trigger).toContain("workflow.manual");
    const audit = core.permissions.audit.list({ limit: 200 });
    expect(audit.find((e) => e.action === "workflow.run.started_by_user")).toMatchObject({
      actor: "user:me",
      details: { workflow: "hello", run: run.id },
    });
    // The run's own actor is the workflow system actor, not the user.
    expect(run.correlationId).toBe(`workflow-${run.id}`);
  });

  it("refuses an actor that is not a trusted user, audits it, and starts nothing", async () => {
    const t = setup();
    const calls = newCalls();
    const core = await boot({ path: t.db, calls, autoAnswer: () => true });
    go(core);
    core.admin.save(user, echo("w"));
    for (const who of [
      agent,
      { kind: "user" as const, id: "me", trustedByUser: false },
      { kind: "system" as const, id: "workflow-x", trustedByUser: true },
    ]) {
      expect(codeOf(() => core.engine.startManual(who, "w"))).toBe("NOT_USER_ACTOR");
    }
    await settle(core);
    expect(core.engine.listRuns()).toEqual([]);
    expect(calls.log).toEqual([]);
    expect(
      core.permissions.audit
        .list({ limit: 200 })
        .filter((e) => e.action === "workflow.run.start.refused"),
    ).toHaveLength(3);
  });

  it("refuses an unknown workflow and a disabled one", async () => {
    const t = setup();
    const core = await boot({ path: t.db, calls: newCalls() });
    go(core);
    expect(codeOf(() => core.engine.startManual(user, "nope"))).toBe("NOT_FOUND");
    core.admin.save(user, echo("off", { enabled: false }));
    expect(codeOf(() => core.engine.startManual(user, "off"))).toBe("INVALID_REQUEST");
    expect(core.engine.listRuns()).toEqual([]);
  });

  it("is refused while the emergency stop is engaged, like a trigger, and the refusal is recorded", async () => {
    const t = setup();
    const calls = newCalls();
    const core = await boot({ path: t.db, calls });
    go(core);
    core.admin.save(user, echo("w"));
    core.permissions.engageKillSwitch("user", "test");
    const { run, refused } = core.engine.startManual(user, "w");
    expect(refused).toBe(true);
    expect(core.engine.getRun(run.id)).toMatchObject({
      status: "refused",
      reason: "Emergency stop is engaged",
    });
    await settle(core);
    expect(calls.log).toEqual([]);
  });

  it("is refused for an unauthorised production workflow, and runs once the exact definition is authorised", async () => {
    const t = setup();
    const calls = newCalls();
    const core = await boot({ path: t.db, calls, ai: fakeAi, autoAnswer: () => true });
    go(core);
    core.admin.save(user, deployFailedWorkflow());
    core.admin.setEnabled(user, "deploy-failed", true);
    const refused = core.engine.startManual(user, "deploy-failed", { service: "api" });
    expect(refused.refused).toBe(true);
    expect(core.engine.getRun(refused.run.id)?.reason).toMatch(/not authorised/);
    await settle(core);
    expect(calls.log).toEqual([]);

    core.admin.authorise(user, "deploy-failed");
    core.policyAdmin.addRule(user, {
      id: "logs-ok",
      effect: "allow",
      match: { tool: "deploys.logs", environments: ["production"], actorKinds: ["system"] },
    });
    const ok = core.engine.startManual(user, "deploy-failed", { service: "api" });
    expect(ok.refused).toBe(false);
    await vi.waitFor(async () => {
      await settle(core);
      expect(core.engine.getRun(ok.run.id)?.status).toBe("succeeded");
    });
  });

  it("is refused by the rate limit like a trigger", async () => {
    const t = setup();
    const clock = new ManualClock();
    const core = await boot({
      path: t.db,
      calls: newCalls(),
      now: clock.now,
      sleep: clock.sleep,
      rate: { max: 1, windowMs: 60_000 },
      autoAnswer: () => true,
    });
    go(core);
    core.admin.save(
      user,
      devWorkflow("hello", [{ id: "n", type: "notify", title: "t", message: "m" }], [], {
        environment: "local",
      }),
    );
    expect(core.engine.startManual(user, "hello").refused).toBe(false);
    const second = core.engine.startManual(user, "hello");
    expect(second.refused).toBe(true);
    expect(core.engine.getRun(second.run.id)?.reason).toMatch(/rate limit/);
  });

  it("is refused when the definition names a tool that is not available now", async () => {
    const t = setup();
    const core = await boot({ path: t.db, calls: newCalls() });
    go(core);
    core.admin.save(user, echo("w"));
    await core.manager.disable("deploys");
    const { run, refused } = core.engine.startManual(user, "w");
    expect(refused).toBe(true);
    expect(core.engine.getRun(run.id)?.reason).toMatch(/not runnable now/);
  });

  it("keeps destructive-step gating: the run refuses a write before an approval step", async () => {
    const t = setup();
    const calls = newCalls();
    const core = await boot({ path: t.db, calls, autoAnswer: () => true });
    go(core);
    // Validation already rejects this definition at save time; a forged row is refused at start.
    expect(
      codeOf(() =>
        core.admin.save(
          user,
          devWorkflow(
            "w",
            [{ id: "r", type: "action", tool: "deploys.restart" }],
            ["deploys.restart"],
          ),
        ),
      ),
    ).toBe("INVALID_DEFINITION");
    expect(core.store.listDefinitions()).toEqual([]);
    expect(codeOf(() => core.engine.startManual(user, "w"))).toBe("NOT_FOUND");
    expect(calls.log).toEqual([]);
  });
});

describe("cancelRun", () => {
  it("cancels one active run, withdraws its approval and leaves other runs alone", async () => {
    const t = setup();
    const core = await boot({ path: t.db, calls: newCalls() });
    go(core);
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
    const a = core.engine.startManual(user, "waiting");
    const b = core.engine.startManual(user, "waiting");
    await vi.waitFor(() => {
      expect(core.engine.getRun(a.run.id)?.status).toBe("waiting_approval");
      expect(core.engine.getRun(b.run.id)?.status).toBe("waiting_approval");
    });
    core.engine.cancelRun(user, a.run.id);
    await vi.waitFor(() => expect(core.engine.getRun(a.run.id)?.status).toBe("cancelled"));
    expect(core.engine.getRun(a.run.id)?.reason).toMatch(/cancelled by the user/);
    expect(core.engine.getRun(b.run.id)?.status).toBe("waiting_approval");
    expect(core.permissions.pendingConfirmations()).toHaveLength(1);
    expect(
      core.permissions.audit
        .list({ limit: 200 })
        .find((e) => e.action === "workflow.run.cancelled_by_user"),
    ).toMatchObject({ actor: "user:me", details: { run: a.run.id } });
  });

  it("answers a clear error for an unknown run and for a run that is not active; refuses non-users", async () => {
    const t = setup();
    const core = await boot({ path: t.db, calls: newCalls(), autoAnswer: () => true });
    go(core);
    core.admin.save(
      user,
      devWorkflow("hello", [{ id: "n", type: "notify", title: "t", message: "m" }], [], {
        environment: "local",
      }),
    );
    const { run } = core.engine.startManual(user, "hello");
    await vi.waitFor(async () => {
      await settle(core);
      expect(core.engine.getRun(run.id)?.status).toBe("succeeded");
    });
    expect(codeOf(() => core.engine.cancelRun(user, "run_nope"))).toBe("NOT_FOUND");
    expect(codeOf(() => core.engine.cancelRun(user, run.id))).toBe("INVALID_REQUEST");
    expect(codeOf(() => core.engine.cancelRun(agent, run.id))).toBe("NOT_USER_ACTOR");
    expect(core.engine.getRun(run.id)?.status).toBe("succeeded");
  });

  it("does not undo on cancel: a succeeded step with a declared undo makes the run failed_needs_attention", async () => {
    const t = setup();
    const calls = newCalls();
    const core = await boot({ path: t.db, calls, autoAnswer: () => true });
    go(core);
    core.admin.save(
      user,
      devWorkflow(
        "undoable",
        [
          { id: "gate", type: "approval", summary: "go?" },
          {
            id: "restart",
            type: "action",
            tool: "deploys.restart",
            compensate: { tool: "deploys.undo_restart" },
          },
          { id: "hold", type: "action", tool: "deploys.hang" },
        ],
        ["deploys.restart", "deploys.undo_restart", "deploys.hang"],
        { environment: "local" },
      ),
    );
    const { run } = core.engine.startManual(user, "undoable");
    await vi.waitFor(() => expect(calls.log.map((c) => c.command)).toEqual(["restart", "hang"]));
    core.engine.cancelRun(user, run.id);
    await vi.waitFor(async () => {
      await settle(core);
      expect(core.engine.getRun(run.id)?.status).toBe("failed_needs_attention");
    });
    expect(calls.log.map((c) => c.command)).toEqual(["restart", "hang"]);
  });
});
