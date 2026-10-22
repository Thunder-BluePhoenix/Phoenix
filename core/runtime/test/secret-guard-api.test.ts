// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 79 secret guard, Core side, through the real HTTP API of a real Core (in-memory database).
// Secrets are built at runtime. The override tests use the real Phase 56 approval path: a card is
// created and decided over the same routes the hook and the web UI use.
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  FAKE_AWS_KEY,
  FAKE_BEARER,
  FAKE_GITHUB_TOKEN,
} from "../../../protocol/testing/fake-secrets";
import { startCore, type TestCore } from "./helpers";

const cores: TestCore[] = [];
afterEach(async () => {
  for (const core of cores.splice(0).reverse()) await core.runtime.stop();
});
async function core(): Promise<TestCore> {
  const c = await startCore();
  cores.push(c);
  return c;
}

const hashOf = (text: string) => createHash("sha256").update(text).digest("hex");
const HASH = hashOf("scanned content one");
const OTHER = hashOf("scanned content two");

const result = (over: Record<string, unknown> = {}) => ({
  outcome: "blocked",
  agent: "claude-code",
  session_id: "5f1c1b0e-6a0e-4f43-8d7d-0a6a3f4b2c11",
  tool: "Bash",
  findings: [{ kind: "github_token", location: "tool_input.command" }],
  content_hash: HASH,
  scope: null,
  ...over,
});

/** The approval card the hook creates, decided by the owner. */
async function approveCard(c: TestCore, hash: string, behavior: "allow" | "deny" = "allow") {
  const created = await c.api("POST", "/api/agent-approvals", {
    kind: "permission",
    agent: "claude-code",
    session_id: "5f1c1b0e-6a0e-4f43-8d7d-0a6a3f4b2c11",
    project: "/work/app",
    tool: "SecretGuard",
    input_summary: {
      description: "Secret guard found: github_token at tool_input.command.",
      detail: JSON.stringify({
        blocked_tool: "Bash",
        content_hash: hash,
        session_id: "5f1c1b0e-6a0e-4f43-8d7d-0a6a3f4b2c11",
      }),
    },
  });
  expect(created.status).toBe(201);
  const decided = await c.api(
    "POST",
    `/api/agent-approvals/${created.json.id}/decision`,
    { behavior },
    { "x-phoenix-client": "test" },
  );
  expect(decided.status).toBe(200);
}

const audit = async (c: TestCore) =>
  (await c.api("GET", "/api/audit?limit=200")).json.entries as {
    action: string;
    details: Record<string, unknown>;
  }[];

describe("POST /api/secret-guard/result", () => {
  it("needs the session token", async () => {
    const c = await core();
    const res = await fetch(`${c.base}/api/secret-guard/result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(result()),
    });
    expect(res.status).toBe(401);
  });

  it("records a block in the audit log with kinds and places only", async () => {
    const c = await core();
    const res = await c.api("POST", "/api/secret-guard/result", result());
    expect(res.status).toBe(200);
    const row = (await audit(c)).find((e) => e.action === "secret_guard.blocked")!;
    expect(row.details).toMatchObject({
      agent: "claude-code",
      tool: "Bash",
      findings: [{ kind: "github_token", location: "tool_input.command" }],
      content_hash: HASH,
    });
    const status = (await c.api("GET", "/api/secret-guard")).json;
    expect(status).toMatchObject({ blocked: 1, overridden: 0, allowed: 0 });
    expect(status.recent[0]).toMatchObject({ outcome: "blocked", tool: "Bash" });
  });

  it.each([
    ["the tool name", { tool: `curl ${FAKE_GITHUB_TOKEN}` }],
    ["a location", { findings: [{ kind: "api_key", location: `file ${FAKE_AWS_KEY}` }] }],
    ["an unknown extra field", { note: FAKE_BEARER }],
    ["the scope", { scope: FAKE_GITHUB_TOKEN }],
    ["a key named like a secret", { password: "anything-goes-here-12345" }],
  ])("refuses a payload with a secret in %s and keeps nothing of it", async (_n, patch) => {
    const c = await core();
    const res = await c.api("POST", "/api/secret-guard/result", result(patch));
    expect([400, 403]).toContain(res.status);
    const everything = JSON.stringify(res.json) + JSON.stringify(await audit(c));
    for (const secret of [FAKE_GITHUB_TOKEN, FAKE_AWS_KEY, FAKE_BEARER])
      expect(everything).not.toContain(secret);
    expect((await audit(c)).some((e) => e.action.startsWith("secret_guard."))).toBe(false);
  });

  it("a secret-looking assignment hidden in a free text field is refused too", async () => {
    const c = await core();
    const assigned = `${["API", "_KEY"].join("")}=${["Zk3", "pQ9vL2", "mX7wR5", "tY8nB4"].join("")}`;
    const res = await c.api("POST", "/api/secret-guard/result", result({ tool: assigned }));
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.json)).not.toContain("Zk3pQ9vL2");
  });

  it.each([
    ["an unknown outcome", { outcome: "maybe" }],
    ["an unknown kind", { findings: [{ kind: "whatever", location: "x" }] }],
    ["a block without findings", { findings: [] }],
    ["a bad hash", { content_hash: "abc" }],
    ["a bad agent", { agent: "Not Valid" }],
    ["an allowed result with findings", { outcome: "allowed" }],
  ])("rejects %s", async (_n, patch) => {
    const c = await core();
    expect((await c.api("POST", "/api/secret-guard/result", result(patch))).status).toBe(400);
  });
});

describe("an override needs the owner's approval of THAT content", () => {
  const overridden = (hash = HASH) => result({ outcome: "overridden", content_hash: hash });

  it("is refused when no card was ever approved", async () => {
    const c = await core();
    const res = await c.api("POST", "/api/secret-guard/result", overridden());
    expect(res.status).toBe(403);
    expect((await audit(c)).some((e) => e.action === "secret_guard.overridden")).toBe(false);
  });

  it("is recorded after the owner allowed a card carrying that hash", async () => {
    const c = await core();
    await approveCard(c, HASH);
    expect((await c.api("POST", "/api/secret-guard/result", overridden())).status).toBe(200);
    expect((await c.api("GET", "/api/secret-guard")).json).toMatchObject({ overridden: 1 });
  });

  it("an approval of other content does not cover it", async () => {
    const c = await core();
    await approveCard(c, OTHER);
    expect((await c.api("POST", "/api/secret-guard/result", overridden())).status).toBe(403);
  });

  it("a DENIED card does not cover it", async () => {
    const c = await core();
    await approveCard(c, HASH, "deny");
    expect((await c.api("POST", "/api/secret-guard/result", overridden())).status).toBe(403);
  });

  it("a card of another agent does not cover it", async () => {
    const c = await core();
    await approveCard(c, HASH);
    const res = await c.api("POST", "/api/secret-guard/result", {
      ...overridden(),
      agent: "codex",
    });
    expect(res.status).toBe(403);
  });
});
