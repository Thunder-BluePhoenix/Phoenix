// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Live agent sessions inside Core with a real event bus and a real SQLite settings store. The
// orchestrated-session port, the terminal focuser and git are fakes; no agent, terminal window or
// real service is touched.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  LinkView,
  SessionDetail,
  SessionView,
  TerminalFocuser,
} from "@phoenix/capability-agents";
import { EventBus } from "@phoenix/event-bus";
import { silentLogger } from "@phoenix/logging";
import { openDatabase, SettingsStore, type Database } from "@phoenix/persistence";
import { ErrorCode, PhoenixError, type PhoenixEvent } from "@phoenix/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { FAKE_GITHUB_TOKEN } from "../../../protocol/testing/fake-secrets";
import { AgentLive, FIRED_KEY, MAX_LIVE_SESSIONS, THRESHOLDS_KEY } from "../src/agent-live";

const T0 = Date.parse("2026-10-16T10:00:00Z");
const PH = "ph-0123456789abcdef";
const LIVE = "5f1c1b0e-6a0e-4f43-8d7d-0a6a3f4b2c11";

const dirs: string[] = [];
const dbs: Database[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  for (const db of dbs.splice(0)) db.close();
});
function project(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "phoenix-live-")));
  dirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

interface Rig {
  live: AgentLive;
  events: { event: PhoenixEvent; ephemeral: boolean }[];
  settings: SettingsStore;
  db: Database;
  clock: { now: number };
  authorized: string[];
  outcomes: string[];
  focused: unknown[];
  ph: { sessions: SessionView[]; details: Record<string, SessionDetail> };
}

function rig(over: { focuser?: TerminalFocuser | null; deny?: boolean; db?: Database } = {}): Rig {
  const db = over.db ?? openDatabase(":memory:");
  if (!over.db) dbs.push(db);
  const bus = new EventBus();
  const events: Rig["events"] = [];
  bus.subscribe("test", "*", (event, info) => {
    events.push({ event, ephemeral: info.ephemeral });
  });
  const settings = new SettingsStore(db);
  const clock = { now: T0 };
  const authorized: string[] = [];
  const outcomes: string[] = [];
  const focused: unknown[] = [];
  const ph: Rig["ph"] = { sessions: [], details: {} };
  const focuser: TerminalFocuser = {
    platform: "linux",
    focus: async (target) => {
      focused.push(target);
      return { focused: true, method: "fake" };
    },
  };
  const live = new AgentLive({
    bus,
    settings,
    logger: silentLogger,
    now: () => clock.now,
    permissions: {
      authorize: async (request) => {
        authorized.push(`${request.command}:${request.sideEffect}:${request.summary}`);
        if (over.deny) throw new PhoenixError(ErrorCode.PERMISSION_DENIED, "denied");
        return { id: "act_1", request, authorizedAt: "t" };
      },
      recordOutcome: (_action, outcome) => void outcomes.push(outcome),
    },
    orchestrated: {
      list: async () => ph.sessions,
      get: async (id) => {
        const detail = ph.details[id];
        if (!detail) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Unknown session");
        return detail;
      },
    },
    ...(over.focuser === null ? {} : { focuser: over.focuser ?? focuser }),
  });
  return { live, events, settings, db, clock, authorized, outcomes, focused, ph };
}

