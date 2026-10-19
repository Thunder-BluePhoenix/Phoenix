// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { MessageKey } from "../i18n/en";
import { isMessageKey, translate } from "../i18n/store";
import type {
  Workflow,
  WorkflowDefinitionView,
  WorkflowEnvironment,
  WorkflowRunSummary,
} from "./types";

/** The environment in words; production is shouted so it is never mistaken for a test one. */
export function environmentText(environment: WorkflowEnvironment): string {
  return translate(`automation.workflows.environment.${environment}`);
}

/** The key of a status in a table of messages, or null for a status this build has no words for. */
const keyed = (prefix: string, status: string): MessageKey | null => {
  const key = `${prefix}.${status}`;
  return isMessageKey(key) ? key : null;
};

/** Words, never colour alone, for every run status the engine reports; an unknown one as reported. */
export function runStatusText(status: string): string {
  const key = keyed("automation.workflows.runStatus", status);
  return key ? translate(key) : status;
}

/** Statuses that are not a success and must not read like one. */
export const NEEDS_ATTENTION: Record<string, true> = {
  failed: true,
  failed_needs_attention: true,
  interrupted: true,
  refused: true,
};

export function stepStatusText(status: string): string {
  const key = keyed("automation.workflows.stepStatus", status);
  return key ? translate(key) : status;
}

export const authorisationText = (w: Pick<Workflow, "authorised" | "authorisation_reasons">) =>
  translate(
    w.authorisation_reasons.length === 0
      ? "automation.workflows.authorisation.notNeeded"
      : w.authorised
        ? "automation.workflows.authorisation.authorised"
        : "automation.workflows.authorisation.notAuthorised",
  );

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
const MAX_PAYLOAD_KEYS = 20;

/** The API's rule: an expiry must be in the future and at most 90 days away. */
export function expiryProblem(local: string, now: number = Date.now()): string | null {
  if (local.trim() === "") return null;
  const at = expiryOf(local);
  if (at === null) return translate("automation.workflows.expiry.invalid");
  const ms = Date.parse(at) - now;
  if (ms <= 0) return translate("automation.workflows.expiry.past");
  if (ms > MAX_EXPIRY_DAYS * 86_400_000) {
    return translate("automation.workflows.expiry.tooFar", { days: MAX_EXPIRY_DAYS });
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
  return {
    runId: details[1] ?? "",
    reason: details[2] ?? translate("automation.workflows.refused.noReason"),
  };
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
    return { error: translate("automation.workflows.payload.invalidJson") };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { error: translate("automation.workflows.payload.notObject") };
  }
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) payload[k] = v;
  if (Object.keys(payload).length > MAX_PAYLOAD_KEYS) {
    return { error: translate("automation.workflows.payload.tooMany", { max: MAX_PAYLOAD_KEYS }) };
  }
  return { payload };
}
