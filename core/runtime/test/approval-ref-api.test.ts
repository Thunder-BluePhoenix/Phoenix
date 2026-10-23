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

const agentBody = (command = "git push origin main") => ({
  kind: "permission",
  agent: "test-agent",
  session_id: "test-session",
  project: "/work/phoenix",
  tool: "Bash",
  input_summary: { command },
  suggestions_ok: true,
});

const cli = { "x-phoenix-client": "phoenix-cli" };

describe("server-bound CLI approval references", () => {
  it("issues a full opaque reference and accepts a CLI confirmation only when it quotes it", async () => {
    const c = await core();
    const waiting = c.runtime.permissions.authorize({
      capabilityId: "approval-ref",
      command: "deploy",
      permissions: [],
      sideEffect: "write",
      summary: "Deploy the reviewed build",
    });
    const listed = await c.api("GET", "/api/confirmations");
    const [pending] = listed.json.confirmations as { id: string; ref: string }[];
    expect(pending!.ref).toMatch(/^[0-9a-f]{64}$/);

    const missing = await c.api(
      "POST",
      `/api/confirmations/${pending!.id}`,
      { approve: true },
      cli,
    );
    expect(missing.status).toBe(409);
    expect(missing.json).toMatchObject({ code: "EVENT_DUPLICATE" });
    expect(c.runtime.permissions.pendingConfirmations()).toHaveLength(1);

    const accepted = await c.api(
      "POST",
      `/api/confirmations/${pending!.id}`,
      { approve: true, ref: pending!.ref },
      cli,
    );
    expect(accepted.status).toBe(200);
    await expect(waiting).resolves.toMatchObject({ confirmationId: pending!.id });
  });

  it("rejects a stale or cross-source confirmation reference without deciding anything", async () => {
    const c = await core();
    const first = c.runtime.permissions.authorize({
      capabilityId: "approval-ref",
      command: "first",
      permissions: [],
      sideEffect: "write",
      summary: "First request",
    });
    const second = c.runtime.permissions.authorize({
      capabilityId: "approval-ref",
      command: "second",
      permissions: [],
      sideEffect: "write",
      summary: "Second request",
    });
    // Attach handlers before resolving: these rejections are intentional test outcomes.
    const firstResult = first.then(
      () => "approved" as const,
      (error: unknown) => error,
    );
    const secondResult = second.then(
      () => "approved" as const,
      (error: unknown) => error,
    );
    const listed = (await c.api("GET", "/api/confirmations")).json.confirmations as {
      id: string;
      ref: string;
    }[];
    const [one, two] = listed;
    const refused = await c.api(
      "POST",
      `/api/confirmations/${one!.id}`,
      { approve: true, ref: two!.ref },
      cli,
    );
    expect(refused.status).toBe(409);
    expect(c.runtime.permissions.pendingConfirmations()).toHaveLength(2);

    // Non-CLI clients retain the existing generic approval path; only the CLI's stale-list guard
    // is server-bound by this change.
    expect((await c.api("POST", `/api/confirmations/${one!.id}`, { approve: false })).status).toBe(
      200,
    );
    expect((await c.api("POST", `/api/confirmations/${two!.id}`, { approve: false })).status).toBe(
      200,
    );
    await expect(firstResult).resolves.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(secondResult).resolves.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("binds CLI agent decisions to the full pending view and passes the ref to no agent code", async () => {
    const c = await core();
    const created = await c.api("POST", "/api/agent-approvals", agentBody());
    const [pending] = (await c.api("GET", "/api/agent-approvals")).json.approvals as {
      id: string;
      ref: string;
    }[];
    expect(pending).toMatchObject({ id: created.json.id });
    expect(pending!.ref).toMatch(/^[0-9a-f]{64}$/);

    const bad = await c.api(
      "POST",
      `/api/agent-approvals/${pending!.id}/decision`,
      { behavior: "allow", ref: "0".repeat(64) },
      cli,
    );
    expect(bad.status).toBe(409);
    expect((await c.api("GET", "/api/agent-approvals")).json.approvals).toHaveLength(1);

    const accepted = await c.api(
      "POST",
      `/api/agent-approvals/${pending!.id}/decision`,
      { behavior: "allow", ref: pending!.ref },
      cli,
    );
    expect(accepted.status).toBe(200);
    expect(accepted.json).toEqual({ id: pending!.id, outcome: "allow" });
  });

  it("rejects a reference copied from another agent request", async () => {
    const c = await core();
    await c.api("POST", "/api/agent-approvals", agentBody("git status"));
    await c.api("POST", "/api/agent-approvals", agentBody("git push"));
    const pending = (await c.api("GET", "/api/agent-approvals")).json.approvals as {
      id: string;
      ref: string;
    }[];
    const rejected = await c.api(
      "POST",
      `/api/agent-approvals/${pending[0]!.id}/decision`,
      { behavior: "deny", ref: pending[1]!.ref },
      cli,
    );
    expect(rejected.status).toBe(409);
    expect((await c.api("GET", "/api/agent-approvals")).json.approvals).toHaveLength(2);
  });
});
