// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The n8n capability against a mock shaped from the n8n public API docs, on 127.0.0.1 only.
// Nothing in this file contacts a real n8n.
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createN8nCapability,
  diffExecutions,
  executionPhase,
  executionTracker,
  parseExecution,
  parseExecutions,
  parseRetried,
  parseWorkflow,
  parseWorkflows,
} from "../src";
import { Clock } from "../testing/clock";
import {
  MOCK_KEY,
  REMOTE_MARKER,
  execution,
  startMockN8n,
  workflow,
  type MockN8n,
} from "../testing/mock-n8n";

const T0 = Date.parse("2026-10-05T09:00:00Z");
const iso = (offsetSeconds: number) => new Date(T0 + offsetSeconds * 1000).toISOString();
const KEY = "plan1-n8naction-abcdef0123456789";
const OTHER_KEY = "plan1-n8naction-fedcba9876543210";

let h: Harness | undefined;
let mock: MockN8n | undefined;
let clock: Clock;

afterEach(async () => {
  await h?.close();
  await mock?.close();
  h = mock = undefined;
});

async function ready(
  options: {
    key?: string | null;
    config?: Record<string, unknown> | null;
    data?: (m: MockN8n) => void;
  } = {},
) {
  mock = await startMockN8n();
  clock = new Clock();
  mock.workflows.push(workflow());
  options.data?.(mock);
  h = createHarness({
    modules: [createN8nCapability({ now: () => clock.now, sleep: clock.sleep })],
  });
  if (options.config !== null)
    h.manager.configure("n8n", { base_url: mock.url, ...options.config });
  const key = options.key === undefined ? MOCK_KEY : options.key;
  if (key) await h.manager.setSecret("n8n", "api_key", key);
  await h.enable("n8n");
  await clock.first();
}

const types = () => h!.types("n8n");
const health = async () => (await h!.manager.checkHealth("n8n")).health;
const everything = (ops: unknown[] = []) =>
  JSON.stringify({ ops, events: h!.events, audit: h!.db.prepare("SELECT * FROM audit_log").all() });

describe("manifest and configuration", () => {
  it("status is read; run_again and pause_workflow are external; the key stays out of views", async () => {
    await ready();
    const view = h!.manager.get("n8n");
    expect(view.permissions.map((p) => p.permission)).toEqual(["network", "external_api"]);
    expect(view.commands).toEqual([
      expect.objectContaining({ name: "status", side_effect: "read" }),
      expect.objectContaining({ name: "run_again", side_effect: "external" }),
      expect.objectContaining({ name: "pause_workflow", side_effect: "external" }),
    ]);
    expect(view.secrets).toEqual([expect.objectContaining({ name: "api_key", set: true })]);
    expect(JSON.stringify(view)).not.toContain(MOCK_KEY);
  });

  it.each([
    "http://n8n.example.com",
    "ftp://n8n.example.com",
    "https://user:pw@n8n.example.com",
    "https://n8n.example.com?x=1",
    "javascript:alert(1)",
    "n8n.example.com",
  ])("refuses base_url %s", async (url) => {
    await ready();
    expect(() => h!.manager.configure("n8n", { base_url: url })).toThrow();
  });

  it("accepts https and loopback http, and refuses secrets in config", async () => {
    await ready();
    expect(() =>
      h!.manager.configure("n8n", { base_url: "https://n8n.example.com" }),
    ).not.toThrow();
    expect(() => h!.manager.configure("n8n", { base_url: "http://localhost:5678" })).not.toThrow();
    expect(() => h!.manager.configure("n8n", { base_url: mock!.url, api_key: MOCK_KEY })).toThrow();
  });

  it("without a base_url nothing is requested and health is degraded", async () => {
    await ready({ config: null });
    expect(mock!.service.requests).toEqual([]);
    expect(await health()).toMatchObject({
      status: "degraded",
      message: expect.stringMatching(/base_url/),
    });
    const op = await h!.run("n8n", "status");
    expect(op.result).toMatchObject({ configured: false });
  });

  it("without a key nothing is requested and health is degraded", async () => {
    await ready({ key: null });
    expect(mock!.service.requests).toEqual([]);
    expect(await health()).toMatchObject({ status: "degraded" });
  });
});

