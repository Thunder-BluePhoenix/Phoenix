// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phases 39 and 40 through the public HTTP API and a real PhoenixRuntime: definitions, validation,
// production authorisation bound to the definition hash, manual runs that pass every gate of a bus
// trigger, cancel, the kill switch, metrics, and reconciliation of interrupted runs after a restart.
// The only capability is a local test double; nothing here reaches a network.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CapabilityModule } from "@phoenix/capability-manager";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startCore, type TestCore } from "./helpers";
import { guardNetwork } from "./network-guard";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
  vi.restoreAllMocks();
});

interface Calls {
  log: string[];
  /** Calls held open by `hang`; released at cleanup so a stopped Core never waits on them. */
  held: PromiseWithResolvers<unknown>[];
}

function deploys(calls: Calls): CapabilityModule {
  const record =
    (command: string, result: unknown = { ok: true }) =>
    () => {
      calls.log.push(command);
      return result;
    };
  return {
    manifest: {
      id: "deploys",
      name: "Deploys",
      version: "1.0.0",
      description: "Test deploy system",
      license: "GPL-3.0-or-later",
      events: ["deploy.*"],
      permissions: ["filesystem_write", "production_action"],
      data_categories: [],
      commands: [
        { name: "logs", description: "Read logs", side_effect: "read", timeout_ms: 2000 },
        {
          name: "hang",
          description: "Read that never ends",
          side_effect: "read",
          timeout_ms: 60_000,
        },
        {
          name: "restart",
          description: "Restart",
          side_effect: "write",
          permissions: ["filesystem_write"],
          timeout_ms: 2000,
        },
        {
          name: "undo_restart",
          description: "Undo the restart",
          side_effect: "write",
          permissions: ["filesystem_write"],
          timeout_ms: 2000,
        },
        {
          name: "rollback",
          description: "Roll production back",
          side_effect: "production",
          permissions: ["production_action"],
          timeout_ms: 2000,
        },
      ],
    },
    commands: {
      logs: record("logs", { lines: ["ok"] }),
      restart: record("restart"),
      undo_restart: record("undo_restart"),
      rollback: record("rollback"),
      hang: () => {
        calls.log.push("hang");
        const held = Promise.withResolvers<unknown>();
        calls.held.push(held);
        return held.promise;
      },
    },
  };
}

interface Rig {
  core: TestCore;
  calls: Calls;
  /** Answers each confirmation prompt: by capability id; undefined leaves it pending. */
  answer: { by: (capabilityId: string) => boolean | undefined };
  fetched: string[];
}

async function rig(runtime: Parameters<typeof startCore>[1] = {}): Promise<Rig> {
  const guard = guardNetwork();
  const calls: Calls = { log: [], held: [] };
  const core = await startCore({}, { capabilities: [deploys(calls)], ...runtime });
  cleanups.push(async () => {
    for (const h of calls.held) h.resolve({ released: true });
    await core.runtime.stop();
    guard.release();
  });
  await core.runtime.capabilities.enable("deploys");
  const answer: Rig["answer"] = { by: () => true };
  core.runtime.bus.subscribe("test.user", "security.confirmation.requested", () => {
    for (const c of core.runtime.permissions.pendingConfirmations()) {
      const verdict = answer.by(c.capabilityId);
      if (verdict !== undefined) core.runtime.permissions.resolveConfirmation(c.id, verdict);
    }
  });
  return { core, calls, answer, fetched: guard.requests };
}

type Definition = Record<string, unknown>;

const workflow = (id: string, steps: unknown[], tools: string[], over: Definition = {}) => ({
  id,
  name: id,
  version: 1,
  enabled: true,
  environment: "local",
  trigger: { event: "deploy.failed" },
  declares: { tools, ai: false },
  steps,
  ...over,
});

const readLogs = (id = "read-logs", over: Definition = {}) =>
  workflow(
    id,
    [{ id: "logs", type: "action", tool: "deploys.logs", input: {} }],
    ["deploys.logs"],
    over,
  );

const hangOnly = (id = "hang-it") =>
  workflow(id, [{ id: "wait", type: "action", tool: "deploys.hang" }], ["deploys.hang"]);

const waitForApproval = (id = "needs-approval") =>
  workflow(
    id,
    [
      { id: "gate", type: "approval", summary: "go?" },
      { id: "tell", type: "notify", title: "t", message: "m" },
    ],
    [],
  );

