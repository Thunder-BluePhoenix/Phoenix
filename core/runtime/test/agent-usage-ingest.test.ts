// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 78 ingest: what agents report is stored as per-day increments with strict validation,
// clamps against forged numbers, and a cost that is NULL (never zero) unless the agent reported
// one or the user entered a price. All simulated: no agent, provider or bill was involved.
import { PhoenixError } from "@phoenix/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { BASELINES_KEY, PRICES_KEY } from "../src/agent-usage";
import { LIMITS } from "../src/agent-usage";
import { closeRigs, DAY, T0, usageRig } from "./agent-usage-rig";

afterEach(closeRigs);

const body = (over: Record<string, unknown> = {}) => ({
  agent: "claude-code",
  session_id: "s1",
  model: "m-1",
  project: "/work/alpha",
  input_tokens: 1_000,
  output_tokens: 500,
  ...over,
});

describe("cost is null unless known; never zero", () => {
  it("stores NULL cost for a model without a user price, even with tokens", () => {
    const r = usageRig();
    r.report(body());
    const [row] = r.usage.store.range("2026-10-20", "2026-10-20");
    expect(row).toMatchObject({ input_tokens: 1_000, output_tokens: 500, cost_micro: null });
  });

  it("computes cost only from the user's own price (USD per million tokens)", () => {
    const r = usageRig();
    r.usage.setConfig({ prices: { "m-1": { input_per_mtok: 3, output_per_mtok: 15 } } });
    r.report(body({ input_tokens: 1_000_000, output_tokens: 100_000 }));
    // 1M * 3 + 0.1M * 15 = 4.5 USD = 4_500_000 micro dollars
    expect(r.usage.store.range("2026-10-20", "2026-10-20")[0]?.cost_micro).toBe(4_500_000);
  });

  it("a user price of 0 is a real zero; a missing price is not", () => {
    const r = usageRig();
    r.usage.setConfig({ prices: { free: { input_per_mtok: 0, output_per_mtok: 0 } } });
    r.report(body({ model: "free" }));
    r.report(body({ model: "other", session_id: "s2" }));
    const rows = r.usage.store.range("2026-10-20", "2026-10-20");
    expect(rows.find((x) => x.model === "free")?.cost_micro).toBe(0);
    expect(rows.find((x) => x.model === "other")?.cost_micro).toBeNull();
  });

  it("falls back to an AI-settings price only when exactly one price exists for the model", () => {
    const r = usageRig();
    r.aiPrices.value = {
      "prov-a:m-1": { input_per_mtok: 1, output_per_mtok: 2 },
      "prov-b:m-1": { input_per_mtok: 5, output_per_mtok: 9 },
      "prov-a:m-2": { input_per_mtok: 1, output_per_mtok: 2 },
    };
    r.report(body({ model: "m-1", input_tokens: 1_000_000, output_tokens: 0 }));
    r.report(body({ model: "m-2", session_id: "s2", input_tokens: 1_000_000, output_tokens: 0 }));
    const rows = r.usage.store.range("2026-10-20", "2026-10-20");
    expect(rows.find((x) => x.model === "m-1")?.cost_micro).toBeNull(); // two different prices: ambiguous
    expect(rows.find((x) => x.model === "m-2")?.cost_micro).toBe(1_000_000);
  });

  it("the agent's own reported cost is kept as reported", () => {
    const r = usageRig();
    r.report({ agent: "claude-code", session_id: "s1", cost_usd: 0.25 });
    expect(r.usage.store.range("2026-10-20", "2026-10-20")[0]).toMatchObject({
      input_tokens: 0,
      output_tokens: 0,
      cost_micro: 250_000,
    });
  });

  it("the board shows null cost (not 0) and says the cost is unknown", async () => {
    const r = usageRig();
    r.report(body());
    const view = await r.usage.mission(undefined);
    expect(view.totals.cost_usd).toBeNull();
    expect(view.unpriced_models).toEqual(["m-1"]);
    expect(view.by_agent[0]?.cost_usd).toBeNull();
  });

  it("a partly unknown cost is flagged as a lower bound", async () => {
    const r = usageRig();
    r.usage.setConfig({ prices: { "m-1": { input_per_mtok: 1, output_per_mtok: 1 } } });
    r.report(body({ input_tokens: 1_000_000, output_tokens: 0 }));
    r.report(body({ session_id: "s2", model: "unpriced" }));
    const view = await r.usage.mission(undefined);
    expect(view.totals.cost_usd).toBe(1);
    expect(view.totals.cost_partial).toBe(true);
  });
});