describe("parsing", () => {
  it("reads workflows and executions, with numeric or string ids", () => {
    expect(parseWorkflow(workflow())).toEqual({ id: "wf1", name: "Nightly sync", active: true });
    expect(parseExecution(execution())).toEqual({
      id: "101",
      workflowId: "wf1",
      status: "success",
      phase: "succeeded",
      startedAt: Date.parse("2026-10-05T10:00:00.000Z"),
      stoppedAt: Date.parse("2026-10-05T10:00:05.000Z"),
      mode: "trigger",
    });
    expect(parseExecution(execution({ id: "77" }))?.id).toBe("77");
  });

  it.each([
    ["path-shaped id", { id: "../x" }],
    ["id with slash", { id: "a/b" }],
    ["negative id", { id: -3 }],
    ["fractional id", { id: 1.5 }],
    ["no workflow", { workflowId: undefined }],
    ["bad time", { startedAt: "never" }],
    ["no time", { startedAt: undefined }],
  ])("skips an execution with %s", (_n, over) => {
    expect(parseExecution({ ...execution(), ...over })).toBeUndefined();
  });

  it("an unknown status is kept as a word and maps to no phase of interest", () => {
    expect(parseExecution(execution({ status: "teleporting" }))).toMatchObject({
      status: "teleporting",
      phase: "other",
    });
    expect(executionPhase("constructor")).toBe("other");
    expect(executionPhase("crashed")).toBe("failed");
    expect(executionPhase("waiting")).toBe("running");
  });

  it("skips broken list entries and throws on the wrong shape", () => {
    expect(
      parseWorkflows({
        data: [1, null, workflow({ id: "ok" }), { id: REMOTE_MARKER + "/x", name: "n" }],
      }).map((w) => w.id),
    ).toEqual(["ok"]);
    expect(parseExecutions({ data: ["x", execution()] })).toHaveLength(1);
    expect(() => parseExecutions({ data: "x" })).toThrow();
    expect(() => parseWorkflows([])).toThrow();
    expect(() => parseRetried({})).toThrow();
    expect(parseRetried({ data: { id: 5 } })).toEqual({ id: "5" });
  });

  it("clips names and drops control characters", () => {
    const w = parseWorkflow(workflow({ name: `a\u0007b${"x".repeat(500)}` }));
    expect(w!.name).toHaveLength(120);
    expect(w!.name).not.toMatch(/\u0007/);
  });
});

describe("diffExecutions (history rule)", () => {
  const live = T0;
  const ex = (over = {}) => parseExecution(execution({ startedAt: iso(5), ...over }))!;
  const old = (over = {}) => parseExecution(execution({ startedAt: iso(-86_400), ...over }))!;

  it("old finished executions are silent; a running one reports its end", () => {
    const t = executionTracker(live);
    expect(
      diffExecutions(
        t,
        [old({ status: "error" }), old({ id: 2, status: "success" })],
        [],
        "https://n.example",
      ),
    ).toEqual([]);
    expect(diffExecutions(t, [old({ id: 3, status: "running" })], [], "https://n.example")).toEqual(
      [],
    );
    const done = diffExecutions(t, [old({ id: 3, status: "error" })], [], "https://n.example");
    expect(done.map((e) => e.event_type)).toEqual(["n8n.execution.failed"]);
  });

  it("a new execution that fails makes one error event naming the workflow; no event while running", () => {
    const t = executionTracker(live);
    const wf = [parseWorkflow(workflow())!];
    expect(diffExecutions(t, [ex({ status: "running" })], wf, "https://n.example")).toEqual([]);
    const events = diffExecutions(t, [ex({ status: "error" })], wf, "https://n.example");
    expect(events).toMatchObject([
      {
        event_type: "n8n.execution.failed",
        severity: "error",
        subject: "Nightly sync",
        correlation_id: "n8n-execution-101",
      },
    ]);
    expect(events[0]!.payload).toEqual({
      execution_id: "101",
      workflow_id: "wf1",
      workflow: "Nightly sync",
      status: "error",
      mode: "trigger",
      url: "https://n.example/workflow/wf1/executions/101",
    });
    expect(diffExecutions(t, [ex({ status: "error" })], wf, "https://n.example")).toEqual([]);
  });

  it("no link for a non-https base (loopback http), and the id is encoded into the path", () => {
    const t = executionTracker(live);
    const [e] = diffExecutions(t, [ex({ status: "success" })], [], "http://127.0.0.1:5678");
    expect(e!.payload.url).toBeUndefined();
    expect(e!.subject).toBe("workflow wf1");
  });
});

