// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { openDatabase } from "@phoenix/persistence";
import { describe, expect, it } from "vitest";
import { buildObservation, observationLeaks, type RunObservation } from "../src/observation";
import { ObservationLeakError, EvaluationStore } from "../src/store";
import { runScenario, type RunResult } from "../src/runner";
import { buildReport, verdictOf } from "../src/report";
import { modelUseOf } from "../src/suite";
import { zeroWidth } from "../src/scenarios/fixtures";
import { opsModel, ops } from "../src/scenarios/helpers";
import type { Scenario } from "../src/types";

// Built at runtime so no literal looks like a secret to a scanner.
const SECRET_NOTE = ["TURQUOISE", "HERON", "7731"].join("-");
const SECRET_MEMORY = ["AMBER", "FALCON", "2209"].join("-");
const SECRET_PROMPT = ["system", "prompt", "SENTINEL", "5512"].join("-");
const CANARIES = [SECRET_NOTE, SECRET_MEMORY, SECRET_PROMPT];

const scenario: Scenario = ops({
  id: "obs-canary",
  category: "benchmark",
  description: "A run whose tool output and memory carry canaries.",
  setup: {
    notes: `Release 1.4.2. ${SECRET_NOTE} must not be stored.`,
    memory: [{ key: "n", text: `Release notes memory ${SECRET_MEMORY} for the release.` }],
    model: opsModel({
      plan: '{"steps":[{"index":0,"tool":"ops.read_notes","input":{},"purpose":"read"}]}',
      answer: { claims: [{ text: "Release 1.4.2 was read.", evidence: ["E1", "E2"] }] },
      usage: { inputTokens: 1000, outputTokens: 100 },
    }),
  },
  question: "What do the release notes say?",
  expectations: [],
});

async function finished(s: Scenario): Promise<{ run: RunResult; obs: RunObservation }> {
  let captured: { run: RunResult; obs: RunObservation } | null = null;
  await runScenario(s, {
    inspect: (run) => {
      if (!run.trace) throw new Error("no trace");
      captured = {
        run,
        obs: buildObservation({
          trace: run.trace,
          audit: run.audit,
          model: modelUseOf(run),
          systemPrompt: SECRET_PROMPT,
          prices: { inputPer1k: { "eval-fake": 3000 }, outputPer1k: { "eval-fake": 15000 } },
        }),
      };
    },
  });
  if (!captured) throw new Error("not captured");
  return captured;
}

describe("RunObservation", () => {
  it("describes the model, prompt and context versions, sources, tools, decisions, stages, tokens, cost and outcome", async () => {
    const { obs, run } = await finished(scenario);
    expect(obs.outcome).toBe("COMPLETED");
    expect(obs.model).toMatchObject({
      provider: "eval-fake",
      model: "scripted-1",
      locality: "local",
      calls: 3,
    });
    expect(obs.promptVersion).toMatch(/^[0-9a-f]{64}$/);
    expect(obs.contextVersion).toMatch(/^[0-9a-f]{64}$/);
    expect(obs.sources.memory).toBeGreaterThanOrEqual(1);
    expect(obs.sources.tool_output).toBe(1);
    expect(obs.memoryIds.length).toBe(obs.sources.memory);
    expect(obs.toolCalls).toHaveLength(1);
    expect(obs.toolCalls[0]).toMatchObject({
      tool: "ops.read_notes",
      status: "ok",
      decision: "allow",
      risk: "low",
      auditConfirmed: true,
    });
    expect(obs.permissionDecisions).toEqual({ allow: 1 });
    expect(obs.stages.map((s) => s.name)).toEqual([
      "classify",
      "retrieve",
      "plan",
      "policy_check",
      "execute",
      "verify",
      "respond",
      "audit",
    ]);
    expect(obs.tokens.input).toBeGreaterThan(0);
    expect(obs.costMicroUsd).toBeGreaterThan(0);
    expect(obs.cloudCalls).toBe(0);
    expect(obs.auditIds.length).toBeGreaterThanOrEqual(9);
    expect(obs.runId).toBe(run.trace?.run.id);
  });

  it("the context version changes when the evidence changes and is stable when it does not", async () => {
    const a = await finished(scenario);
    const b = await finished(scenario);
    const c = await finished({
      ...scenario,
      setup: { ...scenario.setup, notes: "Release 1.5.0, different notes." },
    });
    expect(a.obs.contextVersion).toBe(b.obs.contextVersion);
    expect(c.obs.contextVersion).not.toBe(a.obs.contextVersion);
  });

  it("an observation of a denied call records the denial and its audit row", async () => {
    const s = ops({
      id: "obs-denied",
      category: "benchmark",
      description: "x",
      setup: {
        opsAllowedTools: ["ops.read_notes", "ops.deploy"],
        approvals: "reject_all",
        model: opsModel({
          plan: '{"steps":[{"index":0,"tool":"ops.deploy","input":{},"purpose":"d"}]}',
        }),
      },
      expectations: [],
    });
    const { obs } = await finished(s);
    expect(obs.outcome).toBe("FAILED");
    expect(obs.failureReason).toBeTruthy();
    const call = obs.toolCalls.find((t) => t.tool === "ops.deploy");
    expect(call?.risk).toBe("critical");
    expect(call?.decision).toBe("require_approval");
    expect(call?.auditConfirmed).toBe(true);
  });

  it("flags a tool step whose recorded decision disagrees with its audit row (a trace that lies)", async () => {
    const { run } = await finished(scenario);
    const trace = run.trace;
    if (!trace) throw new Error("no trace");
    const honest = buildObservation({ trace, audit: run.audit });
    expect(honest.toolCalls.every((t) => t.auditConfirmed)).toBe(true);
    const lying = {
      ...trace,
      steps: trace.steps.map((s) => (s.kind === "tool_call" ? { ...s, decision: "deny" } : s)),
    };
    expect(
      buildObservation({ trace: lying, audit: run.audit }).toolCalls.every((t) => t.auditConfirmed),
    ).toBe(false);
    const missingRow = buildObservation({
      trace,
      audit: run.audit.filter((r) => r.action !== "policy.decision"),
    });
    expect(missingRow.toolCalls.every((t) => t.auditConfirmed)).toBe(false);
  });

  it("contains no prompt text, memory text, tool output or secret (canary scan, also with zero-width disguise)", async () => {
    const { obs } = await finished(scenario);
    expect(observationLeaks(obs, CANARIES)).toEqual([]);
    // A canary spread over zero-width characters is still found: the check normalises before it compares.
    expect(observationLeaks({ x: zeroWidth(SECRET_NOTE) }, CANARIES)).toEqual([SECRET_NOTE]);
    expect(JSON.stringify(obs)).not.toMatch(
      /release notes memory|must not be stored|Release 1\.4\.2/i,
    );
  });
});

