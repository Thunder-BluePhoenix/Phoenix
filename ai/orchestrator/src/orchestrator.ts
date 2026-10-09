// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The AI orchestrator (Phase 31). One request becomes one run:
//   classify → retrieve → plan → policy_check → execute → verify → respond → audit
// Rules this file exists to keep:
//   * An agent acts ONLY through `ToolCaller.call` (the ToolGateway), as
//     `{ kind: "agent", id, trustedByUser: false }`. This package never holds the capability manager.
//   * The environment, resource and data class of every call come from `AgentDefinition.classify`
//     (trusted code), never from a plan or a model.
//   * A plan is untrusted data. It is validated against the registry before step 1 runs.
//   * Every stage writes an audit record (`agent.stage.<name>`) holding ids, counts and tool
//     names only. Prompts, memory text and tool output never go into audit details.
//   * Every run is bounded (steps, tool calls, wall time by the injected clock) and cancellable
//     at any point; cancelling abandons the in-flight tool call and nothing further runs.
import { silentLogger, redact, type Logger } from "@phoenix/logging";
import { ToolGatewayError } from "@phoenix/ai-tool-gateway";
import type { ToolCall } from "@phoenix/ai-tool-gateway";
import type { Database } from "@phoenix/persistence";
import {
  assertTransition,
  isTerminalRunState,
  validateToolRequest,
  type AgentRun,
  type AgentRunState,
  type AgentTask,
  type Evidence,
  type NewEvent,
  type ToolRequest,
  type Verification,
} from "@phoenix/protocol";
import { CancelledError, PlanRejectedError, RunFailure, ToolCallFailure } from "./errors";
import { runEvent, type RunEventFacts, type RunEventKind } from "./events";
import { EvidenceBook } from "./evidence";
import { checkPlan, safeText } from "./plan";
import { AgentStore, type StoredOutcome, type StoredRun, type StoredStep } from "./store";
import {
  DEFAULT_LIMITS,
  STAGES,
  type AgentDefinition,
  type ApprovalFeed,
  type ApprovalSignal,
  type AuditTrail,
  type ConfirmationContext,
  type Conclusion,
  type FawkesPublisher,
  type Limits,
  type RunContext,
  type StageName,
  type StageStatus,
  type ToolCallOutput,
  type ToolCaller,
  type TrustedTarget,
} from "./types";

export class AgentsDisabledError extends Error {
  override name = "AgentsDisabledError";
  constructor() {
    super("Agent automation is turned off");
  }
}
export class KillSwitchEngagedError extends Error {
  override name = "KillSwitchEngagedError";
  constructor() {
    super("The emergency stop is engaged");
  }
}
export class InvalidTaskError extends Error {
  override name = "InvalidTaskError";
}
export class TooManyRunsError extends Error {
  override name = "TooManyRunsError";
  constructor(limit: number) {
    super(`At most ${limit} agent runs may be active at once`);
  }
}

/** Cancels stay on record under this name so the UI can say who stopped the run. */
export type CancelReason = string;

export type DetailValue = number | boolean | null | string | readonly string[];
export type StageDetail = Record<string, DetailValue>;

export interface TimerHandle {
  cancel(): void;
}
export type SetTimer = (ms: number, fn: () => void) => TimerHandle;

const realTimer: SetTimer = (ms, fn) => {
  const handle = setTimeout(fn, ms);
  handle.unref();
  return { cancel: () => clearTimeout(handle) };
};

export interface OrchestratorOptions {
  db: Database;
  gateway: ToolCaller;
  audit: AuditTrail;
  /** The setting `agents.enabled`. Read on every submit. */
  isEnabled: () => boolean;
  isKillSwitchEngaged: () => boolean;
  /** Fawkes-visible events of a run. */
  publish: FawkesPublisher;
  approvals?: ApprovalFeed;
  agents: readonly AgentDefinition[];
  limits?: Partial<Limits>;
  /** Epoch ms. Used for timestamps and the wall-time budget. */
  now?: () => number;
  /** Schedules the wall-time deadline. Tests drive it by hand. */
  setTimer?: SetTimer;
  newId?: (prefix: string) => string;
  logger?: Logger;
}

