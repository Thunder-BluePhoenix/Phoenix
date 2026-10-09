// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The workflow engine: listens to the event bus, starts runs, executes them through the tool
// gateway and keeps their history in SQLite. It holds a `WorkflowStore` (reads, run writes,
// counters) and has no way to create, change, enable or authorise a workflow: that is
// `WorkflowAdmin`, which only the user-authenticated API layer is given.
import { matchesPattern } from "@phoenix/event-bus";
import { silentLogger, type Logger } from "@phoenix/logging";
import { createEvent, type PhoenixEvent } from "@phoenix/protocol";
import { boundRecord, boundValue } from "./bound";
import { realSleep, DEFAULT_CONCURRENCY, DEFAULT_RATE, type EngineDeps } from "./engine-types";
import { evaluateCondition, type Value } from "./expr";
import { RunExecutor } from "./executor";
import { compiledExpression } from "./render";
import { Halted, newRunState, type RunState } from "./run-state";
import { DEFAULT_APPROVAL_WAIT_MS, StepRunner, WORKFLOW_SOURCE } from "./runner";
import { Semaphore } from "./semaphore";
import { MAX_REFUSED_RECORDS } from "./engine-types";
import type { DefinitionRead, RunRecord } from "./store";
import { transaction } from "./store";
import { LIMITS, type RunStatus, type ToolCatalog, type WorkflowDefinition } from "./types";
import { catalogFromGateway } from "./engine-types";
import { requiresAuthorisation, validateDefinition } from "./validate";
import {
  buildMetrics,
  runView,
  summarise,
  type RunSummary,
  type RunView,
  type WorkflowMetrics,
} from "./views";

const KILL_SWITCH_EVENT = "security.kill_switch.engaged";
const SUBSCRIBER_EVENTS = "workflow-engine.events";
const SUBSCRIBER_KILL = "workflow-engine.kill-switch";
const DURATION_SAMPLES = 1000;

export interface WorkflowListing {
  id: string;
  name: string;
  enabled: boolean;
  environment: WorkflowDefinition["environment"];
  version: number;
  hash: string;
  trigger: WorkflowDefinition["trigger"];
  /** Why running it needs the user's authorisation; empty when it does not. */
  authorisationReasons: string[];
  /** A live authorisation for exactly this definition exists (or none is needed). */
  authorised: boolean;
  /** Problems with the stored definition or its tools right now; empty when it can run. */
  problems: string[];
}

export interface RecoveryReport {
  interrupted: string[];
  needsAttention: string[];
}

export class WorkflowEngine {
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly catalog: ToolCatalog;
  private readonly runner: StepRunner;
  private readonly executor: RunExecutor;
  private readonly slots: Semaphore;
  private readonly active: Record<string, RunState> = Object.create(null) as Record<
    string,
    RunState
  >;
  private readonly pending = new Set<Promise<void>>();
  private readonly unsubscribe: (() => void)[] = [];
  private readonly newId: () => string;
  private stopped = false;
  private definitionCache: { stamp: string; defs: DefinitionRead[] } | undefined;