const step = (cwd: string, over: Record<string, unknown> = {}) => ({
  agent: "claude-code",
  session_id: LIVE,
  project: cwd,
  kind: "run",
  tool: "Bash",
  target: "npm test",
  at: new Date(T0).toISOString(),
  ...over,
});
const flush = () => {
  const done = Promise.withResolvers<void>();
  setImmediate(() => done.resolve());
  return done.promise;
};
const phSession = (workspace: string, over: Partial<SessionView> = {}): SessionView => ({
  id: PH,
  launcher: "fake",
  workspace,
  repository: "p",
  state: "completed",
  started_at: new Date(T0 - 60_000).toISOString(),
  ended_at: new Date(T0 + 60_000).toISOString(),
  accepts_input: false,
  messages_sent: 0,
  output: {
    stdout: { lines: 0, dropped_lines: 0, truncated_lines: 0, bytes_seen: 0 },
    stderr: { lines: 0, dropped_lines: 0, truncated_lines: 0, bytes_seen: 0 },
  },
  ...over,
});
const link = (over: Partial<LinkView>): LinkView => ({
  id: 1,
  session_id: PH,
  kind: "commit",
  ref: "abc1234",
  repo: "p",
  confidence: "time+path",
  source: "e",
  why: {},
  created_at: new Date(T0).toISOString(),
  ...over,
});

describe("recordStep", () => {
  it("emits an ephemeral agent.session.step event with the step and cumulative file totals", async () => {
    const r = rig();
    const cwd = project();
    r.live.recordStep(
      step(cwd, {
        kind: "edit",
        tool: "Edit",
        target: `${cwd}/a.ts`,
        file: { path: `${cwd}/a.ts`, added: 2, removed: 1 },
      }),
    );
    r.live.recordStep(
      step(cwd, {
        kind: "edit",
        tool: "Edit",
        target: `${cwd}/a.ts`,
        file: { path: `${cwd}/a.ts`, added: 3, removed: 0 },
      }),
    );
    await flush();
    const steps = r.events.filter((e) => e.event.event_type === "agent.session.step");
    expect(steps).toHaveLength(2);
    expect(steps.every((e) => e.ephemeral)).toBe(true);
    expect(steps[1]!.event.payload).toMatchObject({
      agent: "claude-code",
      session_id: LIVE,
      project: cwd,
      n: 2,
      kind: "edit",
      file: { path: `${cwd}/a.ts`, added: 5, removed: 1, edits: 2 },
    });
    expect((await r.live.session(LIVE)).files).toMatchObject([
      { path: `${cwd}/a.ts`, added: 5, removed: 1, edits: 2, session_id: LIVE },
    ]);
  });

  it("rejects an invalid step and emits nothing", async () => {
    const r = rig();
    expect(() => r.live.recordStep({ nope: 1 })).toThrow(PhoenixError);
    expect(() => r.live.recordStep(step("relative"))).toThrow(/Invalid/);
    await flush();
    expect(r.events).toEqual([]);
  });

  it("redacts again on arrival: a secret a hook sent never reaches state or the event", async () => {
    const r = rig();
    r.live.recordStep(step(project(), { target: `curl ${FAKE_GITHUB_TOKEN}` }));
    await flush();
    expect(JSON.stringify(r.events)).not.toContain(FAKE_GITHUB_TOKEN);
    expect(JSON.stringify(await r.live.session(LIVE))).not.toContain(FAKE_GITHUB_TOKEN);
  });

  it("keeps at most 500 steps per session and says how many were dropped", async () => {
    const r = rig();
    const cwd = project();
    for (let i = 0; i < 520; i++) r.live.recordStep(step(cwd, { target: `cmd ${i}` }));
    const detail = await r.live.session(LIVE);
    expect(detail.steps).toHaveLength(500);
    expect(detail.steps[0]!.target).toBe("cmd 20");
    expect(detail.steps.at(-1)!.target).toBe("cmd 519");
    expect(detail.dropped_steps).toBe(20);
    expect(detail.sessions[0]).toMatchObject({ step_count: 520, dropped_steps: 20, id: LIVE });
  });

  it("bounds the number of sessions, dropping the least recently heard from", () => {
    const r = rig();
    const cwd = project();
    for (let i = 0; i < MAX_LIVE_SESSIONS + 3; i++) {
      r.clock.now += 1000;
      r.live.recordStep(step(cwd, { session_id: `s-${i}` }));
    }
    const ids = r.live.sessions().map((s) => s.id);
    expect(ids).toHaveLength(MAX_LIVE_SESSIONS);
    expect(ids).not.toContain("s-0");
    expect(ids).toContain(`s-${MAX_LIVE_SESSIONS + 2}`);
  });

  it("lists sessions newest first with the active flag and terminal knowledge", () => {
    const r = rig();
    const cwd = project();
    r.live.recordStep(step(cwd, { session_id: "old" }));
    r.clock.now += 20 * 60_000;
    r.live.recordStep(step(cwd, { session_id: "new", tty: "/dev/ttys001", pid: 99 }));
    const [a, b] = r.live.sessions();
    expect([a!.id, a!.active, a!.has_terminal]).toEqual(["new", true, true]);
    expect([b!.id, b!.active, b!.has_terminal]).toEqual(["old", false, false]);
  });
});

