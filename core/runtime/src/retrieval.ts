// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Hybrid retrieval inside Core (Phase 37 wiring).
//
// OFF by default, like all AI: with `retrieval.enabled` false, or AI itself off, nothing is embedded
// and search/ask run exactly the Phase 28 lexical path. When on, memories are embedded in the
// background (bounded, incremental, single-flight) through `AiService`, and search/ask fuse bm25
// with the vector scan using the dev-tuned values from the phase doc (k = 20, vector weight 0.5)
// and the deterministic feature reranker. The model reranker is not offered: it did not help.
// Every candidate passes the viewer's `canView` inside both searches.
import { ContextEngine, type ContextBundle, type ContextEngineOptions } from "@phoenix/ai-context";
import {
  canView,
  freshnessOf,
  type MemoryItem,
  type MemoryStore,
  type Viewer,
} from "@phoenix/ai-memory";
import type { AiService } from "@phoenix/ai-models";
import {
  AiEmbedder,
  FeatureReranker,
  Retriever,
  VectorIndexer,
  VectorStore,
  type IndexReport,
} from "@phoenix/ai-retrieval";
import { REVIEW_MEMORY_SOURCE, type MeetingHit } from "@phoenix/ai-meetings";
import type {
  RetrievalApi,
  RetrievalInfoView,
  RetrievalSettingsView,
  RetrievalStatusView,
} from "@phoenix/api";
import type { Logger } from "@phoenix/logging";
import type { AuditLog } from "@phoenix/permissions";
import type { Database, SettingsStore } from "@phoenix/persistence";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";

const SETTINGS_KEY = "retrieval.settings";
/** Dev-tuned values from the Phase 37 benchmark; see the phase doc for the caveats. */
export const DEFAULT_RETRIEVAL_SETTINGS: RetrievalSettingsView = {
  enabled: false,
  provider: "ollama",
  model: "nomic-embed-text",
  k: 20,
  vector_weight: 0.5,
  reranker: "feature",
};
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
const SETTING_KEYS = ["enabled", "provider", "model", "k", "vector_weight", "reranker"] as const;
/** Embedding runs one call can make before it hands back (256 items each). */
const MAX_RUNS_PER_TRIGGER = 40;
/** nomic-embed-text wants these prefixes; other models get none. */
const NOMIC_PREFIXES = { documentPrefix: "search_document: ", queryPrefix: "search_query: " };
/** Queries are always labelled sensitive so a question never leaves the device. */
const QUERY_PRIVACY = "sensitive" as const;

const invalid = (message: string) => new PhoenixError(ErrorCode.INVALID_REQUEST, message);

interface LastRun {
  at: string;
  embedded: number;
  failed: number;
  remaining: number;
  capped: boolean;
  degraded: string[];
}

export interface RetrievalDeps {
  db: Database;
  store: MemoryStore;
  settings: SettingsStore;
  ai: AiService;
  /** Providers able to embed, by id. */
  embeddingProviders: () => readonly string[];
  aiEnabled: () => boolean;
  audit: AuditLog;
  logger: Logger;
  now?: () => Date;
}

export type MemoryHit = { item: MemoryItem; score: number };

/** A bundle already assembled by the hybrid retriever, handed to `ask` as if it were the engine. */
class PreparedEngine extends ContextEngine {
  constructor(
    options: ContextEngineOptions,
    private readonly bundle: ContextBundle,
  ) {
    super(options);
  }
  override assemble(): ContextBundle {
    return this.bundle;
  }
}

export class RetrievalRuntime implements RetrievalApi {
  readonly vectors: VectorStore;
  private readonly now: () => Date;
  private indexer: { key: string; indexer: VectorIndexer } | null = null;
  private running: Promise<IndexReport | null> | null = null;
  private lastRun: LastRun | null = null;
  private closed = false;

  constructor(private readonly d: RetrievalDeps) {
    this.now = d.now ?? (() => new Date());
    this.vectors = new VectorStore(d.db, { now: this.now });
  }

  // ── Settings ───────────────────────────────────────────────────────────────

  settings(): RetrievalSettingsView {
    const stored = this.d.settings.get<Partial<RetrievalSettingsView> | null>(SETTINGS_KEY, null);
    const base = DEFAULT_RETRIEVAL_SETTINGS;
    if (stored === null || typeof stored !== "object") return { ...base };
    return {
      enabled: stored.enabled === true,
      provider: typeof stored.provider === "string" ? stored.provider : base.provider,
      model: typeof stored.model === "string" ? stored.model : base.model,
      k: typeof stored.k === "number" && stored.k >= 1 ? stored.k : base.k,
      vector_weight:
        typeof stored.vector_weight === "number" && stored.vector_weight >= 0
          ? stored.vector_weight
          : base.vector_weight,
      reranker: stored.reranker === "none" ? "none" : "feature",
    };
  }