interface Inflight {
  tool: string;
  capabilityId: string;
  command: string;
  risk: string;
  preview: string;
  confirmationId?: string;
}

interface RunState {
  task: AgentTask;
  def: AgentDefinition;
  run: AgentRun;
  target: TrustedTarget | null;
  title: string;
  controller: AbortController;
  abort: { kind: "cancel" | "budget"; reason: string } | null;
  startedMs: number;
  toolCalls: number;
  modelCalls: number;
  recorded: Partial<Record<StageName, true>>;
  evidence: EvidenceBook;
  conclusion: Conclusion | null;
  verification: Verification | null;
  inflight: Inflight | null;
  deadline: TimerHandle | null;
  done: Promise<void>;
}

export interface TaskTrace {
  task: AgentTask;
  run: StoredRun;
  steps: StoredStep[];
  evidence: Evidence[];
  conclusion: Conclusion | null;
  verification: Verification | null;
  /** Every audit record this run wrote or caused: stage records and policy decisions. */
  auditIds: number[];
}

type Detail = StageDetail;

function cleanDetail(detail: Detail): Detail {
  const out: Detail = {};
  for (const [key, value] of Object.entries(detail)) {
    if (typeof value === "string") out[key] = safeText(value, 120);
    else if (Array.isArray(value)) out[key] = value.slice(0, 20).map((v) => safeText(v, 120));
    else out[key] = value;
  }
  return out;
}

export class Orchestrator {
  readonly limits: Limits;
  private readonly store: AgentStore;
  private readonly defs: Record<string, AgentDefinition> = {};
  private readonly active: Record<string, RunState> = {};
  private readonly now: () => number;
  private readonly setTimer: SetTimer;
  private readonly newId: (prefix: string) => string;
  private readonly logger: Logger;
  private readonly unsubscribeApprovals: () => void;
  private closed = false;

