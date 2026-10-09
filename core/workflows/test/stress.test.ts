// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Seeded reliability run (Phase 40): hundreds of runs against a real SQLite file, a real
// PermissionGateway, CapabilityManager, PolicyEngine and ToolGateway, with injected tool errors,
// timeouts, approvals that are rejected or never answered, crashes (the database is closed and
// reopened mid-flight) and kill-switch toggles. Then the invariants are read back from SQLite.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  boot,
  closeAll,
  devWorkflow,
  ManualClock,
  newCalls,
  tempDir,
  triggerEvent,
  user,
  type Core,
} from "./fixtures";

const cleanups: (() => void)[] = [];
afterEach(async () => {
  await closeAll();
  for (const c of cleanups.splice(0)) c();
});

/** mulberry32: small, seeded, good enough for choosing scenarios. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ANSWER = "{{ event.payload.answer }}";
const workflows = () => [
  // A: approve -> restart(undo) -> echo(undo) -> result. `note` may carry FAIL to break echo.
  devWorkflow(
    "wa",
    [
      { id: "gate", type: "approval", summary: `a: ${ANSWER}` },
      {
        id: "restart",
        type: "action",
        tool: "deploys.restart",
        compensate: { tool: "deploys.undo_restart" },
      },
      {
        id: "echo",
        type: "action",
        tool: "deploys.echo",
        input: { note: "{{ event.payload.note }}" },
        compensate: { tool: "deploys.undo_restart" },
      },
      { id: "done", type: "result", outcome: "success", summary: "a done" },
    ],
    ["deploys.restart", "deploys.undo_restart", "deploys.echo"],
    { trigger: { event: "stress.a" } },
  ),
  // B: reads with retries, no approval needed.
  devWorkflow(
    "wb",
    [
      { id: "logs", type: "action", tool: "deploys.logs" },
      { id: "flaky", type: "action", tool: "deploys.flaky", retry: { max: 2, backoff_ms: 5 } },
      { id: "tell", type: "notify", title: "b", message: "{{ steps.logs.lines }}" },
    ],
    ["deploys.logs", "deploys.flaky"],
    { trigger: { event: "stress.b" } },
  ),
  // C: approve -> restart(undo) -> a write that never answers (timeout 2 s, abandoned).
  devWorkflow(
    "wc",
    [
      { id: "gate", type: "approval", summary: `c: ${ANSWER}` },
      {
        id: "restart",
        type: "action",
        tool: "deploys.restart",
        compensate: { tool: "deploys.undo_restart" },
      },
      { id: "stuck", type: "action", tool: "deploys.stuck_write", timeout_ms: 2000 },
    ],
    ["deploys.restart", "deploys.undo_restart", "deploys.stuck_write"],
    { trigger: { event: "stress.c" } },
  ),
];

describe("reliability stress (seeded)", () => {
  it("keeps every invariant over 400+ runs with failures, crashes and kill-switch toggles", async () => {
    const SEED = 20260509;
    const rand = rng(SEED);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
    const t = tempDir();
    cleanups.push(t.cleanup);
    const clock = new ManualClock();
    // Back-off waits are instant; only the 2 s step timeout of the stuck write follows the manual
    // clock. Every other bound stays open so that advancing time cannot race real, fast calls.
    const stressSleep = (ms: number, signal: AbortSignal): Promise<void> =>
      ms <= 50
        ? Promise.resolve()
        : ms === 2000
          ? clock.sleep(ms, signal)
          : clock.sleep(1e12, signal);
    const calls = newCalls();
    let ticks = 0;
    let totalEvents = 0;
    let crashes = 0;
    let killToggles = 0;

    const open = async (): Promise<Core> => {
      const core = await boot({
        path: t.db,
        calls,
        now: clock.now,
        sleep: stressSleep,
        rate: { max: 1_000_000, windowMs: 60_000 },
        maxConcurrent: 6,
        autoAnswer: (c) => {
          if (c.capabilityId === "deploys") return true;
          if (/: approve\b/.test(c.summary)) return true;
          if (/: reject\b/.test(c.summary)) return false;
          return undefined; // "ignore": nobody answers
        },
      });
      return core;
    };
    const pump = async (core: Core, done: () => boolean) =>
      vi.waitFor(
        async () => {
          clock.advance(2500);
          await core.bus.drain();
          if (core.permissions.isKillSwitchEngaged()) return;
          expect(done()).toBe(true);
        },
        { timeout: 90_000, interval: 4 },
      );
    const busy = (core: Core) =>
      core.engine
        .listRuns({ limit: 200 })
        .some((r) => ["queued", "running", "compensating"].includes(r.status));

    let core = await open();
    core.engine.recover();
    core.engine.start();
    for (const w of workflows()) core.admin.save(user, w);

    const EPOCHS = 8;
    for (let epoch = 0; epoch < EPOCHS; epoch++) {
      if (epoch > 0) {
        core = await open();
        core.engine.recover();
        core.engine.start();
      }
      calls.failCommands["undo_restart"] = rand() < 0.3;
      calls.failCommands["logs"] = rand() < 0.2;
      calls.failFlaky = rand() < 0.5 ? 2 : 0;
      const n = 100 + Math.floor(rand() * 20);
      const startedNow = () =>
        Object.values(core.store.counters()).reduce((a, c) => a + (c["runs_started"] ?? 0), 0);
      const before = startedNow();
      for (let i = 0; i < n; i++) {
        const kind = pick(["a", "a", "b", "c"]);
        core.bus.publish(
          triggerEvent(`stress.${kind}`, {
            answer: pick(["approve", "approve", "approve", "reject", "ignore"]),
            note: rand() < 0.25 ? "FAIL this one" : "fine",
          }),
        );
        totalEvents++;
      }
      if (epoch < EPOCHS - 1) {
        // Let part of the work happen, optionally pull the emergency stop, then crash mid-flight.
        const target = 10 + Math.floor(rand() * 30);
        await vi.waitFor(
          async () => {
            clock.advance(++ticks % 2 === 0 ? 2500 : 0); // timing only: never draws from the seeded stream
            await core.bus.drain();
            expect(startedNow() - before).toBeGreaterThanOrEqual(target);
          },
          { timeout: 30_000, interval: 3 },
        );
        if (rand() < 0.6) {
          core.permissions.engageKillSwitch("user", "stress");
          killToggles++;
          core.bus.publish(triggerEvent("stress.b", { answer: "approve", note: "while stopped" }));
          totalEvents++;
          await core.bus.drain();
          core.permissions.disengageKillSwitch();
          await core.manager.enable("deploys");
          core.bus.publish(triggerEvent("stress.b", { answer: "approve", note: "fine" }));
          totalEvents++;
          await core.bus.drain();
        }
        await core.crash();
        crashes++;
      }
    }
    // Last epoch runs to quiescence; then every unanswered approval is answered "no" and it settles again.
    await pump(core, () => !busy(core));
    for (const c of core.permissions.pendingConfirmations())
      core.permissions.resolveConfirmation(c.id, false);
    await pump(
      core,
      () => !busy(core) && core.engine.listRuns({ status: "waiting_approval" }).length === 0,
    );
    await core.bus.drain();
    await core.engine.idle();

    // ── Invariants, read from the database ────────────────────────────────
    const db = core.db;
    const one = <T>(sql: string, ...args: (string | number)[]): T =>
      db.prepare(sql).get(...args) as T;
    const all = <T>(sql: string, ...args: (string | number)[]): T[] =>
      db.prepare(sql).all(...args) as T[];

    const runs = one<{ n: number }>("SELECT COUNT(*) AS n FROM workflow_runs").n;
    const started = one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM workflow_runs WHERE started_at IS NOT NULL",
    ).n;
    expect(runs).toBeGreaterThanOrEqual(300);
    expect(started).toBeGreaterThanOrEqual(300);
    expect(crashes).toBe(EPOCHS - 1);

    // 1. No run is left in a non-terminal state after recovery.
    expect(
      all<{ id: string; status: string }>(
        "SELECT id, status FROM workflow_runs WHERE status IN ('queued','running','waiting_approval','compensating') OR finished_at IS NULL",
      ),
    ).toEqual([]);
    expect(all("SELECT 1 FROM workflow_run_steps WHERE status IN ('running','waiting')")).toEqual(
      [],
    );

    // 2. A destructive step never ran without an approval step that succeeded earlier in the same run.
    expect(
      all<{ run_id: string; step_id: string }>(
        `SELECT s.run_id, s.step_id FROM workflow_run_steps s WHERE s.destructive = 1 AND NOT EXISTS (
           SELECT 1 FROM workflow_run_steps a WHERE a.run_id = s.run_id AND a.step_type = 'approval'
             AND a.status = 'succeeded' AND a.seq < s.seq)`,
      ),
    ).toEqual([]);
    const writeCommands = ["restart", "echo", "stuck_write", "undo_restart", "rollback"];
    const writeCalls = calls.log.filter((c) => writeCommands.includes(c.command)).length;
    const writeRows = one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM workflow_run_steps WHERE destructive = 1",
    ).n;
    expect(writeCalls).toBeGreaterThan(50);
    expect(writeCalls).toBeLessThanOrEqual(writeRows);

    // 3. Each succeeded step is undone at most once, and a cleanly failed run undid all it had to.
    expect(
      all(
        "SELECT run_id, step_id, COUNT(*) c FROM workflow_run_steps WHERE phase = 'compensation' GROUP BY run_id, step_id HAVING c > 1",
      ),
    ).toEqual([]);
    const needUndo = all<{ id: string; status: string; definition: string }>(
      "SELECT id, status, definition FROM workflow_runs WHERE status IN ('failed','rejected')",
    );
    for (const r of needUndo) {
      const steps = all<{ step_id: string; phase: string; status: string }>(
        "SELECT step_id, phase, status FROM workflow_run_steps WHERE run_id = ?",
        r.id,
      );
      const def = JSON.parse(r.definition) as { steps: { id: string; compensate?: unknown }[] };
      for (const s of steps.filter((x) => x.phase === "step" && x.status === "succeeded")) {
        if (def.steps.find((d) => d.id === s.step_id)?.compensate === undefined) continue;
        const undone = steps.some(
          (x) => x.phase === "compensation" && x.step_id === s.step_id && x.status === "succeeded",
        );
        expect(undone, `${r.id} ${s.step_id}`).toBe(true);
      }
    }
    const undoRows = one<{ ok: number; unknown: number }>(
      `SELECT SUM(status = 'succeeded') AS ok, SUM(status = 'unknown') AS unknown FROM workflow_run_steps
       WHERE phase = 'compensation' AND tool = 'deploys.undo_restart'`,
    );
    const undoAudits = all(
      "SELECT 1 FROM audit_log WHERE action = 'tool.succeeded' AND details LIKE '%undo_restart%'",
    ).length;
    expect(undoAudits).toBeGreaterThanOrEqual(undoRows.ok ?? 0);
    expect(undoAudits).toBeLessThanOrEqual((undoRows.ok ?? 0) + (undoRows.unknown ?? 0));
    expect(undoAudits).toBeGreaterThan(0);

    // 4. One audited decision per executed tool call.
    const decisions = all<{ id: number; details: string }>(
      "SELECT id, details FROM audit_log WHERE action = 'policy.decision' AND actor LIKE 'system:workflow-%'",
    ).map((d) => ({ id: d.id, ...(JSON.parse(d.details) as { effect: string; tool: string }) }));
    const allowedDecisions = decisions.filter((d) => d.effect !== "deny");
    expect(calls.log.length).toBeLessThanOrEqual(allowedDecisions.length);
    const outcomes = all<{ details: string }>(
      "SELECT details FROM audit_log WHERE action IN ('tool.succeeded','tool.failed','tool.timeout','tool.invalid_output')",
    ).map((o) => (JSON.parse(o.details) as { decisionAuditId: number }).decisionAuditId);
    expect(new Set(outcomes).size).toBe(outcomes.length); // never two outcomes for one decision
    const decisionIds = new Set(decisions.map((d) => d.id));
    expect(outcomes.filter((id) => !decisionIds.has(id))).toEqual([]);
    for (const id of outcomes) expect(decisions.find((d) => d.id === id)?.effect).not.toBe("deny");

    // 5. Counters match the rows they count (they are written in the same transactions).
    const counters = core.store.counters();
    const sum = (name: string) => Object.values(counters).reduce((n, c) => n + (c[name] ?? 0), 0);
    expect(sum("runs_started")).toBe(started);
    expect(sum("runs_refused")).toBe(
      one<{ n: number }>("SELECT COUNT(*) AS n FROM workflow_runs WHERE status = 'refused'").n,
    );
    const terminalCounters = [
      "runs_succeeded",
      "runs_failed",
      "runs_rejected",
      "runs_cancelled",
      "runs_needs_attention",
      "runs_interrupted",
    ];
    expect(terminalCounters.reduce((n, c) => n + sum(c), 0)).toBe(
      one<{ n: number }>("SELECT COUNT(*) AS n FROM workflow_runs WHERE status != 'refused'").n,
    );
    expect(sum("steps_succeeded")).toBe(
      one<{ n: number }>("SELECT COUNT(*) AS n FROM workflow_run_steps WHERE status = 'succeeded'")
        .n,
    );

    // The run was not trivial: every outcome class happened, and the injections were hit.
    const byStatus = Object.fromEntries(
      all<{ status: string; n: number }>(
        "SELECT status, COUNT(*) AS n FROM workflow_runs GROUP BY status",
      ).map((r) => [r.status, r.n]),
    );
    console.log(
      `stress: seed=${SEED} events=${totalEvents} runs=${runs} started=${started} crashes=${crashes} killToggles=${killToggles}`,
      JSON.stringify(byStatus),
    );
    for (const status of [
      "succeeded",
      "failed",
      "rejected",
      "failed_needs_attention",
      "interrupted",
      "cancelled",
      "refused",
    ])
      expect(byStatus[status] ?? 0, status).toBeGreaterThan(0);
  }, 180_000);
});
