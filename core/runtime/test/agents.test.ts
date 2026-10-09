// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 31 through the public HTTP API and a real PhoenixRuntime: settings, task routes with
// hostile input, the full vertical slice (task → context → plan → permission → capability →
// verify → audit → Fawkes), the additive confirmation fields, kill switch, and restart.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentDefinition } from "@phoenix/ai-orchestrator";
import type { CapabilityModule } from "@phoenix/capability-manager";
import { defaults } from "@phoenix/config";
import { silentLogger } from "@phoenix/logging";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeNetwork } from "./ai-network";
import { PhoenixRuntime } from "../src";
import { startCore, TOKEN, type TestCore } from "./helpers";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const REPO = "octo/phoenix";
const RUN_ID = 4242;
const ID = /^task_[0-9a-f]{32}$/;

interface TaskView {
  id: string;
  state: string;
  kind: string;
  title: string;
  failure_reason: string | null;
}
interface Detail {
  task: { id: string; input: Record<string, unknown> };
  run: { state: string; failure_reason: string | null };
  steps: {
    kind: string;
    name: string;
    status: string;
    policy_audit_id: number | null;
    stage_audit_id: number | null;
    decision: string | null;
    risk: string | null;
  }[];
  evidence: { id: string; kind: string }[];
  summary: string | null;
  diagnosis: {
    claims: { grounded: boolean }[];
    evidence_coverage: number;
    ai_used: boolean;
  } | null;
  proposals: { advisory: boolean }[];
  ai_used: boolean;
  verification: { passed: boolean } | null;
  audit_ids: number[];
}
interface AuditEntry {
  id: number;
  action: string;
  actor: string;
  details: Record<string, unknown>;
}

const ops: { restarts: number; running: boolean; gate: PromiseWithResolvers<void> | null } = {
  restarts: 0,
  running: false,
  gate: null,
};
const opsCapability: CapabilityModule = {
  manifest: {
    id: "ops",
    name: "Ops",
    version: "1.0.0",
    description: "Test capability with a read tool and a write tool",
    license: "GPL-3.0-or-later",
    events: ["ops.*"],
    permissions: ["filesystem_write"],
    data_categories: [],
    commands: [
      { name: "read_state", description: "Read the service state", side_effect: "read" },
      {
        name: "restart",
        description: "Restart the service",
        side_effect: "write",
        permissions: ["filesystem_write"],
      },
    ],
  },
  commands: {
    read_state: async () => {
      if (ops.gate) await ops.gate.promise;
      return { running: ops.running };
    },
    restart() {
      ops.restarts++;
      ops.running = true;
      return { restarted: true };
    },
  },
};

/** A task kind that restarts a service and verifies it by re-reading state. */
const restartAgent: AgentDefinition = {
  descriptor: { id: "ops-agent", kind: "ops_restart", version: "1.0.0" },
  allowedCapabilities: ["ops"],
  allowedTools: ["ops.restart", "ops.read_state"],
  classify: () => ({
    ok: true,
    title: "Restart the service",
    target: { environment: "local", resource: "service:svc", dataClass: "internal" },
  }),
  plan: () => ({
    steps: [{ index: 0, tool: "ops.restart", input: {}, purpose: "restart the service" }],
  }),
  conclude: async () => ({ summary: "restarted", proposals: [], aiUsed: false, modelCalls: 0 }),
  verify: async (rc, conclusion) => {
    const read = await rc.callTool({ tool: "ops.read_state", input: {} });
    const running =
      typeof read.output === "object" &&
      read.output !== null &&
      "running" in read.output &&
      read.output.running === true;
    return {
      conclusion,
      verification: {
        passed: running,
        checks: [{ name: "service_running", passed: running, detail: `running=${running}` }],
      },
    };
  },
};

/** A task kind that only reads (the read can be held open by `ops.gate`). */
const readAgent: AgentDefinition = {
  ...restartAgent,
  descriptor: { id: "ops-reader", kind: "ops_read", version: "1.0.0" },
  plan: () => ({ steps: [{ index: 0, tool: "ops.read_state", input: {}, purpose: "read" }] }),
  verify: async (_rc, conclusion) => ({
    conclusion,
    verification: { passed: true, checks: [{ name: "ok", passed: true, detail: "" }] },
  }),
};

