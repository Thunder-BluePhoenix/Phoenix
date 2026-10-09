// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Hybrid retrieval: lexical (MemoryStore.search, bm25) and vector candidates, fused with
// reciprocal-rank fusion, optionally reranked, then assembled into a grounded, cited bundle.
//
// Order of work, and why it is this order:
//   1. The permission filter (`canView` + optional scope narrowing) is built first and handed to
//      BOTH candidate searches, where it runs on each row BEFORE the row is scored or counted.
//      A forbidden item therefore cannot influence a rank, a count, a fusion score, the reranker
//      prompt or the output. Items loaded by id for the vector hits are checked again.
//   2. Reciprocal-rank fusion: score(d) = Σ_list weight_list / (k + rank_list(d)), rank from 1,
//      k = 60 by default (the constant from Cormack et al. 2009). RRF uses ranks only, so bm25
//      scores and cosine similarities never need to be put on one scale.
//   3. The reranker reorders the top `rerankDepth` candidates only.
//   4. Assembly: near-duplicates are dropped, the limit and the token budget are applied, and
//      each item carries its citation (id, source, sourceRef) and its kind (fact | interpretation).
import {
  buildMatchQuery,
  canView,
  freshnessOf,
  maxSensitivity,
  scopeMatches,
  tokenize,
  type MemoryDomain,
  type MemoryItem,
  type MemoryStore,
  type Viewer,
} from "@phoenix/ai-memory";
import {
  NEAR_DUPLICATE_OVERLAP,
  estimateTokens,
  parseQuestion,
  type Clock,
  type ParsedQuestion,
  type ContextBundle,
  type ContextItem,
  type OmittedCount,
} from "@phoenix/ai-context";
import type { PrivacyClass } from "@phoenix/ai-models";
import {
  DEGRADED_TEXT,
  classifyEmbedFailure,
  type Embedder,
  type EmbeddingDegradedReason,
} from "./embedder";
import type { Reranker, RerankCandidate } from "./rerank";
import { VectorError, type VectorSearchResult, type VectorStore } from "./vectors";

export type RetrievalMode = "hybrid" | "lexical" | "vector";

/** Why vector candidates were not used, beyond the embedding reasons. */
export type VectorSkipReason =
  | EmbeddingDegradedReason
  | "index_empty"
  | "not_requested"
  | "no_embedder"
  | "unusable_query_vector";

export interface RetrievalRequest {
  query: string;
  /** Who is asking. Items outside the viewer's grants never enter any stage. */
  viewer: Viewer;
  /** Only these scope patterns. Narrows what the viewer may see; never widens. */
  scopes?: readonly string[];
  domains?: readonly MemoryDomain[];
  /** Most items to return. */
  limit: number;
  /** Most estimated tokens of item text to return. Default: unbounded. */
  tokenBudget?: number;
  /** Default "hybrid". "lexical" and "vector" exist for evaluation and for degraded operation. */
  mode?: RetrievalMode;
  /** Run the configured reranker. Default true when one is configured. */
  rerank?: boolean;
  /**
   * Data class of the query text, for the embedding router. Default "internal": a query is the
   * user's own words about their work, but never sent to a provider that is not allowed internal
   * data. Sensitive text never reaches a cloud provider for this purpose in any case.
   */
  queryPrivacy?: PrivacyClass;
  signal?: AbortSignal;
}

export interface Citation {
  memoryId: string;
  source: string;
  sourceRef: string;
  scope: string;
  observedAt: string;
}

export interface RetrievedItem extends ContextItem {
  citation: Citation;
  /** 1-based rank in each candidate list; absent when the list did not contain the item. */
  lexicalRank?: number;
  vectorRank?: number;
  /** Cosine similarity of the vector hit. */
  similarity?: number;
  /** Reciprocal-rank-fusion score. */
  fused: number;
  /** Reranker score; absent when the item was outside the reranked depth or no reranker ran. */
  rerankScore?: number;
}

