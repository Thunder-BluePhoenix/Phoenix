// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { PolicyAuditSink, Actor, Environment, ToolRequest } from "./types";
import { ENVIRONMENTS, PolicyError } from "./types";
import type { PolicyStore } from "./store";

export const AUTONOMY_LEVELS = [
  "observe",
  "analyze",
  "propose",
  "bounded_execute",
  "supervised_execute",
  "autonomous_workflow",
] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

/** Explicit autonomous origin; ordinary directly requested tool calls do not carry this. */
export interface AutonomyContext {
  runId: string;
  level: AutonomyLevel;
}

export interface AutonomySetting {
  capabilityId: string;
  environment: Environment;
  level: AutonomyLevel;
  maxActions: number;
  maxDurationMs: number;
  updatedBy: string;
  updatedAt: number;
}

export interface AutonomyLimits {
  maxActions: number;
  maxDurationMs: number;
}

/** No audited OS sandbox is available. This constant MUST NOT be promoted by a config flag. */
export const AUTONOMOUS_EXECUTION_SANDBOX_AVAILABLE = false;

const MAX_ACTIONS = 100;
const MAX_DURATION_MS = 60 * 60_000;
const validLevel = (level: unknown): level is AutonomyLevel =>
  (AUTONOMY_LEVELS as readonly unknown[]).includes(level);
const validEnvironment = (environment: unknown): environment is Environment =>
  (ENVIRONMENTS as readonly unknown[]).includes(environment);
const validId = (id: unknown): id is string =>
  typeof id === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(id);

interface Session {
  readonly actorId: string;
  readonly started: number;
  readonly deadline: number;
  readonly maxActions: number;
  actions: number;
  stopped: boolean;
  readonly capabilities: ReadonlySet<string>;
  readonly environment: Environment;
  readonly level: AutonomyLevel;
}

/** User-owned configuration and process-local run budget. Restart never resumes a run. */
export class AutonomyController {
  private readonly sessions = new Map<string, Session>();
  private readonly now: () => number;

  constructor(
    private readonly store: Pick<PolicyStore, "autonomySetting" | "saveAutonomySetting">,
    private readonly audit: PolicyAuditSink,
    private readonly isKillSwitchEngaged: () => boolean,
    now?: () => number,
  ) {
    this.now = now ?? Date.now;
  }

  setting(capabilityId: string, environment: Environment): AutonomySetting | undefined {
    if (!validId(capabilityId) || !validEnvironment(environment))
      throw new PolicyError("INVALID_REQUEST", "Invalid autonomy scope");
    return this.store.autonomySetting(capabilityId, environment);
  }

  /** Only a trusted user may increase or lower a setting; audit failure prevents the change. */
  configure(
    by: Actor,
    capabilityId: string,
    environment: Environment,
    level: AutonomyLevel,
    limits: AutonomyLimits,
  ): AutonomySetting {
    this.requireUser(by);
    if (
      !validId(capabilityId) ||
      !validEnvironment(environment) ||
      !validLevel(level) ||
      !Number.isInteger(limits?.maxActions) ||
      limits.maxActions < 1 ||
      limits.maxActions > MAX_ACTIONS ||
      !Number.isInteger(limits.maxDurationMs) ||
      limits.maxDurationMs < 1 ||
      limits.maxDurationMs > MAX_DURATION_MS
    )
      throw new PolicyError("INVALID_REQUEST", "Invalid autonomy setting or limits");
    const setting = {
      capabilityId,
      environment,
      level,
      maxActions: limits.maxActions,
      maxDurationMs: limits.maxDurationMs,
      updatedBy: by.id,
      updatedAt: this.now(),
    };
    this.record(by, "autonomy.setting.changed", "info", {
      capabilityId,
      environment,
      level,
      limits,
    });
    this.store.saveAutonomySetting(setting);
    return setting;
  }