async function core(overrides: Parameters<typeof startCore>[1] = {}): Promise<TestCore> {
  const c = await startCore(
    {},
    { capabilities: [opsCapability], runtime: { agents: [restartAgent, readAgent] }, ...overrides },
  );
  cleanups.push(() => c.runtime.stop());
  await c.runtime.capabilities.enable("ops");
  return c;
}

const enable = (c: TestCore, enabled = true) => c.api("POST", "/api/agent/settings", { enabled });
const ops_ = (c: TestCore) => c.api("POST", "/api/agent/tasks", { kind: "ops_restart", input: {} });
const detail = async (c: TestCore, id: string) =>
  (await c.api("GET", `/api/agent/tasks/${id}`)).json as Detail;
const audit = async (c: TestCore) =>
  (await c.api("GET", "/api/audit?limit=1000")).json.entries as AuditEntry[];

describe("settings", () => {
  it("automation is off by default and changing it is audited", async () => {
    const c = await core();
    const before = await c.api("GET", "/api/agent/settings");
    expect(before.status).toBe(200);
    expect(before.json).toMatchObject({
      enabled: false,
      kinds: expect.arrayContaining(["ci_failure", "ops_restart"]),
      active_runs: 0,
    });
    const after = await enable(c);
    expect(after.json.enabled).toBe(true);
    expect((await audit(c)).some((e) => e.action === "agents.settings.changed")).toBe(true);
    expect((await enable(c, false)).json.enabled).toBe(false);
  });

  it.each([
    [{}],
    [{ enabled: "yes" }],
    [{ enabled: 1 }],
    [{ enabled: null }],
    [{ enabled: true, extra: 1 }],
    [[true]],
    ["true"],
  ])("rejects %j", async (body) => {
    const c = await core();
    const res = await c.api("POST", "/api/agent/settings", body);
    expect(res.status).toBe(400);
    expect((await c.api("GET", "/api/agent/settings")).json.enabled).toBe(false);
  });

  it("is behind the session token", async () => {
    const c = await core();
    for (const [method, path] of [
      ["GET", "/api/agent/settings"],
      ["POST", "/api/agent/settings"],
      ["POST", "/api/agent/tasks"],
      ["GET", "/api/agent/tasks"],
      ["GET", `/api/agent/tasks/task_${"0".repeat(32)}`],
      ["POST", `/api/agent/tasks/task_${"0".repeat(32)}/cancel`],
    ] as const) {
      const res = await fetch(c.base + path, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "POST" ? "{}" : undefined,
      });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
    const wrong = await fetch(`${c.base}/api/agent/settings`, {
      headers: { authorization: `Bearer ${TOKEN}x` },
    });
    expect(wrong.status).toBe(401);
  });
});