/** Production workflow: reads logs, asks, then rolls production back. */
const production = (over: Definition = {}) =>
  workflow(
    "prod-rollback",
    [
      { id: "logs", type: "action", tool: "deploys.logs", input: {} },
      { id: "gate", type: "approval", summary: "Roll back?" },
      { id: "rollback", type: "action", tool: "deploys.rollback", input: {} },
    ],
    ["deploys.logs", "deploys.rollback"],
    { environment: "production", ...over },
  );

interface RunSummary {
  id: string;
  workflow_id: string;
  status: string;
  terminal: boolean;
  reason: string | null;
  correlation_id: string;
  trigger_event_id: string;
}
interface RunDetail extends RunSummary {
  trigger: string;
  steps: { step_id: string; status: string; tool: string | null; phase: string }[];
}

const save = (r: Rig, definition: unknown) => r.core.api("POST", "/api/workflows", { definition });
const start = (r: Rig, id: string, payload?: unknown) =>
  r.core.api("POST", `/api/workflows/${id}/runs`, payload === undefined ? {} : { payload });
const run = async (r: Rig, id: string) =>
  (await r.core.api("GET", `/api/workflows/runs/${id}`)).json as RunDetail;
const hashOf = async (r: Rig, id: string): Promise<string> =>
  (await r.core.api("GET", `/api/workflows/${id}`)).json.workflow.hash;
const untilStatus = (r: Rig, id: string, status: string) =>
  vi.waitFor(async () => expect((await run(r, id)).status).toBe(status));
const auditActions = async (r: Rig) =>
  (await r.core.api("GET", "/api/audit?limit=1000")).json.entries as {
    action: string;
    actor: string;
    decision: string;
    details: Record<string, unknown>;
  }[];

describe("definitions: list, get, validate, save, replace, enable", () => {
  it("validate is a dry run: nothing is stored and nothing runs", async () => {
    const r = await rig();
    const bad = await r.core.api("POST", "/api/workflows/validate", {
      definition: { id: "x", name: "x" },
    });
    expect(bad.status).toBe(200);
    expect(bad.json).toMatchObject({ valid: false, hash: null, authorisation: null });
    expect(bad.json.problems.length).toBeGreaterThan(0);
    const unknownTool = await r.core.api("POST", "/api/workflows/validate", {
      definition: workflow("t", [{ id: "a", type: "action", tool: "nope.run" }], ["nope.run"]),
    });
    expect(unknownTool.json.valid).toBe(false);
    const good = await r.core.api("POST", "/api/workflows/validate", { definition: readLogs() });
    expect(good.json).toMatchObject({
      valid: true,
      problems: [],
      authorisation: { required: false, reasons: [] },
    });
    expect(good.json.hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await r.core.api("GET", "/api/workflows")).json.workflows).toEqual([]);
    expect(r.calls.log).toEqual([]);
  });

  it("saves (201), replaces (200), refuses a behaviour change without a version bump, and serves it back", async () => {
    const r = await rig();
    const created = await save(r, readLogs());
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    expect(created.json).toMatchObject({
      stored_enabled: true,
      authorisation_required: false,
      workflow: { id: "read-logs", enabled: true, authorised: true, problems: [] },
    });
    expect((await save(r, readLogs())).status).toBe(200);

    const changed = readLogs("read-logs", { trigger: { event: "deploy.errored" } });
    const conflict = await save(r, changed);
    expect(conflict.status).toBe(400);
    expect(conflict.json.details[0]).toBe("VERSION_CONFLICT");
    const bumped = await save(
      r,
      readLogs("read-logs", { version: 2, trigger: { event: "deploy.errored" } }),
    );
    expect(bumped.status).toBe(200);
    expect(bumped.json.workflow).toMatchObject({
      version: 2,
      trigger: { event: "deploy.errored" },
    });

    const one = (await r.core.api("GET", "/api/workflows/read-logs")).json;
    expect(one.definition).toMatchObject({ id: "read-logs", version: 2 });
    expect(one).toMatchObject({ created_by: "user:owner", authorisations: [] });
    expect((await r.core.api("GET", "/api/workflows")).json.workflows).toHaveLength(1);
    expect(
      (await auditActions(r)).filter((e) => /^workflow\.(created|updated)$/.test(e.action)),
    ).toHaveLength(3);
  });

  it("an invalid definition is 400 INVALID_DEFINITION with the problems; unknown ids are 404; bodies need exact keys", async () => {
    const r = await rig();
    const bad = await save(
      r,
      workflow("x", [{ id: "a", type: "action", tool: "deploys.restart" }], ["deploys.restart"]),
    );
    expect(bad.status).toBe(400);
    expect(bad.json.details[0]).toBe("INVALID_DEFINITION");
    expect(bad.json.details.join(" ")).toMatch(/before any approval step/);
    expect((await r.core.api("GET", "/api/workflows")).json.workflows).toEqual([]);
    expect((await r.core.api("GET", "/api/workflows/nope")).status).toBe(404);
    expect(
      (await r.core.api("POST", "/api/workflows/nope/enabled", { enabled: true })).status,
    ).toBe(404);
    expect((await r.core.api("POST", "/api/workflows", { definition: {}, extra: 1 })).status).toBe(
      400,
    );
    expect((await r.core.api("POST", "/api/workflows/validate", {})).status).toBe(400);
    expect((await r.core.api("POST", "/api/workflows/x/enabled", { enabled: "yes" })).status).toBe(
      400,
    );
  });

  it("enabling and disabling is audited and a disabled workflow cannot be started", async () => {
    const r = await rig();
    await save(r, readLogs());
    const off = await r.core.api("POST", "/api/workflows/read-logs/enabled", { enabled: false });
    expect(off.json.workflow.enabled).toBe(false);
    const started = await start(r, "read-logs");
    expect(started.status).toBe(400);
    expect(started.json.details).toContain("WORKFLOW_DISABLED");
    expect((await r.core.api("GET", "/api/workflows/runs")).json.runs).toEqual([]);
    expect((await auditActions(r)).some((e) => e.action === "workflow.disabled")).toBe(true);
  });
});

