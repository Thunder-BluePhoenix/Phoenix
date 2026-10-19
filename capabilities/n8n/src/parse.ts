// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Validation of n8n public-API responses. n8n is self-hosted and so is whatever answers at the
// user's base_url: treat every field as hostile. Execution data (what the workflow processed) is
// never requested and never read; only ids, names, status and times are kept.
import { redact } from "@phoenix/logging";
import {
  epochMs,
  expectObject,
  int,
  isObject,
  parseList,
  str,
  type Json,
} from "@phoenix/service-kit";

const ID = /^[A-Za-z0-9_-]{1,100}$/;

export const MAX_WORKFLOWS = 100;
export const MAX_EXECUTIONS = 100;

export interface Workflow {
  id: string;
  name: string;
  active: boolean;
}

export type ExecutionPhase = "running" | "succeeded" | "failed" | "other";

export interface Execution {
  id: string;
  workflowId: string;
  /** n8n's own status word, lower case. */
  status: string;
  phase: ExecutionPhase;
  /** Epoch ms the execution started. */
  startedAt: number;
  stoppedAt?: number | undefined;
  /** "manual", "trigger", "webhook", "retry", … */
  mode?: string | undefined;
}

const PHASE: Readonly<Record<string, ExecutionPhase>> = {
  new: "running",
  running: "running",
  waiting: "running",
  success: "succeeded",
  error: "failed",
  crashed: "failed",
};

/** What a status word means for Phoenix; words it does not know map to "other" (no event). */
export function executionPhase(status: string): ExecutionPhase {
  return Object.hasOwn(PHASE, status) ? PHASE[status]! : "other";
}

/** n8n ids are strings (workflows) or numbers (executions, older versions send strings too). */
function idOf(value: unknown): string | undefined {
  const text =
    typeof value === "number"
      ? int(value) !== undefined && value >= 0
        ? String(value)
        : undefined
      : str(value, 100);
  // An id cannot be "redacted and still be that id": a credential-lookalike id is dropped.
  return text !== undefined && ID.test(text) && String(redact(text)) === text ? text : undefined;
}

export const MAX_NAME = 120;

/** Free text from n8n: clipped, control characters removed, secret-looking values redacted. */
export function text(value: unknown, max = MAX_NAME): string | undefined {
  const clipped = str(value, max * 4);
  if (clipped === undefined) return undefined;
  const clean = String(redact(clipped));
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}

export function parseWorkflow(raw: Json): Workflow | undefined {
  const id = idOf(raw.id);
  const name = text(raw.name);
  if (id === undefined || name === undefined) return undefined;
  return { id, name, active: raw.active === true };
}

export function parseExecution(raw: Json): Execution | undefined {
  const id = idOf(raw.id);
  const workflowId = idOf(raw.workflowId);
  const startedAt = epochMs(raw.startedAt);
  if (id === undefined || workflowId === undefined || startedAt === undefined) return undefined;
  const status = (
    str(raw.status, 20) ?? (raw.finished === true ? "success" : "unknown")
  ).toLowerCase();
  const mode = str(raw.mode, 20);
  return {
    id,
    workflowId,
    status,
    phase: executionPhase(status),
    startedAt,
    stoppedAt: epochMs(raw.stoppedAt),
    mode: mode !== undefined && /^[a-z]+$/.test(mode) ? mode : undefined,
  };
}

/** `{ data: [...], nextCursor }` as the public API lists things. */
export function parseWorkflows(body: unknown): Workflow[] {
  return parseList(expectObject(body).data, parseWorkflow, MAX_WORKFLOWS);
}

export function parseExecutions(body: unknown): Execution[] {
  return parseList(expectObject(body).data, parseExecution, MAX_EXECUTIONS);
}

/** What POST /workflows/{id}/deactivate answers: the workflow, now inactive. */
export function parseDeactivated(body: unknown): Workflow {
  const parsed = parseWorkflow(expectObject(body));
  if (!parsed) throw new TypeError("unusable workflow");
  return parsed;
}

/** What POST /executions/{id}/retry answers: the new execution (or just its id). */
export function parseRetried(body: unknown): { id: string } {
  const raw = expectObject(body);
  const id = idOf(raw.id) ?? (isObject(raw.data) ? idOf(raw.data.id) : undefined);
  if (id === undefined) throw new TypeError("retry answered without an execution id");
  return { id };
}