describe("polling through the capability", () => {
  it("history rule: nothing from before enabling is replayed", async () => {
    await ready({
      data: (m) =>
        m.executions.push(
          execution({ id: 1, status: "error", startedAt: iso(-86_400) }),
          execution({ id: 2, status: "success", startedAt: iso(-60) }),
        ),
    });
    expect(types()).toEqual([]);
    expect(h!.state.snapshot().state).toBe("IDLE");
  });

  it("a failing execution after enabling is ERROR in Fawkes; a later success is SUCCESS", async () => {
    await ready();
    mock!.executions.push(
      execution({ id: 201, status: "running", startedAt: iso(10), stoppedAt: null }),
    );
    await clock.tick();
    expect(types()).toEqual([]);
    mock!.executions[0]!.status = "error";
    await clock.tick();
    await vi.waitFor(() => expect(types()).toEqual(["n8n.execution.failed"]));
    await h!.drain();
    expect(h!.state.snapshot()).toMatchObject({
      state: "ERROR",
      explanation: "Workflow failed: Nightly sync",
      source: "n8n",
    });
    mock!.executions.push(execution({ id: 202, status: "success", startedAt: iso(20) }));
    await clock.tick();
    await vi.waitFor(() => expect(types()).toContain("n8n.execution.succeeded"));
  });

  it("only GETs while polling, with the key in X-N8N-API-KEY and never the data of executions", async () => {
    await ready();
    const reqs = mock!.service.requests;
    expect(reqs.map((r) => r.path)).toEqual([
      "/api/v1/executions?limit=50&includeData=false",
      "/api/v1/workflows?limit=100",
    ]);
    for (const r of reqs) {
      expect(r.method).toBe("GET");
      expect(r.headers["x-n8n-api-key"]).toBe(MOCK_KEY);
      expect(r.headers.authorization).toBeUndefined();
    }
  });

  it("still reports executions (named by id) when the workflow list fails", async () => {
    await ready({
      data: (m) =>
        (m.override.current = (path) =>
          path.startsWith("/api/v1/workflows") ? { status: 500, body: {} } : undefined),
    });
    mock!.executions.push(execution({ id: 301, status: "error", startedAt: iso(10) }));
    await clock.tick();
    await vi.waitFor(() => expect(types()).toEqual(["n8n.execution.failed"]));
    expect(h!.events.find((e) => e.source === "n8n")!.subject).toBe("workflow wf1");
  });

  it("makes no request while unwatched and resumes when someone watches", async () => {
    mock = await startMockN8n();
    clock = new Clock();
    h = createHarness({
      modules: [createN8nCapability({ now: () => clock.now, sleep: clock.sleep })],
    });
    h.manager.presence.setClients(0);
    h.manager.configure("n8n", { base_url: mock.url });
    await h.manager.setSecret("n8n", "api_key", MOCK_KEY);
    await h.enable("n8n");
    await new Promise((r) => setImmediate(r));
    expect(mock.service.requests).toEqual([]);
    expect(clock.sleeps).toEqual([]);
    h.manager.presence.setClients(1);
    await clock.first();
    const afterFirst = mock.service.requests.length;
    expect(afterFirst).toBeGreaterThan(0);
    h.manager.presence.setClients(0);
    clock.release();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(mock.service.requests).toHaveLength(afterFirst);
    h.manager.presence.setClients(1);
    await vi.waitFor(() => expect(mock!.service.requests.length).toBeGreaterThan(afterFirst));
  });
});

