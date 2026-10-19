// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 69: a known test week is seeded through the real recorders (AgentLive steps, bus events,
// the audit log, meetings and their items) and the recap must equal the seed exactly. The week is
// Monday 2026-10-26 to Sunday 2026-11-01 in America/New_York, the week the clocks go back, so the
// boundaries are tested where a naive "7 x 24 h" week would be wrong.
import { AuditLog } from "@phoenix/permissions";
import { EventBus } from "@phoenix/event-bus";
import { silentLogger } from "@phoenix/logging";
import {
  EventStore,
  MeetingStore,
  openDatabase,
  RECAP_OTHER_KEY,
  RECAP_RENAMED_KEY,
  SettingsStore,
  type Database,
} from "@phoenix/persistence";
import { createEvent, ErrorCode, PhoenixError } from "@phoenix/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { AgentLive } from "../src/agent-live";
import { MAX_SESSION_LINES, MAX_STEP_LINES, RECAP_METRIC, RecapRuntime } from "../src/recap";
import { startCore, type TestCore } from "./helpers";

const ZONE = "America/New_York";
const WEEK = "2026-10-26";
const iso = (value: string) => Date.parse(value);

interface Rig {
  db: Database;
  bus: EventBus;
  clock: { now: number };
  recap: RecapRuntime;
  live: AgentLive;
  audit: AuditLog;
  meetings: MeetingStore;
  allowed: { meetings: boolean };
  at(when: string): void;
  step(agent: string, session: string, project: string, kind: string, over?: object): void;
  publish(type: string, source: string, when: string): Promise<void>;
  record(action: string, decision: "allowed" | "denied" | "info" | "blocked", when: string): void;
  item(meeting: string, kind: string, status: string, n: number): void;
}

const dbs: Database[] = [];
const recaps: RecapRuntime[] = [];
afterEach(() => {
  for (const r of recaps.splice(0)) r.close();
  for (const db of dbs.splice(0)) db.close();
});

function rig(existing?: Database): Rig {
  const db = existing ?? openDatabase(":memory:");
  if (!existing) dbs.push(db);
  const bus = new EventBus({ store: new EventStore(db) });
  const clock = { now: iso("2026-11-04T12:00:00Z") };
  const allowed = { meetings: true };
  const settings = new SettingsStore(db);
  const audit = new AuditLog(db, () => clock.now);
  const recap = new RecapRuntime({
    db,
    settings,
    bus,
    audit,
    meetingsAllowed: () => allowed.meetings,
    logger: silentLogger,
    now: () => clock.now,
    timeZone: ZONE,
  });
  recaps.push(recap);
  const live = new AgentLive({
    bus,
    settings,
    logger: silentLogger,
    now: () => clock.now,
    recap,
    permissions: {
      authorize: async (request) => ({ id: "act_1", request, authorizedAt: "t" }),
      recordOutcome: () => undefined,
    },
    orchestrated: { list: async () => [], get: async () => Promise.reject(new Error("none")) },
  });
  const meetings = new MeetingStore(db);
  let counter = 0;
  return {
    db,
    bus,
    clock,
    recap,
    live,
    audit,
    meetings,
    allowed,
    at: (when) => {
      clock.now = iso(when);
    },
    step(agent, session, project, kind, over = {}) {
      live.recordStep({
        agent,
        session_id: session,
        project,
        kind,
        tool: kind === "run" ? "Bash" : kind === "edit" ? "Edit" : "Read",
        target: "x",
        at: new Date(clock.now).toISOString(),
        ...over,
      });
    },
    async publish(type, source, when) {
      clock.now = iso(when);
      bus.publish(
        createEvent({
          event_type: type,
          source,
          severity: "info",
          timestamp: new Date(clock.now).toISOString(),
          payload: {},
        }),
      );
      await bus.drain();
    },
    record(action, decision, when) {
      clock.now = iso(when);
      audit.record({ actor: "user", action, decision, details: {} });
    },
    item(meeting, kind, status, n) {
      db.prepare(
        `INSERT INTO meeting_items (id, meeting_id, kind, text, status, extracted_by, dedupe_key, created_at)
         VALUES (?, ?, ?, 'x', ?, 'manual', ?, '2026-10-27T00:00:00Z')`,
      ).run(`item-${++counter}-${n}`, meeting, kind, status, `k${counter}`);
    },
  };
}

