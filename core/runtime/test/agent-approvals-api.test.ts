// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { afterEach, describe, expect, it } from "vitest";
import { startCore, type TestCore } from "./helpers";

const cores: TestCore[] = [];
afterEach(async () => {
  for (const core of cores.splice(0).reverse()) await core.runtime.stop();
});

async function core(): Promise<TestCore> {
  const instance = await startCore();
  cores.push(instance);
  return instance;
}

const body = (over: Record<string, unknown> = {}) => ({
  kind: "permission",
  agent: "claude",
  session_id: "s1",
  project: "/work/phoenix",
  tool: "Bash",
  input_summary: { command: "npm test -- --run" },
  suggestions_ok: true,
  ...over,
});

describe("agent approval HTTP API", () => {
  it("needs the session token on every route", async () => {
    const c = await core();
    const routes: [string, string][] = [
      ["POST", "/api/agent-approvals"],
      ["GET", "/api/agent-approvals"],
      ["POST", "/api/agent-approvals/apr_x/wait"],
      ["POST", "/api/agent-approvals/apr_x/decision"],
      ["GET", "/api/agent-approvals/history"],
      ["GET", "/api/agent-approvals/rules"],
      ["DELETE", "/api/agent-approvals/rules/arl_x"],
    ];
    for (const [method, path] of routes) {
      const res = await fetch(c.base + path, {
        method,
        headers: { "content-type": "application/json" },
        ...(method === "GET" ? {} : { body: "{}" }),
      });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it("creates (201), lists without the nonce, waits, decides once (409), and records history", async () => {
    const c = await core();
    const created = await c.api("POST", "/api/agent-approvals", body());
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ status: "pending" });
    const { id, nonce, digest } = created.json;

    const listed = await c.api("GET", "/api/agent-approvals");
    expect(listed.status).toBe(200);
    expect(listed.json.approvals).toHaveLength(1);
    expect(listed.json.approvals[0]).toMatchObject({ id, always_ok: true, kind: "permission" });
    expect(JSON.stringify(listed.json)).not.toContain(nonce);

    expect(
      (await c.api("POST", `/api/agent-approvals/${id}/wait`, { nonce: "0".repeat(32) })).status,
    ).toBe(404);
    const waiting = c.api("POST", `/api/agent-approvals/${id}/wait`, { nonce, wait_ms: 25_000 });
    const decision = await c.api(
      "POST",
      `/api/agent-approvals/${id}/decision`,
      { behavior: "allow" },
      { "x-phoenix-client": "web" },
    );
    expect(decision.status).toBe(200);
    expect(decision.json).toEqual({ id, outcome: "allow" });
    expect((await waiting).json).toEqual({
      id,
      digest,
      status: "decided",
      decision: { behavior: "allow" },
      decided_by: "user",
    });
    expect(
      (await c.api("POST", `/api/agent-approvals/${id}/decision`, { behavior: "deny" })).status,
    ).toBe(409);

    const history = await c.api("GET", "/api/agent-approvals/history?limit=5");
    expect(history.json.history[0]).toMatchObject({
      id,
      outcome: "allow",
      decided_by: "user",
      client: "web",
      command: "npm test -- --run",
    });
    const audit = (await c.api("GET", "/api/audit")).json.entries;
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "agent_approval.resolved", actor: "user:web" }),
      ]),
    );
  });

  it("Always creates a listed rule, a later request is decided by it, and DELETE accepts an empty {} body", async () => {
    const c = await core();
    const created = await c.api("POST", "/api/agent-approvals", body());
    const decided = await c.api("POST", `/api/agent-approvals/${created.json.id}/decision`, {
      behavior: "allow",
      always: { ttl_minutes: 60, pattern: "npm test *" },
    });
    expect(decided.json.rule).toMatchObject({ pattern: "npm test *", project: "/work/phoenix" });
    const rules = await c.api("GET", "/api/agent-approvals/rules");
    expect(rules.json.rules).toHaveLength(1);
    expect(rules.json.rules[0]).toMatchObject({ tool: "Bash", uses: 0, created_by: "user:owner" });

    const auto = await c.api(
      "POST",
      "/api/agent-approvals",
      body({ input_summary: { command: "npm test x" } }),
    );
    expect(auto.status).toBe(201);
    expect(auto.json).toMatchObject({
      status: "decided",
      decided_by: "rule",
      decision: { behavior: "allow" },
    });
    expect(auto.json).not.toHaveProperty("nonce");

    const revoked = await c.api(
      "DELETE",
      `/api/agent-approvals/rules/${rules.json.rules[0].id}`,
      {},
    );
    expect(revoked.status).toBe(200);
    expect((await c.api("GET", "/api/agent-approvals/rules")).json.rules).toEqual([]);
    expect(
      (await c.api("DELETE", `/api/agent-approvals/rules/${rules.json.rules[0].id}`)).status,
    ).toBe(404);
  });

  it("terminal:true ends the wait as 'terminal'", async () => {
    const c = await core();
    const created = await c.api("POST", "/api/agent-approvals", body());
    await c.api("POST", `/api/agent-approvals/${created.json.id}/decision`, {
      behavior: "deny",
      terminal: true,
    });
    const wait = await c.api("POST", `/api/agent-approvals/${created.json.id}/wait`, {
      nonce: created.json.nonce,
    });
    expect(wait.json).toEqual({
      id: created.json.id,
      digest: created.json.digest,
      status: "terminal",
    });
  });

  it("the engaged kill switch cancels pending requests and new ones come back 'terminal'", async () => {
    const c = await core();
    const created = await c.api("POST", "/api/agent-approvals", body());
    const waiting = c.api("POST", `/api/agent-approvals/${created.json.id}/wait`, {
      nonce: created.json.nonce,
    });
    await c.api("POST", "/api/security/kill-switch", { engaged: true });
    expect((await waiting).json.status).toBe("cancelled");
    expect((await c.api("GET", "/api/agent-approvals")).json.approvals).toEqual([]);
    const next = await c.api("POST", "/api/agent-approvals", body());
    expect(next.json).toMatchObject({ status: "terminal", reason: "kill_switch" });
    await c.api("POST", "/api/security/kill-switch", { engaged: false });
    expect((await c.api("POST", "/api/agent-approvals", body())).json.status).toBe("pending");
  });

  it("returns 400 for malformed bodies and is not a tool-gateway capability", async () => {
    const c = await core();
    expect((await c.api("POST", "/api/agent-approvals", body({ agent: "Bad Agent" }))).status).toBe(
      400,
    );
    expect((await c.api("POST", "/api/agent-approvals", body({ extra: 1 }))).status).toBe(400);
    const capabilities = (await c.api("GET", "/api/capabilities")).json;
    expect(JSON.stringify(capabilities)).not.toContain("agent-approval");
    expect(JSON.stringify(capabilities)).not.toContain("agent_approval");
    expect(c.runtime.toolGateway.tools().filter((t) => /approval/.test(t.name))).toEqual([]);
  });
});