describe("failures", () => {
  it("401: degraded, waits >= 5 minutes, neither key nor remote text in the message", async () => {
    await ready({
      data: (m) => (m.override.current = () => ({ status: 401, body: { message: REMOTE_MARKER } })),
    });
    expect(clock.sleeps[0]).toBeGreaterThanOrEqual(300_000);
    const status = await health();
    expect(status.status).toBe("degraded");
    expect(JSON.stringify(status)).not.toContain(REMOTE_MARKER);
    expect(JSON.stringify(status)).not.toContain(MOCK_KEY);
  });

  it("429 with Retry-After is honoured", async () => {
    await ready({
      data: (m) =>
        (m.override.current = () => ({ status: 429, headers: { "retry-after": "75" }, body: {} })),
    });
    expect(clock.sleeps[0]).toBeGreaterThanOrEqual(75_000);
    expect((await health()).status).toBe("degraded");
  });

  it("a redirect is not followed (the key would travel to another host)", async () => {
    const other = await startMockN8n();
    try {
      await ready({
        data: (m) =>
          (m.override.current = () => ({
            status: 302,
            headers: { location: `${other.url}/api/v1/executions` },
            body: {},
          })),
      });
      expect(other.service.requests).toEqual([]);
      expect((await health()).status).toBe("unhealthy");
    } finally {
      await other.close();
    }
  });

  it("an oversized response is cut off", async () => {
    await ready({
      data: (m) =>
        (m.override.current = () => ({
          body: JSON.stringify({ data: [], pad: "x".repeat(2 * 1024 * 1024 + 10) }),
        })),
    });
    expect((await health()).status).toBe("unhealthy");
    expect(types()).toEqual([]);
  });

  it.each([
    ["not JSON", "<html>REMOTE</html>"],
    ["a string", '"REMOTE"'],
    ["wrong shape", JSON.stringify({ data: { a: 1 } })],
  ])("a hostile body (%s) makes no events and leaks no text", async (_n, body) => {
    await ready({ data: (m) => (m.override.current = () => ({ body })) });
    expect(types()).toEqual([]);
    const status = await health();
    expect(status.status).toBe("unhealthy");
    expect(JSON.stringify(status)).not.toContain("REMOTE");
  });

  it("hostile execution fields never reach events", async () => {
    await ready();
    mock!.executions.push(
      execution({
        id: 401,
        status: "error",
        startedAt: iso(10),
        mode: "<script>",
        workflowId: "wf1",
      }),
      execution({ id: "../../etc", status: "error", startedAt: iso(10) }),
      execution({ id: 402, status: "error", startedAt: iso(10), workflowId: "a/b" }),
    );
    await clock.tick();
    await vi.waitFor(() => expect(types()).toEqual(["n8n.execution.failed"]));
    const event = h!.events.find((e) => e.source === "n8n")!;
    expect(event.payload.mode).toBeUndefined();
    expect(event.payload.execution_id).toBe("401");
  });
});

describe("run_again (approval path)", () => {
  const ARGS = { execution_id: "101", idempotency_key: KEY };
  const withExecution = (m: MockN8n) => m.executions.push(execution({ startedAt: iso(-100) }));

  it("declining the confirmation never calls n8n", async () => {
    await ready({ data: withExecution });
    const before = mock!.service.requests.length;
    const op = await h!.run("n8n", "run_again", ARGS, false);
    expect(op.status).toBe("failed");
    expect(mock!.service.requests).toHaveLength(before);
    expect(mock!.posts).toEqual([]);
  });

  it("without a decision it waits and sends nothing", async () => {
    await ready({ data: withExecution });
    const before = mock!.service.requests.length;
    const op = h!.manager.invoke("n8n", "run_again", ARGS);
    await vi.waitFor(() => expect(h!.permissions.pendingConfirmations()).toHaveLength(1));
    expect(op.status).toBe("pending");
    expect(h!.permissions.pendingConfirmations()[0]).toMatchObject({ sideEffect: "external" });
    expect(mock!.service.requests).toHaveLength(before);
    for (const c of h!.permissions.pendingConfirmations())
      h!.permissions.resolveConfirmation(c.id, false);
  });

  it("approved: exactly one POST to /retry; the same key does not retry twice; a new key does", async () => {
    await ready({ data: withExecution });
    const first = await h!.run("n8n", "run_again", ARGS, true);
    expect(first.status).toBe("succeeded");
    expect(first.result).toMatchObject({
      status: "started",
      execution_id: "101",
      new_execution_id: "901",
    });
    expect(mock!.posts).toEqual([{ path: "/api/v1/executions/101/retry" }]);
    const again = await h!.run("n8n", "run_again", ARGS, true);
    expect(again.result).toMatchObject({ status: "already_requested", new_execution_id: "901" });
    expect(mock!.posts).toHaveLength(1);
    await h!.run("n8n", "run_again", { ...ARGS, idempotency_key: OTHER_KEY }, true);
    expect(mock!.posts).toHaveLength(2);
    expect(everything([first])).not.toContain(MOCK_KEY);
  });

  it("an unknown execution is a 404, frees the key and reveals no remote text", async () => {
    await ready();
    const op = await h!.run("n8n", "run_again", ARGS, true);
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(/404/);
    mock!.executions.push(execution({ startedAt: iso(-100) }));
    const retry = await h!.run("n8n", "run_again", ARGS, true);
    expect(retry.status).toBe("succeeded");
  });

  it("a 5xx reply says the outcome is unknown, and the same key is not blindly re-sent", async () => {
    await ready({ data: withExecution });
    mock!.override.current = (_p, method) =>
      method === "POST" ? { status: 502, body: REMOTE_MARKER } : undefined;
    const first = await h!.run("n8n", "run_again", ARGS, true);
    expect(first.status).toBe("failed");
    expect(first.error?.message).toMatch(/outcome is unknown/);
    expect(JSON.stringify(first)).not.toContain(REMOTE_MARKER);
    mock!.override.current = undefined;
    const second = await h!.run("n8n", "run_again", ARGS, true);
    expect(second.status).toBe("failed");
    expect(second.error?.message).toMatch(/outcome is unknown/);
    // One POST reached the server (the override answered it); the repeat sent nothing.
    expect(mock!.service.requests.filter((r) => r.method === "POST")).toHaveLength(1);
  });

  it("rejects ids that could reshape the path, before anything is asked or sent", async () => {
    await ready({ data: withExecution });
    for (const execution_id of ["../x", "a/b", "1 2", ""]) {
      await expect(
        h!.run("n8n", "run_again", { execution_id, idempotency_key: KEY }),
      ).rejects.toThrow();
    }
    await expect(h!.run("n8n", "run_again", { ...ARGS, extra: true })).rejects.toThrow();
    await expect(
      h!.run("n8n", "run_again", { execution_id: "101", idempotency_key: "short" }),
    ).rejects.toThrow();
    expect(mock!.posts).toEqual([]);
  });
});