/** The known week. Every number asserted below is derived by hand from this list. */
async function seedWeek(r: Rig): Promise<void> {
  // Session A (claude-code in /work/alpha), Monday: 4 steps, 240 s of work (the 16 min gap is idle).
  r.at("2026-10-26T14:00:00Z");
  r.step("claude-code", "sess-a", "/work/alpha", "run");
  r.at("2026-10-26T14:02:00Z");
  r.step("claude-code", "sess-a", "/work/alpha", "edit", {
    file: { path: "/work/alpha/a.ts", added: 10, removed: 2 },
  });
  r.at("2026-10-26T14:04:00Z");
  r.step("claude-code", "sess-a", "/work/alpha", "edit", {
    file: { path: "/work/alpha/a.ts", added: 5, removed: 0 },
  });
  r.at("2026-10-26T14:20:00Z");
  r.step("claude-code", "sess-a", "/work/alpha", "read");
  // Session B (codex in /work/beta), Tuesday: 3 steps, 120 s.
  r.at("2026-10-27T13:00:00Z");
  r.step("codex", "sess-b", "/work/beta", "run");
  r.at("2026-10-27T13:01:00Z");
  r.step("codex", "sess-b", "/work/beta", "edit", {
    file: { path: "/work/beta/b.ts", added: 3, removed: 1 },
  });
  r.at("2026-10-27T13:02:00Z");
  r.step("codex", "sess-b", "/work/beta", "run");
  // Session C (claude-code in /work/alpha), Sunday evening: 6 reads 4 min apart = 1200 s.
  for (let i = 0; i < 6; i++) {
    r.at(new Date(iso("2026-11-02T04:00:00Z") + i * 4 * 60_000).toISOString());
    r.step("claude-code", "sess-c", "/work/alpha", "read");
  }
  // Just outside the week on both sides: Sunday 23:30 EDT before, Monday 00:10 EST after.
  r.at("2026-10-26T03:30:00Z");
  r.step("claude-code", "sess-prev", "/work/alpha", "read");
  r.at("2026-11-02T05:10:00Z");
  r.step("claude-code", "sess-next", "/work/alpha", "read");

  // Commits (git.commit.created from git): Mon x2, Wed x1, Sun x1 in the week; one on each side.
  for (const when of [
    "2026-10-26T15:00:00Z",
    "2026-10-26T16:00:00Z",
    "2026-10-28T15:00:00Z",
    "2026-11-02T04:30:00Z",
  ])
    await r.publish("git.commit.created", "git", when);
  await r.publish("git.commit.created", "git", "2026-10-26T03:00:00Z"); // Sun 23:00 EDT: last week
  await r.publish("git.commit.created", "git", "2026-11-02T05:30:00Z"); // Mon 00:30 EST: next week
  // A forged commit and forged CI from a source that does not own the event family.
  await r.publish("git.commit.created", "terminal", "2026-10-27T15:00:00Z");
  await r.publish("github.ci.failed", "terminal", "2026-10-27T15:00:00Z");
  // CI: 2 passed, 1 failed.
  await r.publish("github.ci.passed", "github", "2026-10-27T17:00:00Z");
  await r.publish("github.ci.passed", "github", "2026-10-28T17:00:00Z");
  await r.publish("github.ci.failed", "github", "2026-10-28T18:00:00Z");

  // Permissions. Boundaries: Mon 00:00:00 EDT is in, Sun 23:59:59 EDT (the 25th) is out,
  // Sun 23:59:59 EST is in, Mon 00:00:00 EST (the 2nd) is out.
  r.record("agent_approval.resolved", "allowed", "2026-10-26T04:00:00Z"); // in (boundary)
  r.record("agent_approval.resolved", "allowed", "2026-10-26T03:59:59Z"); // out
  r.record("agent_approval.resolved", "allowed", "2026-10-26T14:00:00Z"); // in
  r.record("agent_approval.resolved", "denied", "2026-10-26T14:05:00Z"); // in
  r.record("confirmation.approved", "allowed", "2026-10-27T12:00:00Z"); // in
  r.record("confirmation.rejected", "denied", "2026-10-27T12:10:00Z"); // in
  r.record("confirmation.expired", "denied", "2026-10-27T12:20:00Z"); // in
  r.record("agent_approval.resolved", "denied", "2026-11-02T04:59:59Z"); // in (boundary)
  r.record("agent_approval.resolved", "denied", "2026-11-02T05:00:00Z"); // out
  r.record("permission.granted", "info", "2026-10-28T12:00:00Z"); // not a decision the user took
  r.record("action.authorized", "allowed", "2026-10-28T12:00:00Z"); // automatic, not a grant
  r.record("confirmation.requested", "info", "2026-10-28T12:00:00Z");

  // Meetings: two in the week (Tue; Sunday evening EST), one deleted, one next week.
  const upsert = (id: string, startedAt: string) =>
    r.meetings.upsert({ capabilityId: "kage", externalId: id, status: "ready", startedAt });
  upsert("m1", "2026-10-27T15:00:00Z");
  upsert("m2", "2026-11-02T04:30:00Z");
  upsert("m3", "2026-11-02T05:30:00Z");
  upsert("m4", "2026-10-28T15:00:00Z");
  r.item("kage:m1", "decision", "accepted", 1); // counts
  r.item("kage:m1", "decision", "proposed", 2); // not reviewed
  r.item("kage:m1", "decision", "rejected", 3); // rejected
  r.item("kage:m1", "action_item", "accepted", 4); // not a decision
  r.item("kage:m2", "decision", "edited", 5); // counts
  r.item("kage:m3", "decision", "accepted", 6); // next week
  r.item("kage:m4", "decision", "accepted", 7); // meeting deleted below
  r.meetings.delete("kage:m4");

  r.at("2026-11-04T12:00:00Z"); // Wednesday of the following week
}