describe("running totals become per-day increments", () => {
  it("stores the difference between reports, not the running total twice", () => {
    const r = usageRig();
    r.report(body({ input_tokens: 100, output_tokens: 10 }));
    r.report(body({ input_tokens: 250, output_tokens: 30 }));
    expect(r.usage.store.sessionTotals("claude-code", "s1")).toMatchObject({
      input_tokens: 250,
      output_tokens: 30,
    });
  });

  it("a total that goes down is a reset and counts from zero", () => {
    const r = usageRig();
    r.report(body({ input_tokens: 500, output_tokens: 0 }));
    r.report(body({ input_tokens: 40, output_tokens: 0 }));
    expect(r.usage.store.sessionTotals("claude-code", "s1").input_tokens).toBe(540);
  });

  it("splits a session across days by Core's clock, never the sender's", () => {
    const r = usageRig();
    r.report(body({ input_tokens: 100, output_tokens: 0 }));
    r.clock.now = T0 + DAY;
    r.report(body({ input_tokens: 160, output_tokens: 0 }));
    expect(
      r.usage.store.range("2026-10-20", "2026-10-21").map((x) => [x.day, x.input_tokens]),
    ).toEqual([
      ["2026-10-20", 100],
      ["2026-10-21", 60],
    ]);
  });

  it("rebuilds its baseline from what is stored after a restart", () => {
    const first = usageRig();
    first.report(body({ input_tokens: 100, output_tokens: 0 }));
    const second = usageRig(first.db);
    second.report(body({ input_tokens: 130, output_tokens: 0 }));
    expect(second.usage.store.sessionTotals("claude-code", "s1").input_tokens).toBe(130);
  });
});

