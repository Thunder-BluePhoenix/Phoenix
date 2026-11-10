// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 64: user-set retention for dictation statistics. Fake clock and hand-driven timers; the
// default is keep-until-deleted and nothing here changes it.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localDay, type Timers } from "@phoenix/ai-multimodal";
import { afterEach, describe, expect, it } from "vitest";
import { startCore, type TestCore } from "./helpers";

let core: TestCore | undefined;
afterEach(async () => {
  await core?.runtime.stop();
  core = undefined;
});

// Local noon on a fixed day: calendar arithmetic below never crosses a DST edge.
const NOW = new Date(2026, 5, 15, 12).getTime();
const DAY = 86_400_000;
const daysAgo = (n: number) => localDay(new Date(2026, 5, 15 - n, 12).getTime());

class FakeTimers implements Timers {
  readonly pending: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  after(fn: () => void, ms: number): () => void {
    const entry = { fn, ms, cancelled: false };
    this.pending.push(entry);
    return () => {
      entry.cancelled = true;
    };
  }
  live() {
    return this.pending.filter((p) => !p.cancelled);
  }
  /** Runs the one live timer, as the clock reaching it would. */
  fire() {
    const live = this.live();
    expect(live).toHaveLength(1);
    live[0]!.cancelled = true;
    live[0]!.fn();
  }
}

async function boot(databasePath?: string, dataDir?: string) {
  const clock = { now: NOW };
  const timers = new FakeTimers();
  core = await startCore(dataDir ? { dataDir } : {}, {
    runtime: {
      dictation: { now: () => clock.now, timers },
      ...(databasePath ? { databasePath } : {}),
    },
  });
  return { clock, timers };
}

function seed(days: number[]) {
  const insert = core!.runtime.db.prepare(
    "INSERT INTO dictation_stats (day, app, words, speech_ms, sessions) VALUES (?, ?, 10, 1000, 1)",
  );
  for (const d of days) insert.run(daysAgo(d), "com.example.app");
}
const days = () =>
  (
    core!.runtime.db.prepare("SELECT day FROM dictation_stats ORDER BY day DESC").all() as {
      day: string;
    }[]
  ).map((r) => r.day);
const setRetention = (retention_days: unknown) =>
  core!.api("POST", "/api/dictation/stats/retention", { retention_days });
const auditActions = async () =>
  (
    (await core!.api("GET", "/api/audit?limit=100")).json.entries as {
      action: string;
      details: unknown;
    }[]
  ).filter((e) => e.action.startsWith("dictation.stats."));