const EMPTY_GRID_WEEK = [0, 0, 0, 0, 0, 0, 0];

describe("the recap of a seeded week equals the seed", () => {
  it("every number, including week boundaries on the DST change", async () => {
    const r = rig();
    await seedWeek(r);
    const recap = r.recap.recap(WEEK);

    expect(recap.week).toEqual({
      start: "2026-10-26",
      end: "2026-11-01",
      days: [
        "2026-10-26",
        "2026-10-27",
        "2026-10-28",
        "2026-10-29",
        "2026-10-30",
        "2026-10-31",
        "2026-11-01",
      ],
      time_zone: ZONE,
      current: false,
    });
    expect(recap.coding).toEqual({
      seconds: 240 + 120 + 1200,
      sessions: 3,
      steps: 4 + 3 + 6,
      files: 2,
      lines_added: 15 + 3,
      lines_removed: 2 + 1,
      lines_changed: 21,
      commands: 3,
      longest_session_seconds: 1200,
    });
    expect(recap.permissions).toEqual({ granted: 3, denied: 4 });
    expect(recap.top_agent).toEqual({ name: "claude-code", steps: 10 });
    expect(recap.top_project).toEqual({ name: "alpha", steps: 10 });
    expect(recap.busiest_day).toEqual({ day: "2026-11-01", steps: 6, seconds: 1200 });
    expect(recap.days).toEqual([
      { day: "2026-10-26", steps: 4, seconds: 240, commits: 2 },
      { day: "2026-10-27", steps: 3, seconds: 120, commits: 0 },
      { day: "2026-10-28", steps: 0, seconds: 0, commits: 1 },
      { day: "2026-10-29", steps: 0, seconds: 0, commits: 0 },
      { day: "2026-10-30", steps: 0, seconds: 0, commits: 0 },
      { day: "2026-10-31", steps: 0, seconds: 0, commits: 0 },
      { day: "2026-11-01", steps: 6, seconds: 1200, commits: 1 },
    ]);
    expect(recap.commits).toBe(4);
    expect(recap.ci).toEqual({ passed: 2, failed: 1 });
    expect(recap.meetings).toEqual({ count: 2, decisions: 2 });
    expect(recap.meetings_allowed).toBe(true);
    expect(recap.grid.source).toBe("local-git-events");
    expect(recap.grid.weeks).toHaveLength(53);
    const last = recap.grid.weeks.at(-1)!;
    expect([last.start, last.days.map((d) => d.count)]).toEqual([WEEK, [2, 0, 1, 0, 0, 0, 1]]);
    expect(recap.grid.weeks.at(-2)!.days.map((d) => d.count)).toEqual([0, 0, 0, 0, 0, 0, 1]);
    expect(recap.grid.total).toBe(5); // the 4 in the week and the one on the Sunday before
    expect(recap.grid.max).toBe(2);
  });

  it("the neighbouring weeks hold exactly what falls just outside this one", async () => {
    const r = rig();
    await seedWeek(r);
    const next = r.recap.recap(undefined); // today is Wed 2026-11-04
    expect(next.week).toMatchObject({ start: "2026-11-02", end: "2026-11-08", current: true });
    expect(next.coding).toMatchObject({ steps: 1, sessions: 1, seconds: 0 });
    expect(next.commits).toBe(1);
    expect(next.permissions).toEqual({ granted: 0, denied: 1 });
    expect(next.meetings).toEqual({ count: 1, decisions: 1 });
    expect(next.busiest_day).toEqual({ day: "2026-11-02", steps: 1, seconds: 0 });
    // The grid shows no day after today.
    expect(next.grid.weeks.at(-1)!.days.map((d) => d.count)).toEqual([1, 0, 0, 0, 0, 0, 0]);

    const before = r.recap.recap("2026-10-19");
    expect(before.coding.steps).toBe(1);
    expect(before.commits).toBe(1);
    expect(before.permissions).toEqual({ granted: 1, denied: 0 });
  });

  it("any day of the week selects the week; Sunday belongs to the week before Monday", async () => {
    const r = rig();
    await seedWeek(r);
    for (const day of ["2026-10-26", "2026-10-29", "2026-11-01"])
      expect(r.recap.recap(day).coding.steps, day).toBe(13);
    expect(r.recap.recap("2026-11-02").coding.steps).toBe(1);
  });

  it("survives the capped events table: the numbers do not come from the events", async () => {
    const r = rig();
    await seedWeek(r);
    const before = r.recap.recap(WEEK);
    expect(r.db.prepare("DELETE FROM events").run().changes).toBeGreaterThan(0);
    expect(r.recap.recap(WEEK)).toEqual(before);
  });

  it("an empty week is all zeros with nothing to rank", () => {
    const r = rig();
    const recap = r.recap.recap("2026-01-14");
    expect(recap.week.start).toBe("2026-01-12");
    expect(recap.coding).toEqual({
      seconds: 0,
      sessions: 0,
      steps: 0,
      files: 0,
      lines_added: 0,
      lines_removed: 0,
      lines_changed: 0,
      commands: 0,
      longest_session_seconds: 0,
    });
    expect(recap.permissions).toEqual({ granted: 0, denied: 0 });
    expect([recap.top_agent, recap.top_project, recap.busiest_day]).toEqual([null, null, null]);
    expect([recap.commits, recap.ci, recap.meetings]).toEqual([
      0,
      { passed: 0, failed: 0 },
      { count: 0, decisions: 0 },
    ]);
    expect(recap.grid.total).toBe(0);
    expect(recap.days.map((d) => d.steps)).toEqual(EMPTY_GRID_WEEK);
  });

  it("leaves meetings and decisions out while sensitive meeting data is off", async () => {
    const r = rig();
    await seedWeek(r);
    r.allowed.meetings = false;
    const recap = r.recap.recap(WEEK);
    expect([recap.meetings, recap.meetings_allowed]).toEqual([null, false]);
    expect(JSON.stringify(recap)).not.toContain("kage:m");
    // Everything else is unchanged.
    expect(recap.commits).toBe(4);
  });

  it("a longer pause is not coding time and a restart does not extend a session", () => {
    const r = rig();
    r.at("2026-10-26T14:00:00Z");
    r.step("claude-code", "s", "/work/alpha", "run");
    r.at("2026-10-26T14:05:00Z"); // exactly the idle limit: counted
    r.step("claude-code", "s", "/work/alpha", "read");
    r.at("2026-10-26T14:10:01Z"); // 5 min 1 s: not counted
    r.step("claude-code", "s", "/work/alpha", "read");
    expect(r.recap.recap(WEEK).coding).toMatchObject({
      seconds: 300,
      longest_session_seconds: 300,
      steps: 3,
      sessions: 1,
    });
  });

  it("keeps the longest session across days, not the sum of sessions", () => {
    const r = rig();
    for (const [session, start, minutes] of [
      ["s1", "2026-10-26T14:00:00Z", 3],
      ["s2", "2026-10-26T18:00:00Z", 2],
    ] as const) {
      for (let i = 0; i <= minutes; i++) {
        r.at(new Date(iso(start) + i * 60_000).toISOString());
        r.step("claude-code", session, "/work/alpha", "read");
      }
    }
    const recap = r.recap.recap(WEEK).coding;
    expect([recap.seconds, recap.longest_session_seconds]).toEqual([300, 180]);
  });

  it("ties for top agent go to the name that sorts first; the (other) bucket never wins", () => {
    const r = rig();
    r.at("2026-10-26T14:00:00Z");
    r.step("zeta", "s1", "/work/p", "read");
    r.step("alpha-agent", "s2", "/work/q", "read");
    expect(r.recap.recap(WEEK).top_agent).toEqual({ name: "alpha-agent", steps: 1 });
    // More distinct names than the daily cap: the rest is pooled and cannot be "top".
    for (let i = 0; i < 25; i++) r.step(`bulk-${i}`, `s-${i}`, "/work/q", "read");
    const top = r.recap.recap(WEEK).top_agent;
    expect(top?.name).not.toBe("(other)");
  });

  it("rejects a week that is not a real day", () => {
    const r = rig();
    for (const week of ["2026-02-30", "26-10-26", "yesterday", "1999-12-31", "2101-01-01", ""]) {
      let caught: unknown;
      try {
        r.recap.recap(week);
      } catch (err) {
        caught = err;
      }
      expect(caught, week).toBeInstanceOf(PhoenixError);
      expect((caught as PhoenixError).code).toBe(ErrorCode.INVALID_REQUEST);
    }
  });
});

