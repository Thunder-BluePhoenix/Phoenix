// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { describe, expect, it } from "vitest";
import {
  CODEX_UNSUPPORTED,
  MAX_USAGE_KEYS,
  UsageTracker,
  extractClaudeUsage,
  mapCodexRateLimits,
  parseThresholds,
  validateUsage,
  type UsageSample,
  type UsageWarning,
} from "../src/usage";

const NOW = Date.parse("2026-10-16T10:00:00Z");
const RESETS = Math.floor(NOW / 1000) + 3 * 3600;

describe("extractClaudeUsage (fields from the public statusLine docs)", () => {
  it("reads rate_limits.five_hour and seven_day only", () => {
    const samples = extractClaudeUsage(
      {
        model: { display_name: "Opus" },
        cost: { total_cost_usd: 1 },
        rate_limits: {
          five_hour: { used_percentage: 23.5, resets_at: RESETS },
          seven_day: { used_percentage: 41.2, resets_at: RESETS + 86_400 },
          spend_limit: { used_percentage: 99, resets_at: RESETS },
        },
      },
      NOW,
    );
    expect(samples).toEqual([
      {
        agent: "claude-code",
        window: "5h",
        used_pct: 23.5,
        resets_at: new Date(RESETS * 1000).toISOString(),
        observed_at: new Date(NOW).toISOString(),
      },
      {
        agent: "claude-code",
        window: "weekly",
        used_pct: 41.2,
        resets_at: new Date((RESETS + 86_400) * 1000).toISOString(),
        observed_at: new Date(NOW).toISOString(),
      },
    ]);
  });

  it("handles each window being absent, and non-subscriber JSON", () => {
    expect(
      extractClaudeUsage(
        { rate_limits: { seven_day: { used_percentage: 5, resets_at: RESETS } } },
        NOW,
      ),
    ).toHaveLength(1);
    expect(extractClaudeUsage({ model: {} }, NOW)).toEqual([]);
    expect(extractClaudeUsage({ rate_limits: {} }, NOW)).toEqual([]);
    expect(extractClaudeUsage(null, NOW)).toEqual([]);
    expect(extractClaudeUsage("x", NOW)).toEqual([]);
  });

  it("ignores malformed values", () => {
    const bad = (five_hour: unknown) => extractClaudeUsage({ rate_limits: { five_hour } }, NOW);
    expect(bad({ used_percentage: "50", resets_at: RESETS })).toEqual([]);
    expect(bad({ used_percentage: 120, resets_at: RESETS })).toEqual([]);
    expect(bad({ used_percentage: -1, resets_at: RESETS })).toEqual([]);
    expect(bad({ used_percentage: 5 })).toEqual([]);
    expect(bad({ used_percentage: 5, resets_at: RESETS * 100 })).toEqual([]);
    expect(bad({ used_percentage: Number.NaN, resets_at: RESETS })).toEqual([]);
  });
});

describe("Codex usage", () => {
  it("is recorded as unsupported, with the reason and what the docs do say", () => {
    expect(CODEX_UNSUPPORTED.agent).toBe("codex");
    expect(CODEX_UNSUPPORTED.reason).toMatch(/^unsupported:/);
    expect(CODEX_UNSUPPORTED.reason).toContain("account/rateLimits/read");
  });

  it("maps the documented account/rateLimits/read shape (only the 5h and weekly windows)", () => {
    const samples = mapCodexRateLimits(
      {
        rateLimits: {
          limitId: "codex",
          primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: RESETS },
          secondary: { usedPercent: 60, windowDurationMins: 10_080, resetsAt: RESETS + 1000 },
        },
        rateLimitResetCredits: { availableCount: 2 },
      },
      NOW,
    );
    expect(samples.map((s) => [s.window, s.used_pct, s.reset_credits])).toEqual([
      ["5h", 25, 2],
      ["weekly", 60, 2],
    ]);
    expect(
      mapCodexRateLimits(
        { rateLimits: { primary: { usedPercent: 25, windowDurationMins: 15, resetsAt: RESETS } } },
        NOW,
      ),
    ).toEqual([]);
  });
});

