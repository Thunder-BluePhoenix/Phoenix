// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Core's side of the Phase 57 relay: the owner-only socket inside a real in-process Core. The
// installer is built over a temp home, so no test can touch a real agent's settings.
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agentsCapability,
  HookInstaller,
  relayCall,
  type AgentReport,
  type AgentState,
} from "@phoenix/capability-agents";
import { defaults } from "@phoenix/config";
import { silentLogger } from "@phoenix/logging";
import type { PhoenixEvent } from "@phoenix/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { requestApproval } from "../../../capabilities/agents/src/approval-client";
import type { ApprovalRequest } from "../../../capabilities/agents/src/approval-map";
import { sendReport } from "../../../capabilities/agents/src/send";
import { PhoenixRuntime } from "../src";
import { startCore, TOKEN, type TestCore } from "./helpers";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

function installer(): HookInstaller {
  const home = mkdtempSync(join(tmpdir(), "phoenix-relay-home-"));
  cleanups.push(() => rmSync(home, { recursive: true, force: true }));
  return new HookInstaller({ home, env: {}, backupDir: join(home, "backups") });
}

interface Running extends TestCore {
  socket: string;
}

async function core(): Promise<Running> {
  const c = await startCore(
    {},
    { capabilities: [agentsCapability], runtime: { installer: installer() } },
  );
  cleanups.push(() => c.runtime.stop());
  expect((await c.api("POST", "/api/capabilities/agents/enable", {})).status).toBe(200);
  return { ...c, socket: join(c.dataDir, "relay", "relay.sock") };
}

let subscriptions = 0;
/** Resolves with the first event matching `pattern` (and `accept`) after this call. */
function nextEvent(
  c: TestCore,
  pattern: string,
  accept: (event: PhoenixEvent) => boolean = () => true,
): Promise<PhoenixEvent> {
  const { promise, resolve } = Promise.withResolvers<PhoenixEvent>();
  const off = c.runtime.bus.subscribe(`relay-test-${subscriptions++}`, pattern, (event) => {
    if (!accept(event)) return;
    off();
    resolve(event);
  });
  cleanups.push(off);
  return promise;
}

/** One raw request line, so the test can send operations the typed client cannot name. */
function rawCall(path: string, line: string): Promise<{ ok: boolean; error?: { code: string } }> {
  const { promise, resolve, reject } = Promise.withResolvers<{
    ok: boolean;
    error?: { code: string };
  }>();
  const socket = connect(path);
  let text = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    text += chunk;
  });
  socket.on("error", reject);
  socket.on("close", () => resolve(JSON.parse(text)));
  socket.write(`${line}\n`);
  return promise;
}

const SESSION = "5f1c1b0e-6a0e-4f43-8d7d-0a6a3f4b2c11";
const report = (state: AgentState = "working"): AgentReport => ({
  agent: "claude-code",
  agent_id: SESSION,
  state,
  workspace: "/home/me/projects/phoenix",
});

const approvalBody = (over: Record<string, unknown> = {}) => ({
  kind: "permission",
  agent: "claude-code",
  session_id: "s1",
  project: "/work/phoenix",
  tool: "Bash",
  input_summary: { command: "npm test -- --run" },
  suggestions_ok: true,
  timeout_ms: 120_000,
  ...over,
});

const decide = (c: TestCore, id: string, behavior: "allow" | "deny") =>
  c.api("POST", `/api/agent-approvals/${id}/decision`, { behavior }, { "x-phoenix-client": "web" });

