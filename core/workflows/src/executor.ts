// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Drives one run from its first step to a terminal state, and is the only code that writes a
// run's history. Every state change is one SQLite transaction (step row + counters, or run row +
// counters), so a crash leaves a state that `recover()` can classify. Failure policy:
//
//   a step fails      -> stop; undo (reverse order) the steps that succeeded and declared an undo
//   an undo fails     -> keep undoing the rest; the run ends failed_needs_attention
//   outcome unknown   -> (timed-out or abandoned destructive call) never undone automatically;
//                        the run ends failed_needs_attention naming the step
//   emergency stop /  -> no new tool call is made, so no undo is attempted; if anything had
//   lost authorisation   succeeded with a declared undo the run ends failed_needs_attention
import type { PolicyAuditSink } from "@phoenix/policy";
import type { PhoenixEvent } from "@phoenix/protocol";
import type { ApprovalOutcome, ApprovalPort } from "./approvals";
import { boundValue } from "./bound";
import type { Semaphore } from "./semaphore";
import type { Value } from "./expr";
import { renderText } from "./render";
import { Halted, RunCancelled, RunRejected, StepFailure, type RunState } from "./run-state";
import { type PreparedAction, type StepResult, type StepRunner } from "./runner";
import type { RunRecord, WorkflowStore } from "./store";
import type { ActionStep, ApprovalStep, RunStatus, Step, StepStatus } from "./types";
import { END } from "./types";
import { nextStepId } from "./validate";

export interface ExecutorDeps {
  store: WorkflowStore;
  runner: StepRunner;
  /** The engine's concurrency slots; a run gives its slot up while it waits for a human. */
  slots: Semaphore;
  approvals: ApprovalPort;
  audit: PolicyAuditSink;
  now: () => number;
  isKillSwitchEngaged: () => boolean;
  /** Whether a live user authorisation covers this run's definition hash. */
  authorised: (run: RunRecord) => boolean;
  warn: (message: string, fields?: Record<string, unknown>) => void;
}

type ResultKind = "success" | "failure" | "rejected" | "cancelled" | "needs_attention";

interface Ending {
  status: RunStatus;
  reason: string;
  /** Run the declared undo steps first. */
  undo: boolean;
}

const COUNTER_FOR: Readonly<Record<string, string>> = {
  succeeded: "runs_succeeded",
  failed: "runs_failed",
  rejected: "runs_rejected",
  cancelled: "runs_cancelled",
  failed_needs_attention: "runs_needs_attention",
  interrupted: "runs_interrupted",
};

const RESULT_KIND: Readonly<Record<string, ResultKind>> = {
  succeeded: "success",
  failed: "failure",
  rejected: "rejected",
  cancelled: "cancelled",
  failed_needs_attention: "needs_attention",
};

export class RunExecutor {
  constructor(private readonly d: ExecutorDeps) {}

  /** Never rejects except with `Halted` (the engine was crashed or stopped: write nothing more). */
  async execute(state: RunState): Promise<void> {
    const { run } = state;
    try {
      this.alive(state);
      this.d.store.markRun(run.id, run.workflowId, "running", this.d.now(), { started: true }, [
        "runs_started",
      ]);
      await this.walk(state);
    } catch (err) {
      if (err instanceof Halted) throw err;
      await this.end(state, this.ending(err));
    }
  }

  private alive(state: RunState): void {
    if (state.halted) throw new Halted("engine halted");
  }

  /** Throws when the run must not take another step. */
  private guard(state: RunState): void {
    this.alive(state);
    if (state.abort.signal.aborted)
      throw new RunCancelled(
        state.cancel?.reason ?? "cancelled",
        state.cancel?.compensate ?? false,
      );
    if (this.d.isKillSwitchEngaged()) throw new RunCancelled("Emergency stop is engaged", false);
    if (state.authRequired && !this.d.authorised(state.run))
      throw new RunCancelled(
        "the user's authorisation was revoked, expired or no longer matches",
        false,
      );
  }

