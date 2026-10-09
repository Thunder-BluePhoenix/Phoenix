// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { Logger } from "@phoenix/logging";
import type { ToolCall, ToolCallResult, ToolContract } from "@phoenix/ai-tool-gateway";
import type { PolicyAuditSink } from "@phoenix/policy";
import type { PhoenixEvent } from "@phoenix/protocol";
import type { AiStep } from "./ai-step";
import type { ApprovalPort } from "./approvals";
import type { ContextLookup } from "./lookup";
import type { WorkflowStore } from "./store";
import type { ToolCatalog } from "./types";

/** The bus, as far as the engine needs it. `EventBus.subscribe` satisfies this. */
export interface EventSource {
  subscribe(
    id: string,
    patterns: string | readonly string[],
    handler: (event: PhoenixEvent) => void | Promise<void>,
  ): () => void;
}

/** Publishes a complete event. `EventBus.publish` satisfies this. */
export type EventPublisher = (event: PhoenixEvent) => { ok: boolean };

/**
 * The ONLY door from a workflow to a capability. The engine never holds a CapabilityManager: a
 * `ToolGateway` is what is handed in, so every action gets a policy decision, an audit record
 * and (where required) a human approval before anything runs.
 */
export interface WorkflowToolGateway {
  /**
   * `options.signal` aborts when the engine abandons the call (step timeout, emergency stop).
   * `ToolGateway.call` takes no second argument yet, so today the abandoned call is not
   * withdrawn inside the gateway (see the gaps register).
   */
  call(call: ToolCall, options?: { signal: AbortSignal }): Promise<ToolCallResult>;
  tools(): ToolContract[];
}

/** Resolves after `ms`; rejects when `signal` aborts first. Injected so tests never really wait. */
export type Sleeper = (ms: number, signal: AbortSignal) => Promise<void>;

export const realSleep: Sleeper = (ms, signal) => {
  const done = Promise.withResolvers<void>();
  if (signal.aborted) {
    done.reject(new Error("aborted"));
    return done.promise;
  }
  const onAbort = () => {
    clearTimeout(timer);
    done.reject(new Error("aborted"));
  };
  const timer = setTimeout(() => {
    signal.removeEventListener("abort", onAbort);
    done.resolve();
  }, ms);
  signal.addEventListener("abort", onAbort, { once: true });
  return done.promise;
};

export interface RateLimit {
  /** Most runs one workflow may start in `windowMs`. */
  max: number;
  windowMs: number;
}

export interface EngineDeps {
  store: WorkflowStore;
  events: EventSource;
  publish: EventPublisher;
  gateway: WorkflowToolGateway;
  approvals: ApprovalPort;
  audit: PolicyAuditSink;
  /** Read before every step and every tool call: the emergency stop. */
  isKillSwitchEngaged: () => boolean;
  /** Absent = `ai` steps fail (the workflow cannot use AI that is not configured). */
  ai?: AiStep;
  /** Absent = `lookup` steps fail. */
  lookup?: ContextLookup;
  now?: () => number;
  sleep?: Sleeper;
  logger?: Logger;
  /** Runs executing at once (default 4); the rest wait in a queue. */
  maxConcurrent?: number;
  rate?: RateLimit;
  /** Deepest chain of workflow-emitted events that may still start a run (default 3). */
  maxChainDepth?: number;
  newId?: () => string;
}

export const DEFAULT_RATE: RateLimit = { max: 20, windowMs: 60_000 };
export const DEFAULT_CONCURRENCY = 4;
/** Refused runs recorded per workflow per window; more are dropped (counted in the log only). */
export const MAX_REFUSED_RECORDS = 50;

/** The tool facts the engine and validator use, taken from the live gateway registry. */
export function catalogFromGateway(gateway: Pick<WorkflowToolGateway, "tools">): ToolCatalog {
  return (name) => {
    const c = gateway.tools().find((t) => t.name === name);
    return c
      ? {
          name: c.name,
          sideEffect: c.sideEffect,
          permissions: c.permissions,
          idempotent: c.idempotent,
          timeoutMs: c.timeoutMs,
        }
      : undefined;
  };
}