describe("what already happened before the recap existed", () => {
  it("counts commits and CI from the events table once, from the owning capability only", async () => {
    const db = openDatabase(":memory:");
    dbs.push(db);
    const store = new EventStore(db);
    const old = (type: string, source: string, timestamp: string) =>
      store.append(createEvent({ event_type: type, source, severity: "info", timestamp }));
    old("git.commit.created", "git", "2026-10-27T15:00:00Z");
    old("git.commit.created", "terminal", "2026-10-27T15:00:00Z"); // forged
    old("github.ci.failed", "github", "2026-10-28T15:00:00Z");
    old("github.ci.failed", "terminal", "2026-10-28T15:00:00Z"); // forged
    const first = rig(db);
    expect(first.recap.recap(WEEK)).toMatchObject({ commits: 1, ci: { passed: 0, failed: 1 } });
    first.recap.close();
    // A second start does not count the same events again.
    const second = rig(db);
    expect(second.recap.recap(WEEK)).toMatchObject({ commits: 1, ci: { passed: 0, failed: 1 } });
  });
});

describe("delete all", () => {
  it("removes every recap row and is audited without content", async () => {
    const r = rig();
    await seedWeek(r);
    expect(r.recap.store.count()).toBeGreaterThan(0);
    const { deleted } = r.recap.deleteAll();
    expect(deleted).toBeGreaterThan(0);
    expect(r.recap.store.count()).toBe(0);
    expect(r.recap.recap(WEEK).coding.steps).toBe(0);
    const entry = r.audit.list({ limit: 1 })[0]!;
    expect([entry.action, entry.details]).toEqual(["recap.stats.delete", { deleted }]);
  });

  it("the stored rows hold counts and names only: no path, command or text", async () => {
    const r = rig();
    await seedWeek(r);
    const stored = JSON.stringify(r.db.prepare("SELECT * FROM recap_daily").all());
    for (const secret of ["/work/", "a.ts", "b.ts", "npm"]) expect(stored).not.toContain(secret);
    expect(stored).toContain("alpha");
    expect(RECAP_METRIC.steps).toBe("steps");
  });
});

