// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 69: the opt-in "every Monday" recap notice. Fake clock throughout (injected through
// `recapClock`); nothing here ran across a real Monday with a real person.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decideRecapNotice,
  isoWeekOf,
  localInstant,
  RECAP_NOTICE_ENABLED_KEY,
  RECAP_NOTICE_LAST_WEEK_KEY,
  recapNoticeText,
} from "../src/recap-notice";
import { fakeNetwork } from "./ai-network";
import { startCore, type TestCore } from "./helpers";

/** A project name that must never reach a notice; built from parts so it is not a key-shaped literal. */
const PROJECT_KEY = ["private", "project", "xyz"].join("-");

const at = (iso: string) => Date.parse(iso);
const NO_QUIET = null;

describe("isoWeekOf", () => {
  it("numbers ISO weeks, including a year boundary", () => {
    expect(isoWeekOf("2026-11-09")).toBe("2026-W46");
    expect(isoWeekOf("2026-11-15")).toBe("2026-W46");
    expect(isoWeekOf("2026-11-16")).toBe("2026-W47");
    expect(isoWeekOf("2027-01-01")).toBe("2026-W53");
    expect(isoWeekOf("2024-12-30")).toBe("2025-W01");
    expect(isoWeekOf("2026-01-01")).toBe("2026-W01");
  });
});

describe("localInstant", () => {
  it("gives 09:00 on the wall clock on and around a clock change", () => {
    // New York: clocks go back Sunday 2026-11-01, so Monday 11-02 is on standard time (UTC-5).
    expect(localInstant("2026-11-02", 540, "America/New_York")).toBe(at("2026-11-02T14:00:00Z"));
    expect(localInstant("2026-10-26", 540, "America/New_York")).toBe(at("2026-10-26T13:00:00Z"));
    expect(localInstant("2026-11-09", 540, "UTC")).toBe(at("2026-11-09T09:00:00Z"));
  });
});

describe("decideRecapNotice", () => {
  const base = { timeZone: "UTC", lastWeek: null, quietHours: NO_QUIET };
  it("waits before Monday 09:00 and sends from then on", () => {
    expect(decideRecapNotice({ ...base, now: at("2026-11-09T08:59:00Z") })).toEqual({
      action: "wait",
      at: at("2026-11-09T09:00:00Z"),
    });
    expect(decideRecapNotice({ ...base, now: at("2026-11-09T09:00:00Z") })).toEqual({
      action: "send",
      week: "2026-W46",
    });
  });
  it("catches up later in the same week, once", () => {
    expect(decideRecapNotice({ ...base, now: at("2026-11-12T18:00:00Z") })).toEqual({
      action: "send",
      week: "2026-W46",
    });
    expect(
      decideRecapNotice({ ...base, lastWeek: "2026-W46", now: at("2026-11-12T18:00:00Z") }),
    ).toEqual({ action: "wait", at: at("2026-11-16T09:00:00Z") });
  });
  it("holds the notice until quiet hours end, even past 09:00", () => {
    const quietHours = { timezone: "UTC", start: "22:00", end: "11:00" };
    const decision = decideRecapNotice({
      ...base,
      quietHours,
      now: at("2026-11-09T09:30:00Z"),
    });
    expect(decision).toEqual({ action: "wait", at: at("2026-11-09T11:00:00Z") });
    expect(decideRecapNotice({ ...base, quietHours, now: at("2026-11-09T11:00:00Z") }).action).toBe(
      "send",
    );
  });
  it("is due at 09:00 wall time on the week after a clock change", () => {
    const now = at("2026-11-02T13:59:00Z"); // 08:59 in New York
    const d = decideRecapNotice({ ...base, timeZone: "America/New_York", now });
    expect(d).toEqual({ action: "wait", at: at("2026-11-02T14:00:00Z") });
  });
});