describe.skipIf(process.platform === "win32")("Core hosts the relay socket", () => {
  it("serves an owner-only socket in an owner-only directory while running, and removes it on stop", async () => {
    const c = await core();
    expect(statSync(c.socket).mode & 0o777).toBe(0o600);
    expect(statSync(join(c.dataDir, "relay")).mode & 0o777).toBe(0o700);
    expect(c.runtime.agentRelay.status()).toMatchObject({
      running: true,
      version: 1,
      platform: process.platform,
      path: c.socket,
    });

    await c.runtime.stop();
    expect(() => statSync(c.socket)).toThrow(/ENOENT/);
    expect(c.runtime.agentRelay.status().running).toBe(false);
  });

  it("answers ping through the client with Core's version", async () => {
    const c = await core();
    const reply = await relayCall("ping", {}, { socketPath: c.socket, timeoutMs: 5_000 });
    expect(reply).toMatchObject({ ok: true, result: { v: 1, core_version: "0.1.0-dev" } });
  });

  it("report reaches the agents capability: an agent.* event and an entry in `list`", async () => {
    const c = await core();
    const seen = nextEvent(c, "agent.*");
    const reply = await relayCall("report", report(), { socketPath: c.socket, timeoutMs: 5_000 });
    expect(reply).toEqual({ ok: true, result: { accepted: true } });
    const event = await seen;
    expect(event.event_type).toBe("agent.working");
    expect(event.payload).toMatchObject({ agent: "claude-code", agent_id: SESSION });

    const list = await c.runtime.capabilities.invokeAndWait("agents", "list", {});
    expect(list.result).toMatchObject({
      agents: [{ agent: "claude-code", agent_id: SESSION, state: "working" }],
    });
  });

  it("report is refused, as a rejection, while the agents capability is off", async () => {
    const c = await core();
    await c.api("POST", "/api/capabilities/agents/disable", {});
    const reply = await relayCall("report", report(), { socketPath: c.socket, timeoutMs: 5_000 });
    expect(reply).toMatchObject({ ok: false, kind: "rejected", code: "CAPABILITY_DISABLED" });
  });

  it("refuses operations that are not on the allow-list, and they change nothing", async () => {
    const c = await core();
    const pending = (await c.api("POST", "/api/agent-approvals", approvalBody())).json;
    const attempts = [
      { op: "approval.decide", body: { id: pending.id, behavior: "allow" } },
      { op: "audit.list", body: {} },
      {
        op: "capability.invoke",
        body: { id: "agents", command: "report", input: report() },
      },
      { op: "__proto__", body: {} },
    ];
    for (const attempt of attempts) {
      const reply = await rawCall(c.socket, JSON.stringify({ v: 1, ...attempt }));
      expect(reply, attempt.op).toMatchObject({ ok: false, error: { code: "op_not_allowed" } });
    }
    await c.runtime.bus.drain();

    const approvals = (await c.api("GET", "/api/agent-approvals")).json.approvals as {
      id: string;
    }[];
    expect(approvals.map((a) => a.id)).toEqual([pending.id]);
    const list = await c.runtime.capabilities.invokeAndWait("agents", "list", {});
    expect(list.result).toMatchObject({ agents: [] });
  });

  it("approval.create then approval.wait is decided by a user decision made over HTTP", async () => {
    const c = await core();
    const requested = nextEvent(c, "agent.approval.requested");
    const created = await relayCall("approval.create", approvalBody(), {
      socketPath: c.socket,
      timeoutMs: 5_000,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const { id, nonce, digest } = created.result as { id: string; nonce: string; digest: string };
    expect(created.result).toMatchObject({ status: "pending" });
    expect((await requested).payload).toMatchObject({ id });

    const waiting = relayCall(
      "approval.wait",
      { id, nonce, wait_ms: 25_000 },
      { socketPath: c.socket, timeoutMs: 30_000 },
    );
    expect((await decide(c, id, "allow")).status).toBe(200);
    expect(await waiting).toEqual({
      ok: true,
      result: {
        id,
        digest,
        status: "decided",
        decision: { behavior: "allow" },
        decided_by: "user",
      },
    });
  });

  it("approval.wait with the wrong nonce, an unknown id or a malformed body is rejected", async () => {
    const c = await core();
    const created = await relayCall("approval.create", approvalBody(), {
      socketPath: c.socket,
      timeoutMs: 5_000,
    });
    if (!created.ok) throw new Error("create failed");
    const { id } = created.result as { id: string };
    const options = { socketPath: c.socket, timeoutMs: 5_000 };

    expect(await relayCall("approval.wait", { id, nonce: "0".repeat(32) }, options)).toMatchObject({
      ok: false,
      kind: "rejected",
      code: "RESOURCE_NOT_FOUND",
    });
    expect(
      await relayCall(
        "approval.wait",
        { id: `apr_${"0".repeat(24)}`, nonce: "0".repeat(32) },
        options,
      ),
    ).toMatchObject({ ok: false, code: "RESOURCE_NOT_FOUND" });
    for (const body of [null, "x", { nonce: "0".repeat(32) }, { id }, { id, nonce: 5 }]) {
      expect(await relayCall("approval.wait", body, options), JSON.stringify(body)).toMatchObject({
        ok: false,
        kind: "rejected",
        code: "INVALID_REQUEST",
      });
    }
    expect(await relayCall("approval.create", { kind: "nope" }, options)).toMatchObject({
      ok: false,
      code: "INVALID_REQUEST",
    });
  });

  it("step and usage reach the real AgentLive: validated, recorded, and visible over HTTP", async () => {
    const c = await core();
    const options = { socketPath: c.socket, timeoutMs: 5_000 };
    const project = mkdtempSync(join(tmpdir(), "phoenix-live-"));
    cleanups.push(() => rmSync(project, { recursive: true, force: true }));
    const stepped = nextEvent(c, "agent.session.step");
    const step = {
      agent: "claude-code",
      session_id: SESSION,
      project,
      kind: "run",
      tool: "Bash",
      target: "npm test",
      at: new Date().toISOString(),
    };
    expect(await relayCall("step", step, options)).toMatchObject({
      ok: true,
      result: { accepted: true },
    });
    expect((await stepped).payload).toMatchObject({ agent: "claude-code", session_id: SESSION });

    const updated = nextEvent(c, "agent.usage.updated");
    expect(
      await relayCall(
        "usage",
        {
          agent: "claude-code",
          samples: [
            { window: "5h", used_pct: 42, resets_at: new Date(Date.now() + 3_600_000).toISOString() },
          ],
        },
        options,
      ),
    ).toEqual({ ok: true, result: { accepted: 1 } });
    expect((await updated).payload).toMatchObject({ window: "5h", used_pct: 42 });

    // The service validates; a bad body is a rejection with its own code, never internal_error.
    for (const op of ["step", "usage"] as const) {
      expect(await relayCall(op, { nonsense: true }, options), op).toMatchObject({
        ok: false,
        kind: "rejected",
        code: "INVALID_REQUEST",
      });
    }
  });

  it("register() still lets a subsystem replace what step answers", async () => {
    const c = await core();
    c.runtime.agentRelay.register("step", (body) => ({ echoed: body }));
    expect(await relayCall("step", { n: 1 }, { socketPath: c.socket, timeoutMs: 5_000 })).toEqual({
      ok: true,
      result: { echoed: { n: 1 } },
    });
  });

  it("handlers registered before start() are served once the relay is up", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "phoenix-core-"));
    cleanups.push(() => rmSync(dataDir, { recursive: true, force: true }));
    const runtime = new PhoenixRuntime({
      config: { ...defaults("dev"), port: 0, dataDir },
      logger: silentLogger,
      databasePath: ":memory:",
      token: TOKEN,
      writeTokenFile: false,
      capabilities: [],
      installer: installer(),
    });
    runtime.agentRelay.register("usage", () => ({ early: true }));
    await runtime.start();
    cleanups.push(() => runtime.stop());
    const reply = await relayCall(
      "usage",
      {},
      { socketPath: join(dataDir, "relay", "relay.sock"), timeoutMs: 5_000 },
    );
    expect(reply).toEqual({ ok: true, result: { early: true } });
  });

  it("serves a hook's report with no usable token and no reachable HTTP port", async () => {
    const c = await core();
    const seen = nextEvent(c, "agent.*");
    const closedPort = "http://127.0.0.1:1";
    const viaSocket = await sendReport(report("started"), {
      relay: { socketPath: c.socket },
      coreUrl: closedPort,
      token: "bogus-not-a-session",
      timeoutMs: 5_000,
    });
    expect(viaSocket).toEqual({ ok: true });
    expect((await seen).event_type).toBe("agent.started");

    // Control: the same call without the relay has nowhere to go, so only the socket served it.
    const viaHttp = await sendReport(report("started"), {
      relay: false,
      coreUrl: closedPort,
      token: "bogus-not-a-session",
      timeoutMs: 1_000,
    });
    expect(viaHttp.ok).toBe(false);
  });

  it("serves a hook's approval request over the socket; an HTTP decision is what it returns", async () => {
    const c = await core();
    const requested = nextEvent(c, "agent.approval.requested");
    const outcome = requestApproval(approvalBody() as unknown as ApprovalRequest, {
      relay: { socketPath: c.socket },
      coreUrl: "http://127.0.0.1:1",
      token: "bogus-not-a-session",
    });
    const { id } = (await requested).payload as { id: string };
    expect((await decide(c, id, "allow")).status).toBe(200);
    expect(await outcome).toEqual({ decision: { behavior: "allow" }, decidedBy: "user" });

    const history = (await c.api("GET", "/api/agent-approvals/history?limit=5")).json.history;
    expect(history[0]).toMatchObject({ id, outcome: "allow", client: "web" });
  });
});

