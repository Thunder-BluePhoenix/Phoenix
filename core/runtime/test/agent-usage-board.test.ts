// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 78 board: the explicit state mapping (the table in docs/mission-control.md), merging of the
// three sources, Phase 77 stall events, and a source that cannot be read. Simulated: the agents
// capability port is a fake; no real agent session exists.
import type { LiveSessionView } from "@phoenix/api";
import type { ActiveAgent, SessionView } from "@phoenix/capability-agents";
import { createEvent } from "@phoenix/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { mapState, type StateInput } from "../src/agent-usage";
import { closeRigs, drain, T0, usageRig, type UsageRig } from "./agent-usage-rig";

afterEach(closeRigs);

const MIN = 60_000;
const base = (over: Partial<StateInput>): StateInput => ({
  raw: "working",
  lastSeenMs: T0 - MIN,
  nowMs: T0,
  stuckAfterMin: 30,
  stalled: false,
  ...over,
});

describe("state mapping table", () => {
  const table: [string, Partial<StateInput>, string][] = [
    ["report working, heard a minute ago", { raw: "working" }, "working"],
    ["report started", { raw: "started" }, "working"],
    ["orchestrated running (no timestamp)", { raw: "running", lastSeenMs: undefined }, "working"],
    ["report waiting", { raw: "waiting" }, "waiting"],
    ["orchestrated waiting", { raw: "waiting", lastSeenMs: undefined }, "waiting"],
    [
      "waiting, silent for hours is still waiting on you",
      { raw: "waiting", lastSeenMs: T0 - 600 * MIN },
      "waiting",
    ],
    ["report completed", { raw: "completed" }, "finished"],
    ["report failed", { raw: "failed" }, "finished"],
    ["orchestrated stopped", { raw: "stopped", lastSeenMs: undefined }, "finished"],
    ["working but silent 31 min", { raw: "working", lastSeenMs: T0 - 31 * MIN }, "stuck"],
    [
      "working, silent exactly 30 min is not yet stuck",
      { raw: "working", lastSeenMs: T0 - 30 * MIN },
      "working",
    ],
    ["working + stall event", { raw: "working", stalled: true }, "stuck"],
    ["steps only, young", { raw: "active" }, "working"],
    ["steps only, old", { raw: "silent", lastSeenMs: T0 - 90 * MIN }, "finished"],
    ["a state this build does not know", { raw: "teleporting" }, "finished"],
  ];
  it.each(table)("%s", (_name, over, column) => {
    expect(mapState(base(over)).state).toBe(column);
  });

  it("a stall flag never moves a finished or waiting session", () => {
    expect(mapState(base({ raw: "completed", stalled: true })).state).toBe("finished");
    expect(mapState(base({ raw: "waiting", stalled: true })).state).toBe("waiting");
  });

  it("says why a session is stuck", () => {
    expect(mapState(base({ lastSeenMs: T0 - 45 * MIN }))).toEqual({
      state: "stuck",
      stuck_reason: "no_report",
    });
    expect(mapState(base({ stalled: true }))).toEqual({
      state: "stuck",
      stuck_reason: "safety_stall",
    });
  });

  it("an orchestrated session is never stuck by silence alone (it has no activity time)", () => {
    expect(mapState(base({ raw: "running", lastSeenMs: undefined })).state).toBe("working");
  });
});

const report = (over: Partial<ActiveAgent>): ActiveAgent => ({
  agent: "claude-code",
  agent_id: "s1",
  workspace: "/work/alpha",
  repository: "alpha",
  state: "working",
  since: new Date(T0 - 5 * MIN).toISOString(),
  updated_at: new Date(T0 - MIN).toISOString(),
  ...over,
});
const live = (over: Partial<LiveSessionView>): LiveSessionView => ({
  id: "s1",
  agent: "claude-code",
  project: "/work/alpha",
  repository: "alpha",
  first_seen: new Date(T0 - 5 * MIN).toISOString(),
  last_seen: new Date(T0 - MIN).toISOString(),
  active: true,
  step_count: 4,
  dropped_steps: 0,
  has_terminal: true,
  ...over,
});
const ph = (over: Partial<SessionView>): SessionView =>
  ({
    id: "ph-0123456789abcdef",
    launcher: "codex",
    workspace: "/work/beta",
    repository: "beta",
    state: "running",
    started_at: new Date(T0 - 2 * MIN).toISOString(),
    accepts_input: true,
    messages_sent: 0,
    output: {
      stdout: { lines: 0, dropped_lines: 0, truncated_lines: 0, bytes_seen: 0 },
      stderr: { lines: 0, dropped_lines: 0, truncated_lines: 0, bytes_seen: 0 },
    },
    ...over,
  }) as SessionView;

const board = async (r: UsageRig) => (await r.usage.mission(undefined)).sessions;

