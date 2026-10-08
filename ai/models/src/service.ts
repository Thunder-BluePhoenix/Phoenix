// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// AiService runs a task: it asks the router for a plan, then tries the allowed providers in
// order with timeouts, bounded retries and fallback.
//
// Nothing in this package has side effects on the user's machine or accounts: every provider call
// is a pure question ("generate text", "embed these strings") whose repeat is harmless apart from
// cost. That is the only reason retrying generate/embed is allowed. If a provider that can ACT
// (run a tool, write a file, send a message) is ever added, its calls must not go through this
// retry path; the tool gateway (Phase 30) owns them and never auto-retries.
//
// Streams are never retried (a retry would replay output the user has already seen). A stream
// that fails before its first chunk may fall back to the next provider; one that fails later
// surfaces its error to the consumer.
import type { Logger } from "@phoenix/logging";
import {
  AiDisabledError,
  AllProvidersFailedError,
  ModelError,
  NoProviderError,
  type Attempt,
} from "./errors";
import { checkGate, type CloudOptIn, type ExternalAiPolicy, type GateDecision } from "./gate";
import type { ProviderRegistry } from "./registry";
import { route, type RoutePlan, type RouteTask, type RouterProvider } from "./router";
import {
  PRIVACY_CLASSES,
  type CostTier,
  type EmbedRequest,
  type EmbedResult,
  type GenerateRequest,
  type GenerateResult,
  type ModelProvider,
  type PrivacyClass,
  type Provenance,
  type StreamChunk,
} from "./types";

/** User settings for the AI layer. There is deliberately no opt-in key for sensitive data. */
export interface AiSettings {
  enabled: boolean;
  /** Provider id the user prefers among the allowed ones. */
  preferred?: string;
  cloudOptIn: CloudOptIn;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  cloudOptIn: { public: false, internal: false },
};

/** Waits `ms` (or rejects early when `signal` aborts). Injected so tests never really wait. */
export type Sleeper = (ms: number, signal?: AbortSignal) => Promise<void>;

export interface RetryPolicy {
  /** Total tries per provider, including the first. 1 = never retry. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 8_000 };

const realSleep: Sleeper = (ms, signal) => {
  const done = Promise.withResolvers<void>();
  if (signal?.aborted) {
    done.reject(new ModelError("aborted", "ai", "The request was cancelled"));
    return done.promise;
  }
  const onAbort = () => {
    clearTimeout(timer);
    done.reject(new ModelError("aborted", "ai", "The request was cancelled"));
  };
  const timer = setTimeout(() => {
    signal?.removeEventListener("abort", onAbort);
    done.resolve();
  }, ms);
  signal?.addEventListener("abort", onAbort, { once: true });
  return done.promise;
};

export interface AiServiceDeps {
  registry: ProviderRegistry;
  /** The AI_external_processing grant. Asked again before every provider call. */
  policy: ExternalAiPolicy;
  /** Current settings. A function so changes apply to the next call without a restart. */
  settings: () => AiSettings;
  sleep?: Sleeper;
  now?: () => number;
  retry?: RetryPolicy;
  /** How long a health check result is trusted. */
  healthTtlMs?: number;
  /** Logged: provider, kind, purpose and outcome. Never prompts, replies or credentials. */
  logger?: Logger;
}

interface RoutingHints {
  latencyBudgetMs?: number;
  maxCostTier?: CostTier;
  /** Overrides settings.preferred for this call. */
  preferred?: string;
  signal?: AbortSignal;
  /** Time allowed for one attempt on one provider. */
  timeoutMs?: number;
}

export interface GenerateTask extends RoutingHints {
  kind: "generate";
  request: GenerateRequest;
}
export interface StreamTask extends RoutingHints {
  kind: "stream";
  request: GenerateRequest;
}
export interface EmbedTask extends RoutingHints {
  kind: "embed";
  request: EmbedRequest;
}
export type AiTask = GenerateTask | StreamTask | EmbedTask;

interface OutcomeBase {
  /** Id of the provider that answered. */
  provider: string;
  /** Label for the UI: "processed by X". */
  provenance: Provenance;
  /** Every provider considered, in order: skipped (with reason), failed (with reason), answered. */
  attempts: Attempt[];
}
export interface GenerateOutcome extends OutcomeBase {
  kind: "generate";
  result: GenerateResult;
}
export interface EmbedOutcome extends OutcomeBase {
  kind: "embed";
  result: EmbedResult;
}
export interface StreamOutcome extends OutcomeBase {
  kind: "stream";
  /**
   * Yields the answering provider's chunks. The first chunk has already been received. Consume or
   * abort `signal` to release the connection.
   */
  stream: AsyncIterable<StreamChunk>;
}
export type AiOutcome = GenerateOutcome | EmbedOutcome | StreamOutcome;

