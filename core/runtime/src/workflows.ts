// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Workflows inside Core (Phases 39-40 wiring).
//
// - The engine runs its tool calls through the runtime's `ToolGateway` as the workflow system
//   actor (`system:workflow-<run id>`); it never holds a `CapabilityManager`.
// - Only this class holds the `WorkflowAdmin` (create, change, enable, authorise, revoke), and it is
//   reached only by the session-token routes in `core/api/src/workflow-routes.ts`. The engine, the
//   tool gateway and the agents are never given it, and no tool or capability command exposes it.
// - Every user action here acts as the signed-in user (`user:owner`, trusted) and is audited by the
//   engine or the admin.
// - Authorising is bound to the definition hash: the caller must echo the hash it reviewed, and a
//   different current hash is refused (`HASH_MISMATCH`). The engine re-checks the live authorisation
//   against the stored hash before every run and every step.
// - `start()` runs `recover()` (interrupted runs are classified, nothing is resumed and no tool is
//   called) before the engine listens to the bus; `close()` stops it before the database closes.
import { aiStepFromService, lookupFromContext } from "@phoenix/workflows";
import type { ContextEngine } from "@phoenix/ai-context";
import type { Viewer } from "@phoenix/ai-memory";
import type { AiService } from "@phoenix/ai-models";
import type { ToolGateway } from "@phoenix/ai-tool-gateway";
import type {
  WorkflowAuthorisationView,
  WorkflowMetricsView,
  WorkflowRunSummaryView,
  WorkflowRunView,
  WorkflowsApi,
  WorkflowView,
} from "@phoenix/api";
import type { EventBus } from "@phoenix/event-bus";
import type { Logger } from "@phoenix/logging";
import type { PermissionGateway } from "@phoenix/permissions";
import type { Database } from "@phoenix/persistence";
import type { Actor } from "@phoenix/policy";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import {
  approvalsFromPermissions,
  catalogFromGateway,
  definitionHash,
  requiresAuthorisation,
  TERMINAL_STATUSES,
  validateDefinition,
  WorkflowAdmin,
  WorkflowAdminStore,
  WorkflowEngine,
  WorkflowError,
  WorkflowStore,
  type Authorisation,
  type RunStatus,
  type RunSummary,
  type ToolCatalog,
  type RunView,
  type WorkflowListing,
  type WorkflowMetrics,
} from "@phoenix/workflows";

/** The one signed-in user. Core has a single user; `trustedByUser` is what the admin demands. */
const USER: Actor = { kind: "user", id: "owner", trustedByUser: true };

/**
 * What `lookup` steps may read. A workflow reads with its own grant, not the device owner's: up to
 * `internal` data. Meeting-derived memory is `sensitive`, so a workflow cannot read it.
 */
const WORKFLOW_VIEWER: Viewer = {
  id: "workflows",
  grants: [{ scope: "*", maxSensitivity: "internal" }],
};

function isRunStatus(value: string): value is RunStatus {
  return Object.hasOwn(TERMINAL_STATUSES, value);
}

const iso = (ms: number): string => new Date(ms).toISOString();
const isoOrNull = (ms: number | null): string | null => (ms === null ? null : iso(ms));

const workflowView = (l: WorkflowListing): WorkflowView => ({
  id: l.id,
  name: l.name,
  enabled: l.enabled,
  environment: l.environment,
  version: l.version,
  hash: l.hash,
  trigger: l.trigger,
  authorisation_reasons: l.authorisationReasons,
  authorised: l.authorised,
  problems: l.problems,
});

const summaryView = (r: RunSummary): WorkflowRunSummaryView => ({
  id: r.id,
  workflow_id: r.workflowId,
  workflow_name: r.workflowName,
  status: r.status,
  terminal: r.terminal,
  correlation_id: r.correlationId,
  trigger_event_id: r.triggerEventId,
  chain_depth: r.chainDepth,
  current_step: r.currentStep,
  reason: r.reason,
  created_at: iso(r.createdAt),
  started_at: isoOrNull(r.startedAt),
  finished_at: isoOrNull(r.finishedAt),
});

const runView = (r: RunView): WorkflowRunView => ({
  ...summaryView(r),
  trigger: r.trigger,
  steps: r.steps.map((s) => ({
    seq: s.seq,
    step_id: s.stepId,
    phase: s.phase,
    type: s.type,
    status: s.status,
    attempts: s.attempts,
    destructive: s.destructive,
    tool: s.tool,
    input: s.input,
    output: s.output,
    error: s.error,
    started_at: iso(s.startedAt),
    finished_at: isoOrNull(s.finishedAt),
  })),
});