  setSettings(input: unknown): RetrievalSettingsView {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw invalid("Retrieval settings must be an object");
    }
    const next = this.settings();
    for (const [key, value] of Object.entries(input)) {
      if (!(SETTING_KEYS as readonly string[]).includes(key)) {
        throw invalid(`Unknown retrieval setting "${key.slice(0, 40)}"`);
      }
      if (key === "enabled") {
        if (typeof value !== "boolean") throw invalid('"enabled" must be a boolean');
        next.enabled = value;
      } else if (key === "provider") {
        if (typeof value !== "string" || !this.d.embeddingProviders().includes(value)) {
          throw invalid('"provider" must be the id of an AI provider that can embed text');
        }
        next.provider = value;
      } else if (key === "model") {
        if (typeof value !== "string" || !MODEL_NAME.test(value)) {
          throw invalid('"model" must be a model name of 1-100 plain characters');
        }
        next.model = value;
      } else if (key === "k") {
        if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 200) {
          throw invalid('"k" must be a whole number from 1 to 200');
        }
        next.k = value;
      } else if (key === "vector_weight") {
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 5) {
          throw invalid('"vector_weight" must be a number from 0 to 5');
        }
        next.vector_weight = value;
      } else {
        if (value !== "feature" && value !== "none") {
          throw invalid('"reranker" must be "feature" or "none"');
        }
        next.reranker = value;
      }
    }
    const before = this.settings();
    this.d.settings.set(SETTINGS_KEY, next);
    this.d.audit.record({
      actor: "user",
      action: "retrieval.settings.changed",
      decision: "info",
      details: { ...next },
    });
    if (next.enabled && (!before.enabled || before.model !== next.model)) void this.index();
    return next;
  }

  // ── Mode ───────────────────────────────────────────────────────────────────

  /** Why the vector index is not used right now, or null when it is. */
  private inactiveReason(): string | null {
    if (!this.settings().enabled) return "retrieval_disabled";
    if (!this.d.aiEnabled()) return "ai_disabled";
    return null;
  }

  lexicalInfo(): RetrievalInfoView {
    const reason = this.inactiveReason();
    return { mode: "lexical", ...(reason && reason !== "retrieval_disabled" ? { vector_skipped_reason: reason } : {}) };
  }

  private embedder(s: RetrievalSettingsView): AiEmbedder {
    return new AiEmbedder(this.d.ai, {
      provider: s.provider,
      model: s.model,
      ...(s.model.startsWith("nomic-embed") ? NOMIC_PREFIXES : {}),
      timeoutMs: 60_000,
    });
  }

  private retriever(s: RetrievalSettingsView): Retriever {
    return new Retriever({
      store: this.d.store,
      vectors: this.vectors,
      embedder: this.embedder(s),
      reranker: s.reranker === "feature" ? new FeatureReranker() : null,
      clock: { now: this.now, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      k: s.k,
      vectorWeight: s.vector_weight,
    });
  }

  private infoOf(report: {
    vectorSkipped: { reason: string } | null;
    vectorTruncated: boolean;
  }): RetrievalInfoView {
    return {
      mode: report.vectorSkipped ? "lexical" : "hybrid",
      ...(report.vectorSkipped ? { vector_skipped_reason: report.vectorSkipped.reason } : {}),
      ...(report.vectorTruncated ? { truncated: true } : {}),
    };
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  /** Hybrid search of memory; `null` hits mean the caller should use the lexical path. */
  async searchMemory(request: {
    text: string;
    viewer: Viewer;
    domain?: string;
    limit: number;
  }): Promise<{ hits: MemoryHit[] | null; info: RetrievalInfoView }> {
    if (this.inactiveReason() !== null) return { hits: null, info: this.lexicalInfo() };
    const result = await this.retriever(this.settings()).retrieve({
      query: request.text,
      viewer: request.viewer,
      ...(request.domain ? { domains: [request.domain as MemoryItem["domain"]] } : {}),
      limit: request.limit,
      queryPrivacy: QUERY_PRIVACY,
    });
    const hits = result.items.flatMap((i) => {
      const item = this.d.store.get(i.id);
      return item ? [{ item, score: i.score }] : [];
    });
    return { hits, info: this.infoOf(result.report) };
  }

  /** The engine `ask` should use: a prepared hybrid bundle, or null for the lexical engine. */
  async preparedEngine(request: {
    question: string;
    viewer: Viewer;
    domains?: readonly MemoryItem["domain"][];
    scopes?: readonly string[];
    limit: number;
    tokenBudget: number;
  }): Promise<{ engine: ContextEngine | null; info: RetrievalInfoView }> {
    if (this.inactiveReason() !== null) return { engine: null, info: this.lexicalInfo() };
    const result = await this.retriever(this.settings()).retrieve({
      query: request.question,
      viewer: request.viewer,
      ...(request.domains ? { domains: request.domains } : {}),
      ...(request.scopes ? { scopes: request.scopes } : {}),
      limit: request.limit,
      tokenBudget: request.tokenBudget,
      queryPrivacy: QUERY_PRIVACY,
    });
    const engine = new PreparedEngine(
      { store: this.d.store, clock: { now: this.now, timeZone: "UTC" } },
      result.bundle,
    );
    return { engine, info: this.infoOf(result.report) };
  }

  /** Hybrid search of meeting memories, or `lexical` when the caller must use the Phase 35 search. */
  async searchMeetings(
    query: string,
    viewer: Viewer,
    limit: number,
  ): Promise<
    | { kind: "lexical"; info: RetrievalInfoView }
    | { kind: "hybrid"; hits: MeetingHit[]; info: RetrievalInfoView }
  > {
    if (this.inactiveReason() !== null) return { kind: "lexical", info: this.lexicalInfo() };
    const result = await this.retriever(this.settings()).retrieve({
      query: query.slice(0, 500),
      viewer,
      domains: ["meeting"],
      scopes: ["meeting:*"],
      limit,
      queryPrivacy: QUERY_PRIVACY,
    });
    const now = this.now();
    const hits = result.items.flatMap((i): MeetingHit[] => {
      const item = this.d.store.get(i.id);
      if (!item || !item.scope.startsWith("meeting:") || !canView(viewer, item)) return [];
      const itemId = typeof item.provenance.item_id === "string" ? item.provenance.item_id : null;
      const part = typeof item.provenance.part === "string" ? item.provenance.part : "summary";
      return [
        {
          citation: {
            meetingId: item.scope.slice("meeting:".length),
            itemId,
            memoryId: item.id,
          },
          text: item.text,
          kind: item.kind,
          origin: item.source === REVIEW_MEMORY_SOURCE ? "reviewed" : "kage",
          part,
          observedAt: item.observedAt,
          freshness: freshnessOf(item, now),
          score: i.score,
        },
      ];
    });
    return { kind: "hybrid", hits, info: this.infoOf(result.report) };
  }

  // ── Indexing ───────────────────────────────────────────────────────────────

  private indexerFor(s: RetrievalSettingsView): VectorIndexer {
    const embedder = this.embedder(s);
    if (this.indexer?.key !== embedder.modelKey) {
      this.indexer = {
        key: embedder.modelKey,
        indexer: new VectorIndexer({ vectors: this.vectors, embedder, minIntervalMs: 0 }),
      };
    }
    return this.indexer.indexer;
  }

  /**
   * Embeds what is missing, a bounded number of runs, one caller at a time. Does nothing (null)
   * while retrieval or AI is off. Never throws for provider problems; they show in `status()`.
   */
  index(): Promise<IndexReport | null> {
    this.running ??= this.runIndex().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runIndex(): Promise<IndexReport | null> {
    if (this.closed || this.inactiveReason() !== null) return null;
    const indexer = this.indexerFor(this.settings());
    let report: IndexReport | null = null;
    let embedded = 0;
    let failed = 0;
    try {
      for (let run = 0; run < MAX_RUNS_PER_TRIGGER && !this.closed; run++) {
        report = await indexer.run();
        embedded += report.embedded;
        failed += report.failed;
        if (!report.capped || report.degraded.length > 0 || report.embedded === 0) break;
      }
    } catch (err) {
      this.d.logger.warn("retrieval: indexing failed", { error: (err as Error).message });
      return null;
    }
    if (report) {
      this.lastRun = {
        at: this.now().toISOString(),
        embedded,
        failed,
        remaining: report.remaining,
        capped: report.capped,
        degraded: report.degraded.map((x) => x.reason),
      };
    }
    return report;
  }

  /** Resolves when the index run in progress (if any) has finished. */
  async settled(): Promise<void> {
    await this.running?.catch(() => undefined);
  }

  close(): Promise<void> {
    this.closed = true;
    return this.settled();
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  status(): RetrievalStatusView {
    const s = this.settings();
    const key = this.embedder(s).modelKey;
    const reason = this.inactiveReason();
    return {
      enabled: s.enabled,
      active: reason === null,
      inactive_reason: reason,
      provider: s.provider,
      model: s.model,
      vector_space: key,
      embedded: this.vectors.count(key),
      total: this.vectors.liveCount(),
      unembedded: this.vectors.unembeddedCount(key),
      failures: this.vectors.failures(key).length,
      other_models: this.vectors
        .models()
        .filter((m) => m.model !== key)
        .map((m) => ({ model: m.model, vectors: m.count })),
      payload_bytes: this.vectors.payloadBytes(),
      last_run: this.lastRun,
    };
  }
}