  private ending(err: unknown): Ending {
    if (err instanceof RunCancelled)
      return { status: "cancelled", reason: err.reason, undo: err.compensate };
    if (err instanceof RunRejected) return { status: "rejected", reason: err.message, undo: true };
    if (err instanceof StepFailure) return { status: "failed", reason: err.message, undo: true };
    this.d.warn("workflow run hit an unexpected error", { error: err });
    return { status: "failed", reason: "internal error", undo: true };
  }

  // ── Walking the steps ────────────────────────────────────────────────────

  private async walk(state: RunState): Promise<void> {
    const { def } = state;
    let index = 0;
    for (let hops = 0; hops <= def.steps.length; hops++) {
      this.guard(state);
      const step = def.steps[index];
      if (!step) break;
      const result = await this.runStep(state, step);
      state.succeeded.push(step.id);
      if (result.finish) state.resultEmitted = true;
      if (result.finish?.outcome === "failure")
        throw new StepFailure(`the workflow reported failure: ${result.finish.summary}`);
      if (result.finish) {
        return this.end(state, { status: "succeeded", reason: result.finish.summary, undo: false });
      }
      const next = result.next ?? nextStepId(def, index);
      if (next === END) break;
      index = state.indexOf[next] ?? def.steps.length;
    }
    return this.end(state, { status: "succeeded", reason: "all steps finished", undo: false });
  }

  private async runStep(state: RunState, step: Step): Promise<StepResult> {
    this.d.store.markRun(state.run.id, state.run.workflowId, "running", this.d.now(), {
      currentStep: step.id,
    });
    if (step.type === "action") return this.action(state, step);
    if (step.type === "approval") return this.approval(state, step);
    return this.simple(state, step);
  }

  private async simple(state: RunState, step: Step): Promise<StepResult> {
    const seq = this.begin(state, step.id, step.type, "running", null);
    try {
      const result = await this.d.runner.simple(state, step);
      this.alive(state);
      state.ctx.steps[step.id] = this.withProvenance(result);
      this.finishStep(state, seq, "succeeded", { output: state.ctx.steps[step.id] ?? null });
      return result;
    } catch (err) {
      this.failStep(state, seq, err);
      throw err;
    }
  }

  private withProvenance(result: StepResult & { processedBy?: string }): Value {
    const out = boundValue(result.output);
    if (
      result.processedBy !== undefined &&
      out !== null &&
      typeof out === "object" &&
      !Array.isArray(out)
    )
      return { ...out, processed_by: result.processedBy };
    return out;
  }

  private async action(state: RunState, step: ActionStep): Promise<StepResult> {
    let prepared: PreparedAction;
    try {
      prepared = this.d.runner.prepareAction(state, step);
    } catch (err) {
      const seq = this.begin(state, step.id, "action", "running", null, step.tool);
      this.failStep(state, seq, err);
      throw err;
    }
    const seq = this.begin(
      state,
      step.id,
      "action",
      "running",
      prepared.input,
      step.tool,
      prepared.destructive,
    );
    try {
      const { output, attempts } = await this.d.runner.callTool(state, prepared, {
        ...(step.retry ? { retry: step.retry } : {}),
        ...(step.timeout_ms === undefined ? {} : { timeoutMs: step.timeout_ms }),
      });
      this.alive(state);
      state.ctx.steps[step.id] = output;
      this.finishStep(state, seq, "succeeded", { output, attempts });
      return { output };
    } catch (err) {
      if (err instanceof StepFailure && err.outcomeUnknown) state.uncertain.push(step.id);
      else if (err instanceof RunCancelled && prepared.destructive) state.uncertain.push(step.id);
      this.failStep(state, seq, err, prepared.destructive);
      throw err;
    }
  }