export interface RetrievalReport {
  mode: RetrievalMode;
  /** Candidates each list contributed, AFTER the permission filter. */
  lexicalCandidates: number;
  vectorCandidates: number;
  /** Set when vector retrieval was wanted but not used; retrieval then ran on keywords alone. */
  vectorSkipped: { reason: VectorSkipReason; detail: string } | null;
  reranker: string | null;
  /** Set when a reranker was configured but did not reorder (it returned nothing). */
  rerankSkipped: string | null;
  /** True when the vector scan stopped at its cap. */
  vectorTruncated: boolean;
}

export interface RetrievalResult {
  items: RetrievedItem[];
  /** The same items as a context bundle, so answerFromContext/buildAskMessages work unchanged. */
  bundle: ContextBundle;
  report: RetrievalReport;
}

export interface RetrieverOptions {
  store: MemoryStore;
  vectors: VectorStore;
  /** null = no embedder: retrieval is lexical-only and says so. */
  embedder: Embedder | null;
  reranker?: Reranker | null;
  clock: Clock;
  /** RRF constant. Default DEFAULT_RRF_K. */
  k?: number;
  lexicalWeight?: number;
  vectorWeight?: number;
  /** Candidates taken from each list. Default 50. */
  candidatePool?: number;
  /** Fused candidates handed to the reranker. Default 20. */
  rerankDepth?: number;
  /** Vector hits below this cosine similarity are dropped. Default 0. */
  minSimilarity?: number;
  maxScan?: number;
}

/** Cormack, Clarke & Buettcher (2009) found 60 works well without tuning. */
export const DEFAULT_RRF_K = 60;

interface Fusing {
  item: MemoryItem;
  lexicalRank?: number;
  vectorRank?: number;
  similarity?: number;
  fused: number;
  rerankScore?: number;
}

/** Share of words two texts have in common (0..1). */
function wordOverlap(a: Record<string, true>, b: Record<string, true>): number {
  const wordsA = Object.keys(a);
  const wordsB = Object.keys(b);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;
  const shared = wordsA.filter((w) => b[w] === true).length;
  return shared / (wordsA.length + wordsB.length - shared);
}

export class Retriever {
  private readonly k: number;
  private readonly lexicalWeight: number;
  private readonly vectorWeight: number;
  private readonly pool: number;
  private readonly depth: number;

  constructor(private readonly options: RetrieverOptions) {
    this.k = options.k ?? DEFAULT_RRF_K;
    this.lexicalWeight = options.lexicalWeight ?? 1;
    this.vectorWeight = options.vectorWeight ?? 1;
    this.pool = Math.max(1, Math.floor(options.candidatePool ?? 50));
    this.depth = Math.max(1, Math.floor(options.rerankDepth ?? 20));
  }

  async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
    const { store, clock } = this.options;
    const mode = request.mode ?? "hybrid";
    const limit = Math.max(0, Math.floor(request.limit));
    const parsed = parseQuestion(request.query, clock);
    const scopes = request.scopes;
    const domains = request.domains;
    // The one permission predicate. Every candidate source below receives it unchanged.
    const accept = (item: Pick<MemoryItem, "scope" | "domain" | "sensitivity">): boolean =>
      canView(request.viewer, item) &&
      (scopes === undefined || scopes.some((s) => scopeMatches(s, item.scope))) &&
      (domains === undefined || domains.includes(item.domain));
    const window = { observedFrom: parsed.window?.from, observedBefore: parsed.window?.before };

    const fusing: Record<string, Fusing> = {};
    const report: RetrievalReport = {
      mode,
      lexicalCandidates: 0,
      vectorCandidates: 0,
      vectorSkipped: null,
      reranker: null,
      rerankSkipped: null,
      vectorTruncated: false,
    };

