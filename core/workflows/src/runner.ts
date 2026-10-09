// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Executes one step. The runner is where the declared-permission model is enforced AGAIN at run
// time: whatever the stored definition says, an action runs only if its tool is in the run's own
// `declares.tools`, the live registry knows it, and a state-changing tool is never called before
// an approval step in the same run succeeded. It reaches capabilities only through the injected
// tool gateway.
import { ToolGatewayError } from "@phoenix/ai-tool-gateway";
import { createEvent, type PhoenixEvent } from "@phoenix/protocol";
import { buildAiMessages, parseAiOutput, AI_PURPOSE, DEFAULT_AI_TOKENS } from "./ai-step";
import { boundValue } from "./bound";
import { type EngineDeps, realSleep, type Sleeper, type WorkflowToolGateway } from "./engine-types";
import { evaluateCondition, type Value } from "./expr";
import { compiledExpression, compiledTemplate, renderInput, renderText } from "./render";
import { Halted, RunCancelled, StepFailure, type RunState } from "./run-state";
import type {
  ActionStep,
  AiStepSpec,
  ConditionStep,
  LookupStep,
  NotifyStep,
  ResultStep,
  Step,
  ToolCatalog,
  ToolFacts,
} from "./types";
import { isDestructive } from "./validate";

export const WORKFLOW_SOURCE = "workflows";
export const DEFAULT_LOOKUP_TIMEOUT_MS = 10_000;
export const DEFAULT_AI_TIMEOUT_MS = 60_000;
export const DEFAULT_APPROVAL_WAIT_MS = 5 * 60_000;

export interface StepResult {
  output: Value;
  /** Overrides the default successor (conditions). */
  next?: string;
  /** Set by `result` steps: the run ends here. */
  finish?: { outcome: "success" | "failure"; summary: string };
}

/** What an action will do, worked out before its step row is written. */
export interface PreparedAction {
  tool: string;
  facts: ToolFacts;
  destructive: boolean;
  input: Value;
  /**
   * True when the input is exactly what the workflow's author wrote. An input built from run data
   * (an event payload, a tool result, a model answer) was "derived from content the user did not
   * write", so the policy engine is told `trustedByUser: false` and asks for approval.
   */
  authored: boolean;
}

export interface RunnerDeps {
  gateway: WorkflowToolGateway;
  catalog: ToolCatalog;
  publish: EngineDeps["publish"];
  ai: EngineDeps["ai"];
  lookup: EngineDeps["lookup"];
  sleep: Sleeper;
  abandon: ((tool: string) => void) | undefined;
  approvalWaitMs: number;
  warn: (message: string, fields?: Record<string, unknown>) => void;
}

/** The actor every workflow tool call carries: its id IS the run's correlation id. */
export function workflowActor(state: RunState, trusted: boolean) {
  return { kind: "system" as const, id: state.run.correlationId, trustedByUser: trusted };
}

/** True when a JSON input reads run data (event, tool output, AI output) through a placeholder. */
export function hasPlaceholders(value: unknown, depth = 0): boolean {
  if (depth > 8) return true;
  if (typeof value === "string") return compiledTemplate(value).some((p) => typeof p !== "string");
  if (Array.isArray(value)) return value.some((v: unknown) => hasPlaceholders(v, depth + 1));
  if (value !== null && typeof value === "object")
    return Object.values(value).some((v: unknown) => hasPlaceholders(v, depth + 1));
  return false;
}

export class StepRunner {
  private readonly sleep: Sleeper;

  constructor(private readonly d: RunnerDeps) {
    this.sleep = d.sleep ?? realSleep;
  }

  /** Builds an event for a run: source, correlation id and causation are filled in here. */
  event(
    state: RunState,
    type: string,
    severity: PhoenixEvent["severity"],
    payload: Record<string, unknown>,
    extra: { requiresAction?: boolean } = {},
  ): PhoenixEvent {
    return createEvent({
      event_type: type,
      source: WORKFLOW_SOURCE,
      severity,
      subject: state.def.id,
      correlation_id: state.run.correlationId,
      // Read by the engine's loop protection: events a run emits carry how deep the chain is.
      metadata: { workflow_depth: state.run.chainDepth },
      causation_id: state.run.triggerEventId.slice(0, 200),
      ...(extra.requiresAction ? { requires_action: true } : {}),
      payload: { workflow: state.def.id, run: state.run.id, ...payload },
    });
  }

  /** Publishes; returns false (and logs) when the bus refuses the event. */
  emit(event: PhoenixEvent): boolean {
    try {
      const out = this.d.publish(event);
      if (!out.ok) this.d.warn("workflow event was refused", { type: event.event_type });
      return out.ok;
    } catch (err) {
      this.d.warn("workflow event could not be published", { type: event.event_type, error: err });
      return false;
    }
  }