describe.skipIf(process.platform === "win32")(
  "a relay that cannot start does not stop Core",
  () => {
    async function coreWithRelayDir(prepare: (dataDir: string) => void) {
      const dataDir = mkdtempSync(join(tmpdir(), "phoenix-core-"));
      cleanups.push(() => rmSync(dataDir, { recursive: true, force: true }));
      prepare(dataDir);
      const runtime = new PhoenixRuntime({
        config: { ...defaults("dev"), port: 0, dataDir },
        logger: silentLogger,
        databasePath: ":memory:",
        token: TOKEN,
        writeTokenFile: false,
        capabilities: [],
        installer: installer(),
      });
      const { port } = await runtime.start();
      cleanups.push(() => runtime.stop());
      const get = (path: string) =>
        fetch(`http://127.0.0.1:${port}${path}`, { headers: { authorization: `Bearer ${TOKEN}` } });
      return { runtime, dataDir, get };
    }

    it("a relay directory open to others: Core runs, status says why, no socket appears", async () => {
      const c = await coreWithRelayDir((dataDir) => {
        const dir = join(dataDir, "relay");
        mkdirSync(dir, { recursive: true });
        chmodSync(dir, 0o755);
      });
      const status = c.runtime.agentRelay.status();
      expect(status.running).toBe(false);
      expect(status.error).toMatch(/mode|700/);
      expect(status.path).toBeUndefined();
      expect(() => statSync(join(c.dataDir, "relay", "relay.sock"))).toThrow(/ENOENT/);

      expect((await c.get("/api/pet/state")).status).toBe(200);
      const listed = await (await c.get("/api/agent-relay/agents")).json();
      expect(listed.relay).toMatchObject({ running: false, version: 1 });
      expect(typeof listed.relay.error).toBe("string");
    });

    it("a relay directory that is a symlink is refused the same way", async () => {
      const elsewhere = mkdtempSync(join(tmpdir(), "phoenix-elsewhere-"));
      cleanups.push(() => rmSync(elsewhere, { recursive: true, force: true }));
      const c = await coreWithRelayDir((dataDir) => {
        symlinkSync(elsewhere, join(dataDir, "relay"));
      });
      expect(c.runtime.agentRelay.status()).toMatchObject({ running: false });
      expect(c.runtime.agentRelay.status().error).toMatch(/real directory/);
      expect((await c.get("/api/pet/state")).status).toBe(200);
    });
  },
);