describe("recapNoticeText", () => {
  it("interpolates only whole counts and falls back to English", () => {
    const counts = { sessions: 3, steps: 40, commits: 2, granted: 5, denied: 1 };
    expect(recapNoticeText("en", counts).body).toBe(
      "Last week: 3 sessions, 40 steps, 2 commits, 5 permissions granted, 1 denied. Open Recap to see it.",
    );
    expect(recapNoticeText("xx", counts)).toEqual(recapNoticeText("en", counts));
    expect(recapNoticeText("__proto__", counts)).toEqual(recapNoticeText("en", counts));
    const hostile = recapNoticeText("en", {
      sessions: Number.NaN,
      steps: -4,
      commits: 1.9,
      granted: Number.POSITIVE_INFINITY,
      denied: 0,
    });
    expect(hostile.body).toContain("0 sessions, 0 steps, 1 commits, 0 permissions");
  });
  it("has a translation for all ten locales, each with the five counts and nothing else", () => {
    const counts = { sessions: 11, steps: 22, commits: 33, granted: 44, denied: 55 };
    for (const locale of ["en", "zh", "hi", "es", "ar", "fr", "bn", "pt", "ru", "id"]) {
      const text = recapNoticeText(locale, counts);
      expect(text.title.length).toBeGreaterThan(5);
      for (const n of ["11", "22", "33", "44", "55"]) expect(text.body).toContain(n);
      expect(text.body).not.toMatch(/[{}]/);
    }
    expect(recapNoticeText("fr", counts).title).not.toBe(recapNoticeText("en", counts).title);
  });
});

const cores: TestCore[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const core of cores.splice(0)) await core.runtime.stop();
});

const clock = { now: at("2026-11-09T08:00:00Z") };
async function boot() {
  const network = fakeNetwork({
    chat: () => {
      throw new Error("No AI calls expected");
    },
  });
  clock.now = at("2026-11-09T08:00:00Z");
  const core = await startCore(
    {},
    {
      runtime: { fetch: network.fetch, recapClock: () => clock.now, recapTimeZone: "UTC" },
    },
  );
  cores.push(core);
  // Last week (2026-11-02..08) has activity: 2 sessions, 9 steps, 4 commits.
  core.runtime.recap.bump(at("2026-11-03T10:00:00Z"), [
    { metric: "sessions", value: 2 },
    { metric: "steps", value: 9 },
    { metric: "commits", value: 4 },
  ]);
  return { core, network };
}
const notices = (core: TestCore) =>
  (core.runtime.notifications.list({ limit: 50 }).notifications ?? []).filter(
    (n) => n.source === "recap",
  );
const enable = (core: TestCore) => core.api("POST", "/api/recap/notice", { enabled: true });