  /** Races `run` against a timeout and the run's own stop signal. */
  async bounded<T>(
    state: RunState,
    ms: number,
    run: (signal: AbortSignal) => Promise<T>,
    onTimeout: () => StepFailure,
  ): Promise<T> {
    const inner = new AbortController();
    const done = Promise.withResolvers<T>();
    const stopTimer = new AbortController();
    const onAbort = () => {
      inner.abort();
      done.reject(this.stopped(state));
    };
    run(inner.signal).then(done.resolve, done.reject);
    this.sleep(ms, stopTimer.signal).then(
      () => {
        inner.abort();
        done.reject(onTimeout());
      },
      () => undefined,
    );
    if (state.abort.signal.aborted) onAbort();
    else state.abort.signal.addEventListener("abort", onAbort, { once: true });
    try {
      return await done.promise;
    } finally {
      stopTimer.abort();
      state.abort.signal.removeEventListener("abort", onAbort);
    }
  }

  // ── Action ───────────────────────────────────────────────────────────────

  /** Run-time permission checks and input rendering. Throws `StepFailure` before anything is called. */
  prepareAction(state: RunState, step: ActionStep): PreparedAction {
    return this.prepareTool(state, step.tool, step.input ?? {}, `step ${step.id}`);
  }

  prepareTool(state: RunState, tool: string, input: unknown, label: string): PreparedAction {
    // Enforced again here, against the definition snapshot this run started with.
    if (!state.def.declares.tools.includes(tool))
      throw new StepFailure(`${label}: ${tool} is not declared by this workflow`);
    const facts = this.d.catalog(tool);
    if (!facts) throw new StepFailure(`${label}: ${tool} is not an available tool`);
    const destructive = isDestructive(facts);
    if (destructive && !state.approved)
      throw new StepFailure(`${label}: ${tool} changes state and no approval step has succeeded`);
    return {
      tool,
      facts,
      destructive,
      input: renderInput(input, state.ctx),
      authored: !hasPlaceholders(input),
    };
  }