describe("session lookup", () => {
  it("an unknown or malformed live id is RESOURCE_NOT_FOUND", async () => {
    const r = rig();
    await expect(r.live.session("nope")).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_NOT_FOUND,
    });
    await expect(r.live.session("../etc")).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_NOT_FOUND,
    });
    await expect(r.live.session(PH)).rejects.toMatchObject({ code: ErrorCode.RESOURCE_NOT_FOUND });
  });

  it("a ph- session matches live sessions by folder and time (and says so)", async () => {
    const r = rig();
    const cwd = project();
    r.ph.sessions = [phSession(cwd)];
    r.ph.details[PH] = { session: phSession(cwd), links: [], ambiguous: [], timeline: [] };
    r.live.recordStep(step(cwd, { session_id: "inside" }));
    r.live.recordStep(step(`${cwd}/sub`, { session_id: "nested" }));
    r.live.recordStep(step(`${cwd}-sibling`, { session_id: "other-folder" }));
    const detail = await r.live.session(PH);
    expect(detail.matched_by).toBe("folder+time");
    expect(detail.sessions.map((s) => s.id).sort()).toEqual(["inside", "nested"]);
    r.clock.now += 3 * 3600_000;
    r.live.recordStep(step(cwd, { session_id: "much-later" }));
    expect((await r.live.session(PH)).sessions.map((s) => s.id)).not.toContain("much-later");
  });

  it("a ph- session with no live match is an empty, honest result", async () => {
    const r = rig();
    r.ph.details[PH] = { session: phSession(project()), links: [], ambiguous: [], timeline: [] };
    expect(await r.live.session(PH)).toMatchObject({
      matched_by: "folder+time",
      sessions: [],
      steps: [],
    });
  });
});

