// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Embedding pipeline. Incremental (only items with no vector for the active model), batched,
// resumable (all state is in SQLite: the next run simply asks "what has no vector yet"),
// rate-bounded (a minimum gap between provider calls and a cap per run) and failure-tolerant:
// a failing item is recorded with an exponential backoff and tried again later, it is never
// dropped and never blocks capture, because capture does not wait for embedding at all.
//
// Privacy: every batch carries exactly one data class, the sensitivity of its items, so the
// router can refuse a cloud provider per batch. With AI off nothing is embedded and the report
// says why; retrieval then runs lexical-only.
import { PRIVACY_CLASSES, type PrivacyClass } from "@phoenix/ai-models";
import {
  DEGRADED_TEXT,
  classifyEmbedFailure,
  type Embedder,
  type EmbeddingDegradedReason,
} from "./embedder";
import type { VectorStore } from "./vectors";

export interface IndexerOptions {
  vectors: VectorStore;
  embedder: Embedder;
  /** Items per provider call. Default 16. */
  batchSize?: number;
  /** Most items handled in one run. Default 256. */
  maxItemsPerRun?: number;
  /** Minimum time between two provider calls. Default 0 (no pacing). */
  minIntervalMs?: number;
  /** After this many failures an item is parked until `retryParked()`. Default 5. */
  maxAttempts?: number;
  /** Delay before retry number `attempts`. Default 30 s doubling, capped at 1 h. */
  backoffMs?: (attempts: number) => number;
  /** Injected so tests never really wait. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

export interface IndexReport {
  model: string;
  embedded: number;
  /** Items whose embedding failed in this run (recorded for retry). */
  failed: number;
  /** Items still without a vector after this run (including backed-off and parked ones). */
  remaining: number;
  degraded: { reason: EmbeddingDegradedReason; detail: string }[];
  /** True when the per-run cap was hit with work left. */
  capped: boolean;
}

export const DEFAULT_BACKOFF_MS = (attempts: number): number =>
  Math.min(30_000 * 2 ** (attempts - 1), 3_600_000);

interface Pending {
  id: string;
  text: string;
}