  /** Calls the tool through the gateway (retrying only idempotent tools) and returns its output. */
  async callTool(
    state: RunState,
    prepared: PreparedAction,
    options: { retry?: { max: number; backoff_ms: number }; timeoutMs?: number },
  ): Promise<{ output: Value; attempts: number }> {
    if (state.abort.signal.aborted) throw this.stopped(state);
    const { facts } = prepared;
    // A retry is only ever allowed for a tool the contract says cannot change anything.
    const extra = facts.idempotent ? (options.retry?.max ?? 0) : 0;
    const timeoutMs =
      options.timeoutMs ?? facts.timeoutMs + (prepared.destructive ? this.d.approvalWaitMs : 0);
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await this.bounded(
          state,
          timeoutMs,
          (signal) =>
            this.d.gateway.call(
              {
                actor: workflowActor(state, prepared.authored),
                tool: prepared.tool,
                input: prepared.input,
                environment: state.def.environment,
                resource: `workflow:${state.def.id}`,
              },
              { signal },
            ),
          () =>
            new StepFailure(
              `${prepared.tool} did not finish within ${timeoutMs} ms; the call was abandoned`,
              "timed_out",
              true,
              prepared.destructive,
            ),
        );
        return { output: boundValue(result.output), attempts: attempt };
      } catch (err) {
        const gone =
          err instanceof RunCancelled ||
          err instanceof Halted ||
          (err instanceof StepFailure && err.status === "timed_out");
        if (gone) this.d.abandon?.(prepared.tool);
        const failure = this.asFailure(err, prepared);
        if (!(failure.retryable && attempt <= extra)) throw failure;
        await this.pause(state, (options.retry?.backoff_ms ?? 0) * attempt);
      }
    }
  }

  private stopped(state: RunState): RunCancelled | Halted {
    return state.cancel
      ? new RunCancelled(state.cancel.reason, state.cancel.compensate)
      : new Halted("engine halted");
  }

  private async pause(state: RunState, ms: number): Promise<void> {
    if (ms <= 0) return;
    await this.bounded(
      state,
      ms + 1,
      (signal) => this.sleep(ms, signal),
      () => new StepFailure("retry wait overran"),
    );
  }

  private asFailure(err: unknown, prepared: PreparedAction): StepFailure {
    if (err instanceof StepFailure) return err;
    if (err instanceof ToolGatewayError) {
      const message = `${prepared.tool}: ${err.message}`.slice(0, 300);
      if (err.code === "TIMEOUT")
        return new StepFailure(message, "timed_out", true, prepared.destructive);
      if (err.code === "EXECUTION_FAILED") return new StepFailure(message, "failed", true);
      if (err.code === "APPROVAL_REJECTED") return new StepFailure(message, "rejected");
      return new StepFailure(message);
    }
    if (err instanceof RunCancelled || err instanceof Halted) throw err;
    return new StepFailure(
      `${prepared.tool}: ${err instanceof Error ? err.message : "failed"}`.slice(0, 300),
    );
  }

  // ── Other step types ─────────────────────────────────────────────────────

  condition(state: RunState, step: ConditionStep): StepResult {
    let verdict: boolean;
    try {
      verdict = evaluateCondition(compiledExpression(step.if), state.ctx);
    } catch {
      throw new StepFailure(`condition ${step.id} could not be evaluated`);
    }
    const index = state.indexOf[step.id] ?? 0;
    const following = state.def.steps[index + 1]?.id ?? "end";
    return {
      output: { matched: verdict },
      next: verdict ? (step.then ?? following) : (step.else ?? "end"),
    };
  }

  async lookup(state: RunState, step: LookupStep): Promise<StepResult> {
    if (state.def.declares.context !== true)
      throw new StepFailure("context lookup is not declared");
    const lookup = this.d.lookup;
    if (!lookup) throw new StepFailure("context lookup is not available");
    const query = renderText(step.query, state.ctx);
    const items = await this.bounded(
      state,
      step.timeout_ms ?? DEFAULT_LOOKUP_TIMEOUT_MS,
      (signal) => lookup({ query, limit: step.limit, signal }),
      () => new StepFailure("context lookup timed out", "timed_out", true),
    ).catch((err: unknown) => {
      if (err instanceof StepFailure || err instanceof RunCancelled || err instanceof Halted)
        throw err;
      throw new StepFailure("context lookup failed", "failed", true);
    });
    return { output: { items: boundValue(items.slice(0, step.limit)) } };
  }

  async ai(state: RunState, step: AiStepSpec): Promise<StepResult & { processedBy: string }> {
    if (!state.def.declares.ai) throw new StepFailure("this workflow does not declare AI use");
    const ai = this.d.ai;
    if (!ai) throw new StepFailure("AI is not available");
    const ctx = state.ctx;
    const records: Record<string, string> = {};
    for (const [name, template] of Object.entries(step.data ?? {}))
      records[name] = renderText(template, ctx);
    const nonce = crypto.randomUUID();
    const timeoutMs = step.timeout_ms ?? DEFAULT_AI_TIMEOUT_MS;
    const reply = await this.bounded(
      state,
      timeoutMs,
      (signal) =>
        ai({
          messages: buildAiMessages(step, records, nonce),
          privacy: step.privacy ?? "sensitive",
          purpose: AI_PURPOSE,
          maxTokens: step.max_tokens ?? DEFAULT_AI_TOKENS,
          timeoutMs,
          signal,
        }),
      () => new StepFailure("AI step timed out", "timed_out", true),
    ).catch((err: unknown) => {
      if (err instanceof StepFailure || err instanceof RunCancelled || err instanceof Halted)
        throw err;
      const name = err instanceof Error ? err.name : "error";
      throw new StepFailure(`AI step failed (${name})`, "failed", true);
    });
    const parsed = parseAiOutput(reply.text, step.output);
    if (!parsed.ok)
      throw new StepFailure(
        `AI answer was rejected: ${parsed.problems.join("; ")}`.slice(0, 300),
        "failed",
        true,
      );
    return { output: parsed.value, processedBy: reply.processedBy.slice(0, 200) };
  }

  notify(state: RunState, step: NotifyStep): StepResult {
    const ctx = state.ctx;
    const event = this.event(
      state,
      "workflow.notify",
      step.severity ?? "info",
      {
        step: step.id,
        title: renderText(step.title, ctx).slice(0, 200),
        message: renderText(step.message, ctx).slice(0, 1000),
      },
      { requiresAction: step.requires_action === true },
    );
    if (!this.emit(event)) throw new StepFailure("the notification event was refused");
    return { output: { event_id: event.event_id } };
  }

  result(state: RunState, step: ResultStep): StepResult {
    const summary = renderText(step.summary, state.ctx).slice(0, 500);
    const event = this.event(
      state,
      "workflow.result",
      step.outcome === "success" ? "success" : "error",
      { step: step.id, outcome: step.outcome, summary },
    );
    if (!this.emit(event)) throw new StepFailure("the result event was refused");
    return {
      output: { outcome: step.outcome, summary },
      finish: { outcome: step.outcome, summary },
    };
  }

  /** Dispatch for the simple (non-action, non-approval) step types. */
  async simple(state: RunState, step: Step): Promise<StepResult & { processedBy?: string }> {
    switch (step.type) {
      case "condition":
        return this.condition(state, step);
      case "lookup":
        return this.lookup(state, step);
      case "ai":
        return this.ai(state, step);
      case "notify":
        return this.notify(state, step);
      case "result":
        return this.result(state, step);
      default:
        throw new StepFailure(`step type ${step.type} is not a simple step`);
    }
  }
}