    if (mode !== "vector") {
      const match = buildMatchQuery(parsed.topicText);
      const found = match
        ? store.search({ match, ...window, limit: this.pool, accept })
        : parsed.window
          ? store.recent({ ...window, limit: this.pool, accept })
          : [];
      found.forEach((s, i) => {
        fusing[s.item.id] = {
          item: s.item,
          lexicalRank: i + 1,
          fused: (match ? this.lexicalWeight : 0) / (this.k + i + 1),
        };
      });
      report.lexicalCandidates = found.length;
    }

    if (mode !== "lexical") {
      const skipped = await this.addVectorCandidates(
        request,
        parsed.topicText,
        window,
        accept,
        fusing,
        report,
      );
      if (skipped) {
        report.vectorSkipped = { reason: skipped, detail: skipDetail(skipped) };
        // A vector-only request that cannot use vectors still answers, from keywords, and says so.
        if (mode === "vector") {
          report.mode = "lexical";
          const match = buildMatchQuery(parsed.topicText);
          const found = match ? store.search({ match, ...window, limit: this.pool, accept }) : [];
          found.forEach((s, i) => {
            fusing[s.item.id] = { item: s.item, lexicalRank: i + 1, fused: 1 / (this.k + i + 1) };
          });
          report.lexicalCandidates = found.length;
        }
      }
    }

