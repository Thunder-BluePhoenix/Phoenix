// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { silentLogger, type Logger } from "@phoenix/logging";
import type { DeadLetterStore, EventStore } from "@phoenix/persistence";
import {
  ErrorCode,
  isExpired,
  PhoenixError,
  validateEvent,
  type PhoenixEvent,
} from "@phoenix/protocol";
import { RecentIds } from "./dedup";
import { isValidPattern, matchesPattern } from "./pattern";

export interface DeliveryInfo {
  /** Position in durable history; null for ephemeral events or when no store is configured. */
  seq: number | null;
  ephemeral: boolean;
}

export type EventHandler = (event: PhoenixEvent, info: DeliveryInfo) => void | Promise<void>;

export interface PublishOptions {
  /** Ephemeral events (transient UI signals) are not persisted and are not retried. */
  ephemeral?: boolean;
  /** When set, the event's source must equal this id (capability authentication, ADR-0016). */
  expectedSource?: string;
}

export type PublishResult =
  | { ok: true; event: PhoenixEvent; seq: number | null; deliveredTo: number }
  | { ok: false; error: PhoenixError };

export interface BusMetrics {
  published: number;
  rejected: number;
  duplicates: number;
  expired: number;
  delivered: number;
  handlerFailures: number;
  deadLettered: number;
  /** Average milliseconds from publish to successful handler completion. */
  avgLatencyMs: number;
  maxLatencyMs: number;
  subscribers: number;
}

export interface EventBusOptions {
  store?: EventStore;
  deadLetters?: DeadLetterStore;
  logger?: Logger;
  /** Number of recent event ids remembered for deduplication. */
  dedupWindow?: number;
  /** Total delivery attempts per durable event per subscriber. */
  maxAttempts?: number;
  /** Base delay between retries; attempt n waits n * retryDelayMs. */
  retryDelayMs?: number;
  now?: () => number;
}

interface Delivery {
  event: PhoenixEvent;
  durable: boolean;
  seq: number | null;
  publishedAt: number;
}

interface Subscription {
  id: string;
  patterns: readonly string[];
  handler: EventHandler;
  queue: Delivery[];
  running: Promise<void> | null;
  active: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * In-process publish/subscribe bus.
 *
 * - Validates every event against the v1 schema and the no-secrets rule.
 * - Deduplicates by event_id (at-least-once upstream → exactly-once per subscriber here).
 * - Persists durable events; ephemeral events are memory-only.
 * - Delivers to each subscriber in order through its own queue, so a slow or
 *   throwing subscriber never blocks or breaks the others.
 * - Retries failed durable deliveries, then dead-letters them.
 */
export class EventBus {
  private readonly subs = new Map<string, Subscription>();
  private readonly recent: RecentIds;
  private readonly logger: Logger;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;
  private readonly now: () => number;
  private closed = false;
  private latencyTotal = 0;
  private latencyCount = 0;
  private readonly m: Omit<BusMetrics, "avgLatencyMs" | "subscribers"> = {
    published: 0,
    rejected: 0,
    duplicates: 0,
    expired: 0,
    delivered: 0,
    handlerFailures: 0,
    deadLettered: 0,
    maxLatencyMs: 0,
  };

  constructor(private readonly options: EventBusOptions = {}) {
    this.recent = new RecentIds(options.dedupWindow ?? 10_000);
    this.logger = (options.logger ?? silentLogger).child("event-bus");
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    this.retryDelayMs = options.retryDelayMs ?? 100;
    this.now = options.now ?? Date.now;
  }