describe("POST /api/agent/tasks", () => {
  it("refuses while automation is disabled, with a clear code, and stores nothing", async () => {
    const c = await core();
    const res = await ops_(c);
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ code: "CAPABILITY_DISABLED", details: ["AGENTS_DISABLED"] });
    expect(res.json.message).toMatch(/turned off/);
    expect((await c.api("GET", "/api/agent/tasks")).json.tasks).toEqual([]);
  });

  it("refuses while the kill switch is engaged", async () => {
    const c = await core();
    await enable(c);
    c.runtime.permissions.engageKillSwitch();
    const res = await ops_(c);
    expect(res.status).toBe(403);
    expect(res.json.code).toBe("SECURITY_POLICY_BLOCKED");
  });

  it.each([
    ["no body", undefined],
    ["empty object", {}],
    ["kind missing", { input: {} }],
    ["kind not a string", { kind: 5, input: {} }],
    ["kind empty", { kind: "", input: {} }],
    ["kind too long", { kind: "k".repeat(41), input: {} }],
    ["unknown kind", { kind: "format_disk", input: {} }],
    ["prototype kind", { kind: "__proto__", input: {} }],
    ["constructor kind", { kind: "constructor", input: {} }],
    ["input missing", { kind: "ci_failure" }],
    ["input null", { kind: "ci_failure", input: null }],
    ["input array", { kind: "ci_failure", input: [] }],
    ["input string", { kind: "ci_failure", input: "octo/phoenix" }],
    [
      "unknown top-level field",
      { kind: "ci_failure", input: { repository: REPO }, tool: "git.status" },
    ],
    ["repository missing", { kind: "ci_failure", input: {} }],
    [
      "repository path traversal",
      { kind: "ci_failure", input: { repository: "../../etc/passwd" } },
    ],
    ["repository with a query", { kind: "ci_failure", input: { repository: "a/b?x=1" } }],
    ["repository is an object", { kind: "ci_failure", input: { repository: { $ne: 1 } } }],
    ["repository newline", { kind: "ci_failure", input: { repository: "a/b\nHost: evil" } }],
    ["run_id negative", { kind: "ci_failure", input: { repository: REPO, run_id: -1 } }],
    ["run_id float", { kind: "ci_failure", input: { repository: REPO, run_id: 1.5 } }],
    ["run_id string", { kind: "ci_failure", input: { repository: REPO, run_id: "12" } }],
    ["run_id huge", { kind: "ci_failure", input: { repository: REPO, run_id: 1e30 } }],
    [
      "extra input field",
      { kind: "ci_failure", input: { repository: REPO, environment: "production" } },
    ],
  ])("400 for %s", async (_n, body) => {
    const c = await core();
    await enable(c);
    const res = await c.api("POST", "/api/agent/tasks", body);
    expect(res.status).toBe(400);
    expect(res.json.code).toBe("INVALID_REQUEST");
    expect((await c.api("GET", "/api/agent/tasks")).json.tasks).toEqual([]);
  });

  it("400 for a body that is not JSON, and 415-style for the wrong content type", async () => {
    const c = await core();
    await enable(c);
    expect((await c.api("POST", "/api/agent/tasks", "{not json")).status).toBe(400);
    const wrongType = await fetch(`${c.base}/api/agent/tasks`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "text/plain" },
      body: "{}",
    });
    expect(wrongType.status).toBe(400);
  });

  it("413 for a giant body", async () => {
    const c = await core();
    await enable(c);
    const res = await c.api("POST", "/api/agent/tasks", {
      kind: "ci_failure",
      input: { repository: "x".repeat(300_000) },
    });
    expect(res.status).toBe(413);
  });
});

describe("GET /api/agent/tasks and /:id", () => {
  it("rejects hostile query values and ids", async () => {
    const c = await core();
    for (const q of [
      "state=DONE",
      "state=%00",
      "limit=0",
      "limit=201",
      "limit=-1",
      "limit=abc",
      "limit=1.5",
    ]) {
      const res = await c.api("GET", `/api/agent/tasks?${q}`);
      expect(res.status, q).toBe(400);
    }
    for (const id of [
      "nope",
      "task_",
      "task_XYZ",
      `task_${"0".repeat(31)}`,
      `task_${"0".repeat(33)}`,
      "..",
      "%2e%2e",
      "1%27%20OR%201=1",
      `task_${"g".repeat(32)}`,
    ]) {
      const res = await c.api("GET", `/api/agent/tasks/${id}`);
      expect([404, 400], id).toContain(res.status);
      const cancel = await c.api("POST", `/api/agent/tasks/${id}/cancel`, {});
      expect([404, 400], id).toContain(cancel.status);
    }
    expect((await c.api("GET", `/api/agent/tasks/task_${"0".repeat(32)}`)).status).toBe(404);
    expect((await c.api("POST", `/api/agent/tasks/task_${"0".repeat(32)}/cancel`, {})).status).toBe(
      404,
    );
    expect(
      (await c.api("POST", `/api/agent/tasks/task_${"0".repeat(32)}/cancel`, { force: true }))
        .status,
    ).toBe(400);
  });

  it("lists newest first, filters by state and bounds the page", async () => {
    const c = await core();
    await enable(c);
    for (let i = 0; i < 3; i++) {
      const r = await ops_(c);
      expect(r.status).toBe(202);
      await vi.waitFor(async () =>
        expect((await c.api("GET", "/api/confirmations")).json.confirmations.length).toBe(1),
      );
      await c.api(
        "POST",
        `/api/confirmations/${(await c.api("GET", "/api/confirmations")).json.confirmations[0].id}`,
        { approve: true },
      );
      await c.runtime.agents.orchestrator.settled(r.json.task.id);
    }
    const all = (await c.api("GET", "/api/agent/tasks")).json.tasks as TaskView[];
    expect(all).toHaveLength(3);
    expect(all.every((t) => t.state === "COMPLETED")).toBe(true);
    expect((await c.api("GET", "/api/agent/tasks?limit=2")).json.tasks).toHaveLength(2);
    expect((await c.api("GET", "/api/agent/tasks?state=failed")).json.tasks).toEqual([]);
    expect((await c.api("GET", "/api/agent/tasks?state=COMPLETED")).json.tasks).toHaveLength(3);
  });
});

