// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 78 usage retention: `keep_days` in the mission config (7 to 3650, default 400). Rows from
// `today - keep_days` on are kept; older rows go on the next report and when Core starts.
// Simulated: a real SQLite database with an injected clock, no agent or provider.
import { PhoenixError } from "@phoenix/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { KEEP_DAYS_KEY } from "../src/agent-usage";
import { closeRigs, DAY, T0, usageRig, type UsageRig } from "./agent-usage-rig";

afterEach(closeRigs);

/** One row on the day `daysAgo` before T0 (its own session, so no running total is shared). */
function rowAt(r: UsageRig, daysAgo: number): void {
  r.clock.now = T0 - daysAgo * DAY;
  r.report({
    agent: "claude-code",
    session_id: `s${daysAgo}`,
    model: "m",
    input_tokens: 10,
    output_tokens: 0,
  });
  r.clock.now = T0;
}

const daysLeft = (r: UsageRig): number[] =>
  (
    r.db.prepare("SELECT DISTINCT day FROM agent_usage ORDER BY day").all() as { day: string }[]
  ).map((row) => Math.round((T0 - Date.parse(`${row.day}T10:00:00Z`)) / DAY));

describe("default retention", () => {
  it("is 400 days: the 400th day back is kept, older rows go on the next report", () => {
    const r = usageRig();
    expect(r.usage.config().keep_days).toBe(400);
    rowAt(r, 450);
    rowAt(r, 401);
    rowAt(r, 400);
    rowAt(r, 5);
    rowAt(r, 0);
    expect(daysLeft(r)).toEqual([400, 5, 0]);
  });
});

describe("a configured retention", () => {
  it("prunes only older rows, on the next report, not when it is saved", () => {
    const r = usageRig();
    for (const d of [100, 31, 30, 29, 1]) rowAt(r, d);
    expect(daysLeft(r)).toEqual([100, 31, 30, 29, 1]);
    expect(r.usage.setConfig({ keep_days: 30 }).keep_days).toBe(30);
    expect(daysLeft(r)).toEqual([100, 31, 30, 29, 1]);
    rowAt(r, 0);
    expect(daysLeft(r)).toEqual([30, 29, 1, 0]);
  });

  it("raising it again restores nothing and keeps what is left", () => {
    const r = usageRig();
    for (const d of [100, 20]) rowAt(r, d);
    r.usage.setConfig({ keep_days: 30 });
    rowAt(r, 0);
    r.usage.setConfig({ keep_days: 3650 });
    rowAt(r, 1);
    expect(daysLeft(r)).toEqual([20, 1, 0]);
  });

  it("accepts the bounds 7 and 3650, and prunes at 7", () => {
    const r = usageRig();
    expect(r.usage.setConfig({ keep_days: 3650 }).keep_days).toBe(3650);
    rowAt(r, 3_000);
    expect(daysLeft(r)).toEqual([3_000]);
    expect(r.usage.setConfig({ keep_days: 7 }).keep_days).toBe(7);
    for (const d of [8, 7, 2, 0]) rowAt(r, d);
    expect(daysLeft(r)).toEqual([7, 2, 0]);
  });

  it("is audited with the new value", () => {
    const r = usageRig();
    r.usage.setConfig({ keep_days: 90 });
    const rows = r.db
      .prepare("SELECT details FROM audit_log WHERE action = 'agent_usage.config.changed'")
      .all() as { details: string }[];
    expect(rows.map((row) => JSON.parse(row.details))).toEqual([{ keep_days: 90 }]);
  });

  it("a request without keep_days leaves it alone", () => {
    const r = usageRig();
    r.usage.setConfig({ keep_days: 90 });
    r.usage.setConfig({ stuck_after_min: 45 });
    expect(r.usage.config()).toMatchObject({ keep_days: 90, stuck_after_min: 45 });
  });
});

describe("invalid retention is refused and nothing is stored", () => {
  it("rejects out-of-range, non-integer and non-number values", () => {
    const r = usageRig();
    for (const bad of [
      6,
      0,
      -1,
      3_651,
      7.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "30",
      "",
      null,
      true,
      [30],
      { days: 30 },
    ])
      expect(() => r.usage.setConfig({ keep_days: bad }), String(bad)).toThrow(PhoenixError);
    expect(r.usage.config().keep_days).toBe(400);
    expect(r.settings.get(KEEP_DAYS_KEY, "absent")).toBe("absent");
  });

  it("a bad keep_days rejects the whole request, a bad other part does not save keep_days", () => {
    const r = usageRig();
    expect(() =>
      r.usage.setConfig({
        keep_days: 5,
        budgets: [{ scope: "daily", metric: "tokens", limit: 5 }],
      }),
    ).toThrow(PhoenixError);
    expect(() => r.usage.setConfig({ keep_days: 30, stuck_after_min: 1 })).toThrow(PhoenixError);
    expect(r.usage.config()).toMatchObject({ keep_days: 400, budgets: [] });
    expect(r.settings.get(KEEP_DAYS_KEY, "absent")).toBe("absent");
  });

  it("a rejected value deletes nothing", () => {
    const r = usageRig();
    rowAt(r, 300);
    expect(() => r.usage.setConfig({ keep_days: 3 })).toThrow(PhoenixError);
    rowAt(r, 0);
    expect(daysLeft(r)).toEqual([300, 0]);
  });

  it("a damaged stored value reads as the default and never deletes more than 400 days", () => {
    const r = usageRig();
    rowAt(r, 300);
    r.settings.set(KEEP_DAYS_KEY, 3);
    expect(r.usage.config().keep_days).toBe(400);
    rowAt(r, 0);
    expect(daysLeft(r)).toEqual([300, 0]);
  });
});

describe("retention survives a restart", () => {
  it("is read again by a new runtime on the same database", () => {
    const first = usageRig();
    first.usage.setConfig({ keep_days: 60 });
    const second = usageRig(first.db);
    expect(second.usage.config().keep_days).toBe(60);
  });

  it("a lowered value prunes when Core loads, without a report, and only what it names", () => {
    const first = usageRig();
    for (const d of [200, 61, 60, 59, 3]) rowAt(first, d);
    first.usage.setConfig({ keep_days: 60 });
    expect(daysLeft(first)).toEqual([200, 61, 60, 59, 3]);
    const second = usageRig(first.db);
    expect(daysLeft(second)).toEqual([60, 59, 3]);
  });

  it("a restart with the default prunes nothing inside 400 days", () => {
    const first = usageRig();
    for (const d of [400, 399, 1]) rowAt(first, d);
    const second = usageRig(first.db);
    expect(daysLeft(second)).toEqual([400, 399, 1]);
  });
});