describe("validateUsage", () => {
  const sample = { window: "5h", used_pct: 50, resets_at: new Date(RESETS * 1000).toISOString() };

  it("accepts one sample or a list, and stamps Core's own observation time", () => {
    const one = validateUsage(
      { agent: "claude-code", ...sample, observed_at: "1999-01-01T00:00:00Z" },
      NOW,
    );
    expect(one.ok && one.samples[0]!.observed_at).toBe(new Date(NOW).toISOString());
    const many = validateUsage(
      { agent: "claude-code", samples: [sample, { ...sample, window: "weekly" }] },
      NOW,
    );
    expect(many.ok && many.samples).toHaveLength(2);
  });

  it("rejects bad agents, windows, percentages, times and too many samples", () => {
    for (const body of [
      null,
      { ...sample },
      { agent: "Bad", ...sample },
      { agent: "claude-code", ...sample, window: "daily" },
      { agent: "claude-code", ...sample, used_pct: 101 },
      { agent: "claude-code", ...sample, resets_at: "yesterday-ish" },
      { agent: "claude-code", ...sample, reset_credits: -1 },
      { agent: "claude-code", samples: [] },
      { agent: "claude-code", samples: Array.from({ length: 5 }, () => sample) },
    ]) {
      expect(validateUsage(body, NOW).ok).toBe(false);
    }
  });
});

describe("parseThresholds", () => {
  it("accepts 1..4 unique whole percents and sorts them", () => {
    expect(parseThresholds([95, 80])).toEqual([80, 95]);
    for (const bad of [[], [0], [100], [80, 80], [1.5], ["80"], "80", [10, 20, 30, 40, 50]]) {
      expect(parseThresholds(bad)).toBeUndefined();
    }
  });
});