const metricsView = (m: WorkflowMetrics): WorkflowMetricsView => ({
  runs_started: m.runsStarted,
  runs_succeeded: m.runsSucceeded,
  runs_failed: m.runsFailed,
  runs_cancelled: m.runsCancelled,
  runs_rejected: m.runsRejected,
  runs_interrupted: m.runsInterrupted,
  runs_refused: m.runsRefused,
  runs_compensated: m.runsCompensated,
  runs_needing_attention: m.runsNeedingAttention,
  steps_succeeded: m.stepsSucceeded,
  steps_failed: m.stepsFailed,
  step_failure_rate: m.stepFailureRate,
  duration: m.duration,
  approvals_waiting: m.approvalsWaiting,
  approvals_approved: m.approvalsApproved,
  approvals_rejected: m.approvalsRejected,
  approvals_expired: m.approvalsExpired,
});

/** What the HTTP layer says for each workflow error. `INVALID_REQUEST` carries its own marker. */
const ERROR_CODES: Record<WorkflowError["code"], ErrorCode> = {
  NOT_USER_ACTOR: ErrorCode.PERMISSION_DENIED,
  INVALID_DEFINITION: ErrorCode.INVALID_REQUEST,
  NOT_FOUND: ErrorCode.RESOURCE_NOT_FOUND,
  VERSION_CONFLICT: ErrorCode.INVALID_REQUEST,
  LIMIT_REACHED: ErrorCode.INVALID_REQUEST,
  AUDIT_FAILED: ErrorCode.INTERNAL_ERROR,
  INVALID_REQUEST: ErrorCode.INVALID_REQUEST,
};

/** Runs `fn`; a `WorkflowError` leaves as a `PhoenixError` with its problems as details. */
function mapped<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (!(err instanceof WorkflowError)) throw err;
    const details = err.code === "INVALID_REQUEST" ? err.details : [err.code, ...err.details];
    throw new PhoenixError(ERROR_CODES[err.code], err.message, details);
  }
}

export interface WorkflowsDeps {
  db: Database;
  bus: EventBus;
  /** The runtime's tool gateway: the only way a workflow reaches a capability. */
  gateway: ToolGateway;
  permissions: PermissionGateway;
  ai: AiService;
  context: ContextEngine;
  logger: Logger;
}

export class WorkflowsRuntime implements WorkflowsApi {
  private readonly store: WorkflowStore;
  private readonly engine: WorkflowEngine;
  /** Never exported and never given to the engine, the gateway or an agent. */
  private readonly admin: WorkflowAdmin;
  private readonly catalog: ToolCatalog;
  private started = false;

  constructor(private readonly d: WorkflowsDeps) {
    this.store = new WorkflowStore(d.db);
    this.catalog = catalogFromGateway(d.gateway);
    this.engine = new WorkflowEngine({
      store: this.store,
      events: d.bus,
      publish: (event) => d.bus.publish(event),
      gateway: d.gateway,
      approvals: approvalsFromPermissions(d.permissions),
      audit: d.permissions.audit,
      isKillSwitchEngaged: () => d.permissions.isKillSwitchEngaged(),
      // The call given up on keeps its prompt otherwise: withdraw it.
      abandon: (tool) => {
        const dot = tool.indexOf(".");
        const capability = tool.slice(0, dot);
        const command = tool.slice(dot + 1);
        for (const c of d.permissions.pendingConfirmations()) {
          if (c.capabilityId === capability && c.command === command) {
            d.permissions.resolveConfirmation(c.id, false, "workflow-abandon");
          }
        }
      },
      // `AiService` refuses every call while AI is off, so an `ai` step then fails the run.
      ai: aiStepFromService(d.ai),
      lookup: lookupFromContext(d.context, WORKFLOW_VIEWER),
      logger: d.logger,
    });
    this.admin = new WorkflowAdmin({
      store: this.store,
      writes: new WorkflowAdminStore(d.db),
      audit: d.permissions.audit,
      catalog: this.catalog,
    });
  }

  /** Classifies runs a previous process left unfinished, then listens to the bus. */
  start(): void {
    if (this.started) return;
    this.started = true;
    const report = this.engine.recover();
    if (report.interrupted.length + report.needsAttention.length > 0) {
      this.d.logger.warn("workflow runs from a previous process were closed", {
        interrupted: report.interrupted.length,
        needs_attention: report.needsAttention.length,
      });
    }
    this.engine.start();
  }

  /** Stops listening and abandons running work without writing anything more. */
  async close(): Promise<void> {
    await this.engine.stop();
  }

  // ── Reading ────────────────────────────────────────────────────────────────