  /** Starts only non-executing observation/analysis/proposal; executable levels fail closed. */
  begin(
    by: Actor,
    runId: string,
    capabilities: readonly string[],
    environment: Environment,
    level: AutonomyLevel,
  ): void {
    if (
      by.kind !== "agent" ||
      !validId(runId) ||
      !validEnvironment(environment) ||
      !validLevel(level) ||
      capabilities.length === 0 ||
      capabilities.some((id) => !validId(id)) ||
      this.sessions.has(runId)
    )
      throw new PolicyError("INVALID_REQUEST", "Invalid autonomy run");
    const reason = this.refusal(capabilities, environment, level);
    if (reason) {
      this.record(by, "autonomy.run.refused", "denied", { runId, reason });
      throw new PolicyError("INVALID_REQUEST", reason);
    }
    const settings = capabilities.map((id) => this.setting(id, environment));
    const maxActions = Math.min(...settings.map((s) => s!.maxActions));
    const duration = Math.min(...settings.map((s) => s!.maxDurationMs));
    this.record(by, "autonomy.run.started", "allowed", {
      runId,
      capabilities,
      environment,
      level,
      maxActions,
      duration,
    });
    const started = this.now();
    this.sessions.set(runId, {
      started,
      deadline: started + duration,
      maxActions,
      actions: 0,
      stopped: false,
      actorId: by.id,
      capabilities: new Set(capabilities),
      environment,
      level,
    });
  }

  /** Refuse before any executable workflow is queued, regardless of settings or approval. */
  refusal(
    capabilities: readonly string[],
    environment: Environment,
    level: AutonomyLevel,
  ): string | undefined {
    if (this.isKillSwitchEngaged()) return "Emergency stop is engaged";
    if (
      !validLevel(level) ||
      !validEnvironment(environment) ||
      capabilities.some((id) => !validId(id))
    )
      return "Invalid autonomy scope";
    if (AUTONOMY_LEVELS.indexOf(level) >= 3 && !AUTONOMOUS_EXECUTION_SANDBOX_AVAILABLE)
      return "Autonomous execution requires an audited OS sandbox; none is available";
    try {
      for (const id of capabilities) {
        const setting = this.setting(id, environment);
        if (!setting || AUTONOMY_LEVELS.indexOf(level) > AUTONOMY_LEVELS.indexOf(setting.level))
          return `Autonomy level is not enabled for ${id} in ${environment}`;
      }
    } catch {
      return "Autonomy settings could not be read";
    }
    return undefined;
  }
  /** Read-only gate for policy preview; action counts change only in reserve(). */
  check(request: ToolRequest): string | undefined {
    const context = request.autonomy;
    if (!context) return undefined;
    if (request.actor.kind !== "agent" || !validId(context.runId) || !validLevel(context.level))
      return "Invalid autonomous tool request";
    const session = this.sessions.get(context.runId);
    if (!session || session.stopped) return "Autonomy run is stopped or not active";
    if (session.actorId !== request.actor.id) return "Autonomy run actor does not match";
    if (this.isKillSwitchEngaged()) return "Emergency stop is engaged";
    if (
      session.level !== context.level ||
      session.environment !== request.environment ||
      !session.capabilities.has(request.capabilityId)
    )
      return "Autonomy run scope does not match";
    const reason = this.refusal([request.capabilityId], request.environment, context.level);
    if (reason) return reason;
    if (this.now() >= session.deadline) return "Autonomy time limit reached";
    if (session.actions >= session.maxActions) return "Autonomy action budget reached";
    if (request.sideEffect !== "none" && request.sideEffect !== "read")
      return "Autonomy execution requires an audited OS sandbox";
    return undefined;
  }

  /** Stops a session irrevocably; kill switch also gates every next decision. */
  stop(by: Actor, runId: string): void {
    this.requireUser(by);
    this.record(by, "autonomy.run.stopped", "info", { runId });
    const session = this.sessions.get(runId);
    if (session) session.stopped = true;
  }

  /** Called only when an autonomous tool request would otherwise be allowed by policy. */
  reserve(request: ToolRequest): string | undefined {
    const reason = this.check(request);
    if (reason || !request.autonomy) return reason;
    this.sessions.get(request.autonomy.runId)!.actions++;
    return undefined;
  }

  private requireUser(by: Actor): void {
    if (by?.kind !== "user" || !by.trustedByUser || !by.id)
      throw new PolicyError("NOT_USER_ACTOR", "Only a trusted user can configure or stop autonomy");
  }

  private record(
    by: Actor,
    action: string,
    decision: "allowed" | "denied" | "info",
    details: Record<string, unknown>,
  ): void {
    try {
      this.audit.record({ actor: `${by.kind}:${by.id}`, action, decision, details });
    } catch (err) {
      throw new PolicyError("AUDIT_FAILED", "Autonomy action could not be audited", [String(err)]);
    }
  }
}
