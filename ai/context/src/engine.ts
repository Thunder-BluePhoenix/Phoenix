// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Context assembly: lexical retrieval across memory domains for one question.
//
// Order of work: parse the question (topic + time window) → search each domain separately, with
// the permission filter applied INSIDE the search so a forbidden item never occupies a result slot
// or shows up in any count → drop near-duplicates → give every domain its share of the limit →
// fill what is left by score → stop at the token budget.
import {
  MEMORY_DOMAINS,
  buildMatchQuery,
  canView,
  freshnessOf,
  maxSensitivity,
  scopeMatches,
  tokenize,
  type Freshness,
  type MemoryDomain,
  type MemoryItem,
  type MemoryKind,
  type MemoryProvenance,
  type MemoryStore,
  type ScoredMemory,
  type Viewer,
} from "@phoenix/ai-memory";
import type { PrivacyClass } from "@phoenix/ai-models";
import { parseQuestion } from "./question";
import type { Clock, TimeWindow } from "./time";

export interface ContextRequest {
  question: string;
  /** Who is asking. Items outside the viewer's grants are never retrieved. */
  viewer: Viewer;
  /** Only these scope patterns (exact or `prefix*`). Narrows what the viewer may see; never widens. */
  scopes?: readonly string[];
  /** Only these domains. Default: all. */
  domains?: readonly MemoryDomain[];
  /** Most items to return. */
  limit: number;
  /** Most estimated tokens of item text to return. */
  tokenBudget: number;
}

export interface ContextItem {
  id: string;
  text: string;
  domain: MemoryDomain;
  kind: MemoryKind;
  source: string;
  sourceRef: string;
  scope: string;
  provenance: MemoryProvenance;
  /** Negated bm25 (0 for time-only questions); comparable within one bundle. */
  score: number;
  observedAt: string;
  sensitivity: PrivacyClass;
  freshness: Freshness;
}

export interface OmittedCount {
  /** Only "limit", "token_budget" and "near_duplicate". Permission is never a reason. */
  reason: "limit" | "token_budget" | "near_duplicate";
  count: number;
}

export interface ContextBundle {
  items: ContextItem[];
  domainsCovered: MemoryDomain[];
  omitted: OmittedCount[];
  tokensEstimate: number;
  /** Highest sensitivity among the items: what a model request carrying them must be labelled. */
  sensitivity: PrivacyClass;
  /** The time window found in the question, if any. */
  window: TimeWindow | null;
  /** What was searched for, after the time phrase and filler words were removed. */
  topic: string;
}

/** About four characters per token; good enough to bound a prompt without a tokenizer. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Share of words two texts have in common (0..1). */
function overlap(a: Record<string, true>, b: Record<string, true>): number {
  const wordsA = Object.keys(a);
  const wordsB = Object.keys(b);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;
  const shared = wordsA.filter((w) => b[w] === true).length;
  return shared / (wordsA.length + wordsB.length - shared);
}

export const NEAR_DUPLICATE_OVERLAP = 0.85;
/** Candidates fetched per domain, as a multiple of `limit`, so dedupe and quotas have choices. */
const CANDIDATE_FACTOR = 4;

export interface ContextEngineOptions {
  store: MemoryStore;
  clock: Clock;
}

interface Candidate {
  scored: ScoredMemory;
  tokens: number;
  words: Record<string, true>;
}

export class ContextEngine {
  constructor(private readonly options: ContextEngineOptions) {}

  assemble(request: ContextRequest): ContextBundle {
    const { store, clock } = this.options;
    const limit = Math.max(0, Math.floor(request.limit));
    const parsed = parseQuestion(request.question, clock);
    const match = buildMatchQuery(parsed.topicText);
    const scopes = request.scopes;
    const accept = (item: MemoryItem) =>
      canView(request.viewer, item) &&
      (scopes === undefined || scopes.some((s) => scopeMatches(s, item.scope)));
    const omittedCounts = { limit: 0, token_budget: 0, near_duplicate: 0 };

    const perDomain: Candidate[][] = [];
    // Near-duplicates are detected across domains: the same decision may sit in a summary and a doc.
    const accepted: Candidate[] = [];
    for (const domain of request.domains ?? MEMORY_DOMAINS) {
      const query = {
        domain,
        limit: Math.max(1, limit) * CANDIDATE_FACTOR,
        observedFrom: parsed.window?.from,
        observedBefore: parsed.window?.before,
        accept,
      };
      const found = match
        ? store.search({ ...query, match })
        : parsed.window
          ? store.recent(query)
          : [];
      const kept: Candidate[] = [];
      for (const scored of found) {
        const words: Record<string, true> = {};
        for (const w of tokenize(scored.item.text)) words[w] = true;
        if (accepted.some((k) => overlap(k.words, words) >= NEAR_DUPLICATE_OVERLAP)) {
          omittedCounts.near_duplicate++;
          continue;
        }
        const candidate = { scored, tokens: estimateTokens(scored.item.text), words };
        kept.push(candidate);
        accepted.push(candidate);
      }
      if (kept.length > 0) perDomain.push(kept);
    }

    const chosen: Candidate[] = [];
    let tokens = 0;
    const take = (c: Candidate): void => {
      if (tokens + c.tokens > request.tokenBudget) {
        omittedCounts.token_budget++;
        return;
      }
      chosen.push(c);
      tokens += c.tokens;
    };

    // Pass 1: every domain gets its share, so one chatty domain cannot crowd out the others.
    const quota = Math.max(1, Math.floor(limit / Math.max(1, perDomain.length)));
    const leftovers: Candidate[] = [];
    for (const candidates of perDomain) {
      let used = 0;
      for (const c of candidates) {
        if (used < quota && chosen.length < limit) {
          const before = chosen.length;
          take(c);
          if (chosen.length > before) used++;
        } else leftovers.push(c);
      }
    }
    // Pass 2: spare room goes to the best of what is left, whatever its domain.
    leftovers.sort((a, b) => b.scored.score - a.scored.score);
    for (const c of leftovers) {
      if (chosen.length >= limit) omittedCounts.limit++;
      else take(c);
    }

    chosen.sort((a, b) => b.scored.score - a.scored.score);
    const items = chosen.map((c): ContextItem => {
      const item = c.scored.item;
      return {
        id: item.id,
        text: item.text,
        domain: item.domain,
        kind: item.kind,
        source: item.source,
        sourceRef: item.sourceRef,
        scope: item.scope,
        provenance: item.provenance,
        score: c.scored.score,
        observedAt: item.observedAt,
        sensitivity: item.sensitivity,
        freshness: freshnessOf(item, clock.now()),
      };
    });
    const omitted = (Object.keys(omittedCounts) as OmittedCount["reason"][])
      .map((reason) => ({ reason, count: omittedCounts[reason] }))
      .filter((o) => o.count > 0);
    return {
      items,
      domainsCovered: MEMORY_DOMAINS.filter((d) => items.some((i) => i.domain === d)),
      omitted,
      tokensEstimate: tokens,
      sensitivity: maxSensitivity(items.map((i) => i.sensitivity)),
      window: parsed.window,
      topic: parsed.topicText,
    };
  }
}