  constructor(private readonly o: OrchestratorOptions) {
    this.limits = { ...DEFAULT_LIMITS, ...o.limits };
    this.store = new AgentStore(o.db);
    this.now = o.now ?? Date.now;
    this.setTimer = o.setTimer ?? realTimer;
    this.newId = o.newId ?? ((prefix) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`);
    this.logger = (o.logger ?? silentLogger).child("agent-runtime");
    for (const def of o.agents) {
      if (Object.hasOwn(this.defs, def.descriptor.kind)) {
        throw new Error(`Agent kind "${def.descriptor.kind}" is registered twice`);
      }
      this.defs[def.descriptor.kind] = def;
    }
    this.unsubscribeApprovals = o.approvals?.subscribe((s) => this.onApproval(s)) ?? (() => {});
    this.recoverInterrupted();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Task kinds this orchestrator can run. */
  kinds(): string[] {
    return Object.keys(this.defs);
  }

  /**
   * Accepts a task and starts its run in the background. Throws AgentsDisabledError,
   * KillSwitchEngagedError, InvalidTaskError or TooManyRunsError; nothing is stored then.
   */
  submit(request: { kind: string; input: unknown; requestedBy: string }): AgentTask {
    if (this.closed) throw new AgentsDisabledError();
    if (!this.o.isEnabled()) throw new AgentsDisabledError();
    if (this.o.isKillSwitchEngaged()) throw new KillSwitchEngagedError();
    const def = Object.hasOwn(this.defs, request.kind) ? this.defs[request.kind] : undefined;
    if (!def) throw new InvalidTaskError(`Unknown task kind "${safeText(request.kind, 40)}"`);
    const input = request.input;
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new InvalidTaskError('"input" must be an object');
    }
    if (Object.keys(this.active).length >= this.limits.maxActiveRuns) {
      throw new TooManyRunsError(this.limits.maxActiveRuns);
    }
    const stamp = new Date(this.now()).toISOString();
    const task: AgentTask = {
      id: this.newId("task"),
      kind: def.descriptor.kind,
      input: { ...input },
      requestedBy: safeText(request.requestedBy, 100) || "user",
      createdAt: stamp,
      correlationId: this.newId("corr"),
    };
    const classified = def.classify(task);
    if (!classified.ok) throw new InvalidTaskError(classified.reason);

    const run: AgentRun = {
      id: this.newId("run"),
      taskId: task.id,
      agentId: def.descriptor.id,
      state: "CREATED",
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.store.insertTask(task);
    this.store.insertRun(run, def.descriptor.version);
    const controller = new AbortController();
    const rs: RunState = {
      task,
      def,
      run,
      target: null,
      title: classified.title,
      controller,
      abort: null,
      startedMs: this.now(),
      toolCalls: 0,
      modelCalls: 0,
      recorded: {},
      evidence: new EvidenceBook((e) => this.store.addEvidence(run.id, e, this.iso())),
      conclusion: null,
      verification: null,
      inflight: null,
      deadline: null,
      done: Promise.resolve(),
    };
    this.active[run.id] = rs;
    rs.deadline = this.setTimer(this.limits.maxWallMs, () =>
      this.abort(rs, "budget", `the run exceeded its ${this.limits.maxWallMs} ms time budget`),
    );
    rs.done = this.execute(rs);
    return task;
  }

  /** Cancels the task's active run. False when there is none (finished, unknown). */
  cancel(taskId: string, reason: CancelReason = "cancelled by the user"): boolean {
    const rs = Object.values(this.active).find((r) => r.task.id === taskId);
    if (!rs) return false;
    this.abort(rs, "cancel", reason);
    return true;
  }

  /** Disabling automation and the emergency stop both end here. Returns how many runs. */
  cancelAll(reason: CancelReason): number {
    const runs = Object.values(this.active);
    for (const rs of runs) this.abort(rs, "cancel", reason);
    return runs.length;
  }

  /** Resolves when every run that is active now has finished. */
  async idle(): Promise<void> {
    await Promise.allSettled(Object.values(this.active).map((r) => r.done));
  }

  /** Resolves when the task's run has finished (immediately if it already has). */
  async settled(taskId: string): Promise<void> {
    const rs = Object.values(this.active).find((r) => r.task.id === taskId);
    if (rs) await rs.done;
  }

  activeCount(): number {
    return Object.keys(this.active).length;
  }

  list(query: { state?: AgentRunState; limit: number }) {
    return this.store.list(query);
  }

  trace(taskId: string): TaskTrace | undefined {
    const task = this.store.task(taskId);
    if (!task) return undefined;
    const run = this.store.runForTask(taskId);
    if (!run) return undefined;
    const steps = this.store.steps(run.id);
    const auditIds = new Set<number>();
    for (const s of steps) {
      if (s.policyAuditId !== null) auditIds.add(s.policyAuditId);
      if (s.stageAuditId !== null) auditIds.add(s.stageAuditId);
    }
    return {
      task,
      run,
      steps,
      evidence: this.store.evidence(run.id),
      conclusion: run.outcome?.conclusion ?? null,
      verification: run.outcome?.verification ?? null,
      auditIds: [...auditIds].sort((a, b) => a - b),
    };
  }

  /**
   * What the approval prompt for `confirmationId` should add: which task asked, how risky the
   * action is, what it would do. Undefined when no active run is waiting on it.
   */
  describeConfirmation(confirmationId: string): ConfirmationContext | undefined {
    for (const rs of Object.values(this.active)) {
      const f = rs.inflight;
      if (f?.confirmationId !== confirmationId || !rs.target) continue;
      return {
        task_id: rs.task.id,
        run_id: rs.run.id,
        risk: f.risk as ConfirmationContext["risk"],
        target: rs.target.resource,
        preview: f.preview,
        evidence_ids: rs.evidence.list().map((e) => e.id),
      };
    }
    return undefined;
  }

  /** Stops every run and stops listening. Pending work finishes as CANCELLED. */
  async close(): Promise<void> {
    this.closed = true;
    this.cancelAll("Phoenix is shutting down");
    await this.idle();
    this.unsubscribeApprovals();
  }

  // ── Run lifecycle ───────────────────────────────────────────────────────────

  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  private facts(rs: RunState): RunEventFacts {
    return {
      taskId: rs.task.id,
      runId: rs.run.id,
      correlationId: rs.task.correlationId,
      agentKind: rs.def.descriptor.kind,
      title: rs.title,
    };
  }

  private emit(rs: RunState, kind: RunEventKind, extra: { stage?: string; reason?: string } = {}) {
    try {
      this.o.publish(runEvent(kind, this.facts(rs), extra) satisfies NewEvent);
    } catch (err) {
      this.logger.warn("could not publish an agent run event", { error: err });
    }
  }

  private transition(rs: RunState, to: AgentRunState, reason?: string): void {
    assertTransition(rs.run.state, to);
    const at = this.iso();
    rs.run = {
      ...rs.run,
      state: to,
      updatedAt: at,
      ...(reason === undefined ? {} : { failureReason: reason }),
    };
    this.store.setRunState(rs.run.id, to, at, reason);
  }

  private abort(rs: RunState, kind: "cancel" | "budget", reason: string): void {
    if (rs.abort || isTerminalRunState(rs.run.state)) return;
    rs.abort = { kind, reason: safeText(reason, 200) };
    rs.controller.abort();
    this.rejectPendingApproval(rs);
  }

  private abortError(rs: RunState): Error {
    const a = rs.abort ?? { kind: "cancel" as const, reason: "cancelled" };
    return a.kind === "budget"
      ? new RunFailure(`Stopped: ${a.reason}`)
      : new CancelledError(a.reason);
  }

  /** Throws unless the run may continue: not cancelled, kill switch off, inside its time budget. */
  private checkpoint(rs: RunState): void {
    if (rs.controller.signal.aborted) throw this.abortError(rs);
    if (this.o.isKillSwitchEngaged()) {
      this.abort(rs, "cancel", "the emergency stop is engaged");
      throw this.abortError(rs);
    }
    if (this.now() - rs.startedMs > this.limits.maxWallMs) {
      this.abort(rs, "budget", `the run exceeded its ${this.limits.maxWallMs} ms time budget`);
      throw this.abortError(rs);
    }
  }

  /** Lets cancellation interrupt work that does not watch the signal itself. */
  private raceAbort<T>(rs: RunState, work: Promise<T>): Promise<T> {
    const signal = rs.controller.signal;
    if (signal.aborted) {
      work.catch(() => {});
      return Promise.reject(this.abortError(rs));
    }
    const cancelled = Promise.withResolvers<never>();
    const onAbort = () => cancelled.reject(this.abortError(rs));
    signal.addEventListener("abort", onAbort, { once: true });
    return Promise.race([work, cancelled.promise]).finally(() =>
      signal.removeEventListener("abort", onAbort),
    );
  }

  private recordStage(
    rs: RunState,
    name: StageName,
    status: StageStatus,
    detail: Detail,
    startedAt: string,
  ): void {
    if (rs.recorded[name]) return;
    rs.recorded[name] = true;
    const cleaned = cleanDetail(detail);
    let auditId: number | null = null;
    try {
      auditId = this.o.audit.record({
        actor: `agent:${rs.def.descriptor.id}`,
        action: `agent.stage.${name}`,
        decision: "info",
        details: { taskId: rs.task.id, runId: rs.run.id, status, ...cleaned },
      }).id;
    } catch (err) {
      this.logger.error("could not audit an agent stage", { stage: name, error: err });
    }
    this.store.addStep({
      runId: rs.run.id,
      kind: "stage",
      name,
      status,
      detail: cleaned,
      policyAuditId: null,
      decision: null,
      risk: null,
      stageAuditId: auditId,
      startedAt,
      finishedAt: this.iso(),
    });
  }

  private async stage<T>(
    rs: RunState,
    name: StageName,
    work: () => Promise<T> | T,
    detail: (result: T) => Detail,
  ): Promise<T> {
    this.checkpoint(rs);
    const startedAt = this.iso();
    try {
      const result = await this.raceAbort(rs, Promise.resolve().then(work));
      this.checkpoint(rs);
      this.recordStage(rs, name, "ok", detail(result), startedAt);
      return result;
    } catch (err) {
      const status: StageStatus =
        err instanceof CancelledError
          ? "cancelled"
          : err instanceof PlanRejectedError
            ? "rejected"
            : "failed";
      const reason = err instanceof PlanRejectedError ? err.problems : [errorText(err)];
      this.recordStage(rs, name, status, { reason: reason.slice(0, 5) }, startedAt);
      throw err;
    }
  }

  private async execute(rs: RunState): Promise<void> {
    await Promise.resolve();
    let failure: { state: "FAILED" | "CANCELLED" | "COMPLETED"; reason?: string } = {
      state: "COMPLETED",
    };
    try {
      await this.pipeline(rs);
    } catch (err) {
      if (err instanceof CancelledError) failure = { state: "CANCELLED", reason: err.reason };
      else if (err instanceof RunFailure) failure = { state: "FAILED", reason: err.message };
      else {
        this.logger.error("agent run crashed", { runId: rs.run.id, error: err });
        failure = { state: "FAILED", reason: "Internal error; see the Phoenix log" };
      }
    }
    try {
      this.finish(rs, failure.state, failure.reason);
    } catch (err) {
      this.logger.error("could not finish an agent run", { runId: rs.run.id, error: err });
    } finally {
      rs.deadline?.cancel();
      delete this.active[rs.run.id];
    }
  }

  private async pipeline(rs: RunState): Promise<void> {
    const { def, task } = rs;

    const classified = await this.stage(
      rs,
      "classify",
      (): { target: TrustedTarget } => {
        const c = def.classify(task);
        if (!c.ok) throw new RunFailure(c.reason);
        return { target: c.target };
      },
      (c) => ({
        kind: task.kind,
        environment: c.target.environment,
        resource: c.target.resource,
        dataClass: c.target.dataClass,
      }),
    );
    rs.target = classified.target;
    this.transition(rs, "READY");
    this.transition(rs, "RUNNING");
    this.emit(rs, "started", { stage: "classify" });
    const rc = this.context(rs, classified.target);

    await this.stage(
      rs,
      "retrieve",
      async () => def.retrieve?.(rc),
      () => ({ evidence: rs.evidence.list().length }),
    );

    this.emit(rs, "thinking", { stage: "plan" });
    const plan = await this.stage(
      rs,
      "plan",
      async () => {
        const raw = await def.plan(rc);
        // The emergency stop also disables capabilities; report it as a stop, not as a bad plan.
        this.checkpoint(rs);
        const checked = checkPlan(raw, {
          tools: this.o.gateway.tools(),
          allowedTools: def.allowedTools,
          allowedCapabilities: def.allowedCapabilities,
          maxSteps: this.limits.maxSteps,
        });
        if (!checked.ok) {
          this.logger.warn("agent plan rejected", { runId: rs.run.id, problems: checked.problems });
          throw new PlanRejectedError(checked.problems);
        }
        return checked.plan;
      },
      (p) => ({ steps: p.steps.length, tools: p.steps.map((s) => s.tool) }),
    );

    await this.stage(
      rs,
      "policy_check",
      () => {
        const needsApproval: string[] = [];
        for (const step of plan.steps) {
          const decision = this.o.gateway.preview?.(this.callFor(rs, step.tool, step.input));
          if (decision?.effect === "deny") {
            throw new RunFailure(
              `Policy would refuse ${safeText(step.tool)}: ${safeText(decision.reasons[0] ?? "denied", 120)}`,
            );
          }
          if (decision?.effect === "require_approval") needsApproval.push(step.tool);
        }
        return needsApproval;
      },
      (needsApproval) => ({ steps: plan.steps.length, needsApproval }),
    );

    const skipped: string[] = [];
    const conclusion = await this.stage(
      rs,
      "execute",
      async () => {
        for (const step of plan.steps) {
          this.checkpoint(rs);
          const skip = def.skipStep?.(rc, step);
          if (skip !== undefined) {
            // Not a tool call (nothing reached the gateway), so no `tool_call` row: it is named in
            // the execute stage's detail instead.
            skipped.push(step.tool);
            continue;
          }
          try {
            const out = await rc.callTool({
              tool: step.tool,
              input: def.prepareInput?.(rc, step) ?? step.input,
              stepIndex: step.index,
            });
            await def.afterTool?.(rc, step, out.output);
          } catch (err) {
            if (!(err instanceof ToolCallFailure)) throw err;
            const how = def.toolFailure?.(rc, step, { code: err.code, message: err.message });
            if (how !== "continue") {
              throw new RunFailure(`${safeText(step.tool)} failed (${safeText(err.code, 40)})`);
            }
          }
        }
        this.emit(rs, "thinking", { stage: "execute" });
        return def.conclude(rc);
      },
      (c) => ({
        toolCalls: rs.toolCalls,
        modelCalls: c.modelCalls,
        aiUsed: c.aiUsed,
        evidence: rs.evidence.list().length,
        ...(skipped.length > 0 ? { skipped } : {}),
      }),
    );
    // `rs.conclusion` stays empty until the verifier has returned: an unverified conclusion
    // (model text included) is never persisted.
    rs.modelCalls = conclusion.modelCalls;

    this.transition(rs, "VERIFYING");
    const verified = await this.stage(
      rs,
      "verify",
      async () => {
        const result = await def.verify(rc, conclusion);
        rs.conclusion = result.conclusion;
        rs.verification = result.verification;
        if (!result.verification.passed) {
          const failed = result.verification.checks
            .filter((c) => c.passed === false && c.required !== false)
            .map((c) => c.name);
          throw new RunFailure(`Verification failed: ${failed.join(", ") || "a required check"}`);
        }
        return result;
      },
      (r) => ({
        passed: r.verification.passed,
        checks: r.verification.checks.map((c) => `${c.name}:${c.passed ? "pass" : "fail"}`),
        toolCalls: rs.toolCalls,
      }),
    );

    await this.stage(
      rs,
      "respond",
      () => {
        this.persistOutcome(rs);
        return verified.conclusion;
      },
      (c) => ({
        proposals: c.proposals.length,
        aiUsed: c.aiUsed,
        claims: c.diagnosis?.claims.length ?? 0,
        evidenceCoverage: c.diagnosis?.evidenceCoverage ?? null,
      }),
    );

    await this.stage(
      rs,
      "audit",
      () => undefined,
      () => ({
        toolCalls: rs.toolCalls,
        modelCalls: rs.modelCalls,
        evidence: rs.evidence.list().length,
        outcome: "COMPLETED",
      }),
    );
  }

  private persistOutcome(rs: RunState): void {
    const outcome: StoredOutcome = {
      conclusion: rs.conclusion ? (redact(rs.conclusion) as Conclusion) : null,
      verification: rs.verification,
      toolCalls: rs.toolCalls,
    };
    this.store.setOutcome(rs.run.id, outcome);
  }

  /** Moves the run to its final state, completes the audit trail, and tells Fawkes. */
  private finish(rs: RunState, state: "COMPLETED" | "FAILED" | "CANCELLED", reason?: string): void {
    this.rejectPendingApproval(rs);
    if (!isTerminalRunState(rs.run.state)) this.transition(rs, state, reason);
    const startedAt = this.iso();
    for (const name of STAGES) {
      if (name === "audit" || rs.recorded[name]) continue;
      this.recordStage(rs, name, "skipped", { reason: state }, startedAt);
    }
    this.recordStage(
      rs,
      "audit",
      state === "COMPLETED" ? "ok" : state === "CANCELLED" ? "cancelled" : "failed",
      {
        toolCalls: rs.toolCalls,
        modelCalls: rs.modelCalls,
        evidence: rs.evidence.list().length,
        outcome: state,
        ...(reason ? { reason } : {}),
      },
      startedAt,
    );
    this.persistOutcome(rs);
    try {
      rs.def.finished?.(rs.run.id);
    } catch (err) {
      this.logger.warn("agent cleanup failed", { error: err });
    }
    this.emit(
      rs,
      state === "COMPLETED" ? "completed" : state === "FAILED" ? "failed" : "cancelled",
      reason ? { reason } : {},
    );
  }

  /** A restart cannot resume a run (its tool calls are gone): it is closed as FAILED, on record. */
  private recoverInterrupted(): void {
    for (const run of this.store.interruptedRuns()) {
      const reason = "Phoenix stopped while this run was in progress";
      this.store.setRunState(run.id, "FAILED", this.iso(), reason);
      try {
        const id = this.o.audit.record({
          actor: `agent:${run.agentId}`,
          action: "agent.stage.audit",
          decision: "info",
          details: {
            taskId: run.taskId,
            runId: run.id,
            status: "failed",
            outcome: "FAILED",
            reason,
          },
        }).id;
        this.store.addStep({
          runId: run.id,
          kind: "stage",
          name: "audit",
          status: "failed",
          detail: { outcome: "FAILED", reason },
          policyAuditId: null,
          decision: null,
          risk: null,
          stageAuditId: id,
          startedAt: this.iso(),
          finishedAt: this.iso(),
        });
      } catch (err) {
        this.logger.error("could not audit an interrupted run", { runId: run.id, error: err });
      }
    }
  }

  // ── Tool calls ──────────────────────────────────────────────────────────────

  private callFor(rs: RunState, tool: string, input: Record<string, unknown>): ToolCall {
    const target = rs.target!;
    return {
      // Never trusted by the user: derived work, so anything above low risk needs a human.
      actor: { kind: "agent", id: rs.def.descriptor.id, trustedByUser: false },
      tool,
      input,
      environment: target.environment,
      resource: target.resource,
      dataClass: target.dataClass,
    };
  }

  private context(rs: RunState, target: TrustedTarget): RunContext {
    const orchestrator = this;
    return {
      task: rs.task,
      runId: rs.run.id,
      target,
      evidence: rs.evidence,
      signal: rs.controller.signal,
      availableTools: () =>
        this.o.gateway
          .tools()
          .filter((t) => rs.def.allowedTools.includes(t.name))
          .map((t) => ({ name: t.name, description: t.description, sideEffect: t.sideEffect })),
      callTool: (request) => orchestrator.callTool(rs, request),
      countModelCall: () => {
        rs.modelCalls++;
      },
    };
  }

  private addToolStep(
    rs: RunState,
    tool: string,
    status: string,
    startedAt: string,
    extra: {
      auditId?: number | null;
      decision?: string | null;
      risk?: string | null;
      detail?: Detail;
    },
  ): void {
    this.store.addStep({
      runId: rs.run.id,
      kind: "tool_call",
      name: tool,
      status,
      detail: cleanDetail(extra.detail ?? {}),
      policyAuditId: extra.auditId ?? null,
      decision: extra.decision ?? null,
      risk: extra.risk ?? null,
      stageAuditId: null,
      startedAt,
      finishedAt: this.iso(),
    });
  }

  private async callTool(rs: RunState, request: ToolRequest): Promise<ToolCallOutput> {
    this.checkpoint(rs);
    const startedAt = this.iso();
    const parsed = validateToolRequest(request);
    const tool = parsed.ok ? parsed.value.tool : "(invalid)";
    const reject = (code: "NOT_ALLOWED" | "BUDGET" | "INVALID_REQUEST", message: string) => {
      this.addToolStep(rs, tool, "rejected", startedAt, { detail: { code } });
      return new ToolCallFailure(code, message, tool);
    };
    if (!parsed.ok) throw reject("INVALID_REQUEST", "The tool request is malformed");
    const capability = tool.slice(0, tool.indexOf("."));
    if (!rs.def.allowedCapabilities.includes(capability) || !rs.def.allowedTools.includes(tool)) {
      throw reject("NOT_ALLOWED", `"${safeText(tool)}" is not allowed for this kind of task`);
    }
    if (rs.toolCalls >= this.limits.maxToolCalls) {
      throw reject("BUDGET", `A run may make at most ${this.limits.maxToolCalls} tool calls`);
    }
    rs.toolCalls++;

    const call = this.callFor(rs, tool, parsed.value.input);
    const contract = this.o.gateway.tools().find((t) => t.name === tool);
    let risk = "unknown";
    try {
      risk = this.o.gateway.preview?.(call).risk ?? risk;
    } catch {
      // The preview only decorates the approval prompt; the real decision happens in `call`.
    }
    rs.inflight = {
      tool,
      capabilityId: contract?.capabilityId ?? capability,
      command: contract?.command ?? tool.slice(tool.indexOf(".") + 1),
      risk,
      preview: safeText(
        `${contract?.description ?? tool} ${JSON.stringify(redact(call.input))}`,
        300,
      ),
    };
    const pending = this.o.gateway.call(call);
    try {
      const result = await this.raceAbort(rs, pending);
      this.addToolStep(rs, tool, "ok", startedAt, {
        auditId: result.auditId,
        decision: result.decision.effect,
        risk: result.decision.risk,
        detail: { stepIndex: parsed.value.stepIndex ?? null, operationId: result.operationId },
      });
      return {
        output: result.output,
        auditId: result.auditId,
        decision: result.decision.effect,
        risk: result.decision.risk,
        operationId: result.operationId,
      };
    } catch (err) {
      if (err instanceof ToolGatewayError) {
        if (this.o.isKillSwitchEngaged()) {
          this.abort(rs, "cancel", "the emergency stop is engaged");
          this.addToolStep(rs, tool, "cancelled", startedAt, { auditId: err.auditId ?? null });
          throw this.abortError(rs);
        }
        this.addToolStep(rs, tool, err.code === "DENIED" ? "denied" : "failed", startedAt, {
          auditId: err.auditId ?? null,
          decision: err.decision?.effect ?? null,
          risk: err.decision?.risk ?? null,
          detail: { code: err.code },
        });
        throw new ToolCallFailure(
          err.code,
          safeText(err.message, 200),
          tool,
          err.auditId,
          err.decision,
        );
      }
      // Cancelled or out of time while the call was in flight: the call is abandoned. It may
      // still have been decided and audited by the gateway; that record stands.
      pending.catch(() => {});
      this.addToolStep(rs, tool, "abandoned", startedAt, {
        detail: { reason: rs.abort?.reason ?? "stopped" },
      });
      throw err;
    } finally {
      rs.inflight = null;
    }
  }

  // ── Approvals ───────────────────────────────────────────────────────────────

  private onApproval(signal: ApprovalSignal): void {
    try {
      if (signal.kind === "requested") {
        const rs = Object.values(this.active).find(
          (r) =>
            r.inflight !== null &&
            r.inflight.confirmationId === undefined &&
            r.inflight.capabilityId === signal.capabilityId &&
            r.inflight.command === signal.command,
        );
        if (!rs?.inflight) return;
        rs.inflight.confirmationId = signal.confirmationId;
        if (rs.run.state === "RUNNING") {
          this.transition(rs, "WAITING_APPROVAL");
          this.emit(rs, "waiting", { stage: "execute" });
        }
        return;
      }
      const rs = Object.values(this.active).find(
        (r) => r.inflight?.confirmationId === signal.confirmationId,
      );
      if (rs?.run.state === "WAITING_APPROVAL") {
        this.transition(rs, "RUNNING");
        this.emit(rs, "thinking", { stage: "execute" });
      }
    } catch (err) {
      this.logger.warn("agent approval signal failed", { error: err });
    }
  }

  /** A cancelled run must not leave a prompt behind for something that will never run. */
  private rejectPendingApproval(rs: RunState): void {
    const feed = this.o.approvals;
    const f = rs.inflight;
    if (!feed || !f) return;
    try {
      if (f.confirmationId) {
        feed.reject(f.confirmationId);
        return;
      }
      const same = feed
        .pending()
        .filter((p) => p.capabilityId === f.capabilityId && p.command === f.command);
      const competing = Object.values(this.active).filter(
        (r) =>
          r !== rs &&
          r.inflight?.capabilityId === f.capabilityId &&
          r.inflight.command === f.command,
      );
      if (same.length === 1 && competing.length === 0) feed.reject(same[0]!.id);
    } catch (err) {
      this.logger.warn("could not reject a pending approval", { error: err });
    }
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? safeText(err.message, 200) : "unknown error";
}