describe("the board merges the three sources", () => {
  it("one card per session from reports, steps and orchestrated sessions, with folder names only", async () => {
    const r = usageRig();
    r.port.reports = [
      report({}),
      report({ agent: "gemini", agent_id: "g1", state: "waiting", reason: "permission" }),
    ];
    r.live.sessions = [live({}), live({ id: "only-steps", agent: "cursor" })];
    r.port.orchestrated = [ph({})];
    const sessions = await board(r);
    expect(sessions.map((s) => [s.key, s.state])).toEqual([
      ["gemini:g1", "waiting"],
      ["claude-code:s1", "working"],
      ["cursor:only-steps", "working"],
      ["codex:ph-0123456789abcdef", "working"],
    ]);
    const claude = sessions.find((s) => s.key === "claude-code:s1")!;
    expect(claude).toMatchObject({
      project: "alpha",
      sources: ["steps", "report"],
      can_open: true,
      can_focus: true,
      steps: 4,
    });
    expect(sessions.find((s) => s.key === "gemini:g1")).toMatchObject({
      reason: "permission",
      can_open: false,
      can_focus: false,
    });
    expect(JSON.stringify(sessions)).not.toContain("/work/");
  });

  it("an orchestrated state beats its later report", async () => {
    const r = usageRig();
    r.port.reports = [
      report({ agent: "codex", agent_id: "ph-0123456789abcdef", state: "working" }),
    ];
    r.port.orchestrated = [ph({ state: "completed" })];
    expect((await board(r))[0]).toMatchObject({
      key: "codex:ph-0123456789abcdef",
      state: "finished",
    });
  });

  it("session usage is attached from the stored reports", async () => {
    const r = usageRig();
    r.port.reports = [report({})];
    r.report({
      agent: "claude-code",
      session_id: "s1",
      model: "m",
      input_tokens: 1_200,
      output_tokens: 300,
    });
    expect((await board(r))[0]?.usage).toMatchObject({
      input_tokens: 1_200,
      output_tokens: 300,
      tokens_reported: true,
      cost_usd: null,
    });
  });

  it("a session that reported nothing shows tokens_reported false, not 0 tokens of data", async () => {
    const r = usageRig();
    r.port.reports = [report({})];
    expect((await board(r))[0]?.usage).toMatchObject({ tokens_reported: false, cost_usd: null });
  });

  it("an unreadable source is flagged, and the other sources still show", async () => {
    const r = usageRig();
    r.live.sessions = [live({})];
    r.port.fail = true;
    const view = await r.usage.mission(undefined);
    expect(view.sources).toEqual({ reported: false, orchestrated: false });
    expect(view.sessions).toHaveLength(1);
  });

  it("a session with only old steps is finished, not working", async () => {
    const r = usageRig();
    r.live.sessions = [live({ last_seen: new Date(T0 - 3 * 60 * MIN).toISOString() })];
    expect((await board(r))[0]?.state).toBe("finished");
  });
});

describe("Phase 77 stall events", () => {
  const stall = (r: UsageRig, over: Record<string, unknown> = {}, source = "core") =>
    r.bus.publish(
      createEvent({
        event_type: "agent.safety.stall",
        source,
        severity: "warning",
        payload: { agent: "claude-code", session_id: "s1", reason: "no_activity", ...over },
        timestamp: new Date(T0).toISOString(),
      }),
    );

  it("a working session with a stall flag is stuck", async () => {
    const r = usageRig();
    r.port.reports = [report({ updated_at: new Date(T0 - 1_000).toISOString() })];
    stall(r);
    await drain(r);
    expect((await board(r))[0]).toMatchObject({ state: "stuck", stuck_reason: "safety_stall" });
  });

  it("a report newer than the stall clears it", async () => {
    const r = usageRig();
    stall(r);
    await drain(r);
    r.port.reports = [report({ updated_at: new Date(T0 + MIN).toISOString() })];
    r.clock.now = T0 + 2 * MIN;
    expect((await board(r))[0]?.state).toBe("working");
  });

  it("ignores a stall posted by another source, and malformed ones", async () => {
    const r = usageRig();
    r.port.reports = [report({ updated_at: new Date(T0 - 1_000).toISOString() })];
    stall(r, {}, "terminal");
    stall(r, { session_id: 5 });
    await drain(r);
    expect((await board(r))[0]?.state).toBe("working");
  });
});

describe("totals, search window and per-key views", () => {
  it("totals by day, agent, project and session add up to the overall total", async () => {
    const r = usageRig();
    r.usage.setConfig({ prices: { m: { input_per_mtok: 1, output_per_mtok: 1 } } });
    r.report({
      agent: "claude-code",
      session_id: "a",
      model: "m",
      project: "/x/alpha",
      input_tokens: 1_000_000,
      output_tokens: 0,
    });
    r.report({
      agent: "codex",
      session_id: "b",
      model: "m",
      project: "/x/beta",
      input_tokens: 0,
      output_tokens: 2_000_000,
    });
    const view = await r.usage.mission(7);
    expect(view.totals).toMatchObject({
      input_tokens: 1_000_000,
      output_tokens: 2_000_000,
      cost_usd: 3,
    });
    expect(view.by_agent.map((a) => [a.agent, a.cost_usd])).toEqual([
      ["codex", 2],
      ["claude-code", 1],
    ]);
    expect(view.by_project.map((p) => p.project).sort()).toEqual(["alpha", "beta"]);
    expect(view.by_session).toHaveLength(2);
    expect(view.by_day).toHaveLength(7);
    expect(view.by_day.at(-1)).toMatchObject({ day: "2026-10-20", input_tokens: 1_000_000 });
    expect(view.by_day[0]?.cost_usd).toBeNull();
  });

  it("refuses a window outside 1-90 days", async () => {
    const r = usageRig();
    for (const days of [0, 91, 1.5]) await expect(r.usage.mission(days)).rejects.toThrow();
  });
});
