// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// n8n capability (Phase 67): watches workflow executions of YOUR n8n (self-hosted, so base_url is
// required) and turns finished ones into n8n.execution.* events. Read-only by default: the poller
// only GETs and pauses while nothing is watching. Two commands change things, both external and
// both asking the user first: `run_again` (retry an execution) and `pause_workflow` (deactivate).
import { defineCapability, type CapabilityContext, type HealthResult } from "@phoenix/sdk";
import {
  nextDelay,
  realSleep,
  safeBaseUrl,
  ServiceError,
  startPolling,
  type ServiceItem,
  type Sleep,
} from "@phoenix/service-kit";
import {
  createN8nClient,
  deactivateWorkflow,
  listExecutions,
  listWorkflows,
  retryExecution,
  SERVICE,
} from "./client";
import { diffExecutions, executionTracker } from "./events";
import type { Execution, Workflow } from "./parse";

export * from "./client";
export * from "./events";
export * from "./parse";

export const DEFAULT_POLL_MS = 30_000;
export const MIN_POLL_MS = 5_000;
export const EXECUTIONS_PER_POLL = 50;
const WORKFLOWS_PER_POLL = 100;
const MAX_STATUS_ITEMS = 10;
const MAX_REMEMBERED_KEYS = 200;

export const ID_PATTERN = "^[A-Za-z0-9_-]{1,100}$";
export const IDEMPOTENCY_KEY_PATTERN = "^[A-Za-z0-9_-]{16,80}$";
const ID_RE = new RegExp(ID_PATTERN);
const URL_PATTERN =
  "^(https://[^\\s@?#]+|http://(127\\.0\\.0\\.1|localhost)(:[0-9]+)?(/[^\\s@?#]*)?)$";

export interface N8nCapabilityOptions {
  /** Epoch ms clock; tests pin it. */
  now?: () => number;
  /** Waits between polls; resolves early when `signal` aborts. Tests control time with it. */
  sleep?: Sleep;
}

interface Settings {
  /** Undefined until the user sets a usable `base_url`: there is no default for a self-hosted n8n. */
  baseUrl: string | undefined;
  configured: boolean;
  pollMs: number;
}

function settings(ctx: CapabilityContext): Settings {
  const { base_url, poll_ms } = ctx.config;
  return {
    baseUrl: typeof base_url === "string" ? safeBaseUrl(base_url) : undefined,
    configured: base_url !== undefined,
    pollMs: typeof poll_ms === "number" ? Math.max(poll_ms, MIN_POLL_MS) : DEFAULT_POLL_MS,
  };
}

interface ActionInput {
  idempotency_key: string;
}

function hasKey(v: unknown): v is ActionInput {
  return (
    typeof v === "object" &&
    v !== null &&
    "idempotency_key" in v &&
    typeof v.idempotency_key === "string"
  );
}

