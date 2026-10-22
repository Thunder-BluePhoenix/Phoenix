// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 78 reports. Claude Code's real status JSON was NOT captured: the payloads follow the public
// documentation (https://code.claude.com/docs/en/statusline). Only `cost.total_cost_usd`, the
// session id, `model.id` and the project folder are read; the `context_window` token fields are
// documented as the CURRENT context, not session totals, so they are deliberately not read.
import { describe, expect, it } from "vitest";
import { runStatusline, type StatuslineDeps } from "../src/statusline";
import {
  MAX_REPORTED_COST_USD,
  MAX_REPORTED_TOKENS,
  extractClaudeCost,
  folderName,
  isTokenUsageBody,
  validateTokenUsage,
} from "../src/usage";

const NOW = Date.parse("2026-10-20T10:00:00Z");
const status = (over: Record<string, unknown> = {}) => ({
  session_id: "abc123",
  model: { id: "claude-opus-5-5", display_name: "Opus" },
  workspace: { project_dir: "/Users/me/work/alpha", current_dir: "/Users/me/work/alpha/sub" },
  cost: { total_cost_usd: 0.01234 },
  context_window: { total_input_tokens: 15_500, total_output_tokens: 1_200 },
  ...over,
});

describe("extractClaudeCost", () => {
  it("reads the documented cost, session id, model id and the project FOLDER NAME", () => {
    expect(extractClaudeCost(status())).toEqual({
      agent: "claude-code",
      session_id: "abc123",
      model: "claude-opus-5-5",
      project: "alpha",
      cost_usd: 0.01234,
    });
  });

  it("never reports the context-window token counts as session totals", () => {
    const report = extractClaudeCost(status());
    expect(report).not.toHaveProperty("input_tokens");
    expect(report).not.toHaveProperty("output_tokens");
  });

  it("is null without a usable cost or session id (no invented zero)", () => {
    expect(extractClaudeCost(status({ cost: {} }))).toBeNull();
    expect(extractClaudeCost(status({ cost: { total_cost_usd: "1" } }))).toBeNull();
    expect(extractClaudeCost(status({ cost: { total_cost_usd: -1 } }))).toBeNull();
    expect(
      extractClaudeCost(status({ cost: { total_cost_usd: MAX_REPORTED_COST_USD + 1 } })),
    ).toBeNull();
    expect(extractClaudeCost(status({ session_id: "has spaces" }))).toBeNull();
    expect(extractClaudeCost(status({ session_id: undefined }))).toBeNull();
    expect(extractClaudeCost([])).toBeNull();
    expect(extractClaudeCost(null)).toBeNull();
  });

  it("drops a model id that is not a plain identifier, and falls back through the directories", () => {
    expect(extractClaudeCost(status({ model: { id: "bad model\n" } }))?.model).toBe("");
    expect(extractClaudeCost(status({ workspace: undefined, cwd: "/a/b/gamma" }))?.project).toBe(
      "gamma",
    );
  });
});

describe("validateTokenUsage", () => {
  const ok = { agent: "codex", session_id: "s1", model: "m", input_tokens: 5, output_tokens: 6 };

  it("accepts the generic body and reduces project to a folder name", () => {
    expect(validateTokenUsage({ ...ok, project: "/x/y/zed", cost_usd: 1.5 })).toEqual({
      ok: true,
      report: { ...ok, project: "zed", cost_usd: 1.5 },
    });
  });

  it("keeps a missing field missing instead of making it zero", () => {
    const r = validateTokenUsage({ agent: "codex", session_id: "s1", cost_usd: 2 });
    expect(r).toMatchObject({ ok: true, report: { cost_usd: 2 } });
    expect(r.ok && "input_tokens" in r.report).toBe(false);
  });

  it("refuses the edges of every number and unknown fields", () => {
    const bad = [
      { ...ok, input_tokens: MAX_REPORTED_TOKENS + 1 },
      { ...ok, input_tokens: -1 },
      { ...ok, output_tokens: 0.5 },
      { ...ok, cost_usd: Number.NaN },
      { ...ok, extra: 1 },
      { ...ok, agent: "UPPER" },
      { agent: "codex", session_id: "s1" },
      [],
      "x",
    ];
    for (const body of bad) expect(validateTokenUsage(body).ok).toBe(false);
    expect(validateTokenUsage({ ...ok, input_tokens: MAX_REPORTED_TOKENS }).ok).toBe(true);
  });

  it("tells a token report from a plan-window sample by its session id", () => {
    expect(isTokenUsageBody(ok)).toBe(true);
    expect(isTokenUsageBody({ agent: "x", window: "5h", used_pct: 5 })).toBe(false);
  });

  it("folderName cuts a path to its last segment, either separator", () => {
    expect(folderName("/a/b/c/")).toBe("c");
    expect(folderName("C:\\Users\\me\\proj")).toBe("proj");
    expect(folderName("/")).toBe("");
    expect(folderName(`/a/${"x".repeat(300)}`)).toHaveLength(120);
  });

  it("folderName drops control, format, line and paragraph separators (the same rule as Core's display names)", () => {
    expect(folderName("/a/pro\u2028j\u00ade\u202Ect\u2029\u0007")).toBe("project");
  });
});

describe("the statusLine relay forwards the cost next to the plan windows", () => {
  const deps = (): { all: StatuslineDeps; sent: unknown[] } => {
    const sent: unknown[] = [];
    return {
      sent,
      all: {
        runThen: async () => ({ code: 0, stdout: Buffer.alloc(0), timedOut: false }),
        send: async (body) => {
          sent.push(body);
          return { ok: true };
        },
        now: () => NOW,
        warn: () => {},
      },
    };
  };

  it("sends the cost report and still passes the previous command's output through", async () => {
    const { all, sent } = deps();
    const out = Buffer.from("[Opus]\n");
    all.runThen = async () => ({ code: 0, stdout: out, timedOut: false });
    const r = await runStatusline({ then: "prev" }, Buffer.from(JSON.stringify(status())), all);
    expect(r.stdout.toString()).toBe("[Opus]\n");
    expect(sent).toEqual([
      {
        agent: "claude-code",
        session_id: "abc123",
        model: "claude-opus-5-5",
        project: "alpha",
        cost_usd: 0.01234,
      },
    ]);
  });

  it("sends both the plan windows and the cost when both are present", async () => {
    const { all, sent } = deps();
    const resets = Math.floor(NOW / 1000) + 3_600;
    const json = status({ rate_limits: { five_hour: { used_percentage: 40, resets_at: resets } } });
    await runStatusline({}, Buffer.from(JSON.stringify(json)), all);
    expect(sent).toHaveLength(2);
  });

  it("a failing Core never changes the output or throws", async () => {
    const { all } = deps();
    all.send = async () => {
      throw new Error("down");
    };
    const r = await runStatusline({}, Buffer.from(JSON.stringify(status())), all);
    expect(r.exitCode).toBe(0);
  });
});