describe("diff", () => {
  it("is computed on demand from git, with commits and CI runs from the existing links only", async () => {
    const r = rig();
    const cwd = project();
    writeFileSync(join(cwd, "a.ts"), "x\n");
    execFileSync("git", ["add", "."], { cwd });
    execFileSync("git", ["-c", "user.email=t@e.x", "-c", "user.name=t", "commit", "-qm", "i"], {
      cwd,
    });
    writeFileSync(join(cwd, "a.ts"), "x\ny\n");
    r.live.recordStep(
      step(cwd, {
        kind: "edit",
        tool: "Edit",
        target: `${cwd}/a.ts`,
        file: { path: `${cwd}/a.ts`, added: 1, removed: 0 },
      }),
    );
    r.ph.sessions = [phSession(cwd)];
    r.ph.details[PH] = {
      session: phSession(cwd),
      links: [
        link({}),
        link({ id: 2, kind: "ci_run", ref: "9", detail: { conclusion: "failure" } }),
      ],
      ambiguous: [],
      timeline: [],
    };
    const viaLive = await r.live.diff(LIVE, `${cwd}/a.ts`);
    expect(viaLive).toMatchObject({
      session_id: LIVE,
      path: "a.ts",
      source: "git diff HEAD",
      truncated: false,
    });
    expect(viaLive.diff).toContain("+y");
    expect(viaLive.commits).toMatchObject([{ ref: "abc1234", repo: "p" }]);
    expect(viaLive.ci_runs).toMatchObject([{ ref: "9", conclusion: "failure" }]);
    // Via the orchestrated id: same associations, nothing invented.
    const viaPh = await r.live.diff(PH, "a.ts");
    expect(viaPh.commits).toEqual(viaLive.commits);
  });

  it("links nothing when the session is not associated with an orchestrated one", async () => {
    const r = rig();
    const cwd = project();
    writeFileSync(join(cwd, "a.ts"), "x\n");
    r.live.recordStep(step(cwd));
    const out = await r.live.diff(LIVE, "a.ts");
    expect(out.commits).toEqual([]);
    expect(out.ci_runs).toEqual([]);
  });

  it("refuses paths outside the project: `..`, absolute, symlink", async () => {
    const r = rig();
    const cwd = project();
    const outside = project();
    writeFileSync(join(outside, "secret"), "s");
    symlinkSync(join(outside, "secret"), join(cwd, "link"));
    mkdirSync(join(cwd, "d"));
    r.live.recordStep(step(cwd));
    for (const p of ["../x", "d/../../x", join(outside, "secret"), "/etc/passwd", "link"]) {
      await expect(r.live.diff(LIVE, p), p).rejects.toMatchObject({
        code: ErrorCode.INVALID_REQUEST,
      });
    }
  });

  it("404s a session with no live data", async () => {
    await expect(rig().live.diff(LIVE, "a.ts")).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_NOT_FOUND,
    });
  });
});

describe("focusTerminal asks first, then focuses", () => {
  it("authorizes a confirmed `execute` action before calling the focuser, and audits the outcome", async () => {
    const r = rig();
    const cwd = project();
    r.live.recordStep(step(cwd, { tty: "/dev/ttys004", pid: 77 }));
    const out = await r.live.focusTerminal(LIVE);
    expect(out).toEqual({ focused: true, method: "fake" });
    expect(r.authorized).toHaveLength(1);
    expect(r.authorized[0]).toMatch(/^session\.focus_terminal:execute:/);
    expect(r.focused).toEqual([{ project: cwd, pid: 77, tty: "/dev/ttys004" }]);
    expect(r.outcomes).toEqual(["succeeded"]);
  });

  it("does not start anything when the user declines", async () => {
    const r = rig({ deny: true });
    r.live.recordStep(step(project()));
    await expect(r.live.focusTerminal(LIVE)).rejects.toMatchObject({
      code: ErrorCode.PERMISSION_DENIED,
    });
    expect(r.focused).toEqual([]);
  });

  it("records a failed focus and passes the error on", async () => {
    const r = rig({
      focuser: {
        platform: "linux",
        focus: async () => {
          throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "no window");
        },
      },
    });
    r.live.recordStep(step(project()));
    await expect(r.live.focusTerminal(LIVE)).rejects.toThrow("no window");
    expect(r.outcomes).toEqual(["failed"]);
  });

  it("explains an unsupported system and an unknown session without asking anything", async () => {
    const r = rig({ focuser: null });
    r.live.recordStep(step(project()));
    await expect(r.live.focusTerminal(LIVE)).rejects.toThrow(/not supported/);
    await expect(r.live.focusTerminal("unknown")).rejects.toMatchObject({
      code: ErrorCode.RESOURCE_NOT_FOUND,
    });
    expect(r.authorized).toEqual([]);
  });
});