describe("weekly recap notice (Core)", () => {
  it("is off by default and independent of the Kage proactive switch", async () => {
    const { core } = await boot();
    expect((await core.api("GET", "/api/recap/notice")).json).toEqual({
      enabled: false,
      last_week: null,
      time_zone: "UTC",
    });
    clock.now = at("2026-11-09T10:00:00Z");
    expect(core.runtime.recapNotice.tick()).toBe(false);
    expect(notices(core)).toEqual([]);
    // The Kage opt-in does not turn it on, and turning it on does not touch the Kage opt-in.
    core.runtime.proactive.setPreferences({ enabled: true, capabilities: ["kage"] });
    expect(core.runtime.recapNotice.tick()).toBe(false);
    await enable(core);
    expect(core.runtime.proactive.status().preferences.capabilities).toEqual(["kage"]);
    await core.api("POST", "/api/recap/notice", { enabled: false });
    expect(core.runtime.proactive.status().preferences.enabled).toBe(true);
    expect(core.runtime.recapNotice.status().enabled).toBe(false);
  });

  it("validates the request and keeps the persisted state plain", async () => {
    const { core } = await boot();
    for (const body of [{}, { enabled: "yes" }, { enabled: true, extra: 1 }])
      expect((await core.api("POST", "/api/recap/notice", body)).status).toBe(400);
    await enable(core);
    expect(core.runtime.settings.get(RECAP_NOTICE_ENABLED_KEY, null)).toBe(true);
    clock.now = at("2026-11-09T10:00:00Z");
    core.runtime.recapNotice.tick();
    expect(core.runtime.settings.get(RECAP_NOTICE_LAST_WEEK_KEY, null)).toBe("2026-W46");
  });

  it("sends one counts-only notice at Monday 09:00 and never twice in a week", async () => {
    const { core, network } = await boot();
    await enable(core);
    vi.useFakeTimers();
    core.runtime.recapNotice.stop();
    core.runtime.recapNotice.start();
    clock.now = at("2026-11-09T08:59:00Z");
    await vi.advanceTimersByTimeAsync(59 * 60_000);
    expect(notices(core)).toEqual([]);
    clock.now = at("2026-11-09T09:00:00Z");
    await vi.advanceTimersByTimeAsync(60_000);
    const sent = notices(core);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      title: "Your weekly recap is ready",
      body: "Last week: 2 sessions, 9 steps, 4 commits, 0 permissions granted, 0 denied. Open Recap to see it.",
      severity: "info",
      eventType: "insight.weekly_recap",
    });
    // Later the same week, a restart-like re-arm and direct checks add nothing.
    clock.now = at("2026-11-11T12:00:00Z");
    await vi.advanceTimersByTimeAsync(3 * 24 * 3_600_000);
    expect(core.runtime.recapNotice.tick()).toBe(false);
    core.runtime.recapNotice.stop();
    core.runtime.recapNotice.start();
    expect(notices(core)).toHaveLength(1);
    expect(core.runtime.recapNotice.status().last_week).toBe("2026-W46");
    // Next Monday, new activity: a second notice for the new week.
    core.runtime.recap.bump(at("2026-11-10T10:00:00Z"), [{ metric: "steps", value: 1 }]);
    clock.now = at("2026-11-16T09:00:00Z");
    expect(core.runtime.recapNotice.tick()).toBe(true);
    expect(notices(core)).toHaveLength(2);
    expect(network.requests).toEqual([]);
  });

  it("catches up once when Core was off on Monday", async () => {
    const { core } = await boot();
    await enable(core);
    clock.now = at("2026-11-12T15:00:00Z"); // Thursday; Core was not running on Monday
    expect(core.runtime.recapNotice.tick()).toBe(true);
    expect(core.runtime.recapNotice.tick()).toBe(false);
    expect(notices(core)).toHaveLength(1);
  });

  it("does not fire for an earlier Monday when it is switched on mid-week", async () => {
    const { core } = await boot();
    clock.now = at("2026-11-11T12:00:00Z"); // Wednesday
    await enable(core);
    expect(core.runtime.recapNotice.tick()).toBe(false);
    expect(core.runtime.recapNotice.status().last_week).toBe("2026-W46");
    clock.now = at("2026-11-16T09:00:00Z");
    expect(core.runtime.recapNotice.tick()).toBe(false); // no activity in the week of 11-09
    expect(notices(core)).toEqual([]);
  });

  it("counts exactly the previous Monday-to-Sunday week, not the week before or the current one", async () => {
    const { core } = await boot(); // 2026-11-02..08 already holds 2 sessions, 9 steps, 4 commits
    // Edges of the previous week count; the Sunday before it and the Monday after it do not.
    core.runtime.recap.bump(at("2026-11-02T00:00:00Z"), [{ metric: "steps", value: 100 }]);
    core.runtime.recap.bump(at("2026-11-08T23:59:59Z"), [{ metric: "commits", value: 10 }]);
    core.runtime.recap.bump(at("2026-11-01T23:59:59Z"), [{ metric: "steps", value: 1000 }]);
    core.runtime.recap.bump(at("2026-11-09T00:00:00Z"), [{ metric: "steps", value: 10000 }]);
    const asked: unknown[] = [];
    const real = core.runtime.recap.recap.bind(core.runtime.recap);
    const spy = vi
      .spyOn(core.runtime.recap, "recap")
      .mockImplementation((week: string | undefined) => {
        asked.push(week);
        return real(week);
      });
    await enable(core);
    clock.now = at("2026-11-12T15:00:00Z"); // Thursday of the CURRENT week (11-09..15)
    expect(core.runtime.recapNotice.tick()).toBe(true);
    spy.mockRestore();
    // A day key accepted by `recap(week)`: the Monday of the previous week.
    expect(asked).toEqual(["2026-11-02"]);
    const view = real("2026-11-02");
    expect(view.week).toMatchObject({ start: "2026-11-02", end: "2026-11-08", current: false });
    expect(notices(core)[0]).toMatchObject({
      body: "Last week: 2 sessions, 109 steps, 14 commits, 0 permissions granted, 0 denied. Open Recap to see it.",
    });
  });

  it("waits for Proactive quiet hours to end, then sends", async () => {
    const { core } = await boot();
    core.runtime.proactive.setPreferences({
      quietHours: { timezone: "UTC", start: "22:00", end: "11:00" },
    });
    await enable(core);
    clock.now = at("2026-11-09T09:30:00Z");
    expect(core.runtime.recapNotice.tick()).toBe(false);
    expect(notices(core)).toEqual([]);
    expect(core.runtime.recapNotice.status().last_week).toBeNull();
    clock.now = at("2026-11-09T11:00:00Z");
    expect(core.runtime.recapNotice.tick()).toBe(true);
  });

  it("stays silent in notification quiet mode and when the source is muted, then sends once allowed", async () => {
    const { core } = await boot();
    await enable(core);
    clock.now = at("2026-11-09T10:00:00Z");
    core.runtime.notifications.setPreferences({ enabled: false });
    expect(core.runtime.recapNotice.tick()).toBe(false);
    core.runtime.notifications.setPreferences({ enabled: true, muted_sources: ["recap"] });
    expect(core.runtime.recapNotice.tick()).toBe(false);
    expect(notices(core)).toEqual([]);
    core.runtime.notifications.setPreferences({ muted_sources: [] });
    expect(core.runtime.recapNotice.tick()).toBe(true);
  });

  it("is blocked by the emergency stop, also when it engages after scheduling", async () => {
    const { core } = await boot();
    await enable(core);
    clock.now = at("2026-11-09T10:00:00Z");
    core.runtime.permissions.engageKillSwitch();
    expect(core.runtime.recapNotice.tick()).toBe(false);
    expect(notices(core)).toEqual([]);
    core.runtime.permissions.disengageKillSwitch();
    expect(core.runtime.recapNotice.tick()).toBe(true);
  });

  it("sends nothing for an empty week, and marks it handled", async () => {
    const { core } = await boot();
    await enable(core);
    clock.now = at("2026-11-23T10:00:00Z"); // week of 11-16 had no activity
    expect(core.runtime.recapNotice.tick()).toBe(false);
    expect(notices(core)).toEqual([]);
    expect(core.runtime.recapNotice.status().last_week).toBe("2026-W48");
  });

  it("writes the text in the chosen interface language and carries counts only", async () => {
    const { core } = await boot();
    await core.api("POST", "/api/ui/settings", { locale: "es" });
    await enable(core);
    clock.now = at("2026-11-09T10:00:00Z");
    core.runtime.recapNotice.tick();
    const [n] = notices(core);
    expect(n!.title).toBe("Tu resumen semanal está listo");
    expect(n!.body).toBe(
      "La semana pasada: 2 sesiones, 9 pasos, 4 commits, 0 permisos concedidos, 0 denegados. Abre el resumen para verlo.",
    );
  });

  it("never puts a project or agent name into the notice", async () => {
    const { core } = await boot();
    core.runtime.recap.bump(at("2026-11-04T10:00:00Z"), [
      { metric: "agent_steps", key: "claude-code", value: 5 },
      { metric: "project_steps", key: PROJECT_KEY, value: 5 },
    ]);
    await enable(core);
    clock.now = at("2026-11-09T10:00:00Z");
    core.runtime.recapNotice.tick();
    const [n] = notices(core);
    expect(`${n!.title} ${n!.body}`).not.toMatch(new RegExp(`${PROJECT_KEY}|claude-code`));
  });

  it("leaves the Kage proactive rules unchanged", async () => {
    const { core } = await boot();
    const viewer = core.runtime.memory.agentContext().viewer.id;
    // "recap" is not a Kage/proactive source: it cannot be opted into, or given a cadence, there.
    expect(
      (await core.api("POST", "/api/proactive/preferences", { capabilities: ["recap"] })).status,
    ).toBe(400);
    expect(
      (await core.api("POST", "/api/proactive/preferences", { enabled: true, cadenceMinutes: 15 }))
        .status,
    ).toBe(400);
    // A delivered recap notice is not a Kage insight: no counter, no rate-limit slot is used.
    await enable(core);
    clock.now = at("2026-11-09T10:00:00Z");
    expect(core.runtime.recapNotice.tick()).toBe(true);
    expect(core.runtime.notifications.noiseMetrics(viewer)).toMatchObject({
      delivered: 0,
      dismissed: 0,
      suppressed: 0,
    });
    // Kage insights still go through the policy: quiet hours suppress them and count it.
    core.runtime.proactive.setPreferences({
      enabled: true,
      capabilities: ["kage"],
      quietHours: { timezone: "UTC", start: "00:00", end: "23:59" },
    });
    const insight = {
      id: "i1",
      kind: "unassigned_action" as const,
      capabilityId: "kage",
      title: "t",
      body: "b",
      evidenceIds: ["i1"],
      subjectId: "i1",
    };
    expect(core.runtime.notifications.considerInsight(viewer, insight, () => true)).toBeNull();
    expect(core.runtime.notifications.noiseMetrics(viewer).suppressed).toBe(1);
    // Opted-out Kage stays refused even though the recap switch is on.
    core.runtime.proactive.setPreferences({ enabled: false });
    expect(core.runtime.notifications.considerInsight(viewer, insight, () => true)).toBeNull();
    expect(() => core.runtime.proactive.evaluate()).toThrow();
  });
});