export interface ProviderStatus {
  id: string;
  label: string;
  locality: ModelProvider["locality"];
  capabilities: ModelProvider["capabilities"];
  /** undefined when the provider was not checked (cloud provider that is not allowed to run). */
  available: boolean | undefined;
  detail: string;
  /** Per data class: may this provider be used right now, and if not, why. */
  access: Record<PrivacyClass, GateDecision>;
}

export interface AiStatus {
  enabled: boolean;
  preferred?: string;
  cloudOptIn: CloudOptIn;
  providers: ProviderStatus[];
}

interface HealthEntry {
  ok: boolean;
  detail: string;
  at: number;
}

export class AiService {
  private readonly sleep: Sleeper;
  private readonly now: () => number;
  private readonly retry: RetryPolicy;
  private readonly healthTtlMs: number;
  private readonly healthCache: Record<string, HealthEntry | undefined> = {};

  constructor(private readonly deps: AiServiceDeps) {
    this.sleep = deps.sleep ?? realSleep;
    this.now = deps.now ?? Date.now;
    this.retry = deps.retry ?? DEFAULT_RETRY;
    this.healthTtlMs = deps.healthTtlMs ?? 15_000;
  }

  /** Throws AiDisabledError before anything else happens: no routing, no health check, no fetch. */
  private requireEnabled(): AiSettings {
    const settings = this.deps.settings();
    if (!settings.enabled) throw new AiDisabledError();
    return settings;
  }

  private gateFor(provider: RouterProvider, privacy: PrivacyClass, settings: AiSettings) {
    return checkGate(provider.locality, privacy, this.deps.policy, settings.cloudOptIn);
  }

  /** Health of providers that may receive this data class; others are not contacted at all. */
  private async refreshHealth(privacy: PrivacyClass, settings: AiSettings): Promise<void> {
    const stale = this.deps.registry
      .list()
      .filter((p) => this.gateFor(p, privacy, settings).allowed)
      .filter((p) => {
        const entry = this.healthCache[p.id];
        return entry === undefined || this.now() - entry.at >= this.healthTtlMs;
      });
    await Promise.all(
      stale.map(async (p) => {
        const h = await p
          .health()
          .catch(() => ({ available: false, detail: "health check failed" }));
        this.healthCache[p.id] = { ok: h.available, detail: h.detail, at: this.now() };
      }),
    );
  }

  private routerState(settings: AiSettings) {
    const health: Record<string, boolean | undefined> = {};
    for (const [id, entry] of Object.entries(this.healthCache)) health[id] = entry?.ok;
    return {
      providers: this.deps.registry.list(),
      health,
      policy: this.deps.policy,
      cloudOptIn: settings.cloudOptIn,
    };
  }

  /** The plan for a task using cached health. For UI explanations; makes no network calls. */
  plan(task: RouteTask): RoutePlan {
    const settings = this.requireEnabled();
    return route(
      { ...task, preferred: task.preferred ?? settings.preferred },
      this.routerState(settings),
    );
  }

  /** Providers with availability and what each data class may use. Disabled = no calls. */
  async status(): Promise<AiStatus> {
    const settings = this.deps.settings();
    if (!settings.enabled) {
      return { enabled: false, cloudOptIn: settings.cloudOptIn, providers: [] };
    }
    await Promise.all(PRIVACY_CLASSES.map((c) => this.refreshHealth(c, settings)));
    const providers = this.deps.registry.list().map((p): ProviderStatus => {
      const entry = this.healthCache[p.id];
      const access = {
        public: this.gateFor(p, "public", settings),
        internal: this.gateFor(p, "internal", settings),
        sensitive: this.gateFor(p, "sensitive", settings),
      };
      return {
        id: p.id,
        label: p.label,
        locality: p.locality,
        capabilities: p.capabilities,
        available: entry?.ok,
        detail: entry?.detail ?? "not checked (not allowed to run)",
        access,
      };
    });
    return {
      enabled: true,
      preferred: settings.preferred,
      cloudOptIn: settings.cloudOptIn,
      providers,
    };
  }