describe("runs: start, history, metrics", () => {
  it("a manual start runs the steps through the tool gateway as the workflow actor and records the history", async () => {
    const r = await rig();
    await save(r, readLogs());
    const started = await start(r, "read-logs", { service: "api" });
    expect(started.status).toBe(202);
    const id = started.json.run.id as string;
    expect(started.json.run).toMatchObject({
      workflow_id: "read-logs",
      correlation_id: `workflow-${id}`,
    });
    expect(started.json.run.trigger_event_id).toMatch(/^manual_[0-9a-f]{32}$/);
    await untilStatus(r, id, "succeeded");

    const detail = await run(r, id);
    expect(detail).toMatchObject({ terminal: true, status: "succeeded" });
    expect(detail.trigger).toContain('"service":"api"');
    expect(detail.steps).toEqual([
      expect.objectContaining({
        step_id: "logs",
        status: "succeeded",
        tool: "deploys.logs",
        phase: "step",
      }),
    ]);
    expect(r.calls.log).toEqual(["logs"]);

    const audit = await auditActions(r);
    // The tool call was made by the workflow's system actor, not by the user.
    expect(audit.some((e) => e.actor === `system:workflow-${id}`)).toBe(true);
    // The user's start is a separate, user-attributed record.
    expect(audit.find((e) => e.action === "workflow.run.started_by_user")).toMatchObject({
      actor: "user:owner",
      details: { workflow: "read-logs", run: id },
    });
    expect(audit.some((e) => e.action === "workflow.run.finished")).toBe(true);

    const metrics = (await r.core.api("GET", "/api/workflows/metrics")).json.metrics;
    expect(metrics["read-logs"]).toMatchObject({
      runs_started: 1,
      runs_succeeded: 1,
      steps_succeeded: 1,
      step_failure_rate: 0,
    });
    const listed = (
      await r.core.api("GET", "/api/workflows/runs?workflow_id=read-logs&status=succeeded")
    ).json.runs;
    expect(listed).toEqual([expect.objectContaining({ id, workflow_name: "read-logs" })]);
    expect((await r.core.api("GET", "/api/workflows/runs?status=failed")).json.runs).toEqual([]);
  });

  it("rejects hostile run requests", async () => {
    const r = await rig();
    await save(r, readLogs());
    const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, i]));
    for (const body of [
      { payload: deep },
      { payload: many },
      { payload: [1] },
      { payload: "x" },
      { extra: 1 },
    ]) {
      expect(
        (await r.core.api("POST", "/api/workflows/read-logs/runs", body)).status,
        JSON.stringify(body),
      ).toBe(400);
    }
    for (const q of [
      "limit=0",
      "limit=201",
      "limit=x",
      "status=bogus",
      `workflow_id=${"x".repeat(49)}`,
    ]) {
      expect((await r.core.api("GET", `/api/workflows/runs?${q}`)).status, q).toBe(400);
    }
    expect((await r.core.api("GET", "/api/workflows/runs/run_nope")).status).toBe(404);
    expect((await r.core.api("POST", "/api/workflows/nope/runs", {})).status).toBe(404);
    expect((await r.core.api("GET", "/api/workflows/runs")).json.runs).toEqual([]);
    expect(r.calls.log).toEqual([]);
  });

  it("a bus trigger starts the same workflow and shares the history", async () => {
    const r = await rig();
    await save(r, readLogs());
    expect(
      (
        await r.core.api("POST", "/api/events", {
          event_id: "evt_trigger0001",
          event_type: "deploy.failed",
          version: "1.1",
          source: "terminal",
          timestamp: new Date().toISOString(),
          severity: "error",
          payload: {},
        })
      ).status,
    ).toBe(202);
    await vi.waitFor(async () => {
      const runs = (await r.core.api("GET", "/api/workflows/runs")).json.runs as RunSummary[];
      expect(runs[0]?.status).toBe("succeeded");
      expect(runs[0]?.trigger_event_id).toBe("evt_trigger0001");
    });
  });

  it("the run history is counted (no text) in the privacy inventory and diagnostics", async () => {
    const r = await rig();
    await save(r, readLogs());
    const id = (await start(r, "read-logs", { secretish: "do-not-count-me" })).json.run.id;
    await untilStatus(r, id, "succeeded");
    expect(
      (await r.core.api("GET", "/api/privacy")).json.derived.find(
        (d: { id: string }) => d.id === "workflow_runs",
      ),
    ).toMatchObject({ count: 1 });
    const diag = (await r.core.api("GET", "/api/diagnostics")).json;
    expect(diag.derived.workflow_runs).toBe(1);
    expect(JSON.stringify(diag)).not.toContain("do-not-count-me");
  });
});