  private listing(id: string): WorkflowView {
    const found = this.engine.listWorkflows().find((w) => w.id === id);
    if (!found) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, `No workflow "${id}"`);
    return workflowView(found);
  }

  list(): WorkflowView[] {
    return this.engine.listWorkflows().map(workflowView);
  }

  private authorisationView(a: Authorisation, currentHash: string): WorkflowAuthorisationView {
    return {
      id: a.id,
      workflow_id: a.workflowId,
      definition_hash: a.definitionHash,
      authorised_by: a.authorisedBy,
      authorised_at: iso(a.authorisedAt),
      expires_at: isoOrNull(a.expiresAt),
      revoked_at: isoOrNull(a.revokedAt),
      revoked_by: a.revokedBy,
      live:
        a.revokedAt === null &&
        (a.expiresAt === null || a.expiresAt > Date.now()) &&
        a.definitionHash === currentHash,
    };
  }

  get(id: string) {
    const read = this.store.readDefinition(id);
    if (!read) return null;
    const workflow = this.listing(id);
    return {
      workflow,
      definition: read.ok ? read.definition : null,
      authorisations: this.store
        .authorisations(id)
        .map((a) => this.authorisationView(a, workflow.hash)),
      created_by: read.ok ? read.createdBy : null,
      created_at: read.ok ? iso(read.createdAt) : null,
      updated_by: read.ok ? read.updatedBy : null,
      updated_at: read.ok ? iso(read.updatedAt) : null,
    };
  }

  validate(definition: unknown) {
    const checked = validateDefinition(definition, this.catalog);
    if (!checked.ok) {
      return { valid: false, problems: checked.problems, hash: null, authorisation: null };
    }
    return {
      valid: true,
      problems: [],
      hash: definitionHash(checked.definition),
      authorisation: requiresAuthorisation(checked.definition, this.catalog),
    };
  }

  // ── Changing (user only) ───────────────────────────────────────────────────

  save(definition: unknown) {
    const id =
      typeof definition === "object" &&
      definition !== null &&
      "id" in definition &&
      typeof definition.id === "string"
        ? definition.id
        : undefined;
    const existed = id !== undefined && this.store.readDefinition(id) !== undefined;
    const stored = mapped(() => this.admin.save(USER, definition));
    const need = requiresAuthorisation(stored.definition, this.catalog);
    return {
      created: !existed,
      workflow: this.listing(stored.definition.id),
      stored_enabled: stored.definition.enabled,
      authorisation_required: need.required,
      authorisation_reasons: need.reasons,
    };
  }

  setEnabled(id: string, enabled: boolean): WorkflowView {
    mapped(() => this.admin.setEnabled(USER, id, enabled));
    return this.listing(id);
  }

  authorise(id: string, input: { hash: string; expiresAt?: string }) {
    const read = this.store.readDefinition(id);
    if (!read) throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, `No workflow "${id}"`);
    // The user authorises the content they reviewed. A different current hash is refused.
    if (!read.ok || input.hash !== read.hash) {
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        "The workflow changed since you reviewed it; review it again before authorising",
        ["HASH_MISMATCH"],
      );
    }
    let expiresAt: number | undefined;
    if (input.expiresAt !== undefined) {
      expiresAt = Date.parse(input.expiresAt);
      if (Number.isNaN(expiresAt)) {
        throw new PhoenixError(ErrorCode.INVALID_REQUEST, '"expires_at" must be an ISO timestamp');
      }
    }
    const authorisation = mapped(() =>
      this.admin.authorise(USER, id, expiresAt === undefined ? {} : { expiresAt }),
    );
    return {
      authorisation: this.authorisationView(authorisation, read.hash),
      workflow: this.listing(id),
    };
  }

  revoke(id: string) {
    if (!this.store.readDefinition(id)) {
      throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, `No workflow "${id}"`);
    }
    const revoked = mapped(() => this.admin.revoke(USER, id));
    return { revoked, workflow: this.listing(id) };
  }

  // ── Runs ───────────────────────────────────────────────────────────────────

  startRun(id: string, payload: Record<string, unknown>) {
    const { run, refused } = mapped(() => this.engine.startManual(USER, id, payload));
    if (refused) {
      // Recorded like a refused trigger; the reason is the run's own.
      const reason = this.engine.getRun(run.id)?.reason ?? "refused";
      throw new PhoenixError(ErrorCode.SECURITY_POLICY_BLOCKED, `The run was refused: ${reason}`, [
        "RUN_REFUSED",
        run.id,
        reason,
      ]);
    }
    return { run: summaryView(run) };
  }

  cancelRun(runId: string) {
    const { status } = mapped(() => this.engine.cancelRun(USER, runId));
    return { cancelled: true as const, status };
  }

  listRuns(query: { workflowId?: string; status?: string; limit: number }) {
    const { status } = query;
    if (status !== undefined && !isRunStatus(status)) {
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, '"status" is not a run status');
    }
    return {
      runs: this.engine
        .listRuns({
          ...(query.workflowId === undefined ? {} : { workflowId: query.workflowId }),
          ...(status === undefined ? {} : { status: status }),
          limit: query.limit,
        })
        .map(summaryView),
    };
  }

  getRun(runId: string): WorkflowRunView | null {
    const run = this.engine.getRun(runId);
    return run ? runView(run) : null;
  }

  metrics(): Record<string, WorkflowMetricsView> {
    return Object.fromEntries(
      Object.entries(this.engine.metrics()).map(([id, m]) => [id, metricsView(m)]),
    );
  }
}
