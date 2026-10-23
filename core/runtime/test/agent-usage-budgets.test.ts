// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 78 budgets: the alert comes BEFORE the limit, once per budget per day, again the next day;
// it uses the existing `agent.usage.warning` event and thresholds. Simulated: no real spend.
import { createEvent, PhoenixError } from "@phoenix/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { THRESHOLDS_KEY } from "../src/agent-live";
import { closeRigs, DAY, drain, usageRig, type UsageRig } from "./agent-usage-rig";

afterEach(closeRigs);

const warnings = (r: UsageRig) => r.events.filter((e) => e.event_type === "agent.usage.warning");
const report = (r: UsageRig, tokens: number, session = "s1") =>
  r.report({
    agent: "claude-code",
    session_id: session,
    model: "m",
    input_tokens: tokens,
    output_tokens: 0,
  });

describe("daily token budget", () => {
  it("warns at 80% (before the limit), then at 95%, each once; never again at the same level", async () => {
    const r = usageRig();
    r.usage.setConfig({ budgets: [{ id: "day", scope: "daily", metric: "tokens", limit: 1_000 }] });
    report(r, 700);
    report(r, 810); // 81%
    report(r, 830);
    report(r, 900); // 90%: still only the 80 mark
    report(r, 960); // 96%
    report(r, 990);
    await drain(r);
    const w = warnings(r);
    expect(w.map((e) => [e.payload.threshold, e.severity])).toEqual([
      [80, "warning"],
      [95, "error"],
    ]);
    expect(w[0]?.payload).toMatchObject({ budget_id: "day", scope: "daily", metric: "tokens" });
    // Fired before the limit was reached: 81% < 100%.
    expect(w[0]?.payload.used_pct).toBeLessThan(100);
  });

  it("fires again the next day for the same budget", async () => {
    const r = usageRig();
    r.usage.setConfig({ budgets: [{ id: "day", scope: "daily", metric: "tokens", limit: 1_000 }] });
    report(r, 850);
    await drain(r);
    expect(warnings(r)).toHaveLength(1);
    r.clock.now += DAY;
    report(r, 1_700); // +850 today
    await drain(r);
    expect(warnings(r)).toHaveLength(2);
    // And still once per day.
    report(r, 1_750);
    await drain(r);
    expect(warnings(r)).toHaveLength(2);
  });

  it("does not repeat after a Core restart (the markers are persisted)", async () => {
    const first = usageRig();
    first.usage.setConfig({
      budgets: [{ id: "day", scope: "daily", metric: "tokens", limit: 1_000 }],
    });
    report(first, 850);
    const second = usageRig(first.db);
    report(second, 900);
    await drain(second);
    expect(warnings(second)).toEqual([]);
  });

  it("uses the thresholds the user set for plan usage", async () => {
    const r = usageRig();
    r.settings.set(THRESHOLDS_KEY, [50]);
    r.usage.setConfig({ budgets: [{ id: "day", scope: "daily", metric: "tokens", limit: 1_000 }] });
    report(r, 520);
    await drain(r);
    expect(warnings(r).map((e) => e.payload.threshold)).toEqual([50]);
  });

  it("an agent-scoped budget ignores other agents", async () => {
    const r = usageRig();
    r.usage.setConfig({
      budgets: [{ id: "cx", scope: "daily", metric: "tokens", limit: 1_000, agent: "codex" }],
    });
    report(r, 990);
    await drain(r);
    expect(warnings(r)).toEqual([]);
    r.report({ agent: "codex", session_id: "c1", model: "m", input_tokens: 900, output_tokens: 0 });
    await drain(r);
    expect(warnings(r)).toHaveLength(1);
  });
});

describe("budget warning reset time", () => {
  const resetOf = async (r: UsageRig) => {
    r.usage.setConfig({ budgets: [{ id: "day", scope: "daily", metric: "tokens", limit: 1_000 }] });
    report(r, 900);
    await drain(r);
    return warnings(r)[0]?.payload.resets_at;
  };

  it("is the next local midnight in the zone the budget day is keyed in", async () => {
    // T0 is 2026-10-20T10:00Z: still the 20th in New York (06:00 EDT), so the day ends 04:00Z on the 21st.
    expect(await resetOf(usageRig(undefined, "America/New_York"))).toBe("2026-10-21T04:00:00.000Z");
  });

  it("is UTC midnight for a UTC service, and differs for a zone ahead of UTC", async () => {
    expect(await resetOf(usageRig(undefined, "UTC"))).toBe("2026-10-21T00:00:00.000Z");
    // 15:30 IST on the 20th, so the day ends at 18:30Z on the 20th.
    expect(await resetOf(usageRig(undefined, "Asia/Kolkata"))).toBe("2026-10-20T18:30:00.000Z");
  });
});