  constructor(private readonly d: EngineDeps) {
    this.logger = (d.logger ?? silentLogger).child("workflows");
    this.now = d.now ?? Date.now;
    this.catalog = catalogFromGateway(d.gateway);
    this.slots = new Semaphore(d.maxConcurrent ?? DEFAULT_CONCURRENCY);
    this.newId = d.newId ?? (() => `run_${crypto.randomUUID().replaceAll("-", "")}`);
    const warn = (message: string, fields?: Record<string, unknown>) =>
      this.logger.warn(message, fields);
    this.runner = new StepRunner({
      gateway: d.gateway,
      catalog: this.catalog,
      publish: d.publish,
      ai: d.ai,
      lookup: d.lookup,
      sleep: d.sleep ?? realSleep,
      abandon: d.abandon,
      approvalWaitMs: DEFAULT_APPROVAL_WAIT_MS,
      warn,
    });
    this.executor = new RunExecutor({
      store: d.store,
      runner: this.runner,
      slots: this.slots,
      approvals: d.approvals,
      audit: d.audit,
      now: this.now,
      isKillSwitchEngaged: d.isKillSwitchEngaged,
      authorised: (run) =>
        d.store.activeAuthorisation(run.workflowId, run.definitionHash, this.now()) !== undefined,
      warn,
    });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Classifies runs a previous process left unfinished. Nothing is resumed and no tool is
   * called at startup:
   *  - a run that was only queued, or waiting for a human, with nothing to undo, becomes
   *    `interrupted` (its confirmation prompt died with the process);
   *  - a run with a call whose outcome is unknown, or with succeeded steps that declared an undo,
   *    becomes `failed_needs_attention` and says which steps.
   */
  recover(): RecoveryReport {
    const report: RecoveryReport = { interrupted: [], needsAttention: [] };
    const open = this.d.store.runsInStatus("queued", "running", "waiting_approval", "compensating");
    for (const run of open) {
      const steps = this.d.store.steps(run.id);
      const unknown = steps.filter(
        (s) => s.phase === "step" && s.status === "running" && s.destructive,
      );
      const undoable = steps.filter(
        (s) => s.phase === "step" && s.status === "succeeded" && s.tool !== null,
      );
      const withUndo = undoable.filter((s) => {
        const step = run.definition.steps.find((x) => x.id === s.stepId);
        return step?.type === "action" && step.compensate !== undefined;
      });
      const undone = steps.filter((s) => s.phase === "compensation" && s.status === "succeeded");
      const pendingUndo = withUndo.filter((s) => !undone.some((u) => u.stepId === s.stepId));
      const attention =
        unknown.length > 0 || pendingUndo.length > 0 || run.status === "compensating";
      const status: RunStatus = attention ? "failed_needs_attention" : "interrupted";
      let reason = "Phoenix stopped while this run was in progress";
      if (unknown.length > 0)
        reason += `; outcome unknown for ${unknown.map((s) => s.stepId).join(", ")}`;
      if (pendingUndo.length > 0)
        reason += `; not undone: ${pendingUndo.map((s) => s.stepId).join(", ")}`;
      if (run.status === "compensating") reason += "; stopped while undoing";
      const now = this.now();
      const done = transaction(this.d.store.database, () => {
        const ok = this.d.store.finishRun(run, status, reason.slice(0, 500), now, [
          attention ? "runs_needs_attention" : "runs_interrupted",
        ]);
        if (ok) this.d.store.closeOpenSteps(run.id, now);
        return ok;
      });
      if (!done) continue;
      (attention ? report.needsAttention : report.interrupted).push(run.id);
      this.publishRecovered(run, status, reason);
    }
    return report;
  }

  /** Subscribes to the bus. Call `recover()` first. */
  start(): void {
    if (this.unsubscribe.length > 0 || this.stopped) return;
    this.unsubscribe.push(
      this.d.events.subscribe(SUBSCRIBER_EVENTS, "*", (event) => this.onEvent(event)),
      this.d.events.subscribe(SUBSCRIBER_KILL, KILL_SWITCH_EVENT, () => this.onKillSwitch()),
    );
  }

  /** Stops listening and abandons running work without writing anything more (shutdown, crash). */
  async stop(): Promise<void> {
    this.stopped = true;
    for (const off of this.unsubscribe.splice(0)) off();
    for (const state of Object.values(this.active)) {
      state.halted = true;
      state.abort.abort();
    }
    this.slots.halt();
    await this.idle();
  }

  /** Resolves when no run is executing or queued. */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  /**
   * The emergency stop: every active run is cancelled. No undo is attempted, because the kill
   * switch blocks every tool call; a run with succeeded steps that declared an undo therefore ends
   * `failed_needs_attention`. Waiting approvals are rejected by the PermissionGateway itself.
   */
  onKillSwitch(): void {
    for (const state of Object.values(this.active)) {
      state.cancel = { reason: "Emergency stop is engaged", compensate: false };
      state.abort.abort();
    }
  }

  // ── Reading ──────────────────────────────────────────────────────────────

  listRuns(query: { workflowId?: string; status?: RunStatus; limit?: number } = {}): RunSummary[] {
    return this.d.store.listRuns(query).map(summarise);
  }

  /** One run with per-step status; inputs and outputs are redacted and truncated. */
  getRun(runId: string): RunView | undefined {
    const run = this.d.store.getRun(runId);
    return run ? runView(run, this.d.store.steps(runId)) : undefined;
  }

  listWorkflows(): WorkflowListing[] {
    return this.d.store.listDefinitions().map((read): WorkflowListing => {
      if (!read.ok)
        return {
          id: read.id,
          name: read.id,
          enabled: false,
          environment: "local",
          version: 0,
          hash: "",
          trigger: { event: "" },
          authorisationReasons: [],
          authorised: false,
          problems: read.problems,
        };
      const def = read.definition;
      const need = requiresAuthorisation(def, this.catalog);
      const live = this.d.store.activeAuthorisation(def.id, read.hash, this.now());
      const checked = validateDefinition(def, this.catalog);
      return {
        id: def.id,
        name: def.name,
        enabled: def.enabled,
        environment: def.environment,
        version: def.version,
        hash: read.hash,
        trigger: def.trigger,
        authorisationReasons: need.reasons,
        authorised: !need.required || live !== undefined,
        problems: checked.ok ? [] : checked.problems,
      };
    });
  }

  /** Reliability numbers per workflow. Counters are persisted; durations use the injected clock. */
  metrics(): Record<string, WorkflowMetrics> {
    const counters = this.d.store.counters();
    const waiting: Record<string, number> = Object.create(null) as Record<string, number>;
    for (const w of this.d.store.waitingApprovals()) waiting[w.workflowId] = w.n;
    const out: Record<string, WorkflowMetrics> = Object.create(null) as Record<
      string,
      WorkflowMetrics
    >;
    const ids = new Set([...Object.keys(counters), ...Object.keys(waiting)]);
    for (const id of ids)
      out[id] = buildMetrics(
        counters[id],
        this.d.store.durations(id, DURATION_SAMPLES),
        waiting[id] ?? 0,
      );
    return out;
  }

  // ── Starting runs ────────────────────────────────────────────────────────

  private onEvent(event: PhoenixEvent): void {
    if (this.stopped) return;
    // Refusal notices are for people and logs. A workflow reacting to one would turn every
    // refusal into another run to refuse.
    if (event.source === WORKFLOW_SOURCE && event.event_type === "workflow.run.refused") return;
    const depth = this.chainDepthOf(event);
    // Past the limit nothing is recorded or started: the first refusal (depth limit + 1) is the
    // record that the chain was cut; everything beyond it is dropped silently.
    if (depth > (this.d.maxChainDepth ?? LIMITS.maxChainDepth) + 1) {
      this.logger.warn("dropped an event deep in a workflow chain", {
        event_id: event.event_id,
        depth,
      });
      return;
    }
    try {
      for (const read of this.definitions()) {
        if (!read.ok || !read.definition.enabled) continue;
        const def = read.definition;
        if (!matchesPattern(def.trigger.event, event.event_type)) continue;
        if (!this.whereMatches(def, event)) continue;
        this.consider(read, event);
      }
    } catch (err) {
      // Never throw into the bus: it would retry the delivery and dead-letter it.
      this.logger.error("workflow trigger handling failed", { error: err });
    }
  }

  private definitions(): DefinitionRead[] {
    const stamps = this.d.store.definitionStamps();
    const stamp = JSON.stringify(stamps);
    if (this.definitionCache?.stamp !== stamp)
      this.definitionCache = { stamp, defs: this.d.store.listDefinitions() };
    return this.definitionCache.defs;
  }

  private triggerContext(event: PhoenixEvent): Value {
    return boundValue({
      event_id: event.event_id,
      event_type: event.event_type,
      source: event.source,
      severity: event.severity,
      subject: event.subject,
      timestamp: event.timestamp,
      correlation_id: event.correlation_id,
      payload: boundRecord(event.payload),
    });
  }

  private whereMatches(def: WorkflowDefinition, event: PhoenixEvent): boolean {
    if (def.trigger.where === undefined) return true;
    try {
      return evaluateCondition(compiledExpression(def.trigger.where), {
        event: this.triggerContext(event),
        steps: {},
        run: {},
      });
    } catch {
      return false;
    }
  }

  /** How many workflow hops led to this event (0 for anything a capability or the user caused). */
  private chainDepthOf(event: PhoenixEvent): number {
    if (event.source !== WORKFLOW_SOURCE) return 0;
    const meta: unknown = event.metadata;
    const depth =
      meta !== null && typeof meta === "object" && "workflow_depth" in meta
        ? meta.workflow_depth
        : undefined;
    // An event claiming to come from a workflow without a depth is treated as the deepest.
    return typeof depth === "number" && Number.isInteger(depth) && depth >= 0
      ? depth + 1
      : (this.d.maxChainDepth ?? LIMITS.maxChainDepth) + 1;
  }

  private refusalFor(
    read: Extract<DefinitionRead, { ok: true }>,
    event: PhoenixEvent,
    depth: number,
  ): string | undefined {
    const def = read.definition;
    if (this.d.isKillSwitchEngaged()) return "Emergency stop is engaged";
    if (event.source === WORKFLOW_SOURCE && event.payload["workflow"] === def.id)
      return "loop protection: a workflow is not triggered by its own events";
    if (depth > (this.d.maxChainDepth ?? LIMITS.maxChainDepth))
      return `loop protection: this event is ${depth} workflow hops from a user or capability event`;
    const rate = this.d.rate ?? DEFAULT_RATE;
    if (this.d.store.countStartedSince(def.id, this.now() - rate.windowMs) >= rate.max)
      return `rate limit: at most ${rate.max} runs per ${rate.windowMs} ms`;
    const checked = validateDefinition(def, this.catalog);
    if (!checked.ok)
      return `the definition is not runnable now: ${checked.problems[0] ?? "invalid"}`;
    const need = requiresAuthorisation(def, this.catalog);
    if (
      need.required &&
      this.d.store.activeAuthorisation(def.id, read.hash, this.now()) === undefined
    )
      return `not authorised: ${need.reasons[0] ?? "production workflow"}; the user must authorise this exact definition`;
    return undefined;
  }

  private consider(read: Extract<DefinitionRead, { ok: true }>, event: PhoenixEvent): void {
    const def = read.definition;
    const depth = this.chainDepthOf(event);
    const refusal = this.refusalFor(read, event, depth);
    const id = this.newId();
    const rate = this.d.rate ?? DEFAULT_RATE;
    if (
      refusal !== undefined &&
      this.d.store.countRefusedSince(def.id, this.now() - rate.windowMs) >= MAX_REFUSED_RECORDS
    ) {
      this.logger.warn("too many refused workflow runs; not recording more", { workflow: def.id });
      return;
    }
    const inserted = this.d.store.insertRun({
      id,
      workflow: def,
      hash: read.hash,
      status: refusal === undefined ? "queued" : "refused",
      triggerEventId: event.event_id,
      triggerEvent: this.triggerContext(event),
      chainDepth: depth,
      ...(refusal === undefined ? {} : { reason: refusal }),
      now: this.now(),
    });
    // The same event for the same workflow was seen before: nothing starts, nothing is recorded.
    if (!inserted) return;
    const run = this.d.store.getRun(id);
    if (!run) return;
    if (refusal !== undefined) {
      this.announceRefusal(run, refusal);
      return;
    }
    this.schedule(run, requiresAuthorisation(def, this.catalog).required);
  }

  private announceRefusal(run: RunRecord, reason: string): void {
    try {
      this.d.audit.record({
        actor: `system:${run.correlationId}`.slice(0, 120),
        action: "workflow.run.refused",
        decision: "denied",
        details: { workflow: run.workflowId, run: run.id, trigger: run.triggerEventId, reason },
      });
    } catch (err) {
      this.logger.warn("could not audit a refused workflow run", { error: err });
    }
    this.d.publish(
      createEvent({
        event_type: "workflow.run.refused",
        source: WORKFLOW_SOURCE,
        severity: "warning",
        subject: run.workflowId,
        correlation_id: run.correlationId,
        causation_id: run.triggerEventId.slice(0, 200),
        metadata: { workflow_depth: run.chainDepth },
        payload: { workflow: run.workflowId, run: run.id, reason: reason.slice(0, 300) },
      }),
    );
  }

  private publishRecovered(run: RunRecord, status: RunStatus, reason: string): void {
    this.d.publish(
      createEvent({
        event_type: "workflow.result",
        source: WORKFLOW_SOURCE,
        severity: "error",
        subject: run.workflowId,
        correlation_id: run.correlationId,
        requires_action: status === "failed_needs_attention",
        metadata: { workflow_depth: run.chainDepth },
        payload: {
          workflow: run.workflowId,
          run: run.id,
          outcome: status === "interrupted" ? "interrupted" : "needs_attention",
          status,
          summary: reason.slice(0, 500),
        },
      }),
    );
    try {
      this.d.audit.record({
        actor: `system:${run.correlationId}`.slice(0, 120),
        action: "workflow.run.recovered",
        decision: "info",
        details: { workflow: run.workflowId, run: run.id, status, reason },
      });
    } catch (err) {
      this.logger.warn("could not audit workflow recovery", { error: err });
    }
  }

  // ── Execution ────────────────────────────────────────────────────────────

  private schedule(run: RunRecord, authRequired: boolean): void {
    const state = newRunState(run, {
      id: run.id,
      workflow: run.workflowId,
      correlation_id: run.correlationId,
    });
    state.authRequired = authRequired;
    this.active[run.id] = state;
    const job = (async () => {
      await this.slots.acquire();
      state.holdsSlot = !state.halted;
      try {
        await this.executor.execute(state);
      } catch (err) {
        if (!(err instanceof Halted))
          this.logger.error("workflow run crashed", { run: run.id, error: err });
      } finally {
        if (state.holdsSlot) this.slots.release();
        state.holdsSlot = false;
        delete this.active[run.id];
      }
    })();
    this.pending.add(job);
    void job.finally(() => this.pending.delete(job));
  }
}