describe("pause_workflow (approval path)", () => {
  const ARGS = { workflow_id: "wf1", idempotency_key: KEY };

  it("declining the confirmation never calls n8n and the workflow stays active", async () => {
    await ready();
    const before = mock!.service.requests.length;
    const op = await h!.run("n8n", "pause_workflow", ARGS, false);
    expect(op.status).toBe("failed");
    expect(mock!.service.requests).toHaveLength(before);
    expect(mock!.workflows[0]!.active).toBe(true);
  });

  it("approved: deactivates exactly once; repeating the key does not call again", async () => {
    await ready();
    const op = await h!.run("n8n", "pause_workflow", ARGS, true);
    expect(op.status).toBe("succeeded");
    expect(op.result).toMatchObject({ status: "paused", workflow_id: "wf1", active: false });
    expect(mock!.workflows[0]!.active).toBe(false);
    const again = await h!.run("n8n", "pause_workflow", ARGS, true);
    expect(again.result).toMatchObject({ status: "already_requested", active: false });
    expect(mock!.posts).toEqual([{ path: "/api/v1/workflows/wf1/deactivate" }]);
  });

  it("n8n answering that the workflow is still active is an error, not 'paused'", async () => {
    await ready();
    mock!.override.current = (_p, method) =>
      method === "POST" ? { body: workflow({ active: true }) } : undefined;
    const op = await h!.run("n8n", "pause_workflow", ARGS, true);
    expect(op.status).toBe("failed");
    expect(op.error?.message).toMatch(/still reports the workflow as active/);
  });

  it("rejects ids that could reshape the path", async () => {
    await ready();
    for (const workflow_id of ["../x", "a/b", ""]) {
      await expect(
        h!.run("n8n", "pause_workflow", { workflow_id, idempotency_key: KEY }),
      ).rejects.toThrow();
    }
    expect(mock!.posts).toEqual([]);
  });

  it("without a configured base_url the action fails before sending and without spending the key", async () => {
    await ready({ config: null });
    const op = await h!.run("n8n", "pause_workflow", ARGS, true);
    expect(op.status).toBe("failed");
    expect(mock!.service.requests).toEqual([]);
  });
});

describe("status", () => {
  it("lists workflows and recent executions by workflow name", async () => {
    await ready({
      data: (m) => m.executions.push(execution({ startedAt: iso(-100), status: "error" })),
    });
    const op = await h!.run("n8n", "status");
    expect(op.status).toBe("succeeded");
    expect(op.result).toEqual({
      configured: true,
      workflows: [{ id: "wf1", name: "Nightly sync", active: true }],
      items: [{ id: "101", title: "Nightly sync", state: "error", at: iso(-100) }],
    });
    expect(everything([op])).not.toContain(MOCK_KEY);
  });
});