describe("the vertical slice: task → context → plan → permission → capability → verify → audit → Fawkes", () => {
  it("runs end to end through the HTTP API, with an approval, and is fully auditable", async () => {
    ops.restarts = 0;
    ops.running = false;
    const c = await core();
    await enable(c);
    const pet: string[] = [];
    c.runtime.bus.subscribe(
      "test-pet",
      "pet.state.changed",
      (e) => void pet.push(String(e.payload.state)),
    );

    const created = await ops_(c);
    expect(created.status).toBe(202);
    const id = (created.json.task as TaskView).id;
    expect(id).toMatch(ID);
    expect(created.json.task).toMatchObject({ kind: "ops_restart", state: "CREATED" });

    // the write needs a human: the existing confirmation flow carries the agent context
    await vi.waitFor(async () =>
      expect((await c.api("GET", "/api/confirmations")).json.confirmations).toHaveLength(1),
    );
    const [conf] = (await c.api("GET", "/api/confirmations")).json.confirmations;
    expect(conf).toMatchObject({
      capabilityId: "ops",
      command: "restart",
      sideEffect: "write",
      task_id: id,
      risk: "medium",
      target: "service:svc",
    });
    expect(conf.preview).toContain("Restart the service");
    expect(Array.isArray(conf.evidence_ids)).toBe(true);
    expect((await detail(c, id)).run.state).toBe("WAITING_APPROVAL");
    expect(ops.restarts).toBe(0);
    await vi.waitFor(() => expect(pet).toContain("WAITING"));

    expect((await c.api("POST", `/api/confirmations/${conf.id}`, { approve: true })).status).toBe(
      200,
    );
    await c.runtime.agents.orchestrator.settled(id);

    const d = await detail(c, id);
    expect(d.run.state).toBe("COMPLETED");
    expect(ops.restarts).toBe(1);
    expect(d.verification).toMatchObject({ passed: true });
    expect(pet).toContain("THINKING");
    await vi.waitFor(() => expect(pet).toContain("SUCCESS"));

    // fully auditable: every tool call has its decision, every stage its record, in the real log
    const rows = await audit(c);
    const calls = d.steps.filter((s) => s.kind === "tool_call");
    expect(calls.map((s) => s.name)).toEqual(["ops.restart", "ops.read_state"]);
    for (const call of calls) {
      const row = rows.find((r) => r.id === call.policy_audit_id);
      expect(row, call.name).toMatchObject({ action: "policy.decision", actor: "agent:ops-agent" });
      expect(row!.details).toMatchObject({
        tool: call.name,
        trustedByUser: false,
        resource: "service:svc",
      });
      expect(["allow", "require_approval"]).toContain(call.decision);
    }
    const stages = d.steps.filter((s) => s.kind === "stage");
    expect(stages.map((s) => s.name)).toEqual([
      "classify",
      "retrieve",
      "plan",
      "policy_check",
      "execute",
      "verify",
      "respond",
      "audit",
    ]);
    for (const stage of stages) {
      expect(rows.find((r) => r.id === stage.stage_audit_id)?.action).toBe(
        `agent.stage.${stage.name}`,
      );
    }
    expect(d.audit_ids).toEqual(
      expect.arrayContaining([
        ...calls.map((x) => x.policy_audit_id!),
        ...stages.map((x) => x.stage_audit_id!),
      ]),
    );
    // the approval itself is in the log too
    expect(rows.some((r) => r.action === "confirmation.approved")).toBe(true);
    // the Fawkes events of the run share one correlation id
    const events = (await c.api("GET", "/api/events?limit=200")).json.events as {
      event: { event_type: string; correlation_id?: string };
    }[];
    const mine = events.filter((e) => e.event.event_type.startsWith("agent_run."));
    expect(mine.map((e) => e.event.event_type)).toEqual(
      expect.arrayContaining(["agent_run.started", "agent_run.waiting", "agent_run.completed"]),
    );
    expect(new Set(mine.map((e) => e.event.correlation_id)).size).toBe(1);
  });

  it("reject: the write never runs, the run FAILS, and a rejected confirmation is audited", async () => {
    ops.restarts = 0;
    const c = await core();
    await enable(c);
    const id = (await ops_(c)).json.task.id as string;
    await vi.waitFor(async () =>
      expect((await c.api("GET", "/api/confirmations")).json.confirmations).toHaveLength(1),
    );
    const [conf] = (await c.api("GET", "/api/confirmations")).json.confirmations;
    await c.api("POST", `/api/confirmations/${conf.id}`, { approve: false });
    await c.runtime.agents.orchestrator.settled(id);
    expect((await detail(c, id)).run.state).toBe("FAILED");
    expect(ops.restarts).toBe(0);
  });

  it("cancel while waiting withdraws the prompt and the write never runs", async () => {
    ops.restarts = 0;
    const c = await core();
    await enable(c);
    const id = (await ops_(c)).json.task.id as string;
    await vi.waitFor(async () => expect((await detail(c, id)).run.state).toBe("WAITING_APPROVAL"));
    const res = await c.api("POST", `/api/agent/tasks/${id}/cancel`, {});
    expect(res.status).toBe(200);
    await c.runtime.agents.orchestrator.settled(id);
    expect((await detail(c, id)).run.state).toBe("CANCELLED");
    expect((await c.api("GET", "/api/confirmations")).json.confirmations).toEqual([]);
    expect(ops.restarts).toBe(0);
    // cancelling again is a no-op that reports the final state
    expect((await c.api("POST", `/api/agent/tasks/${id}/cancel`, {})).json).toEqual({
      cancelled: false,
      state: "CANCELLED",
    });
  });

  it("turning automation off cancels running work; the kill switch does too and refuses new tasks", async () => {
    const c = await core();
    await enable(c);
    const a = (await ops_(c)).json.task.id as string;
    await vi.waitFor(async () => expect((await detail(c, a)).run.state).toBe("WAITING_APPROVAL"));
    await enable(c, false);
    await c.runtime.agents.orchestrator.settled(a);
    expect((await detail(c, a)).run.state).toBe("CANCELLED");

    await enable(c);
    const b = (await ops_(c)).json.task.id as string;
    await vi.waitFor(async () => expect((await detail(c, b)).run.state).toBe("WAITING_APPROVAL"));
    expect((await c.api("POST", "/api/security/kill-switch", { engaged: true })).status).toBe(200);
    await c.runtime.agents.orchestrator.settled(b);
    expect((await detail(c, b)).run.state).toBe("CANCELLED");
    expect((await ops_(c)).status).toBe(403);
    expect(ops.restarts).toBe(0);
  });
});