function stringField(v: unknown, field: string): string | undefined {
  if (typeof v !== "object" || v === null || !(field in v)) return undefined;
  const value = (v as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

export interface RunAgainResult {
  status: "started" | "already_requested";
  execution_id: string;
  new_execution_id: string;
  idempotency_key: string;
}

export interface PauseResult {
  status: "paused" | "already_requested";
  workflow_id: string;
  active: boolean;
  idempotency_key: string;
}

export interface N8nStatus {
  configured: boolean;
  workflows: { id: string; name: string; active: boolean }[];
  items: ServiceItem[];
  note?: string;
}

function asServiceError(err: unknown): ServiceError {
  return err instanceof ServiceError
    ? err
    : new ServiceError(SERVICE, "http", `Unexpected error while talking to ${SERVICE}`);
}

/** The service answered definitively that it did nothing, so the same key may be used again. */
const DEFINITE: ReadonlySet<ServiceError["kind"]> = new Set([
  "auth",
  "forbidden",
  "not_found",
  "rate_limit",
]);

const UNKNOWN_OUTCOME =
  "The request was sent but its outcome is unknown; check n8n, then retry with a new idempotency_key";

/** A fresh capability instance (its own watcher state); Phoenix Core uses one per runtime. */
export function createN8nCapability(options: N8nCapabilityOptions = {}) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;

  let tracker = executionTracker(0);
  let workflows: Workflow[] = [];
  let latest: Execution[] = [];
  let polled = false;
  let hasSecret = false;
  let failure: ServiceError | undefined;
  let failures = 0;
  /** idempotency_key → outcome of the action it started (null: sent, outcome unknown). */
  const actions = new Map<string, Promise<unknown | null>>();

  async function cycle(ctx: CapabilityContext): Promise<number> {
    const s = settings(ctx);
    const secret = await ctx.secret("api_key");
    hasSecret = !!secret;
    failure = undefined;
    if (secret && s.baseUrl) {
      try {
        const client = createN8nClient({ baseUrl: s.baseUrl, secret, signal: ctx.signal });
        const executions = await listExecutions(client, EXECUTIONS_PER_POLL);
        // Workflow names are a nicety: events still go out, named by id, if this call fails.
        workflows = await listWorkflows(client, WORKFLOWS_PER_POLL).catch(() => workflows);
        latest = executions;
        for (const event of diffExecutions(tracker, executions, workflows, s.baseUrl)) {
          void ctx.emit(event);
        }
      } catch (err) {
        failure = asServiceError(err);
      }
    }
    polled = true;
    failures = failure ? failures + 1 : 0;
    return nextDelay(s.pollMs, failures, failure);
  }

  async function clientFor(ctx: CapabilityContext) {
    const { baseUrl } = settings(ctx);
    const secret = await ctx.secret("api_key");
    if (!secret) throw new ServiceError(SERVICE, "auth", "Add an n8n API key in Settings first");
    if (!baseUrl)
      throw new ServiceError(
        SERVICE,
        "invalid",
        "Set base_url to your n8n address (https or loopback)",
      );
    return createN8nClient({ baseUrl, secret, signal: ctx.signal });
  }

  /**
   * Runs `start` at most once per idempotency key. A definite refusal frees the key; a send whose
   * outcome is unknown keeps it, so a repeat is told so instead of firing the action again.
   */
  async function once<T>(
    key: string,
    start: () => Promise<T>,
  ): Promise<{ value: T; repeated: boolean }> {
    const known = actions.get(key) as Promise<T | null> | undefined;
    const attempt =
      known ??
      start().catch((err: unknown) => {
        const e = asServiceError(err);
        if (DEFINITE.has(e.kind)) throw e;
        return null;
      });
    if (!known) {
      actions.set(key, attempt);
      while (actions.size > MAX_REMEMBERED_KEYS)
        actions.delete(actions.keys().next().value as string);
    }
    let value: T | null;
    try {
      value = await attempt;
    } catch (err) {
      actions.delete(key);
      throw err;
    }
    if (value === null) throw new ServiceError(SERVICE, "network", UNKNOWN_OUTCOME);
    return { value, repeated: known !== undefined };
  }

  return defineCapability({
    manifest: {
      id: "n8n",
      name: "n8n",
      version: "0.1.0",
      description:
        "Workflow executions of your own n8n: Fawkes shows ERROR when a workflow fails and SUCCESS when one finishes. Watching is read-only (GET only) and pauses while nothing is watching Phoenix. Two commands change things, only after you approve: run_again retries an execution, pause_workflow switches a workflow off. Needs your n8n address (base_url) and an n8n API key.",
      license: "GPL-3.0-or-later",
      homepage: "https://github.com/Thunder-BluePhoenix/Phoenix",
      events: ["n8n.execution.*"],
      permissions: ["network", "external_api"],
      data_categories: ["workflow names", "execution ids, status and times"],
      healthcheck: { interval_ms: 15_000 },
      secrets: [
        {
          name: "api_key",
          description:
            "n8n API key (Settings, n8n API, Create an API key). Sent only to your base_url in the X-N8N-API-KEY header; never logged.",
        },
      ],
      commands: [
        {
          name: "status",
          description: "Your workflows and the latest executions. Read-only.",
          side_effect: "read",
          permissions: ["network", "external_api"],
        },
        {
          name: "run_again",
          description:
            "Retries a past n8n execution (it runs the workflow again, which may have effects of its own). Always asks for your confirmation. Safe to repeat with the same idempotency_key: a second call does not retry again.",
          side_effect: "external",
          permissions: ["network", "external_api"],
          timeout_ms: 60_000,
          input_schema: {
            type: "object",
            additionalProperties: false,
            required: ["execution_id", "idempotency_key"],
            properties: {
              execution_id: { type: "string", pattern: ID_PATTERN },
              idempotency_key: { type: "string", pattern: IDEMPOTENCY_KEY_PATTERN },
            },
          },
        },
        {
          name: "pause_workflow",
          description:
            "Deactivates an n8n workflow so its triggers stop firing. Always asks for your confirmation. Safe to repeat with the same idempotency_key.",
          side_effect: "external",
          permissions: ["network", "external_api"],
          timeout_ms: 60_000,
          input_schema: {
            type: "object",
            additionalProperties: false,
            required: ["workflow_id", "idempotency_key"],
            properties: {
              workflow_id: { type: "string", pattern: ID_PATTERN },
              idempotency_key: { type: "string", pattern: IDEMPOTENCY_KEY_PATTERN },
            },
          },
        },
      ],
      config_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          base_url: {
            type: "string",
            pattern: URL_PATTERN,
            description:
              "Address of your n8n, for example https://n8n.example.com (required). Plain http is only accepted for localhost.",
          },
          poll_ms: {
            type: "integer",
            minimum: MIN_POLL_MS,
            maximum: 3_600_000,
            description: `Milliseconds between checks (default ${DEFAULT_POLL_MS})`,
          },
        },
      },
      state_rules: [
        {
          match: "n8n.execution.failed",
          effect: { state: "ERROR", explain: "Workflow failed: {subject}" },
        },
        {
          match: "n8n.execution.succeeded",
          effect: { state: "SUCCESS", explain: "Workflow finished: {subject}", ttlMs: 5_000 },
        },
      ],
    },
    init(ctx) {
      workflows = [];
      latest = [];
      polled = false;
      failure = undefined;
      failures = 0;
      actions.clear();
      // History rule: anything that began before this moment is background, not news.
      tracker = executionTracker(now());
      startPolling(ctx, () => cycle(ctx), sleep);
    },
    commands: {
      async status(_input, ctx): Promise<N8nStatus> {
        const secret = await ctx.secret("api_key");
        const { baseUrl } = settings(ctx);
        if (!secret || !baseUrl) {
          return {
            configured: false,
            workflows: [],
            items: [],
            note: baseUrl ? "Add an n8n API key in Settings" : "Set base_url to your n8n address",
          };
        }
        try {
          const client = await clientFor(ctx);
          const [executions, list] = await Promise.all([
            listExecutions(client, MAX_STATUS_ITEMS),
            listWorkflows(client, WORKFLOWS_PER_POLL),
          ]);
          const names: Record<string, string> = {};
          for (const w of list) names[w.id] = w.name;
          return {
            configured: true,
            workflows: list.map((w) => ({ id: w.id, name: w.name, active: w.active })),
            items: executions.map((e) => ({
              id: e.id,
              title: Object.hasOwn(names, e.workflowId)
                ? names[e.workflowId]!
                : `workflow ${e.workflowId}`,
              state: e.status,
              at: new Date(e.startedAt).toISOString(),
            })),
          };
        } catch (err) {
          throw asServiceError(err);
        }
      },
      async run_again(input, ctx): Promise<RunAgainResult> {
        const executionId = stringField(input, "execution_id");
        if (!hasKey(input) || executionId === undefined || !ID_RE.test(executionId)) {
          throw new ServiceError(SERVICE, "invalid", "execution_id is not a valid id");
        }
        // Configuration problems are reported before anything is sent (and before a key is spent).
        const client = await clientFor(ctx);
        const { value, repeated } = await once(`run_again:${input.idempotency_key}`, () =>
          retryExecution(client, executionId),
        );
        return {
          status: repeated ? "already_requested" : "started",
          execution_id: executionId,
          new_execution_id: value.id,
          idempotency_key: input.idempotency_key,
        };
      },
      async pause_workflow(input, ctx): Promise<PauseResult> {
        const workflowId = stringField(input, "workflow_id");
        if (!hasKey(input) || workflowId === undefined || !ID_RE.test(workflowId)) {
          throw new ServiceError(SERVICE, "invalid", "workflow_id is not a valid id");
        }
        const client = await clientFor(ctx);
        const key = `pause:${input.idempotency_key}`;
        const { value, repeated } = await once(key, () => deactivateWorkflow(client, workflowId));
        if (value.active) {
          // Only a workflow n8n reports as inactive counts as paused; the key may be tried again.
          actions.delete(key);
          throw new ServiceError(SERVICE, "http", "n8n still reports the workflow as active");
        }
        return {
          status: repeated ? "already_requested" : "paused",
          workflow_id: workflowId,
          active: value.active,
          idempotency_key: input.idempotency_key,
        };
      },
    },
    health(ctx): HealthResult {
      const s = settings(ctx);
      if (s.configured && !s.baseUrl) {
        return { status: "unhealthy", message: "base_url must be https or loopback" };
      }
      if (!s.baseUrl)
        return { status: "degraded", message: "Set base_url to your n8n address in Settings" };
      if (!polled) return { status: "healthy", message: "Reading n8n…" };
      if (!hasSecret) return { status: "degraded", message: "Add an n8n API key in Settings" };
      if (
        failure?.kind === "auth" ||
        failure?.kind === "rate_limit" ||
        failure?.kind === "forbidden"
      ) {
        return { status: "degraded", message: failure.message };
      }
      if (failure) return { status: "unhealthy", message: failure.message };
      return { status: "healthy", message: `Watching ${latest.length} recent executions` };
    },
  });
}
