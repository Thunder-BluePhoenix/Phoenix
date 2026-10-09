// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The agent runtime inside Core (Phase 31). It builds the orchestrator over the runtime's
// ToolGateway (the ONLY thing an agent can reach a capability through), the CI-failure agent, and
// the model call that goes through the runtime's AiService. Automation is off until the user turns
// it on (`agents.enabled`, ADR-0010: autonomy is earned); turning it off, or engaging the kill
// switch, cancels every active run.
import { createCiFailureAgent, type ModelCall } from "@phoenix/ai-agents";
import { buildObservation, type RunObservation } from "@phoenix/ai-evaluation";
import type { AiService } from "@phoenix/ai-models";
import {
  approvalFeed,
  AgentsDisabledError,
  InvalidTaskError,
  KillSwitchEngagedError,
  Orchestrator,
  TooManyRunsError,
  type AgentDefinition,
  type Conclusion,
  type TaskTrace,
} from "@phoenix/ai-orchestrator";
import type { ToolGateway } from "@phoenix/ai-tool-gateway";
import type {
  AgentApi,
  AgentObservationView,
  AgentSettingsView,
  AgentTaskDetailView,
  AgentTaskSummaryView,
  ConfirmationContextView,
} from "@phoenix/api";
import type { EventBus } from "@phoenix/event-bus";
import type { Logger } from "@phoenix/logging";
import type { AuditEntry, PermissionGateway } from "@phoenix/permissions";
import type { Database, SettingsStore } from "@phoenix/persistence";
import { createEvent, ErrorCode, isAgentRunState, PhoenixError } from "@phoenix/protocol";
import type { MemoryRuntime } from "./memory";

export const AGENTS_SETTING_KEY = "agents.enabled";
const CALL_TIMEOUT_MS = 90_000;
const TITLE_FALLBACK = "Agent task";

export interface AgentRuntimeDeps {
  db: Database;
  settings: SettingsStore;
  gateway: ToolGateway;
  permissions: PermissionGateway;
  bus: EventBus;
  memory: MemoryRuntime;
  ai: AiService;
  /** Is the AI feature switched on right now (the same setting `AiService` checks)? */
  aiEnabled: () => boolean;
  /** Further agent kinds, for embedding and tests. The CI-failure agent is always present. */
  extraAgents?: readonly AgentDefinition[];
  logger: Logger;
}

const cleanTitle = (task: { kind: string; input: Record<string, unknown> }): string =>
  task.kind === "ci_failure" && typeof task.input.repository === "string"
    ? `CI failure in ${task.input.repository}`
    : TITLE_FALLBACK;

export class AgentRuntime implements AgentApi {
  readonly orchestrator: Orchestrator;
  private readonly unsubscribeKillSwitch: () => void;

  constructor(private readonly d: AgentRuntimeDeps) {
    const model: ModelCall = async (request, signal) =>
      (await d.ai.run({ kind: "generate", request, signal, timeoutMs: CALL_TIMEOUT_MS })).result;
    this.orchestrator = new Orchestrator({
      db: d.db,
      gateway: d.gateway,
      audit: d.permissions.audit,
      isEnabled: () => this.enabled(),
      isKillSwitchEngaged: () => d.permissions.isKillSwitchEngaged(),
      publish: (event) => {
        const result = d.bus.publish(createEvent(event), { ephemeral: false });
        if (!result.ok) d.logger.warn("agent run event rejected", { code: result.error.code });
      },
      approvals: approvalFeed(d.bus, d.permissions),
      agents: [
        createCiFailureAgent({
          model,
          aiEnabled: d.aiEnabled,
          context: d.memory.agentContext(),
        }),
        ...(d.extraAgents ?? []),
      ],
      logger: d.logger,
    });
    // The emergency stop must end running automation at once, not at the next checkpoint.
    this.unsubscribeKillSwitch = d.bus.subscribe(
      "agent-runtime-kill-switch",
      "security.kill_switch.engaged",
      () => void this.orchestrator.cancelAll("the emergency stop is engaged"),
    );
  }

  enabled(): boolean {
    return this.d.settings.get<unknown>(AGENTS_SETTING_KEY, false) === true;
  }

  async close(): Promise<void> {
    this.unsubscribeKillSwitch();
    await this.orchestrator.close();
  }

  // ── AgentApi ───────────────────────────────────────────────────────────────

  submit(request: { kind: unknown; input: unknown }): AgentTaskSummaryView {
    try {
      const task = this.orchestrator.submit({
        kind: typeof request.kind === "string" ? request.kind : "",
        input: request.input,
        requestedBy: "user",
      });
      return {
        id: task.id,
        kind: task.kind,
        state: "CREATED",
        title: cleanTitle(task),
        requested_by: task.requestedBy,
        created_at: task.createdAt,
        updated_at: task.createdAt,
        failure_reason: null,
      };
    } catch (err) {
      throw this.mapSubmitError(err);
    }
  }