describe("dictation statistics retention (Phase 64)", () => {
  it("defaults to keep-until-deleted and prunes nothing, however old a row is", async () => {
    const { timers } = await boot();
    expect((await core!.api("GET", "/api/dictation/stats/retention")).json).toEqual({
      retention_days: null,
    });
    seed([0, 100, 400, 5000]);
    timers.fire();
    expect(core!.runtime.dictation.pruneStats()).toBe(0);
    expect(days()).toHaveLength(4);
    expect((await auditActions()).some((e) => e.action === "dictation.stats.retention_prune")).toBe(
      false,
    );
  });

  it.each([30, 90, 365])(
    "keeps a row exactly %i days old and deletes one day older",
    async (period) => {
      const { timers } = await boot();
      seed([0, period - 1, period, period + 1, period + 40]);
      expect((await setRetention(period)).json).toEqual({ retention_days: period });
      // Saving does not prune; the next run does.
      expect(days()).toHaveLength(5);
      timers.fire();
      expect(days()).toEqual([daysAgo(0), daysAgo(period - 1), daysAgo(period)]);
    },
  );

  it("switching to a shorter period prunes on the next run, and a longer one deletes nothing more", async () => {
    const { timers } = await boot();
    seed([5, 60, 200, 500]);
    await setRetention(365);
    timers.fire();
    expect(days()).toEqual([daysAgo(5), daysAgo(60), daysAgo(200)]);
    await setRetention(90);
    expect(days()).toHaveLength(3);
    timers.fire();
    expect(days()).toEqual([daysAgo(5), daysAgo(60)]);
    await setRetention(365);
    timers.fire();
    expect(days()).toEqual([daysAgo(5), daysAgo(60)]);
    await setRetention(null);
    timers.fire();
    expect(days()).toHaveLength(2);
  });

  it("runs once a day on the injected timer, reschedules itself and follows the clock", async () => {
    const { clock, timers } = await boot();
    expect(timers.live()).toHaveLength(1);
    expect(timers.live()[0]!.ms).toBe(DAY);
    seed([0, 27, 28, 30]);
    await setRetention(30);
    clock.now += 2 * DAY;
    timers.fire();
    // Two days later the 30-day-old row is 32 days old and goes; the 28-day-old one is exactly 30.
    expect(days()).toEqual([daysAgo(0), daysAgo(27), daysAgo(28)]);
    expect(timers.live()).toHaveLength(1);
    clock.now += DAY;
    timers.fire();
    expect(days()).toEqual([daysAgo(0), daysAgo(27)]);
  });

  it("stops the daily timer when Core stops", async () => {
    const { timers } = await boot();
    expect(timers.live()).toHaveLength(1);
    await core!.runtime.stop();
    expect(timers.live()).toHaveLength(0);
    core = undefined;
  });

  it("prunes at Core start with the saved period", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "phoenix-retention-"));
    const file = join(dataDir, "core.sqlite");
    await boot(file, dataDir);
    seed([1, 31, 500]);
    await setRetention(30);
    await core!.runtime.stop();
    core = undefined;
    await boot(file, dataDir);
    expect(days()).toEqual([daysAgo(1)]);
  });

  it("deletes only dictation_stats rows and audits the count, never content", async () => {
    const { timers } = await boot();
    core!.runtime.db
      .prepare(
        "INSERT INTO dictation_stats (day, app, words, speech_ms, sessions) VALUES (?, ?, 5, 500, 1)",
      )
      .run(daysAgo(900), "com.private.app");
    seed([1, 400, 401]);
    const before = (table: string) =>
      (core!.runtime.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    const others = ["recap_daily", "events", "notifications"].map((t) => [t, before(t)] as const);
    await core!.api("POST", "/api/dictation/settings", { enabled: true });
    await setRetention(365);
    timers.fire();
    expect(days()).toEqual([daysAgo(1)]);
    for (const [t, n] of others) expect(before(t)).toBe(n);
    const entries = await auditActions();
    expect(entries.map((e) => e.action).sort()).toEqual([
      "dictation.stats.retention",
      "dictation.stats.retention_prune",
    ]);
    const prune = entries.find((e) => e.action === "dictation.stats.retention_prune")!;
    expect(prune.details).toEqual({ retention_days: 365, rows: 3 });
    expect(JSON.stringify(entries)).not.toContain("com.private.app");
  });

  it("rejects anything but null, 30, 90 or 365 and any extra field; the stored value is kept", async () => {
    await boot();
    await setRetention(90);
    const bad: unknown[] = [0, 1, 7, 29, 31, 366, -30, 30.5, "30", "none", true, [], {}, undefined];
    for (const value of bad) {
      const res = await core!.api("POST", "/api/dictation/stats/retention", {
        retention_days: value,
      });
      expect(res.status, JSON.stringify(value)).toBe(400);
    }
    for (const body of [{}, { retention_days: 30, extra: 1 }, { days: 30 }, [30], null, "30"]) {
      const res = await core!.api("POST", "/api/dictation/stats/retention", body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await core!.api("GET", "/api/dictation/stats/retention")).json).toEqual({
      retention_days: 90,
    });
  });

  it("needs the session token", async () => {
    await boot();
    const res = await fetch(`${core!.base}/api/dictation/stats/retention`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ retention_days: 30 }),
    });
    expect(res.status).toBe(401);
  });

  it("is listed in the privacy inventory with its row count and period", async () => {
    await boot();
    seed([1, 2]);
    const find = async () =>
      ((await core!.api("GET", "/api/privacy")).json.derived as Record<string, unknown>[]).find(
        (d) => d.id === "dictation_stats",
      );
    expect(await find()).toMatchObject({ count: 2, retention_days: null });
    await setRetention(30);
    expect(await find()).toMatchObject({ count: 2, retention_days: 30 });
  });

  it("ignores a stored value that is not one of the choices", async () => {
    await boot();
    core!.runtime.settings.set("dictation.stats_retention", 7);
    expect(core!.runtime.dictation.statsRetention()).toEqual({ retention_days: null });
    seed([500]);
    expect(core!.runtime.dictation.pruneStats()).toBe(0);
    expect(days()).toHaveLength(1);
  });
});