describe("clamps against forged numbers", () => {
  it("one report adds at most the per-report limit", () => {
    const r = usageRig();
    r.report(body({ input_tokens: 900_000_000_000, output_tokens: 0 }));
    expect(r.usage.store.sessionTotals("claude-code", "s1").input_tokens).toBe(LIMITS.reportTokens);
  });

  it("one session cannot exceed its per-day cap however often it reports", () => {
    const r = usageRig();
    for (let i = 1; i <= 40; i++)
      r.report(body({ input_tokens: i * LIMITS.reportTokens, output_tokens: 0 }));
    expect(r.usage.store.sessionTotals("claude-code", "s1").input_tokens).toBe(
      LIMITS.sessionDayTokens,
    );
  });

  it("all sessions together cannot exceed the daily cap (several agents, so no agent cap is hit first)", () => {
    const r = usageRig();
    for (let s = 0; s < 20; s++)
      for (let i = 1; i <= 10; i++)
        r.report(
          body({
            agent: `agent-${s % 5}`,
            session_id: `s${s}`,
            input_tokens: i * LIMITS.reportTokens,
            output_tokens: 0,
          }),
        );
    expect(r.usage.store.dayTotals("2026-10-20").input_tokens).toBe(LIMITS.dayTokens);
  });

  it("one agent's sessions together cannot exceed that agent's daily cap, and the others still can report", () => {
    const r = usageRig();
    for (let s = 0; s < 8; s++)
      for (let i = 1; i <= 10; i++)
        r.report(
          body({ session_id: `s${s}`, input_tokens: i * LIMITS.reportTokens, output_tokens: 0 }),
        );
    expect(r.usage.store.dayTotals("2026-10-20", "claude-code").input_tokens).toBe(
      LIMITS.agentDayTokens,
    );
    r.report(body({ agent: "codex", session_id: "other", input_tokens: 1_000, output_tokens: 0 }));
    expect(r.usage.store.dayTotals("2026-10-20", "codex").input_tokens).toBe(1_000);
  });

  it("a cut report does not move the baseline past what was stored: the rest counts once there is room", () => {
    const r = usageRig();
    // Only 30M of room under the per-report limit... the agent claims 90M in one go.
    r.report(body({ input_tokens: 90_000_000, output_tokens: 0 }));
    expect(r.usage.store.sessionTotals("claude-code", "s1").input_tokens).toBe(LIMITS.reportTokens);
    // The same total again: the 40M that was cut is still pending and is counted now.
    r.report(body({ input_tokens: 90_000_000, output_tokens: 0 }));
    expect(r.usage.store.sessionTotals("claude-code", "s1").input_tokens).toBe(90_000_000);
  });

  it("says how many reports a limit cut or refused today", async () => {
    const r = usageRig();
    r.report(body({ input_tokens: 900_000_000_000, output_tokens: 0 }));
    for (let i = 0; i < LIMITS.modelsPerSessionDay; i++)
      r.report(body({ session_id: "m", model: `m-${i}`, input_tokens: 1_000 * (i + 1) }));
    expect(() => r.report(body({ session_id: "m", model: "m-extra" }))).toThrow(PhoenixError);
    const { ingest } = await r.usage.mission(undefined);
    expect(ingest).toEqual({
      day: "2026-10-20",
      clamped: 1,
      refused: 1,
      by_agent: [{ agent: "claude-code", clamped: 1, refused: 1 }],
    });
    r.clock.now = T0 + DAY;
    expect((await r.usage.mission(undefined)).ingest).toMatchObject({ clamped: 0, refused: 0 });
  });

  it("a forged huge cost is cut to the per-report limit", () => {
    const r = usageRig();
    r.report({ agent: "claude-code", session_id: "s1", cost_usd: 99_999 });
    expect(r.usage.store.range("2026-10-20", "2026-10-20")[0]?.cost_micro).toBe(
      LIMITS.reportCostMicro,
    );
  });

  it("refuses numbers past the validation caps, negatives, fractions and strings", () => {
    const r = usageRig();
    for (const bad of [
      { input_tokens: 1e13 },
      { input_tokens: -1 },
      { input_tokens: 1.5 },
      { input_tokens: "5" },
      { input_tokens: Number.NaN },
      { output_tokens: Number.POSITIVE_INFINITY },
      { cost_usd: -0.01 },
      { cost_usd: 1e9 },
      { cost_usd: "1" },
      { extra: 1 },
      { agent: "Not Valid!" },
      { session_id: "bad id with spaces" },
      { model: "bad model\n" },
    ])
      expect(() => r.report(body(bad))).toThrow(PhoenixError);
    expect(() => r.report({ agent: "claude-code", session_id: "s1" })).toThrow(PhoenixError);
    expect(r.usage.store.count()).toBe(0);
  });

  it("bounds how many sessions, agents and models one day can hold", () => {
    const r = usageRig();
    for (let i = 0; i < LIMITS.sessionsPerDay; i++) r.report(body({ session_id: `s${i}` }));
    expect(() => r.report(body({ session_id: "one-too-many" }))).toThrow(PhoenixError);
    expect(() => r.report(body({ session_id: "s0", input_tokens: 2_000 }))).not.toThrow();

    const a = usageRig();
    for (let i = 0; i < LIMITS.agentsPerDay; i++) a.report(body({ agent: `agent-${i}` }));
    expect(() => a.report(body({ agent: "agent-extra" }))).toThrow(PhoenixError);

    const m = usageRig();
    for (let i = 0; i < LIMITS.modelsPerSessionDay; i++)
      m.report(body({ model: `m-${i}`, input_tokens: 1_000 * (i + 1) }));
    expect(() => m.report(body({ model: "m-extra", input_tokens: 99_000 }))).toThrow(PhoenixError);
  });

  it("stores a folder name, never the path the agent sent", () => {
    const r = usageRig();
    r.report(body({ project: "/Users/someone/secret-client/alpha" }));
    const [row] = r.usage.store.range("2026-10-20", "2026-10-20");
    expect(row?.project).toBe("alpha");
    expect(JSON.stringify(row)).not.toContain("someone");
  });

  it("prices from settings that are damaged are ignored, not treated as zero", () => {
    const r = usageRig();
    r.settings.set(PRICES_KEY, { "m-1": { input_per_mtok: "free", output_per_mtok: -4 } });
    r.report(body());
    expect(r.usage.store.range("2026-10-20", "2026-10-20")[0]?.cost_micro).toBeNull();
  });
});