  run(task: GenerateTask): Promise<GenerateOutcome>;
  run(task: StreamTask): Promise<StreamOutcome>;
  run(task: EmbedTask): Promise<EmbedOutcome>;
  run(task: AiTask): Promise<AiOutcome>;
  async run(task: AiTask): Promise<AiOutcome> {
    const settings = this.requireEnabled();
    const privacy = task.request.privacy;
    await this.refreshHealth(privacy, settings);
    const plan = route(
      {
        kind: task.kind,
        privacy,
        latencyBudgetMs: task.latencyBudgetMs,
        maxCostTier: task.maxCostTier,
        preferred: task.preferred ?? settings.preferred,
      },
      this.routerState(settings),
    );
    const attempts: Attempt[] = plan.candidates
      .filter((c) => c.refusedBecause !== undefined)
      .map((c) => ({
        provider: c.providerId,
        outcome: "skipped",
        reason: c.refusedBecause,
        calls: 0,
      }));
    if (plan.order.length === 0) throw this.noProvider(task, attempts);

    for (const id of plan.order) {
      const provider = this.deps.registry.get(id);
      if (!provider) continue;
      const attempt: Attempt = { provider: id, outcome: "failed", calls: 0 };
      attempts.push(attempt);
      try {
        const outcome = await this.callProvider(provider, task, attempt, attempts);
        attempt.outcome = "answered";
        this.deps.logger?.info("ai.answered", {
          provider: id,
          kind: task.kind,
          purpose: task.request.purpose,
          calls: attempt.calls,
        });
        return outcome;
      } catch (err) {
        const failure = toModelError(err, id);
        attempt.reason = failure.message;
        this.deps.logger?.warn("ai.provider_failed", {
          provider: id,
          kind: task.kind,
          purpose: task.request.purpose,
          error: failure.kind,
        });
        // The caller cancelled, or the request itself is bad: another provider cannot help.
        if (failure.kind === "aborted" || failure.kind === "invalid") throw failure;
        if (failure.kind === "network" || failure.kind === "timeout") {
          this.healthCache[id] = { ok: false, detail: failure.message, at: this.now() };
        }
      }
    }
    throw new AllProvidersFailedError(attempts);
  }

  private noProvider(task: AiTask, attempts: Attempt[]): NoProviderError {
    this.deps.logger?.warn("ai.no_provider", { kind: task.kind, purpose: task.request.purpose });
    return new NoProviderError(attempts);
  }

  private async callProvider(
    provider: ModelProvider,
    task: AiTask,
    attempt: Attempt,
    attempts: Attempt[],
  ): Promise<AiOutcome> {
    const maxAttempts = task.kind === "stream" ? 1 : Math.max(1, this.retry.maxAttempts);
    const opts = { signal: task.signal, timeoutMs: task.timeoutMs };
    for (let n = 1; ; n++) {
      if (task.signal?.aborted)
        throw new ModelError("aborted", provider.id, "The request was cancelled");
      // Re-checked before every call: the grant may have been revoked while we backed off.
      const gate = this.gateFor(provider, task.request.privacy, this.deps.settings());
      if (!gate.allowed) throw new ModelError("config", provider.id, gate.reason ?? "not allowed");
      attempt.calls++;
      try {
        const base = { provider: provider.id, attempts };
        if (task.kind === "generate") {
          const result = await provider.generate(task.request, opts);
          return { ...base, kind: "generate", result, provenance: result.provenance };
        }
        if (task.kind === "embed") {
          const result = await provider.embed(task.request, opts);
          return { ...base, kind: "embed", result, provenance: result.provenance };
        }
        return { ...base, ...(await openStream(provider, task.request, opts)), kind: "stream" };
      } catch (err) {
        const failure = toModelError(err, provider.id);
        if (!failure.retryable || n >= maxAttempts) throw failure;
        const backoff = Math.min(this.retry.baseDelayMs * 2 ** (n - 1), this.retry.maxDelayMs);
        await this.sleep(Math.max(backoff, failure.retryAfterMs ?? 0), task.signal);
      }
    }
  }
}

interface OpenedStream {
  stream: AsyncIterable<StreamChunk>;
  provenance: Provenance;
}

/** Pulls the first chunk so the answering provider is known before the caller starts reading. */
async function openStream(
  provider: ModelProvider,
  request: GenerateRequest,
  opts: { signal?: AbortSignal; timeoutMs?: number },
): Promise<OpenedStream> {
  const iterator = provider.stream(request, opts)[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done) {
    throw new ModelError("protocol", provider.id, `${provider.id} sent an empty stream`);
  }
  const remainder: AsyncIterable<StreamChunk> = { [Symbol.asyncIterator]: () => iterator };
  async function* chunks(): AsyncGenerator<StreamChunk> {
    yield first.value;
    yield* remainder;
  }
  return { stream: chunks(), provenance: first.value.provenance };
}

/** Provider errors we did not write (custom providers, bugs) are shown generically: no raw text. */
function toModelError(err: unknown, provider: string): ModelError {
  if (err instanceof ModelError) return err;
  return new ModelError("network", provider, `${provider} failed unexpectedly`);
}