  private mapSubmitError(err: unknown): unknown {
    if (err instanceof AgentsDisabledError) {
      return new PhoenixError(
        ErrorCode.CAPABILITY_DISABLED,
        "Agent automation is turned off. Turn it on in the agent settings first.",
        ["AGENTS_DISABLED"],
      );
    }
    if (err instanceof KillSwitchEngagedError) {
      return new PhoenixError(ErrorCode.SECURITY_POLICY_BLOCKED, err.message);
    }
    if (err instanceof InvalidTaskError) {
      return new PhoenixError(ErrorCode.INVALID_REQUEST, err.message);
    }
    if (err instanceof TooManyRunsError) {
      return new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, err.message, ["TOO_MANY_RUNS"]);
    }
    return err;
  }

  list(query: { state?: string; limit: number }): { tasks: AgentTaskSummaryView[] } {
    const state =
      query.state !== undefined && isAgentRunState(query.state) ? query.state : undefined;
    const rows = this.orchestrator.list({ ...(state ? { state } : {}), limit: query.limit });
    return {
      tasks: rows.map(({ task, run }) => ({
        id: task.id,
        kind: task.kind,
        state: run.state,
        title: cleanTitle(task),
        requested_by: task.requestedBy,
        created_at: task.createdAt,
        updated_at: run.updatedAt,
        failure_reason: run.failureReason ?? null,
      })),
    };
  }

  get(id: string): AgentTaskDetailView | null {
    const trace = this.orchestrator.trace(id);
    return trace ? detailOf(trace) : null;
  }

  cancel(id: string): { cancelled: boolean; state: string } | null {
    const trace = this.orchestrator.trace(id);
    if (!trace) return null;
    const cancelled = this.orchestrator.cancel(id, "cancelled by the user");
    const after = this.orchestrator.trace(id);
    return { cancelled, state: after?.run.state ?? trace.run.state };
  }

  observation(id: string): AgentObservationView | null {
    const trace = this.orchestrator.trace(id);
    if (!trace) return null;
    const conclusion = conclusionOf(trace);
    const reported = conclusion?.model;
    const observation = buildObservation({
      trace,
      audit: this.auditRows(trace.auditIds),
      // Tokens the service did not report are 0 here and shown as "unknown" by `observationView`.
      model: reported
        ? {
            provider: reported.provider,
            model: reported.model,
            locality: reported.locality,
            calls: reported.calls,
            inputTokens: reported.inputTokens === "unknown" ? 0 : reported.inputTokens,
            outputTokens: reported.outputTokens === "unknown" ? 0 : reported.outputTokens,
          }
        : null,
    });
    return observationView(observation, reported);
  }

  /** The audit rows a trace names, read by id (the log may hold far more than a page). */
  private auditRows(ids: readonly number[]): AuditEntry[] {
    if (ids.length === 0) return [];
    const rows = this.d.db
      .prepare(`SELECT * FROM audit_log WHERE id IN (${ids.map(() => "?").join(",")})`)
      .all(...ids) as Record<string, string | number | null>[];
    return rows.map((r) => ({
      id: Number(r.id),
      ts: String(r.ts),
      actor: String(r.actor),
      action: String(r.action),
      ...(r.capability_id ? { capabilityId: String(r.capability_id) } : {}),
      decision: r.decision as AuditEntry["decision"],
      details: JSON.parse(String(r.details)) as Record<string, unknown>,
    }));
  }

  settings(): AgentSettingsView {
    const l = this.orchestrator.limits;
    return {
      enabled: this.enabled(),
      kinds: this.orchestrator.kinds(),
      limits: {
        max_steps: l.maxSteps,
        max_tool_calls: l.maxToolCalls,
        max_wall_ms: l.maxWallMs,
        max_active_runs: l.maxActiveRuns,
      },
      active_runs: this.orchestrator.activeCount(),
    };
  }

  setSettings(input: unknown): AgentSettingsView {
    const enabled =
      typeof input === "object" && input !== null && "enabled" in input ? input.enabled : undefined;
    if (typeof enabled !== "boolean") {
      throw new PhoenixError(ErrorCode.INVALID_REQUEST, '"enabled" must be a boolean');
    }
    const before = this.enabled();
    this.d.settings.set(AGENTS_SETTING_KEY, enabled);
    this.d.permissions.audit.record({
      actor: "user",
      action: "agents.settings.changed",
      decision: "info",
      details: { enabled, was: before },
    });
    // Turning automation off ends what is running, not just what starts next.
    if (!enabled) this.orchestrator.cancelAll("agent automation was turned off");
    return this.settings();
  }

  describeConfirmation(confirmationId: string): ConfirmationContextView | undefined {
    const c = this.orchestrator.describeConfirmation(confirmationId);
    return c
      ? {
          task_id: c.task_id,
          risk: c.risk,
          target: c.target,
          preview: c.preview,
          evidence_ids: c.evidence_ids,
        }
      : undefined;
  }
}