describe("the emergency stop ends a run that is in the middle of a tool call", () => {
  it("engaging it cancels the run without waiting for the held-open read to return", async () => {
    const c = await core();
    await enable(c);
    ops.gate = Promise.withResolvers<void>();
    const res = await c.api("POST", "/api/agent/tasks", { kind: "ops_read", input: {} });
    const id = res.json.task.id as string;
    await vi.waitFor(async () => {
      const d = await detail(c, id);
      expect(d.run.state).toBe("RUNNING");
    });
    c.runtime.permissions.engageKillSwitch();
    await c.runtime.agents.orchestrator.settled(id);
    expect((await detail(c, id)).run.state).toBe("CANCELLED");
    ops.gate.resolve();
    ops.gate = null;
  });
});

describe("the CI-failure task over the API, with AI off (the default)", () => {
  it("makes zero network calls to a model and says so", async () => {
    const net = fakeNetwork();
    const c = await startCore({}, { runtime: { fetch: net.fetch } });
    cleanups.push(() => c.runtime.stop());
    await enable(c);
    // github is installed but not enabled: the plan is rejected, and AI was still never contacted
    const res = await c.api("POST", "/api/agent/tasks", {
      kind: "ci_failure",
      input: { repository: REPO, run_id: RUN_ID },
    });
    expect(res.status).toBe(202);
    await c.runtime.agents.orchestrator.settled(res.json.task.id);
    const d = await detail(c, res.json.task.id);
    expect(d.run.state).toBe("FAILED");
    expect(d.run.failure_reason).toMatch(/^Plan rejected/);
    expect(net.requests).toEqual([]);
    expect(d.ai_used).toBe(false);
  });
});

