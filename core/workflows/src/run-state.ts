// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Value } from "./expr";
import type { RunRecord } from "./store";
import type { StepStatus, WorkflowDefinition } from "./types";

/** A step failed. `retryable` is a hint; retries still need `retry` on the step and an idempotent tool. */
export class StepFailure extends Error {
  override name = "StepFailure";
  constructor(
    message: string,
    readonly status: StepStatus = "failed",
    readonly retryable = false,
    /** The call may have taken effect (timeout, cancelled mid-call). */
    readonly outcomeUnknown = false,
  ) {
    super(message);
  }
}

/** The run was stopped from outside (emergency stop). */
export class RunCancelled extends Error {
  override name = "RunCancelled";
  constructor(
    readonly reason: string,
    /** False for the emergency stop: even undo calls are blocked, so none are attempted. */
    readonly compensate: boolean,
  ) {
    super(reason);
  }
}

/** The engine was stopped (process shutdown or a simulated crash): write nothing more. */
export class Halted extends Error {
  override name = "Halted";
}

/** The user said no to an approval step. Not a failure: nothing went wrong. */
export class RunRejected extends Error {
  override name = "RunRejected";
}

export interface RunState {
  run: RunRecord;
  def: WorkflowDefinition;
  indexOf: Record<string, number>;
  ctx: { event: Value; steps: { [id: string]: Value }; run: Value };
  abort: AbortController;
  /** Set (before `abort`) when the run is stopped on purpose; an abort without it is a halt. */
  cancel: { reason: string; compensate: boolean } | undefined;
  /** An approval step has succeeded in this run. */
  approved: boolean;
  /** The run holds one of the engine's concurrency slots (released while it waits for approval). */
  holdsSlot: boolean;
  /** Set by the engine on crash/stop: the executor writes nothing more. */
  halted: boolean;
  /** A `result` step already published this run's result event. */
  resultEmitted: boolean;
  /** Ids of steps that succeeded, in execution order (compensation walks this backwards). */
  succeeded: string[];
  /** Steps whose call may or may not have happened (timeout, cancelled mid-call). */
  uncertain: string[];
  /** Whether this definition needs a live user authorisation (decided when the run starts). */
  authRequired: boolean;
}

export function newRunState(run: RunRecord, ctxRun: Value): RunState {
  const indexOf: Record<string, number> = Object.create(null) as Record<string, number>;
  run.definition.steps.forEach((s, i) => (indexOf[s.id] = i));
  return {
    run,
    def: run.definition,
    indexOf,
    ctx: {
      event: run.triggerEvent ?? null,
      steps: Object.create(null) as { [id: string]: Value },
      run: ctxRun,
    },
    abort: new AbortController(),
    cancel: undefined,
    approved: false,
    holdsSlot: false,
    halted: false,
    resultEmitted: false,
    succeeded: [],
    uncertain: [],
    authRequired: false,
  };
}