  private async approval(state: RunState, step: ApprovalStep): Promise<StepResult> {
    const { run } = state;
    const summary = renderText(step.summary, state.ctx).slice(0, 500);
    const seq = this.begin(state, step.id, "approval", "waiting", { summary });
    this.d.store.markRun(run.id, run.workflowId, "waiting_approval", this.d.now(), {
      currentStep: step.id,
    });
    this.d.runner.emit(
      this.d.runner.event(
        state,
        "workflow.approval.requested",
        "warning",
        { step: step.id, summary },
        { requiresAction: true },
      ),
    );
    let outcome: ApprovalOutcome;
    // A run waiting for a human must not hold one of the few execution slots.
    if (state.holdsSlot) {
      state.holdsSlot = false;
      this.d.slots.release();
    }
    try {
      outcome = await this.d.approvals.request(
        {
          runId: run.id,
          workflowId: run.workflowId,
          stepId: step.id,
          correlationId: run.correlationId,
          summary,
        },
        state.abort.signal,
      );
    } catch (err) {
      await this.retake(state);
      this.alive(state);
      this.failStep(state, seq, new StepFailure("the approval request failed"));
      throw new StepFailure(
        `approval request failed: ${err instanceof Error ? err.name : "error"}`,
      );
    }
    await this.retake(state);
    this.alive(state);
    const counters = [`approvals_${outcome === "blocked" ? "rejected" : outcome}`];
    if (state.abort.signal.aborted) {
      this.finishStep(state, seq, "rejected", { error: "withdrawn" }, counters);
      throw new RunCancelled(
        state.cancel?.reason ?? "cancelled",
        state.cancel?.compensate ?? false,
      );
    }
    if (outcome === "approved") {
      state.approved = true;
      this.d.store.markRun(run.id, run.workflowId, "running", this.d.now(), {
        currentStep: step.id,
      });
      this.finishStep(state, seq, "succeeded", { output: { approved: true } }, counters);
      state.ctx.steps[step.id] = { approved: true };
      return { output: { approved: true } };
    }
    const status: StepStatus = outcome === "expired" ? "expired" : "rejected";
    this.finishStep(state, seq, status, { error: `approval ${outcome}` }, counters);
    if (outcome === "blocked") throw new RunCancelled("Emergency stop is engaged", false);
    if (outcome === "expired") throw new StepFailure("the approval expired before anyone answered");
    throw new RunRejected("the user rejected the approval");
  }

  private async retake(state: RunState): Promise<void> {
    if (state.holdsSlot) return;
    await this.d.slots.acquire();
    state.holdsSlot = true;
  }

  // ── History writes ───────────────────────────────────────────────────────

  private begin(
    state: RunState,
    stepId: string,
    type: string,
    status: StepStatus,
    input: Value,
    tool: string | null = null,
    destructive = false,
    phase: "step" | "compensation" = "step",
  ): number {
    this.alive(state);
    return this.d.store.beginStep({
      runId: state.run.id,
      stepId,
      phase,
      stepType: type,
      status,
      destructive,
      tool,
      input,
      startedAt: this.d.now(),
    });
  }

  private finishStep(
    state: RunState,
    seq: number,
    status: StepStatus,
    patch: { output?: Value; error?: string; attempts?: number },
    extraCounters: readonly string[] = [],
  ): void {
    const counters = [...extraCounters];
    if (status === "succeeded") counters.push("steps_succeeded");
    else if (status !== "waiting") counters.push("steps_failed");
    this.d.store.updateStep(
      state.run,
      seq,
      { status, ...patch, finishedAt: this.d.now() },
      counters,
    );
  }

  private failStep(state: RunState, seq: number, err: unknown, destructive = false): void {
    if (err instanceof Halted) return;
    let status: StepStatus = "failed";
    let message = "internal error";
    if (err instanceof StepFailure) {
      status = err.status;
      message = err.message;
    } else if (err instanceof RunCancelled) {
      status = destructive ? "unknown" : "failed";
      message = `stopped: ${err.reason}`;
    }
    this.finishStep(state, seq, status, { error: message });
  }

  // ── Ending a run ─────────────────────────────────────────────────────────