  publish(input: unknown, options: PublishOptions = {}): PublishResult {
    if (this.closed) {
      return {
        ok: false,
        error: new PhoenixError(ErrorCode.INTERNAL_ERROR, "Event bus is closed"),
      };
    }
    const validation = validateEvent(input);
    if (!validation.ok) return this.reject(validation.error, input);
    const event = validation.event;

    if (options.expectedSource !== undefined && event.source !== options.expectedSource) {
      return this.reject(
        new PhoenixError(
          ErrorCode.SECURITY_POLICY_BLOCKED,
          `Source "${event.source}" does not match authenticated capability "${options.expectedSource}"`,
        ),
        input,
      );
    }

    const durable = !options.ephemeral;
    if (this.recent.has(event.event_id) || (durable && this.options.store?.has(event.event_id))) {
      this.m.duplicates++;
      return { ok: false, error: new PhoenixError(ErrorCode.EVENT_DUPLICATE) };
    }
    this.recent.add(event.event_id);

    if (isExpired(event, this.now())) {
      this.m.expired++;
      this.logger.debug("dropped expired event", { event_id: event.event_id });
      return { ok: true, event, seq: null, deliveredTo: 0 };
    }

    const seq = durable ? (this.options.store?.append(event) ?? null) : null;
    this.m.published++;

    let deliveredTo = 0;
    const delivery: Delivery = { event, durable, seq, publishedAt: this.now() };
    for (const sub of this.subs.values()) {
      if (!sub.patterns.some((p) => matchesPattern(p, event.event_type))) continue;
      sub.queue.push(delivery);
      this.pump(sub);
      deliveredTo++;
    }
    return { ok: true, event, seq, deliveredTo };
  }

  /** Registers a handler. Returns an unsubscribe function. */
  subscribe(id: string, patterns: string | readonly string[], handler: EventHandler): () => void {
    const list = typeof patterns === "string" ? [patterns] : [...patterns];
    if (this.subs.has(id)) throw new Error(`Subscriber "${id}" already registered`);
    const bad = list.filter((p) => !isValidPattern(p));
    if (list.length === 0 || bad.length > 0) {
      throw new Error(`Invalid subscription pattern(s): ${bad.join(", ") || "(none)"}`);
    }
    const sub: Subscription = {
      id,
      patterns: list,
      handler,
      queue: [],
      running: null,
      active: true,
    };
    this.subs.set(id, sub);
    return () => {
      sub.active = false;
      sub.queue.length = 0;
      this.subs.delete(id);
    };
  }

  /** Resolves when every subscriber queue is empty. */
  async drain(): Promise<void> {
    for (;;) {
      const running = [...this.subs.values()].map((s) => s.running).filter((p) => p !== null);
      if (running.length === 0) return;
      await Promise.all(running);
    }
  }

  /** Rejects further publishes (shutdown). Call drain() first to flush queued deliveries. */
  close(): void {
    this.closed = true;
  }

  metrics(): BusMetrics {
    return {
      ...this.m,
      avgLatencyMs: this.latencyCount === 0 ? 0 : this.latencyTotal / this.latencyCount,
      subscribers: this.subs.size,
    };
  }

  private reject(error: PhoenixError, input: unknown): PublishResult {
    this.m.rejected++;
    const type =
      input && typeof input === "object"
        ? (input as { event_type?: unknown }).event_type
        : undefined;
    this.logger.warn("rejected event", {
      code: error.code,
      event_type: type,
      details: error.details,
    });
    return { ok: false, error };
  }

  private pump(sub: Subscription): void {
    if (sub.running) return;
    sub.running = (async () => {
      // Yield so publish() returns before handlers run.
      await Promise.resolve();
      while (sub.active && sub.queue.length > 0) {
        const delivery = sub.queue.shift()!;
        await this.deliver(sub, delivery);
      }
      sub.running = null;
    })();
  }

  private async deliver(sub: Subscription, d: Delivery): Promise<void> {
    const attempts = d.durable ? this.maxAttempts : 1;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (!sub.active) return;
      try {
        await sub.handler(d.event, { seq: d.seq, ephemeral: !d.durable });
        this.m.delivered++;
        const latency = this.now() - d.publishedAt;
        this.latencyTotal += latency;
        this.latencyCount++;
        this.m.maxLatencyMs = Math.max(this.m.maxLatencyMs, latency);
        return;
      } catch (err) {
        lastError = err;
        this.m.handlerFailures++;
        this.logger.warn("subscriber failed", {
          subscriber: sub.id,
          event_id: d.event.event_id,
          attempt,
          error: err,
        });
        if (attempt < attempts && this.retryDelayMs > 0) await sleep(this.retryDelayMs * attempt);
      }
    }
    if (d.durable) {
      this.m.deadLettered++;
      const message = lastError instanceof Error ? lastError.message : String(lastError);
      this.options.deadLetters?.add(d.event, sub.id, message, attempts);
      this.logger.error("event dead-lettered", { subscriber: sub.id, event_id: d.event.event_id });
    }
  }
}