describe("the trace survives a runtime restart", () => {
  it("a finished run reads back identically from a new runtime on the same database", async () => {
    ops.restarts = 0;
    const dir = mkdtempSync(join(tmpdir(), "phoenix-agents-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const make = () =>
      new PhoenixRuntime({
        config: { ...defaults("dev"), port: 0, dataDir: dir },
        logger: silentLogger,
        token: TOKEN,
        writeTokenFile: false,
        capabilities: [opsCapability],
        agents: [restartAgent],
      });
    const first = make();
    const { port } = await first.start();
    const call = async (
      rt: PhoenixRuntime,
      p: number,
      method: string,
      path: string,
      body?: unknown,
    ) => {
      const res = await fetch(`http://127.0.0.1:${p}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${TOKEN}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      void rt;
      return { status: res.status, json: (await res.json()) as Record<string, any> };
    };
    await first.capabilities.enable("ops");
    await call(first, port, "POST", "/api/agent/settings", { enabled: true });
    const created = await call(first, port, "POST", "/api/agent/tasks", {
      kind: "ops_restart",
      input: {},
    });
    const id = created.json.task.id as string;
    await vi.waitFor(() => expect(first.permissions.pendingConfirmations()).toHaveLength(1));
    first.permissions.resolveConfirmation(first.permissions.pendingConfirmations()[0]!.id, true);
    await first.agents.orchestrator.settled(id);
    const before = (await call(first, port, "GET", `/api/agent/tasks/${id}`)).json;
    expect(before.run.state).toBe("COMPLETED");
    await first.stop();

    const second = make();
    cleanups.push(() => second.stop());
    const started = await second.start();
    const after = (await call(second, started.port, "GET", `/api/agent/tasks/${id}`)).json;
    expect(after).toEqual(before);
    // and the audit rows the trace points at are still there
    const rows = (await call(second, started.port, "GET", "/api/audit?limit=1000")).json
      .entries as AuditEntry[];
    for (const call_ of (after.steps as Detail["steps"]).filter((s) => s.kind === "tool_call")) {
      expect(rows.find((r) => r.id === call_.policy_audit_id)?.action).toBe("policy.decision");
    }
    for (const s of (after.steps as Detail["steps"]).filter((x) => x.kind === "stage")) {
      expect(rows.find((r) => r.id === s.stage_audit_id)?.action).toBe(`agent.stage.${s.name}`);
    }
    expect((await call(second, started.port, "GET", "/api/agent/settings")).json.enabled).toBe(
      true,
    );
  });
});