  private async end(state: RunState, ending: Ending): Promise<void> {
    this.alive(state);
    let { status, reason } = ending;
    // A run that finished its steps (even through a `failure` result it was told to take) has
    // nothing to undo only when it succeeded; every other ending undoes what it can.
    const outcome =
      status === "succeeded"
        ? { done: 0, failed: [], skipped: [] }
        : await this.undoSteps(state, ending);
    let needsAttention = false;
    if (state.uncertain.length > 0) {
      needsAttention = true;
      reason += `; outcome unknown for ${state.uncertain.join(", ")} (not undone automatically)`;
    }
    if (outcome.failed.length > 0) {
      needsAttention = true;
      reason += `; undo failed for ${outcome.failed.join(", ")}`;
    }
    if (outcome.skipped.length > 0) {
      needsAttention = true;
      reason += `; not undone: ${outcome.skipped.join(", ")}`;
    }
    if (needsAttention && status !== "succeeded") status = "failed_needs_attention";
    const counters = [COUNTER_FOR[status] ?? "runs_failed"];
    if (outcome.done > 0 && !needsAttention) counters.push("runs_compensated");
    reason = reason.slice(0, 500);
    this.alive(state);
    const finished = this.d.store.finishRun(state.run, status, reason, this.d.now(), counters);
    if (!finished) return;
    state.run.status = status;
    if (!state.resultEmitted) this.emitResult(state, status, reason);
    this.audit(state, status, reason);
  }

  private emitResult(state: RunState, status: RunStatus, reason: string): void {
    const kind = RESULT_KIND[status] ?? "failure";
    this.d.runner.emit(
      this.d.runner.event(
        state,
        "workflow.result",
        status === "succeeded" ? "success" : status === "cancelled" ? "warning" : "error",
        { outcome: kind, status, summary: reason.slice(0, 500) },
        { requiresAction: status === "failed_needs_attention" },
      ),
    );
  }

  private audit(state: RunState, status: RunStatus, reason: string): void {
    try {
      this.d.audit.record({
        actor: `system:${state.run.correlationId}`.slice(0, 120),
        action: "workflow.run.finished",
        decision: "info",
        details: { workflow: state.run.workflowId, run: state.run.id, status, reason },
      });
    } catch (err) {
      this.d.warn("could not audit the end of a workflow run", { error: err });
    }
  }

  /**
   * Declared undo calls, newest step first. Each succeeded step is undone at most once: the
   * undo row is written before the call, and a crash mid-undo is classified by `recover()`.
   */
  private async undoSteps(
    state: RunState,
    ending: Ending,
  ): Promise<{ done: number; failed: string[]; skipped: string[] }> {
    const todo = [...state.succeeded]
      .reverse()
      .map((id) => state.def.steps[state.indexOf[id] ?? -1])
      .filter((s): s is ActionStep => s?.type === "action" && s.compensate !== undefined);
    const out = { done: 0, failed: [] as string[], skipped: [] as string[] };
    if (todo.length === 0) return out;
    if (!ending.undo) {
      out.skipped = todo.map((s) => s.id);
      return out;
    }
    const { run } = state;
    this.d.store.markRun(run.id, run.workflowId, "compensating", this.d.now());
    state.abort = new AbortController();
    state.cancel = undefined;
    for (const [i, step] of todo.entries()) {
      const undo = step.compensate;
      if (!undo) continue;
      try {
        this.alive(state);
        if (state.abort.signal.aborted || this.d.isKillSwitchEngaged())
          throw new RunCancelled("Emergency stop is engaged", false);
        await this.undoOne(state, step.id, undo);
        out.done++;
      } catch (err) {
        if (err instanceof Halted) throw err;
        if (err instanceof RunCancelled) {
          out.skipped.push(...todo.slice(i).map((s) => s.id));
          return out;
        }
        out.failed.push(step.id);
      }
    }
    return out;
  }

  private async undoOne(
    state: RunState,
    stepId: string,
    undo: NonNullable<ActionStep["compensate"]>,
  ): Promise<void> {
    let prepared: PreparedAction;
    try {
      prepared = this.d.runner.prepareTool(state, undo.tool, undo.input ?? {}, `undo of ${stepId}`);
    } catch (err) {
      const seq = this.begin(
        state,
        stepId,
        "action",
        "running",
        null,
        undo.tool,
        false,
        "compensation",
      );
      this.failStep(state, seq, err);
      throw err;
    }
    const seq = this.begin(
      state,
      stepId,
      "action",
      "running",
      prepared.input,
      undo.tool,
      prepared.destructive,
      "compensation",
    );
    try {
      // No retry: an undo is never repeated.
      const { output } = await this.d.runner.callTool(state, prepared, {});
      this.alive(state);
      this.finishStep(state, seq, "succeeded", { output });
    } catch (err) {
      this.failStep(state, seq, err, prepared.destructive);
      throw err;
    }
  }
}
