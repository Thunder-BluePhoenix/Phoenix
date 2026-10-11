// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type {
  Workflow,
  WorkflowDefinitionView,
  WorkflowEnvironment,
  WorkflowRunSummary,
} from "./types";

export const ENVIRONMENT_TEXT: Record<WorkflowEnvironment, string> = {
  local: "Local",
  dev: "Development",
  staging: "Staging",
  production: "PRODUCTION",
};

/** Words, never colour alone, for every run status the engine reports. */
export const RUN_STATUS_TEXT: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  waiting_approval: "Waiting for your approval",
  compensating: "Undoing earlier steps",
  succeeded: "Succeeded",
  rejected: "Rejected by you",
  failed: "Failed",
  failed_needs_attention: "Failed: needs your attention",
  cancelled: "Cancelled",
  interrupted: "Interrupted (Phoenix restarted)",
  refused: "Refused: it was not allowed to run",
};

/** Statuses that are not a success and must not read like one. */
export const NEEDS_ATTENTION: Record<string, true> = {
  failed: true,
  failed_needs_attention: true,
  interrupted: true,
  refused: true,
};

export const STEP_STATUS_TEXT: Record<string, string> = {
  running: "Running",
  waiting: "Waiting",
  succeeded: "Succeeded",
  failed: "Failed",
  timed_out: "Timed out (outcome unknown)",
  rejected: "Rejected",
  expired: "Expired",
  unknown: "Outcome unknown",
};

export const authorisationText = (w: Pick<Workflow, "authorised" | "authorisation_reasons">) =>
  w.authorisation_reasons.length === 0
    ? "No authorisation needed"
    : w.authorised
      ? "Authorised for production"
      : "NOT authorised: triggers are refused";

/** The definition as indented text, for reading. It is never executed or rendered as markup. */
export const definitionText = (definition: unknown): string => JSON.stringify(definition, null, 2);

export interface StepFlag {
  step: string;
  tool: string;
  undo: string | null;
}

/**
 * Steps that call a tool: these are the ones that can change something. Whether a step changes
 * state is Core's call (a run reports `destructive` per step); this list names them all so the user
 * sees every tool before authorising, and it flags a declared undo.
 */
export function toolSteps(definition: WorkflowDefinitionView | null): StepFlag[] {
  if (!definition) return [];
  return definition.steps
    .filter((s) => s.type === "action" && typeof s.tool === "string")
    .map((s) => ({ step: s.id, tool: s.tool ?? "", undo: s.compensate?.tool ?? null }));
}

/** The date-time-local value a person picks, as the ISO string the API takes; null when blank or bad. */
export function expiryOf(local: string): string | null {
  if (local.trim() === "") return null;
  const at = new Date(local);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

export const MAX_EXPIRY_DAYS = 90;

/** The API's rule: an expiry must be in the future and at most 90 days away. */
export function expiryProblem(local: string, now: number = Date.now()): string | null {
  if (local.trim() === "") return null;
  const at = expiryOf(local);
  if (at === null) return "That is not a date and time.";
  const ms = Date.parse(at) - now;
  if (ms <= 0) return "The expiry must be in the future.";
  if (ms > MAX_EXPIRY_DAYS * 86_400_000) {
    return `The expiry can be at most ${MAX_EXPIRY_DAYS} days away.`;
  }
  return null;
}

/** Runs of the same workflow that are not finished. */
export const isActive = (run: Pick<WorkflowRunSummary, "terminal">) => !run.terminal;

/** A refused start: Core answers 403 with details [RUN_REFUSED, run id, reason]. */
export interface RefusedStart {
  runId: string;
  reason: string;
}

export function refusedStart(details: readonly string[]): RefusedStart | null {
  if (details[0] !== "RUN_REFUSED") return null;
  return { runId: details[1] ?? "", reason: details[2] ?? "No reason was given." };
}

/** The payload box: empty means no payload; otherwise a JSON object. */
export function parsePayload(
  text: string,
): { payload: Record<string, unknown> } | { error: string } {
  if (text.trim() === "") return { payload: {} };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: "The payload is not valid JSON." };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { error: "The payload must be a JSON object, like {}." };
  }
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) payload[k] = v;
  if (Object.keys(payload).length > 20) return { error: "The payload can have at most 20 keys." };
  return { payload };
}