/** snake_case view of an observation; unreported token counts and their cost stay "unknown". */
function observationView(o: RunObservation, reported: Conclusion["model"]): AgentObservationView {
  const input = reported?.inputTokens ?? 0;
  const output = reported?.outputTokens ?? 0;
  return {
    version: 1,
    task_id: o.taskId,
    run_id: o.runId,
    agent_id: o.agentId,
    agent_version: o.agentVersion,
    outcome: o.outcome,
    failure_reason: o.failureReason,
    model: reported
      ? {
          provider: reported.provider,
          model: reported.model,
          locality: reported.locality,
          calls: reported.calls,
          input_tokens: reported.inputTokens,
          output_tokens: reported.outputTokens,
        }
      : null,
    prompt_version: o.promptVersion,
    context_version: o.contextVersion,
    sources: o.sources,
    memory_ids: o.memoryIds,
    tool_calls: o.toolCalls.map((t) => ({
      tool: t.tool,
      status: t.status,
      decision: t.decision,
      risk: t.risk,
      policy_audit_id: t.policyAuditId,
      audit_confirmed: t.auditConfirmed,
    })),
    permission_decisions: o.permissionDecisions,
    stages: o.stages.map((st) => ({
      name: st.name,
      status: st.status,
      duration_ms: st.durationMs,
      audit_id: st.auditId,
    })),
    total_duration_ms: o.totalDurationMs,
    tokens: { input, output },
    // Core has no price table: a local model is free, a cloud model's cost is not known here.
    cost_micro_usd: reported?.locality === "cloud" ? "unknown" : 0,
    cloud_calls: o.cloudCalls,
    ai_used: o.aiUsed,
    evidence_coverage: o.evidenceCoverage,
    audit_ids: o.auditIds,
  };
}

function conclusionOf(trace: TaskTrace): Conclusion | null {
  return trace.conclusion;
}

function detailOf(trace: TaskTrace): AgentTaskDetailView {
  const conclusion = conclusionOf(trace);
  const diagnosis = conclusion?.diagnosis;
  return {
    task: {
      id: trace.task.id,
      kind: trace.task.kind,
      input: trace.task.input,
      requested_by: trace.task.requestedBy,
      created_at: trace.task.createdAt,
      correlation_id: trace.task.correlationId,
    },
    run: {
      id: trace.run.id,
      state: trace.run.state,
      agent_id: trace.run.agentId,
      agent_version: trace.run.agentVersion,
      created_at: trace.run.createdAt,
      updated_at: trace.run.updatedAt,
      failure_reason: trace.run.failureReason ?? null,
    },
    steps: trace.steps.map((s) => ({
      seq: s.seq,
      kind: s.kind,
      name: s.name,
      status: s.status,
      detail: s.detail,
      policy_audit_id: s.policyAuditId,
      decision: s.decision,
      risk: s.risk,
      stage_audit_id: s.stageAuditId,
      started_at: s.startedAt,
      finished_at: s.finishedAt,
    })),
    evidence: trace.evidence.map((e) => ({
      id: e.id,
      kind: e.kind,
      source: e.source,
      excerpt_hash: e.excerptHash,
      excerpt: e.excerpt,
      truncated: e.truncated,
    })),
    summary: conclusion?.summary ?? null,
    diagnosis: diagnosis
      ? {
          summary: diagnosis.summary,
          claims: diagnosis.claims.map((c) => ({
            text: c.text,
            evidence_ids: c.evidenceIds,
            grounded: c.grounded,
            origin: c.origin ?? "rule",
            note: c.note ?? null,
          })),
          evidence_coverage: diagnosis.evidenceCoverage,
          model_reported_confidence: diagnosis.modelReportedConfidence ?? null,
          ai_used: diagnosis.aiUsed,
        }
      : null,
    proposals: (conclusion?.proposals ?? []).map((p) => ({
      text: p.text,
      rationale: p.rationale,
      evidence_ids: p.evidenceIds,
      advisory: true,
      grounded: p.grounded,
    })),
    ai_used: conclusion?.aiUsed ?? false,
    processed_by: conclusion?.processedBy ?? null,
    model_calls: conclusion?.modelCalls ?? 0,
    verification: trace.verification
      ? {
          passed: trace.verification.passed,
          checks: trace.verification.checks.map((c) => ({
            name: c.name,
            passed: c.passed,
            detail: c.detail,
            required: c.required !== false,
          })),
        }
      : null,
    audit_ids: trace.auditIds,
  };
}