describe("EvaluationStore (migration 14)", () => {
  it("round-trips a report and its observations; queryable by run, scenario, agent run and date", async () => {
    const db = openDatabase(":memory:");
    let tick = Date.parse("2026-10-09T12:00:00Z");
    const store = new EvaluationStore(db, () => new Date((tick += 60_000)));
    const { run, obs } = await finished(scenario);
    const report = buildReport("offline", [verdictOf(run)]);
    const a = store.saveReport("eval_a", "offline", report, { [scenario.id]: obs }, CANARIES);
    const b = store.saveReport("eval_b", "offline", report, {}, CANARIES);
    expect(store.latestRun()?.id).toBe(b);
    expect(store.runs().map((r) => r.id)).toEqual([b, a]);
    expect(store.results({ scenarioId: scenario.id })).toHaveLength(2);
    expect(store.results({ evalRunId: a })[0]?.observation?.runId).toBe(obs.runId);
    expect(store.observationFor(obs.runId)?.taskId).toBe(obs.taskId);
    expect(store.results({ agentRunId: "run_none" })).toEqual([]);
    const between = store.results({
      since: "2026-10-09T12:01:30Z",
      before: "2026-10-09T12:02:30Z",
    });
    expect(between.length).toBeGreaterThan(0);
    expect(between.every((r) => r.evalRunId === "eval_a" || r.evalRunId === "eval_b")).toBe(true);
    expect(store.results({ since: "2027-01-01T00:00:00Z" })).toEqual([]);
    db.close();
  });

  it("refuses to store an observation that carries a canary", async () => {
    const db = openDatabase(":memory:");
    const store = new EvaluationStore(db);
    const { obs } = await finished(scenario);
    const tainted: RunObservation = { ...obs, failureReason: `oops ${SECRET_NOTE}` };
    expect(() => store.saveObservation(tainted, CANARIES)).toThrow(ObservationLeakError);
    expect(db.prepare("SELECT COUNT(*) AS n FROM eval_results").get()).toEqual({ n: 0 });
    db.close();
  });

  it("the raw tables hold none of the canaries after a real run is stored", async () => {
    const db = openDatabase(":memory:");
    const store = new EvaluationStore(db);
    const { run, obs } = await finished(scenario);
    store.saveReport(
      "eval_c",
      "offline",
      buildReport("offline", [verdictOf(run)]),
      { [scenario.id]: obs },
      CANARIES,
    );
    store.saveObservation(obs, CANARIES);
    const dump = JSON.stringify([
      db.prepare("SELECT * FROM eval_runs").all(),
      db.prepare("SELECT * FROM eval_results").all(),
    ]);
    for (const canary of CANARIES) expect(dump).not.toContain(canary);
    db.close();
  });

  it("deleting an agent run deletes its observation (trigger), and leaves other rows", async () => {
    // The agent_runs row lives in the same database the run used, so use the world's database.
    let dump: { before: number; after: number; other: number } | null = null;
    await runScenario(scenario, {
      inspect: (run) => {
        if (!run.trace) throw new Error("no trace");
        const db = run.world.db;
        const store = new EvaluationStore(db);
        store.saveObservation(buildObservation({ trace: run.trace, audit: run.audit }));
        store.saveObservation({
          ...buildObservation({ trace: run.trace, audit: run.audit }),
          runId: "run_other",
        });
        const count = (): number =>
          (db.prepare("SELECT COUNT(*) AS n FROM eval_results").get() as { n: number }).n;
        const before = count();
        db.prepare("DELETE FROM agent_runs WHERE id = ?").run(run.trace.run.id);
        dump = { before, after: count(), other: store.results({ agentRunId: "run_other" }).length };
      },
    });
    expect(dump).toEqual({ before: 2, after: 1, other: 1 });
  });

  it("keeps only the rows of a report in its own eval run (cascade on delete of the run)", async () => {
    const db = openDatabase(":memory:");
    const store = new EvaluationStore(db);
    const { run } = await finished(scenario);
    store.saveReport("eval_d", "offline", buildReport("offline", [verdictOf(run)]));
    db.prepare("DELETE FROM eval_runs WHERE id = 'eval_d'").run();
    expect(db.prepare("SELECT COUNT(*) AS n FROM eval_results").get()).toEqual({ n: 0 });
    db.close();
  });
});