describe("export", () => {
  it("renders sanitized Markdown from steps, files, timeline and existing links", async () => {
    const r = rig();
    const cwd = project();
    r.live.recordStep(step(cwd, { target: "echo [x](javascript:alert(1)) <img src=x onerror=1>" }));
    r.ph.details[PH] = {
      session: phSession(cwd),
      links: [link({})],
      ambiguous: [],
      timeline: [{ at: "t0", kind: "session.started", detail: { launcher: "fake" } }],
    };
    const md = await r.live.exportMarkdown(PH);
    expect(md).toContain("# Agent session ph\\-0123456789abcdef");
    expect(md).toContain("session\\.started");
    expect(md).toContain("` abc1234 `");
    expect(md).toContain("` echo [x](javascript:alert(1)) <img src=x onerror=1> `");
  });
});

describe("plan usage and warnings", () => {
  const body = (used: number, over: Record<string, unknown> = {}) => ({
    agent: "claude-code",
    samples: [
      { window: "5h", used_pct: used, resets_at: new Date(T0 + 3600_000).toISOString(), ...over },
    ],
  });

  it("emits agent.usage.updated (ephemeral) per sample and exposes levels, thresholds and Codex as unsupported", async () => {
    const r = rig();
    expect(r.live.recordUsage(body(50))).toEqual({ accepted: 1 });
    await flush();
    const updated = r.events.filter((e) => e.event.event_type === "agent.usage.updated");
    expect(updated).toHaveLength(1);
    expect(updated[0]!.ephemeral).toBe(true);
    expect(updated[0]!.event.payload).toMatchObject({
      agent: "claude-code",
      window: "5h",
      used_pct: 50,
    });
    const usage = r.live.usage();
    expect(usage.thresholds).toEqual([80, 95]);
    expect(usage.usage).toMatchObject([
      { agent: "claude-code", window: "5h", used_pct: 50, level: "ok", stale: false },
    ]);
    expect(usage.unsupported).toMatchObject([
      { agent: "codex", reason: expect.stringMatching(/^unsupported:/) },
    ]);
  });

  it("raises a durable warning before the limit, once per window per threshold", async () => {
    const r = rig();
    for (const used of [60, 81, 83, 90, 96, 97, 99]) r.live.recordUsage(body(used));
    await flush();
    const warnings = r.events.filter((e) => e.event.event_type === "agent.usage.warning");
    expect(warnings.map((w) => [w.event.payload.threshold, w.event.severity, w.ephemeral])).toEqual(
      [
        [80, "warning", false],
        [95, "error", false],
      ],
    );
    expect(warnings[0]!.event.payload).toMatchObject({
      agent: "claude-code",
      window: "5h",
      used_pct: 81,
    });
  });

  it("does not repeat a warning after a Core restart (state persisted)", async () => {
    const first = rig();
    first.live.recordUsage(body(85));
    expect(first.settings.get<unknown>(FIRED_KEY, null)).toMatchObject({
      "claude-code:5h": { thresholds: [80] },
    });
    const second = rig({ db: first.db });
    second.live.recordUsage(body(86));
    await flush();
    expect(second.events.filter((e) => e.event.event_type === "agent.usage.warning")).toEqual([]);
  });

  it("thresholds are configurable and validated", async () => {
    const r = rig();
    expect(r.live.setThresholds({ thresholds: [70] })).toEqual({ thresholds: [70] });
    expect(r.settings.get<unknown>(THRESHOLDS_KEY, null)).toEqual([70]);
    r.live.recordUsage(body(75));
    await flush();
    expect(r.events.filter((e) => e.event.event_type === "agent.usage.warning")).toHaveLength(1);
    for (const bad of [{ thresholds: [] }, { thresholds: [100] }, { thresholds: "80" }, {}, null]) {
      expect(() => r.live.setThresholds(bad)).toThrow(PhoenixError);
    }
    expect(rig({ db: r.db }).live.usage().thresholds).toEqual([70]);
  });

  it("rejects malformed usage", () => {
    const r = rig();
    expect(() => r.live.recordUsage({ agent: "x", samples: [{ window: "daily" }] })).toThrow(
      PhoenixError,
    );
    expect(() => r.live.recordUsage(body(150))).toThrow(PhoenixError);
  });
});