describe("UsageTracker: one warning per window per threshold, before the limit", () => {
  const sampleAt = (used: number, over: Partial<UsageSample> = {}): UsageSample => ({
    agent: "claude-code",
    window: "5h",
    used_pct: used,
    resets_at: new Date(RESETS * 1000).toISOString(),
    observed_at: new Date(NOW).toISOString(),
    ...over,
  });
  function make(thresholds: number[] = [80, 95]) {
    const warnings: UsageWarning[] = [];
    const saved: unknown[] = [];
    let now = NOW;
    const tracker = new UsageTracker({
      now: () => now,
      thresholds: () => thresholds,
      onWarning: (w) => warnings.push(w),
      persist: (fired) => saved.push(fired),
    });
    return { tracker, warnings, saved, advance: (ms: number) => (now += ms) };
  }

  it("fires at 80 and at 95 once each, never again for the same window", () => {
    const { tracker, warnings } = make();
    tracker.record(sampleAt(50));
    expect(warnings).toEqual([]);
    tracker.record(sampleAt(81));
    tracker.record(sampleAt(82));
    tracker.record(sampleAt(85));
    expect(warnings.map((w) => w.threshold)).toEqual([80]);
    tracker.record(sampleAt(96));
    tracker.record(sampleAt(97));
    expect(warnings.map((w) => w.threshold)).toEqual([80, 95]);
    expect(warnings[1]).toMatchObject({ agent: "claude-code", window: "5h", used_pct: 96 });
  });

  it("a jump over both thresholds raises one warning for the highest", () => {
    const { tracker, warnings } = make();
    tracker.record(sampleAt(97));
    expect(warnings.map((w) => w.threshold)).toEqual([95]);
    tracker.record(sampleAt(98));
    expect(warnings).toHaveLength(1);
  });

  it("windows are independent, and a new window (new reset time) warns again", () => {
    const { tracker, warnings } = make();
    tracker.record(sampleAt(85));
    tracker.record(sampleAt(85, { window: "weekly" }));
    expect(warnings.map((w) => w.window)).toEqual(["5h", "weekly"]);
    tracker.record(sampleAt(85, { resets_at: new Date((RESETS + 5 * 3600) * 1000).toISOString() }));
    expect(warnings).toHaveLength(3);
  });

  it("small reset-time jitter is the same window", () => {
    const { tracker, warnings } = make();
    tracker.record(sampleAt(85));
    tracker.record(sampleAt(86, { resets_at: new Date((RESETS + 60) * 1000).toISOString() }));
    expect(warnings).toHaveLength(1);
  });

  it("a big drop (a free reset) re-arms the threshold", () => {
    const { tracker, warnings } = make();
    tracker.record(sampleAt(85));
    tracker.record(sampleAt(10));
    tracker.record(sampleAt(85));
    expect(warnings).toHaveLength(2);
  });

  it("honours custom thresholds and a changed list", () => {
    const { tracker, warnings } = make([50]);
    tracker.record(sampleAt(60));
    expect(warnings.map((w) => w.threshold)).toEqual([50]);
  });

  it("already-warned state survives a restart (fired state is restored)", () => {
    const first = make();
    first.tracker.record(sampleAt(85));
    const fired = first.tracker.exportFired();
    const again: UsageWarning[] = [];
    const restarted = new UsageTracker({
      now: () => NOW,
      thresholds: () => [80, 95],
      onWarning: (w) => again.push(w),
      fired,
    });
    restarted.record(sampleAt(86));
    expect(again).toEqual([]);
    restarted.record(sampleAt(96));
    expect(again.map((w) => w.threshold)).toEqual([95]);
    expect(first.saved.length).toBeGreaterThan(0);
  });

  it("a flood of distinct agents is bounded: 32 keys kept, the rest refused, no growing writes", () => {
    const { tracker, saved } = make();
    const accepted: boolean[] = [];
    for (let i = 0; i < 500; i++)
      accepted.push(tracker.record(sampleAt(90, { agent: `agent-${i}` })));
    expect(accepted.filter(Boolean)).toHaveLength(MAX_USAGE_KEYS);
    expect(accepted.slice(MAX_USAGE_KEYS).some(Boolean)).toBe(false);
    expect(tracker.views()).toHaveLength(MAX_USAGE_KEYS);
    expect(Object.keys(tracker.exportFired()).length).toBeLessThanOrEqual(MAX_USAGE_KEYS);
    // One write per newly warned window; refused samples write nothing.
    expect(saved).toHaveLength(MAX_USAGE_KEYS);
    expect(JSON.stringify(saved.at(-1)).length).toBeLessThan(10_000);
  });

  it("known keys keep updating when the table is full; ended windows free room", () => {
    const { tracker, advance } = make();
    for (let i = 0; i < MAX_USAGE_KEYS; i++) tracker.record(sampleAt(10, { agent: `a-${i}` }));
    expect(tracker.record(sampleAt(20, { agent: "a-3" }))).toBe(true);
    expect(tracker.record(sampleAt(20, { agent: "newcomer" }))).toBe(false);
    advance(4 * 3600_000);
    const later = sampleAt(20, {
      agent: "newcomer",
      resets_at: new Date(NOW + 9 * 3600_000).toISOString(),
    });
    expect(tracker.record(later)).toBe(true);
  });

  it("does not persist for readings that warn nothing, however often they arrive or reset", () => {
    const { tracker, saved } = make();
    for (let i = 0; i < 50; i++) {
      tracker.record(
        sampleAt(10 + (i % 5), { resets_at: new Date((RESETS + i * 1200) * 1000).toISOString() }),
      );
    }
    expect(saved).toEqual([]);
    tracker.record(sampleAt(85));
    expect(saved).toHaveLength(1);
    tracker.record(sampleAt(86));
    expect(saved).toHaveLength(1);
  });

  it("views carry the level, and mark old readings or past windows stale", () => {
    const { tracker, advance } = make();
    tracker.record(sampleAt(81));
    tracker.record(sampleAt(97, { window: "weekly" }));
    tracker.record(sampleAt(10, { agent: "codex" }));
    const v = tracker.views();
    expect(v.map((x) => [x.agent, x.window, x.level, x.stale])).toEqual([
      ["claude-code", "5h", "warn", false],
      ["claude-code", "weekly", "critical", false],
      ["codex", "5h", "ok", false],
    ]);
    advance(31 * 60_000);
    expect(tracker.views().every((x) => x.stale)).toBe(true);
    expect(tracker.views().every((x) => x.level === "ok")).toBe(true);
  });
});