describe("what a token holder can and cannot make the recap count", () => {
  const stored = (r: Rig, metric: string) =>
    r.db.prepare("SELECT day, key, value FROM recap_daily WHERE metric = ?").all(metric);

  it("drops events older than the retention window, live and from the backfill", async () => {
    const old = "2020-01-06T12:00:00Z";
    const db = openDatabase(":memory:");
    dbs.push(db);
    const events = new EventStore(db);
    events.append(
      createEvent({
        event_type: "git.commit.created",
        source: "git",
        severity: "info",
        timestamp: old,
      }),
    );
    events.append(
      createEvent({
        event_type: "git.commit.created",
        source: "git",
        severity: "info",
        timestamp: "2026-10-27T15:00:00Z",
      }),
    );
    const r = rig(db);
    expect(stored(r, RECAP_METRIC.commits)).toEqual([{ day: "2026-10-27", key: "", value: 1 }]);
    r.bus.publish(
      createEvent({
        event_type: "git.commit.created",
        source: "git",
        severity: "info",
        timestamp: old,
      }),
    );
    r.bus.publish(
      createEvent({
        event_type: "git.commit.created",
        source: "git",
        severity: "info",
        timestamp: "2026-11-03T15:00:00Z",
      }),
    );
    await r.bus.drain();
    expect(stored(r, RECAP_METRIC.commits)).toEqual([
      { day: "2026-10-27", key: "", value: 1 },
      { day: "2026-11-03", key: "", value: 1 },
    ]);
  });

  it("bounds the lines one step and one session can add to the totals", () => {
    const r = rig();
    r.at("2026-11-04T12:00:00Z");
    r.step("codex", "sess-big", "/work/big", "edit", {
      file: { path: "/work/big/a.ts", added: 900_000, removed: 5 },
    });
    expect(stored(r, RECAP_METRIC.linesAdded)).toEqual([
      { day: "2026-11-04", key: "", value: MAX_STEP_LINES },
    ]);
    expect(stored(r, RECAP_METRIC.linesRemoved)).toEqual([
      { day: "2026-11-04", key: "", value: 5 },
    ]);
    for (let i = 0; i < 20; i++)
      r.step("codex", "sess-big", "/work/big", "edit", {
        file: { path: "/work/big/a.ts", added: 900_000, removed: 0 },
      });
    expect(stored(r, RECAP_METRIC.linesAdded)).toEqual([
      { day: "2026-11-04", key: "", value: MAX_SESSION_LINES },
    ]);
  });

  it("a project named (other) does not merge into the overflow bucket", () => {
    const r = rig();
    r.at("2026-11-04T12:00:00Z");
    r.step("codex", "sess-o", "/work/(other)", "read");
    const keys = stored(r, RECAP_METRIC.projectSteps).map((row) => String(row.key));
    expect(keys).not.toContain(RECAP_OTHER_KEY);
    expect(keys).toEqual([RECAP_RENAMED_KEY]);
  });

  it("after delete all, a running session does not bring its earlier time back", () => {
    const r = rig();
    for (const at of ["12:00:00", "12:02:00", "12:04:00"]) {
      r.at(`2026-11-04T${at}Z`);
      r.step("codex", "sess-live", "/work/live", "read");
    }
    expect(stored(r, RECAP_METRIC.longestSessionMs)).toEqual([
      { day: "2026-11-04", key: "", value: 240_000 },
    ]);
    r.recap.deleteAll();
    r.at("2026-11-04T12:06:00Z");
    r.step("codex", "sess-live", "/work/live", "read");
    // Only the two minutes since the delete count, not 360 s from before it.
    expect(stored(r, RECAP_METRIC.longestSessionMs)).toEqual([
      { day: "2026-11-04", key: "", value: 120_000 },
    ]);
    expect(stored(r, RECAP_METRIC.activeMs)).toEqual([
      { day: "2026-11-04", key: "", value: 120_000 },
    ]);
  });
});

