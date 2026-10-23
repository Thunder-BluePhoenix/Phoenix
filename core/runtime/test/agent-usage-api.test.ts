// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 78 through a real Core over loopback HTTP: the generic token/cost report on the existing
// usage route, GET /api/mission, budgets in settings, the privacy inventory row and delete-all
// kind, and the kill switch. Simulated: no agent, provider or bill is involved.
import { afterEach, describe, expect, it } from "vitest";
import { startCore, type TestCore } from "./helpers";

let core: TestCore | undefined;
afterEach(async () => {
  await core?.runtime.stop();
  core = undefined;
});

const report = (over: Record<string, unknown> = {}) => ({
  agent: "claude-code",
  session_id: "s1",
  model: "m-1",
  project: "/work/alpha",
  input_tokens: 1_000,
  output_tokens: 200,
  ...over,
});

describe("POST /api/agent/live/usage with a token report", () => {
  it("is stored and shown by GET /api/mission, with cost null for an unpriced model", async () => {
    core = await startCore();
    const res = await core.api("POST", "/api/agent/live/usage", report());
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ accepted: 1 });
    const mission = (await core.api("GET", "/api/mission")).json;
    expect(mission.totals).toMatchObject({
      input_tokens: 1_000,
      output_tokens: 200,
      cost_usd: null,
    });
    expect(mission.unpriced_models).toEqual(["m-1"]);
    expect(mission.by_project[0].project).toBe("alpha");
  });

  it("still accepts the plan-window shape on the same route", async () => {
    core = await startCore();
    const resets = new Date(Date.now() + 3_600_000).toISOString();
    const res = await core.api("POST", "/api/agent/live/usage", {
      agent: "claude-code",
      window: "5h",
      used_pct: 10,
      resets_at: resets,
    });
    expect(res.status).toBe(200);
    expect((await core.api("GET", "/api/mission")).json.totals.input_tokens).toBe(0);
  });

  it("answers 400 with the problems for forged or malformed numbers, and stores nothing", async () => {
    core = await startCore();
    for (const bad of [
      report({ input_tokens: -5 }),
      report({ input_tokens: 1e15 }),
      report({ cost_usd: "free" }),
      report({ session_id: "x y" }),
      report({ unexpected: true }),
    ]) {
      const res = await core.api("POST", "/api/agent/live/usage", bad);
      expect(res.status).toBe(400);
    }
    expect((await core.api("GET", "/api/mission")).json.totals.input_tokens).toBe(0);
  });

  it("the kill switch refuses new reports (403) and the stored numbers stay readable", async () => {
    core = await startCore();
    await core.api("POST", "/api/agent/live/usage", report());
    await core.api("POST", "/api/security/kill-switch", { engaged: true });
    const res = await core.api("POST", "/api/agent/live/usage", report({ input_tokens: 9_000 }));
    expect(res.status).toBe(403);
    expect((await core.api("GET", "/api/mission")).json.totals.input_tokens).toBe(1_000);
  });
});

describe("configuration, privacy and delete", () => {
  it("saves budgets and prices, and rejects unknown query parameters", async () => {
    core = await startCore();
    const saved = await core.api("POST", "/api/mission/config", {
      budgets: [{ id: "day", scope: "daily", metric: "tokens", limit: 5_000 }],
      prices: { "m-1": { input_per_mtok: 3, output_per_mtok: 15 } },
    });
    expect(saved.status).toBe(200);
    expect(saved.json).toMatchObject({ stuck_after_min: 30, thresholds: [80, 95] });
    await core.api(
      "POST",
      "/api/agent/live/usage",
      report({ input_tokens: 1_000_000, output_tokens: 0 }),
    );
    const mission = (await core.api("GET", "/api/mission")).json;
    expect(mission.totals.cost_usd).toBe(3);
    expect(mission.budgets[0]).toMatchObject({ id: "day", used: 1_000_000 });
    expect((await core.api("GET", "/api/mission?bogus=1")).status).toBe(400);
    expect((await core.api("POST", "/api/mission/config", { budgets: "x" })).status).toBe(400);
  });

  it("keep_days: saved by POST /api/mission/config, 400 for a bad value and nothing stored", async () => {
    core = await startCore();
    expect((await core.api("GET", "/api/mission/config")).json.keep_days).toBe(400);
    for (const bad of [6, 3_651, 30.5, "30", null])
      expect((await core.api("POST", "/api/mission/config", { keep_days: bad })).status).toBe(400);
    expect((await core.api("GET", "/api/mission/config")).json.keep_days).toBe(400);
    const saved = await core.api("POST", "/api/mission/config", { keep_days: 90 });
    expect(saved.status).toBe(200);
    expect(saved.json.keep_days).toBe(90);
    expect((await core.api("GET", "/api/mission/config")).json.keep_days).toBe(90);
  });

  it("lists agent_usage in the privacy inventory and deletes it only with confirmation", async () => {
    core = await startCore();
    await core.api("POST", "/api/agent/live/usage", report());
    const inventory = (await core.api("GET", "/api/privacy")).json;
    expect(inventory.derived.find((d: { id: string }) => d.id === "agent_usage")).toMatchObject({
      count: 1,
    });
    expect((await core.api("DELETE", "/api/mission/usage")).status).toBe(409);
    expect((await core.api("POST", "/api/privacy/delete", { data: "agent_usage" })).status).toBe(
      409,
    );
    const gone = await core.api("POST", "/api/privacy/delete", {
      data: "agent_usage",
      confirm: true,
    });
    expect(gone.json).toEqual({ deleted: 1 });
    expect((await core.api("GET", "/api/mission")).json.totals).toMatchObject({
      input_tokens: 0,
      cost_usd: null,
    });
    const after = (await core.api("GET", "/api/privacy")).json;
    expect(after.derived.find((d: { id: string }) => d.id === "agent_usage").count).toBe(0);
  });

  it("DELETE /api/mission/usage?confirm=true deletes the same data", async () => {
    core = await startCore();
    await core.api("POST", "/api/agent/live/usage", report());
    expect((await core.api("DELETE", "/api/mission/usage?confirm=true")).json).toEqual({
      deleted: 1,
    });
  });
});