describe("cost budgets and per-session budgets", () => {
  it("a cost budget never fires on an UNKNOWN cost (null is not zero, and not infinite)", async () => {
    const r = usageRig();
    r.usage.setConfig({ budgets: [{ id: "usd", scope: "daily", metric: "cost", limit: 1 }] });
    report(r, 900_000_000); // no price: cost unknown
    await drain(r);
    expect(warnings(r)).toEqual([]);
    expect((await r.usage.mission(undefined)).budgets[0]).toMatchObject({ used: null, pct: null });
  });

  it("a cost budget fires from a known cost", async () => {
    const r = usageRig();
    r.usage.setConfig({
      budgets: [{ id: "usd", scope: "daily", metric: "cost", limit: 10 }],
      prices: { m: { input_per_mtok: 10, output_per_mtok: 0 } },
    });
    report(r, 900_000); // 9 USD
    await drain(r);
    expect(warnings(r)).toHaveLength(1);
    expect((await r.usage.mission(undefined)).budgets[0]).toMatchObject({ used: 9, pct: 90 });
  });

  it("a per-session budget warns per session, once each per day", async () => {
    const r = usageRig();
    r.usage.setConfig({
      budgets: [{ id: "one", scope: "session", metric: "tokens", limit: 1_000 }],
    });
    report(r, 850, "a");
    report(r, 100, "b"); // under
    report(r, 900, "a");
    report(r, 850, "b2");
    await drain(r);
    expect(warnings(r)).toHaveLength(2);
  });
});

describe("partly priced cost budgets, delete-all and the fired-marker cap", () => {
  it("a cost budget with unpriced usage reports unpriced_rows (so the page says 'at least')", async () => {
    const r = usageRig();
    r.usage.setConfig({
      budgets: [{ id: "usd", scope: "daily", metric: "cost", limit: 10 }],
      prices: { priced: { input_per_mtok: 10, output_per_mtok: 0 } },
    });
    const priced = {
      agent: "claude-code",
      model: "priced",
      input_tokens: 100_000,
      output_tokens: 0,
    };
    r.report({ ...priced, session_id: "s1" });
    r.report({ ...priced, session_id: "s2", model: "unpriced", input_tokens: 500_000 });
    const [budget] = (await r.usage.mission(undefined)).budgets;
    expect(budget).toMatchObject({ used: 1, unpriced_rows: 1 });
    // A token budget never carries the flag.
    r.usage.setConfig({ budgets: [{ id: "tok", scope: "daily", metric: "tokens", limit: 10 }] });
    expect((await r.usage.mission(undefined)).budgets[0]?.unpriced_rows).toBe(0);
  });

  it("delete-all removes the budget warning events but keeps plan-usage warnings", async () => {
    const r = usageRig();
    const warning = (payload: Record<string, unknown>) =>
      createEvent({
        event_type: "agent.usage.warning",
        source: "core",
        severity: "warning",
        payload,
      });
    r.eventStore.append(
      warning({ agent: "all agents", window: "daily tokens budget", budget_id: "d" }),
    );
    r.eventStore.append(warning({ agent: "claude-code", window: "5h", threshold: 80 }));
    r.usage.deleteAll();
    const left = r.eventStore.recent({ type: "agent.usage.warning" });
    expect(left.map((e) => e.event.payload.window)).toEqual(["5h"]);
  });

  it("trims fired markers by day, never dropping today's for an older day's", () => {
    const r = usageRig();
    r.usage.setConfig({ budgets: [{ id: "d", scope: "daily", metric: "tokens", limit: 100 }] });
    const old: Record<string, number[]> = {};
    // More markers than the cap, all from yesterday and inserted AFTER today's would be.
    for (let i = 0; i < 2_100; i++) old[`2026-10-19|b${i}|a:s${i}`] = [80];
    r.settings.set("agents.usage.budget_fired", { "2026-10-20|d": [80], ...old });
    report(r, 96);
    const kept = r.settings.get<Record<string, number[]>>("agents.usage.budget_fired", {});
    expect(Object.keys(kept)).toHaveLength(2_000);
    expect(kept["2026-10-20|d"]).toEqual([80, 95]);
  });
});

describe("budget settings are validated", () => {
  it("refuses bad budgets and prices and writes nothing", () => {
    const r = usageRig();
    for (const bad of [
      { budgets: [{ scope: "weekly", metric: "tokens", limit: 1 }] },
      { budgets: [{ scope: "daily", metric: "tokens", limit: 0 }] },
      { budgets: [{ scope: "daily", metric: "tokens", limit: 1e15 }] },
      { budgets: [{ scope: "daily", metric: "tokens", limit: 5, extra: true }] },
      { budgets: [{ scope: "daily", metric: "tokens", limit: 5, agent: "Bad Agent" }] },
      {
        budgets: [
          { id: "x", scope: "daily", metric: "tokens", limit: 5 },
          { id: "x", scope: "daily", metric: "cost", limit: 5 },
        ],
      },
      { prices: { m: { input_per_mtok: -1, output_per_mtok: 1 } } },
      { prices: { m: { input_per_mtok: 1 } } },
      { prices: { "bad model": { input_per_mtok: 1, output_per_mtok: 1 } } },
      { stuck_after_min: 1 },
      { unknown: 1 },
    ])
      expect(() => r.usage.setConfig(bad)).toThrow(PhoenixError);
    expect(() => r.usage.setConfig([])).toThrow(PhoenixError);
    expect(r.usage.config()).toMatchObject({ budgets: [], prices: {}, stuck_after_min: 30 });
  });

  it("a bad part rejects the whole request: nothing is half-saved", () => {
    const r = usageRig();
    expect(() =>
      r.usage.setConfig({
        budgets: [{ scope: "daily", metric: "tokens", limit: 5 }],
        prices: { m: { input_per_mtok: -1, output_per_mtok: 1 } },
      }),
    ).toThrow(PhoenixError);
    expect(r.usage.config().budgets).toEqual([]);
  });
});
