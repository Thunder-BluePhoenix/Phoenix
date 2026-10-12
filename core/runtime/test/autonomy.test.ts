// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startCore, type TestCore } from "./helpers";

const cores: TestCore[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const core of cores.splice(0).reverse()) await core.runtime.stop();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function core(databasePath?: string): Promise<TestCore> {
  const instance = await startCore({}, databasePath ? { runtime: { databasePath } } : {});
  cores.push(instance);
  return instance;
}

const scope = "/api/autonomy/deploys/local";
const proposed = { level: "propose", max_actions: 4, max_duration_ms: 12_000 };

describe("user-only autonomy settings and stop", () => {
  it("defaults to absent, persists scoped budget and level after Core restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "phoenix-autonomy-"));
    directories.push(directory);
    const databasePath = join(directory, "core.sqlite");
    const first = await core(databasePath);
    expect((await first.api("GET", scope)).json).toEqual({ setting: null });
    const configured = await first.api("POST", scope, proposed);
    expect(configured.status).toBe(200);
    expect(configured.json.setting).toMatchObject({
      capability_id: "deploys",
      environment: "local",
      ...proposed,
      updated_by: "owner",
    });
    expect(configured.json.setting.updated_at).toEqual(expect.any(Number));
    expect((await first.api("GET", scope)).json).toEqual(configured.json);
    expect((await first.api("GET", "/api/autonomy/deploys/production")).json).toEqual({
      setting: null,
    });
    expect((await first.api("GET", "/api/autonomy/other/local")).json).toEqual({ setting: null });
    await first.runtime.stop();
    const second = await core(databasePath);
    expect((await second.api("GET", scope)).json).toEqual(configured.json);
    const audit = (await second.api("GET", "/api/audit")).json.entries;
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actor: "user:owner", action: "autonomy.setting.changed" }),
      ]),
    );
  });

  it("requires session token and rejects forged actors, extra fields, invalid scopes and budgets", async () => {
    const c = await core();
    for (const [method, path, body] of [
      ["GET", scope, undefined],
      ["POST", scope, proposed],
      ["POST", "/api/autonomy/runs/run1/stop", {}],
    ] as const) {
      expect((await c.api(method, path, body, { authorization: "" })).status).toBe(401);
    }
    for (const body of [
      { ...proposed, actor: { kind: "user", id: "attacker", trustedByUser: true } },
      { ...proposed, trustedByUser: true },
      { ...proposed, max_actions: 0 },
      { ...proposed, max_actions: 101 },
      { ...proposed, max_actions: 1.5 },
      { ...proposed, max_duration_ms: 0 },
      { ...proposed, max_duration_ms: 3_600_001 },
      { ...proposed, level: "execute" },
      { level: "propose", max_actions: 4 },
    ])
      expect((await c.api("POST", scope, body)).status).toBe(400);
    expect((await c.api("GET", "/api/autonomy/BAD/local")).status).toBe(400);
    expect((await c.api("POST", "/api/autonomy/deploys/unknown", proposed)).status).toBe(400);
    expect((await c.api("POST", "/api/autonomy/runs/run1/stop", { actor: "owner" })).status).toBe(
      400,
    );
    expect((await c.api("POST", "/api/autonomy/runs/BAD/stop", {})).status).toBe(400);
    expect((await c.api("GET", scope)).json).toEqual({ setting: null });
  });

  it("stops a non-executing run and refuses executable runs despite elevated settings or kill-switch changes", async () => {
    const c = await core();
    const agent = { kind: "agent" as const, id: "test-agent", trustedByUser: false };
    const elevated = { level: "autonomous_workflow", max_actions: 3, max_duration_ms: 10_000 };
    expect((await c.api("POST", scope, elevated)).status).toBe(200);
    expect(c.runtime.autonomy.refusal(["deploys"], "local", "bounded_execute")).toMatch(/sandbox/);
    expect(c.runtime.autonomy.refusal(["deploys"], "local", "supervised_execute")).toMatch(
      /sandbox/,
    );
    expect(c.runtime.autonomy.refusal(["deploys"], "local", "autonomous_workflow")).toMatch(
      /sandbox/,
    );
    expect(() =>
      c.runtime.autonomy.begin(agent, "exec1", ["deploys"], "local", "bounded_execute"),
    ).toThrow(/sandbox/);
    c.runtime.autonomy.begin(agent, "read1", ["deploys"], "local", "propose");
    const stopped = await c.api("POST", "/api/autonomy/runs/read1/stop", {});
    expect(stopped).toMatchObject({ status: 200, json: { stopped: true } });
    expect(
      c.runtime.autonomy.check({
        actor: agent,
        tool: "deploys.logs",
        capabilityId: "deploys",
        command: "logs",
        sideEffect: "read",
        permissions: [],
        environment: "local",
        at: new Date(),
        autonomy: { runId: "read1", level: "propose" },
      }),
    ).toMatch(/stopped/);
    expect((await c.api("POST", "/api/security/kill-switch", { engaged: true })).status).toBe(200);
    expect(c.runtime.autonomy.refusal(["deploys"], "local", "propose")).toMatch(/Emergency stop/);
    expect(() => c.runtime.autonomy.begin(agent, "read2", ["deploys"], "local", "propose")).toThrow(
      /Emergency stop/,
    );
    expect((await c.api("GET", scope)).json.setting).toMatchObject(elevated);
    const audit = (await c.api("GET", "/api/audit")).json.entries;
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actor: "user:owner", action: "autonomy.run.stopped" }),
      ]),
    );
    expect(
      c.runtime.toolGateway.tools().filter((tool) => tool.name.startsWith("autonomy.")),
    ).toEqual([]);
    for (const tool of ["autonomy.configure", "autonomy.begin", "autonomy.stop"]) {
      await expect(
        c.runtime.toolGateway.call({
          actor: agent,
          tool,
          input: { runId: "read1" },
          environment: "local",
        }),
      ).rejects.toThrow();
    }
    expect(
      (
        await c.api("POST", "/api/capabilities/autonomy/commands/begin", {
          input: { runId: "exec2" },
        })
      ).status,
    ).toBeGreaterThanOrEqual(400);
    expect((await c.api("POST", "/api/autonomy/runs/read2/start", {})).status).toBe(404);
  });
});