describe("kill switch and delete-all", () => {
  it("the kill switch refuses new reports but never hides stored numbers", async () => {
    const r = usageRig();
    r.report(body());
    r.killSwitch.engaged = true;
    expect(() => r.report(body({ input_tokens: 5_000 }))).toThrow(/Emergency stop/);
    expect((await r.usage.mission(undefined)).totals.input_tokens).toBe(1_000);
    r.killSwitch.engaged = false;
    r.report(body({ input_tokens: 5_000 }));
    expect((await r.usage.mission(undefined)).totals.input_tokens).toBe(5_000);
  });

  it("delete-all removes every row, reports the count and audits it", () => {
    const r = usageRig();
    r.report(body());
    r.report(body({ session_id: "s2" }));
    expect(r.usage.deleteAll()).toEqual({ deleted: 2 });
    expect(r.usage.store.count()).toBe(0);
    const audit = r.db
      .prepare("SELECT action, details FROM audit_log WHERE action = 'agent_usage.delete'")
      .all() as { action: string; details: string }[];
    expect(audit).toHaveLength(1);
  });

  it("after delete-all, a live session's earlier total is not counted again", () => {
    const r = usageRig();
    r.report(body({ input_tokens: 1_000_000, output_tokens: 0 }));
    r.usage.deleteAll();
    r.report(body({ input_tokens: 1_000_500, output_tokens: 0 }));
    expect(r.usage.store.sessionTotals("claude-code", "s1").input_tokens).toBe(500);
  });

  it("the delete survives a Core restart: a repeated running total is not counted again", () => {
    const first = usageRig();
    first.report(body({ input_tokens: 1_000_000, output_tokens: 0 }));
    first.usage.deleteAll();
    // A new runtime on the same database has no in-memory baseline, only what was persisted.
    const second = usageRig(first.db);
    second.report(body({ input_tokens: 1_000_500, output_tokens: 0 }));
    expect(second.usage.store.sessionTotals("claude-code", "s1").input_tokens).toBe(500);
    // And a cost-only session behaves the same.
    first.report({ agent: "claude-code", session_id: "c1", cost_usd: 2 });
    first.usage.deleteAll();
    const third = usageRig(first.db);
    third.report({ agent: "claude-code", session_id: "c1", cost_usd: 2.5 });
    expect(third.usage.store.sessionTotals("claude-code", "c1").cost_micro).toBe(500_000);
  });

  it("two delete-alls in a row keep the marks of both", () => {
    const first = usageRig();
    first.report(body({ session_id: "a", input_tokens: 100, output_tokens: 0 }));
    first.usage.deleteAll();
    first.report(body({ session_id: "b", input_tokens: 200, output_tokens: 0 }));
    first.usage.deleteAll();
    const second = usageRig(first.db);
    second.report(body({ session_id: "a", input_tokens: 110, output_tokens: 0 }));
    second.report(body({ session_id: "b", input_tokens: 230, output_tokens: 0 }));
    expect(second.usage.store.sessionTotals("claude-code", "a").input_tokens).toBe(10);
    expect(second.usage.store.sessionTotals("claude-code", "b").input_tokens).toBe(30);
  });

  it("delete-all keeps no session name in the marks", () => {
    const r = usageRig();
    r.report(body({ session_id: "secret-client-session" }));
    r.usage.deleteAll();
    expect(JSON.stringify(r.settings.get(BASELINES_KEY, {}))).not.toContain("secret-client");
  });
});