    // Array.sort is stable, so equal scores keep the order they were found in.
    let ranked = Object.values(fusing).sort((a, b) => b.fused - a.fused);
    ranked = await this.rerank(request, parsed.topicText, ranked, report);
    return this.assemble(request, parsed, ranked, report, limit);
  }

  private async addVectorCandidates(
    request: RetrievalRequest,
    topic: string,
    window: { observedFrom?: string; observedBefore?: string },
    accept: (item: Pick<MemoryItem, "scope" | "domain" | "sensitivity">) => boolean,
    fusing: Record<string, Fusing>,
    report: RetrievalReport,
  ): Promise<VectorSkipReason | null> {
    const { embedder, vectors, store } = this.options;
    if (embedder === null) return "no_embedder";
    if (topic.trim().length === 0) return "not_requested";
    if (vectors.count(embedder.modelKey) === 0) return "index_empty";
    let query: number[];
    try {
      query = await embedder.embedQuery(topic, request.queryPrivacy ?? "internal", request.signal);
    } catch (err) {
      const failure = classifyEmbedFailure(err);
      if (failure === null) throw err;
      return failure.reason;
    }
    let result: VectorSearchResult;
    try {
      result = vectors.search(embedder.modelKey, query, {
        ...window,
        limit: this.pool,
        accept,
        maxScan: this.options.maxScan,
        minSimilarity: this.options.minSimilarity ?? 0,
      });
    } catch (err) {
      // A zero, non-finite or wrong-width query vector: the model misbehaved, the query still answers.
      if (err instanceof VectorError) return "unusable_query_vector";
      throw err;
    }
    report.vectorTruncated = result.truncated;
    let rank = 0;
    for (const hit of result.hits) {
      const item = store.get(hit.memoryId);
      // Defence in depth: the search already filtered, but the item is re-checked on load.
      if (item === null || item.deletedAt !== null || !accept(item)) continue;
      rank++;
      const gain = this.vectorWeight / (this.k + rank);
      const existing = fusing[item.id];
      if (existing) {
        existing.vectorRank = rank;
        existing.similarity = hit.similarity;
        existing.fused += gain;
      } else {
        fusing[item.id] = { item, vectorRank: rank, similarity: hit.similarity, fused: gain };
      }
    }
    report.vectorCandidates = rank;
    return null;
  }

  private async rerank(
    request: RetrievalRequest,
    topic: string,
    ranked: Fusing[],
    report: RetrievalReport,
  ): Promise<Fusing[]> {
    const reranker = this.options.reranker ?? null;
    if (reranker === null || request.rerank === false || ranked.length < 2) return ranked;
    report.reranker = reranker.name;
    const head = ranked.slice(0, this.depth);
    const candidates: RerankCandidate[] = head.map((r) => ({ item: r.item, fused: r.fused }));
    const scores = await reranker.rerank({
      query: topic,
      candidates,
      now: this.options.clock.now(),
      signal: request.signal,
    });
    if (scores === null) {
      report.rerankSkipped = `${reranker.name} reranker returned nothing; retrieval order kept`;
      return ranked;
    }
    const scored = head.filter((r) => scores[r.item.id] !== undefined);
    for (const r of scored) r.rerankScore = scores[r.item.id];
    // Stable: equal scores keep their fused order.
    scored.sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0));
    const unscored = head.filter((r) => scores[r.item.id] === undefined);
    return [...scored, ...unscored, ...ranked.slice(this.depth)];
  }

  private assemble(
    request: RetrievalRequest,
    parsed: ParsedQuestion,
    ranked: Fusing[],
    report: RetrievalReport,
    limit: number,
  ): RetrievalResult {
    const budget = request.tokenBudget ?? Number.POSITIVE_INFINITY;
    const omitted = { limit: 0, token_budget: 0, near_duplicate: 0 };
    const kept: { fusing: Fusing; words: Record<string, true> }[] = [];
    let tokens = 0;
    for (const f of ranked) {
      const words: Record<string, true> = {};
      for (const w of tokenize(f.item.text)) words[w] = true;
      if (kept.some((k) => wordOverlap(k.words, words) >= NEAR_DUPLICATE_OVERLAP)) {
        omitted.near_duplicate++;
        continue;
      }
      if (kept.length >= limit) {
        omitted.limit++;
        continue;
      }
      const cost = estimateTokens(f.item.text);
      if (tokens + cost > budget) {
        omitted.token_budget++;
        continue;
      }
      kept.push({ fusing: f, words });
      tokens += cost;
    }
    const now = this.options.clock.now();
    const items = kept.map(({ fusing: f }): RetrievedItem => {
      const item = f.item;
      return {
        id: item.id,
        text: item.text,
        domain: item.domain,
        kind: item.kind,
        source: item.source,
        sourceRef: item.sourceRef,
        scope: item.scope,
        provenance: item.provenance,
        score: f.rerankScore ?? f.fused,
        observedAt: item.observedAt,
        sensitivity: item.sensitivity,
        freshness: freshnessOf(item, now),
        citation: {
          memoryId: item.id,
          source: item.source,
          sourceRef: item.sourceRef,
          scope: item.scope,
          observedAt: item.observedAt,
        },
        lexicalRank: f.lexicalRank,
        vectorRank: f.vectorRank,
        similarity: f.similarity,
        fused: f.fused,
        rerankScore: f.rerankScore,
      };
    });
    const omittedList = (Object.keys(omitted) as OmittedCount["reason"][])
      .map((reason) => ({ reason, count: omitted[reason] }))
      .filter((o) => o.count > 0);
    const bundle: ContextBundle = {
      items,
      domainsCovered: [...new Set(items.map((i) => i.domain))].sort(),
      omitted: omittedList,
      tokensEstimate: tokens,
      sensitivity: maxSensitivity(items.map((i) => i.sensitivity)),
      window: parsed.window,
      topic: parsed.topicText,
    };
    return { items, bundle, report };
  }
}

function skipDetail(reason: VectorSkipReason): string {
  switch (reason) {
    case "index_empty":
      return "No memories are embedded yet for the active model, so search is keyword-only.";
    case "unusable_query_vector":
      return "The embedding model gave an unusable vector for this question, so search is keyword-only.";
    case "no_embedder":
      return "No embedding model is configured, so search is keyword-only.";
    case "not_requested":
      return "The question has no searchable topic for the vector index.";
    default:
      return DEGRADED_TEXT[reason];
  }
}