let core: TestCore | undefined;
afterEach(async () => {
  await core?.runtime.stop();
  core = undefined;
});

describe("recap routes", () => {
  it("require the session token", async () => {
    core = await startCore();
    for (const [method, path] of [
      ["GET", "/api/recap"],
      ["DELETE", "/api/recap?confirm=true"],
    ] as const) {
      const res = await fetch(core.base + path, { method });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it("validates the week and refuses unknown parameters", async () => {
    core = await startCore();
    expect((await core.api("GET", "/api/recap?week=2026-02-30")).status).toBe(400);
    expect((await core.api("GET", "/api/recap?week=nope")).status).toBe(400);
    expect((await core.api("GET", "/api/recap?weeks=2")).status).toBe(400);
    expect((await core.api("GET", "/api/recap?week=2026-10-29")).status).toBe(200);
  });

  it("reports steps that hooks sent, then delete needs confirmation and empties them", async () => {
    core = await startCore({}, { runtime: { recapTimeZone: "UTC" } });
    const sent = await core.api("POST", "/api/agent/live/step", {
      agent: "claude-code",
      session_id: "route-session",
      project: "/work/gamma",
      kind: "edit",
      tool: "Edit",
      target: "x",
      at: new Date().toISOString(),
      file: { path: "/work/gamma/g.ts", added: 7, removed: 4 },
    });
    expect(sent.status).toBe(200);
    const recap = (await core.api("GET", "/api/recap")).json;
    expect(recap.coding).toMatchObject({
      steps: 1,
      sessions: 1,
      files: 1,
      lines_added: 7,
      lines_removed: 4,
    });
    expect(recap.top_project).toEqual({ name: "gamma", steps: 1 });

    const refused = await core.api("DELETE", "/api/recap");
    expect([refused.status, refused.json.code]).toEqual([409, "ACTION_REQUIRES_CONFIRMATION"]);
    expect((await core.api("GET", "/api/recap")).json.coding.steps).toBe(1);

    const done = await core.api("DELETE", "/api/recap?confirm=true");
    expect(done.status).toBe(200);
    expect(done.json.deleted).toBeGreaterThan(0);
    expect((await core.api("GET", "/api/recap")).json.coding.steps).toBe(0);
    const audit = (await core.api("GET", "/api/audit")).json.entries as { action: string }[];
    expect(audit.map((e) => e.action)).toContain("recap.stats.delete");
  });

  it("is listed in the privacy inventory and deleted by privacy delete-all, which events delete-all leaves alone", async () => {
    core = await startCore({}, { runtime: { recapTimeZone: "UTC" } });
    core.runtime.recap.bump(Date.now(), [{ metric: "steps", value: 3 }]);
    const inventory = (await core.api("GET", "/api/privacy")).json.derived as {
      id: string;
      count: number;
    }[];
    expect(inventory.find((d) => d.id === "recap")?.count).toBe(1);

    await core.api("POST", "/api/privacy/delete", { data: "events", confirm: true });
    expect(core.runtime.recap.store.count()).toBe(1); // the point of the recap: it outlives the events
    expect(
      (await core.api("POST", "/api/privacy/delete", { data: "recap", confirm: true })).json,
    ).toEqual({ deleted: 1 });
    expect(core.runtime.recap.store.count()).toBe(0);
    expect((await core.api("POST", "/api/privacy/delete", { data: "recap" })).json.code).toBe(
      "ACTION_REQUIRES_CONFIRMATION",
    );
  });
});