export class VectorIndexer {
  private running: Promise<IndexReport> | null = null;
  private lastCallAt = Number.NEGATIVE_INFINITY;
  /** In-memory only: after an outage, no provider call until this time. */
  private cooldownUntil = Number.NEGATIVE_INFINITY;
  private outages = 0;
  /** True once a call succeeded and no outage has been seen since. */
  private providerSeenUp = false;
  private readonly batchSize: number;
  private readonly maxItems: number;
  private readonly minIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly backoff: (attempts: number) => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly options: IndexerOptions) {
    this.batchSize = Math.max(1, Math.floor(options.batchSize ?? 16));
    this.maxItems = Math.max(1, Math.floor(options.maxItemsPerRun ?? 256));
    this.minIntervalMs = Math.max(0, options.minIntervalMs ?? 0);
    this.maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 5));
    this.backoff = options.backoffMs ?? DEFAULT_BACKOFF_MS;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
  }

  /** Items parked after repeated failures become eligible again. */
  retryParked(): number {
    return this.options.vectors.clearFailures(this.options.embedder.modelKey);
  }

  /**
   * Embeds what is missing. Concurrent calls share one run, so two triggers (a timer and a
   * capture event) can never embed the same item twice. Never throws for provider problems; those
   * come back in `degraded`. Aborting `signal` stops after the current call.
   */
  run(signal?: AbortSignal): Promise<IndexReport> {
    this.running ??= this.runOnce(signal).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runOnce(signal?: AbortSignal): Promise<IndexReport> {
    const { vectors, embedder } = this.options;
    const model = embedder.modelKey;
    const report: IndexReport = {
      model,
      embedded: 0,
      failed: 0,
      remaining: 0,
      degraded: [],
      capped: false,
    };
    const degrade = (reason: EmbeddingDegradedReason) => {
      if (!report.degraded.some((d) => d.reason === reason)) {
        report.degraded.push({ reason, detail: DEGRADED_TEXT[reason] });
      }
    };
    if (this.now() < this.cooldownUntil) {
      report.degraded.push({
        reason: "provider_unavailable",
        detail: DEGRADED_TEXT.provider_unavailable,
      });
      report.remaining = vectors.unembeddedCount(model);
      return report;
    }
    let budget = this.maxItems;
    // Least sensitive first: if the provider is only allowed for some classes, those get done.
    for (const privacy of PRIVACY_CLASSES) {
      let stop = false;
      while (!stop && budget > 0 && signal?.aborted !== true) {
        const batch = vectors.pending(
          model,
          privacy,
          Math.min(this.batchSize, budget),
          this.maxAttempts,
        );
        if (batch.length === 0) break;
        budget -= batch.length;
        const outcome = await this.embedBatch(batch, privacy, signal, report);
        if (outcome !== "ok") {
          degrade(outcome);
          stop = true;
        }
      }
    }
    report.capped = budget <= 0 && signal?.aborted !== true;
    report.remaining = vectors.unembeddedCount(model);
    return report;
  }

  /** Returns "ok" or why the rest of this data class should wait. */
  private async embedBatch(
    batch: readonly Pending[],
    privacy: PrivacyClass,
    signal: AbortSignal | undefined,
    report: IndexReport,
  ): Promise<"ok" | EmbeddingDegradedReason> {
    const attempt = await this.embedAndStore(batch, privacy, signal);
    if (attempt.kind === "stored") {
      report.embedded += attempt.stored;
      return "ok";
    }
    if (attempt.kind === "blocked") return attempt.reason;

    // The batch failed. Retry item by item to tell "one bad item" from "provider down": items
    // that fail while a sibling succeeds are recorded (backoff, parking). Two failures in a row
    // before any success mean the provider is down: nothing is recorded against the items (an
    // outage must not park them), the rest of the batch stays pending, and the run goes into a
    // cooldown so triggers do not hammer a dead provider.
    let succeeded = 0;
    let consecutive = 0;
    const bad: { item: Pending; error: string }[] = [];
    for (const item of batch) {
      const one = await this.embedAndStore([item], privacy, signal);
      if (one.kind === "blocked") return one.reason;
      if (one.kind === "stored") {
        succeeded++;
        consecutive = 0;
        report.embedded += one.stored;
        continue;
      }
      consecutive++;
      bad.push({ item, error: one.error });
      if (succeeded === 0 && consecutive >= 2) {
        this.providerSeenUp = false;
        this.cooldownUntil = this.now() + this.backoff(++this.outages);
        return "provider_unavailable";
      }
    }
    if (succeeded === 0 && !this.providerSeenUp) {
      // A lone failing item cannot be told from an outage unless the provider answered earlier.
      this.cooldownUntil = this.now() + this.backoff(++this.outages);
      return "provider_unavailable";
    }
    for (const b of bad) this.fail([b.item], b.error, report);
    return "ok";
  }

  private fail(batch: readonly Pending[], error: string, report: IndexReport): void {
    const { vectors, embedder } = this.options;
    for (const item of batch) {
      vectors.recordFailure(item.id, embedder.modelKey, error, this.backoff);
      report.failed++;
    }
  }

  private async embedAndStore(
    batch: readonly Pending[],
    privacy: PrivacyClass,
    signal: AbortSignal | undefined,
  ): Promise<
    | { kind: "stored"; stored: number }
    | { kind: "blocked"; reason: EmbeddingDegradedReason }
    | { kind: "failed"; error: string }
  > {
    const { vectors, embedder } = this.options;
    await this.pace(signal);
    try {
      const embeddings = await embedder.embedDocuments(
        batch.map((b) => b.text),
        privacy,
        signal,
      );
      if (embeddings.length !== batch.length) {
        return { kind: "failed", error: "the provider returned the wrong number of vectors" };
      }
      const stored = vectors.putMany(
        embedder.modelKey,
        batch.map((b, i) => ({ id: b.id, text: b.text, vector: embeddings[i] ?? [] })),
      );
      this.outages = 0;
      this.providerSeenUp = true;
      return { kind: "stored", stored };
    } catch (err) {
      if (signal?.aborted === true) return { kind: "blocked", reason: "provider_unavailable" };
      const failure = classifyEmbedFailure(err);
      if (failure === null) throw err;
      // Switched off or not allowed: nothing is wrong with any item, so nothing is recorded.
      if (failure.reason === "ai_disabled" || failure.reason === "no_provider") {
        return { kind: "blocked", reason: failure.reason };
      }
      return { kind: "failed", error: failure.message };
    }
  }

  private async pace(signal: AbortSignal | undefined): Promise<void> {
    const wait = this.lastCallAt + this.minIntervalMs - this.now();
    if (wait > 0) await this.sleep(wait, signal);
    this.lastCallAt = this.now();
  }
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  const done = Promise.withResolvers<void>();
  const timer = setTimeout(done.resolve, ms);
  signal?.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      done.resolve();
    },
    { once: true },
  );
  return done.promise;
}