describe("production authorisation is user-only and bound to the definition hash", () => {
  it("is stored disabled, refused until authorised, runs once authorised, and ends when the definition changes or is revoked", async () => {
    const r = await rig();
    const saved = await save(r, production());
    expect(saved.status).toBe(201);
    expect(saved.json).toMatchObject({
      stored_enabled: false,
      authorisation_required: true,
      workflow: { enabled: false, authorised: false },
    });
    expect(saved.json.authorisation_reasons.join(" ")).toMatch(/production/);
    await r.core.api("POST", "/api/workflows/prod-rollback/enabled", { enabled: true });

    // Not authorised: refused, recorded, nothing called.
    const refused = await start(r, "prod-rollback");
    expect(refused.status).toBe(403);
    expect(refused.json).toMatchObject({ code: "SECURITY_POLICY_BLOCKED" });
    expect(refused.json.details[0]).toBe("RUN_REFUSED");
    expect(refused.json.details[2]).toMatch(/not authorised/);
    const refusedRun = await run(r, refused.json.details[1]);
    expect(refusedRun).toMatchObject({ status: "refused", terminal: true });
    expect(r.calls.log).toEqual([]);

    // A stale or invented hash authorises nothing.
    for (const hash of ["0".repeat(64), "x"]) {
      const bad = await r.core.api("POST", "/api/workflows/prod-rollback/authorise", { hash });
      expect(bad.status).toBe(400);
      expect(bad.json.details).toContain("HASH_MISMATCH");
    }
    expect((await r.core.api("GET", "/api/workflows/prod-rollback")).json.authorisations).toEqual(
      [],
    );
    expect(r.calls.log).toEqual([]);

    // The user authorises exactly the hash they reviewed.
    const hash = await hashOf(r, "prod-rollback");
    const ok = await r.core.api("POST", "/api/workflows/prod-rollback/authorise", { hash });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect(ok.json).toMatchObject({
      authorisation: {
        definition_hash: hash,
        authorised_by: "user:owner",
        live: true,
        revoked_at: null,
      },
      workflow: { authorised: true },
    });
    const started = await start(r, "prod-rollback");
    expect(started.status).toBe(202);
    await untilStatus(r, started.json.run.id, "succeeded");
    expect(r.calls.log).toEqual(["logs", "rollback"]);
    expect((await auditActions(r)).find((e) => e.action === "workflow.authorised")).toMatchObject({
      actor: "user:owner",
      details: { workflow: "prod-rollback", hash },
    });

    // Editing the behaviour ends the authorisation (the hash changed).
    const edited = production({ version: 2, name: "prod-rollback (edited)" });
    expect((await save(r, edited)).status).toBe(200);
    const after = (await r.core.api("GET", "/api/workflows/prod-rollback")).json;
    expect(after.workflow).toMatchObject({ authorised: false, version: 2 });
    expect(after.authorisations[0]).toMatchObject({ live: false, definition_hash: hash });
    expect((await start(r, "prod-rollback")).status).toBe(403);

    // Re-authorise the new hash, then revoke.
    const hash2 = await hashOf(r, "prod-rollback");
    expect(hash2).not.toBe(hash);
    await r.core.api("POST", "/api/workflows/prod-rollback/authorise", { hash: hash2 });
    expect(
      (await r.core.api("POST", "/api/workflows/prod-rollback/revoke", {})).json,
    ).toMatchObject({
      revoked: 1,
      workflow: { authorised: false },
    });
    expect((await start(r, "prod-rollback")).status).toBe(403);
  });

  it("an expiry in the past or beyond 90 days is refused; unknown ids are 404; extra fields are 400", async () => {
    const r = await rig();
    await save(r, production());
    const hash = await hashOf(r, "prod-rollback");
    const url = "/api/workflows/prod-rollback/authorise";
    const past = await r.core.api("POST", url, {
      hash,
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    expect(past.status).toBe(400);
    const far = await r.core.api("POST", url, {
      hash,
      expires_at: new Date(Date.now() + 120 * 86_400_000).toISOString(),
    });
    expect(far.status).toBe(400);
    expect((await r.core.api("POST", url, { hash, expires_at: "never" })).status).toBe(400);
    expect((await r.core.api("POST", url, { hash, extra: 1 })).status).toBe(400);
    expect((await r.core.api("POST", "/api/workflows/nope/authorise", { hash })).status).toBe(404);
    expect((await r.core.api("POST", "/api/workflows/nope/revoke", {})).status).toBe(404);
    expect((await r.core.api("GET", "/api/workflows/prod-rollback")).json.authorisations).toEqual(
      [],
    );
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    const live = await r.core.api("POST", url, { hash, expires_at: soon });
    expect(live.json.authorisation).toMatchObject({ live: true, expires_at: soon });
  });

  it("authorise, revoke and every other change need the session token", async () => {
    const r = await rig();
    await save(r, production());
    for (const [method, path] of [
      ["POST", "/api/workflows/prod-rollback/authorise"],
      ["POST", "/api/workflows/prod-rollback/revoke"],
      ["POST", "/api/workflows"],
      ["POST", "/api/workflows/prod-rollback/runs"],
      ["POST", "/api/workflows/runs/run_x/cancel"],
      ["GET", "/api/workflows"],
      ["GET", "/api/workflows/metrics"],
    ] as const) {
      const res = await fetch(`${r.core.base}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "POST" ? "{}" : undefined,
      });
      expect(res.status, path).toBe(401);
    }
  });

  it("no agent, tool or capability command can authorise, revoke, save, start or cancel", async () => {
    const r = await rig();
    await save(r, production());
    const hash = await hashOf(r, "prod-rollback");
    const agent = { kind: "agent" as const, id: "evil-agent", trustedByUser: false };
    const wfSystem = { kind: "system" as const, id: "workflow-run_x", trustedByUser: true };
    for (const actor of [agent, wfSystem]) {
      for (const tool of [
        "workflows.authorise",
        "workflows.revoke",
        "workflows.save",
        "workflows.start",
        "workflows.cancel",
        "workflows.approve",
      ]) {
        await expect(
          r.core.runtime.toolGateway.call({
            actor,
            tool,
            input: { id: "prod-rollback", hash },
            environment: "local",
          }),
        ).rejects.toThrow();
      }
    }
    // The tool registry lists nothing of the sort, and "workflows" is not a capability.
    expect(
      r.core.runtime.toolGateway
        .tools()
        .filter((t) => /^workflows?\./i.test(t.name) || /authori[sz]e|revoke/i.test(t.name)),
    ).toEqual([]);
    for (const command of ["authorise", "revoke", "start", "save"]) {
      const res = await r.core.api("POST", `/api/capabilities/workflows/commands/${command}`, {
        input: { id: "prod-rollback", hash },
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
    expect((await r.core.api("GET", "/api/workflows/prod-rollback")).json.authorisations).toEqual(
      [],
    );
    expect(r.calls.log).toEqual([]);
  });
});

describe("cancel", () => {
  it("cancels one waiting run, withdraws its prompt, and answers clearly for finished or unknown runs", async () => {
    const r = await rig();
    r.answer.by = () => undefined;
    await save(r, waitForApproval());
    const a = (await start(r, "needs-approval")).json.run.id as string;
    const b = (await start(r, "needs-approval")).json.run.id as string;
    await untilStatus(r, a, "waiting_approval");
    await untilStatus(r, b, "waiting_approval");
    expect((await r.core.api("GET", "/api/confirmations")).json.confirmations).toHaveLength(2);

    const cancelled = await r.core.api("POST", `/api/workflows/runs/${a}/cancel`, {});
    expect(cancelled.status).toBe(202);
    expect(cancelled.json).toMatchObject({ cancelled: true });
    await untilStatus(r, a, "cancelled");
    expect((await run(r, a)).reason).toMatch(/cancelled by the user/);
    expect((await run(r, b)).status).toBe("waiting_approval");
    expect((await r.core.api("GET", "/api/confirmations")).json.confirmations).toHaveLength(1);
    expect(
      (await auditActions(r)).find((e) => e.action === "workflow.run.cancelled_by_user"),
    ).toMatchObject({ actor: "user:owner", details: { run: a } });

    const again = await r.core.api("POST", `/api/workflows/runs/${a}/cancel`, {});
    expect(again.status).toBe(400);
    expect(again.json.details).toContain("RUN_NOT_ACTIVE");
    expect((await r.core.api("POST", "/api/workflows/runs/run_nope/cancel", {})).status).toBe(404);
    expect((await r.core.api("POST", `/api/workflows/runs/${b}/cancel`, { x: 1 })).status).toBe(
      400,
    );
  });

  it("approving the confirmation continues a waiting run", async () => {
    const r = await rig();
    r.answer.by = () => undefined;
    await save(r, waitForApproval());
    const id = (await start(r, "needs-approval")).json.run.id as string;
    await untilStatus(r, id, "waiting_approval");
    const [confirmation] = (await r.core.api("GET", "/api/confirmations")).json.confirmations;
    expect(confirmation).toMatchObject({
      capabilityId: "workflows",
      command: expect.stringContaining(id),
    });
    await r.core.api("POST", `/api/confirmations/${confirmation.id}`, { approve: true });
    await untilStatus(r, id, "succeeded");
  });
});

describe("kill switch", () => {
  it("cancels running and waiting runs, rejects approvals and refuses new runs (manual and by trigger)", async () => {
    const r = await rig();
    r.answer.by = () => undefined;
    await save(r, hangOnly());
    await save(r, waitForApproval());
    const hung = (await start(r, "hang-it")).json.run.id as string;
    const waiting = (await start(r, "needs-approval")).json.run.id as string;
    await untilStatus(r, hung, "running");
    await untilStatus(r, waiting, "waiting_approval");

    await r.core.api("POST", "/api/security/kill-switch", { engaged: true });
    await untilStatus(r, hung, "cancelled");
    await untilStatus(r, waiting, "cancelled");
    expect((await run(r, hung)).reason).toMatch(/Emergency stop/);
    expect((await r.core.api("GET", "/api/confirmations")).json.confirmations).toEqual([]);

    // A manual start is refused like a trigger, and the refusal is recorded.
    const refused = await start(r, "hang-it");
    expect(refused.status).toBe(403);
    expect(refused.json.details[0]).toBe("RUN_REFUSED");
    expect(refused.json.details[2]).toMatch(/Emergency stop is engaged/);
    expect(await run(r, refused.json.details[1])).toMatchObject({ status: "refused" });

    const before = r.calls.log.length;
    await r.core.api("POST", "/api/events", {
      event_id: "evt_whilekill001",
      event_type: "deploy.failed",
      version: "1.1",
      source: "terminal",
      timestamp: new Date().toISOString(),
      severity: "error",
      payload: {},
    });
    await vi.waitFor(async () => {
      const refusedRuns = (await r.core.api("GET", "/api/workflows/runs?status=refused")).json.runs;
      expect(refusedRuns.length).toBeGreaterThanOrEqual(3);
    });
    expect(r.calls.log.length).toBe(before);
  });
});

describe("restart: interrupted runs are reconciled at start", () => {
  it("closes runs a previous process left open, calls nothing at startup, and says what needs attention", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phoenix-wf-restart-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const databasePath = join(dir, "phoenix.sqlite");

    // First process: three runs in three states, then Core stops with them still open.
    const first = await rig({ runtime: { databasePath } });
    first.answer.by = (capability) => (capability === "workflows" ? undefined : true);
    await save(first, hangOnly("plain-hang"));
    await save(first, waitForApproval("plain-wait"));
    await save(
      first,
      workflow(
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
      ),
    );
    const plainHang = (await start(first, "plain-hang")).json.run.id as string;
    const plainWait = (await start(first, "plain-wait")).json.run.id as string;
    const undoable = (await start(first, "undoable")).json.run.id as string;
    await untilStatus(first, plainHang, "running");
    await untilStatus(first, plainWait, "waiting_approval");
    await untilStatus(first, undoable, "waiting_approval");
    const [gate] = (await first.core.api("GET", "/api/confirmations")).json.confirmations.filter(
      (c: { command: string }) => c.command.includes(undoable),
    );
    await first.core.api("POST", `/api/confirmations/${gate.id}`, { approve: true });
    // The run is inside `hold` (a read that never ends) after `restart` succeeded.
    await vi.waitFor(async () => {
      const steps = (await run(first, undoable)).steps;
      expect(steps.map((x) => `${x.step_id}:${x.status}`)).toEqual([
        "gate:succeeded",
        "restart:succeeded",
        "hold:running",
      ]);
    });
    expect(first.calls.log.filter((c) => c === "undo_restart")).toEqual([]);

    await first.core.runtime.stop();
    for (const h of first.calls.held) h.resolve({ released: true });

    // Second process on the same database.
    const second = await rig({ runtime: { databasePath } });
    const calls = second.calls.log.length;
    const after = async (id: string) => (await run(second, id)) as RunDetail;
    await vi.waitFor(async () => expect((await after(plainHang)).terminal).toBe(true));
    expect(await after(plainHang)).toMatchObject({ status: "interrupted" });
    expect(await after(plainWait)).toMatchObject({ status: "interrupted" });
    const needs = await after(undoable);
    expect(needs.status).toBe("failed_needs_attention");
    expect(needs.reason).toMatch(/not undone: restart/);
    expect(needs.reason).toMatch(/^Phoenix stopped while this run was in progress/);
    // Nothing was resumed and no tool was called while reconciling.
    expect(second.calls.log.length).toBe(calls);
    expect(second.calls.log).toEqual([]);
    expect(
      second.core.runtime.events
        .recent({ type: "workflow.result" })
        .filter((e) => e.event.payload.status).length,
    ).toBeGreaterThanOrEqual(3);
    expect(
      (await auditActions(second)).filter((e) => e.action === "workflow.run.recovered"),
    ).toHaveLength(3);
    const metrics = (await second.core.api("GET", "/api/workflows/metrics")).json.metrics;
    expect(metrics["plain-hang"]).toMatchObject({ runs_interrupted: 1 });
    expect(metrics["undoable"]).toMatchObject({ runs_needing_attention: 1 });
    // And the definitions survived: a new run works.
    await second.core.api("POST", "/api/workflows/plain-wait/enabled", { enabled: true });
  });

  it("stopping Core with a run in flight stops the engine and writes nothing more", async () => {
    const r = await rig();
    await save(r, hangOnly());
    const id = (await start(r, "hang-it")).json.run.id as string;
    await untilStatus(r, id, "running");
    const rows = () =>
      r.core.runtime.db
        .prepare("SELECT status, finished_at FROM workflow_runs WHERE id = ?")
        .get(id);
    const before = rows();
    await r.core.runtime.stop();
    for (const h of r.calls.held) h.resolve({ released: true });
    // The run is left as it was (open); the next start reconciles it.
    expect(before).toMatchObject({ status: "running", finished_at: null });
  });
});

describe("network", () => {
  it("nothing in the workflow routes reached beyond Core itself", async () => {
    const r = await rig();
    await save(r, readLogs());
    const id = (await start(r, "read-logs")).json.run.id as string;
    await untilStatus(r, id, "succeeded");
    expect(r.fetched.filter((u) => !u.startsWith(r.core.base))).toEqual([]);
  });
});
