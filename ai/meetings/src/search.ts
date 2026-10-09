// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Search and questions over the meeting archive. Both read memory (domain "meeting") through the
// viewer's grants: a meeting the viewer may not see contributes no result, no count and no hint.
// Answers keep stored facts apart from generated interpretation (ai/context) and every fact cites
// its meeting and, for reviewed items, the item id.
import {
  ask,
  type Answer,
  type AnswerFact,
  type ContextEngine,
  type GenerateFn,
} from "@phoenix/ai-context";
import {
  buildMatchQuery,
  canView,
  freshnessOf,
  type Freshness,
  type MemoryItem,
  type MemoryKind,
  type MemoryStore,
  type Viewer,
} from "@phoenix/ai-memory";
import { REVIEW_MEMORY_SOURCE } from "./service";

/** Longest result list. */
export const MAX_SEARCH_RESULTS = 50;
/** Longest question or query read. */
export const MAX_QUERY_CHARS = 500;
const MEETING_SCOPE = "meeting:*";

export interface Citation {
  /** `<capability>:<external id>`. */
  meetingId: string;
  /** The reviewed item this fact came from; null for facts from a Kage summary. */
  itemId: string | null;
  memoryId: string;
}

export interface MeetingHit {
  citation: Citation;
  text: string;
  /** "fact": stored as the source or a reviewer said it. Never a model's interpretation. */
  kind: MemoryKind;
  /** "reviewed": a person accepted it in Phoenix. "kage": taken from Kage's summary, unreviewed. */
  origin: "reviewed" | "kage";
  /** decision | action_item | summary ... */
  part: string;
  observedAt: string;
  freshness: Freshness;
  score: number;
}

export interface MeetingSearchResult {
  query: string;
  hits: MeetingHit[];
  /** Hits the viewer may see (never counts hidden meetings). */
  total: number;
}

export interface MeetingSearchDeps {
  store: MemoryStore;
  now: () => Date;
}

function hitOf(item: MemoryItem, score: number, now: Date): MeetingHit | null {
  const meetingId = item.scope.startsWith("meeting:") ? item.scope.slice("meeting:".length) : null;
  if (meetingId === null) return null;
  const itemId = typeof item.provenance.item_id === "string" ? item.provenance.item_id : null;
  const part = typeof item.provenance.part === "string" ? item.provenance.part : "summary";
  return {
    citation: { meetingId, itemId, memoryId: item.id },
    text: item.text,
    kind: item.kind,
    origin: item.source === REVIEW_MEMORY_SOURCE ? "reviewed" : "kage",
    part,
    observedAt: item.observedAt,
    freshness: freshnessOf(item, now),
    score,
  };
}

/** Lexical search over meeting memories the viewer may see, best match first. */
export function searchMeetings(
  deps: MeetingSearchDeps,
  query: string,
  viewer: Viewer,
  limit = 20,
): MeetingSearchResult {
  const text = query.slice(0, MAX_QUERY_CHARS);
  const match = buildMatchQuery(text);
  if (match === null) return { query: text, hits: [], total: 0 };
  const cap = Math.min(Math.max(1, Math.floor(limit)), MAX_SEARCH_RESULTS);
  const found = deps.store.search({
    match,
    domain: "meeting",
    limit: cap,
    // The permission filter runs inside the search, before the limit, so a hidden meeting can
    // neither fill a slot nor change a count.
    accept: (item) => item.scope.startsWith("meeting:") && canView(viewer, item),
  });
  const hits = found.flatMap((f) => {
    const hit = hitOf(f.item, f.score, deps.now());
    return hit ? [hit] : [];
  });
  return { query: text, hits, total: hits.length };
}

export interface MeetingAnswer {
  question: string;
  answer: Answer;
  /** Stored facts with the meeting (and item) each one came from. */
  citations: { ref: string; text: string; citation: Citation; origin: MeetingHit["origin"] }[];
}

function citationOf(fact: AnswerFact): Citation | null {
  const meetingId = fact.sourceRef;
  if (!meetingId.includes(":")) return null;
  const itemId = typeof fact.provenance.item_id === "string" ? fact.provenance.item_id : null;
  return { meetingId, itemId, memoryId: fact.id };
}

/**
 * Answers a question from meeting memories only (never git, docs or anything else). The facts are
 * the stored text; the interpretation, when a model is available, is labelled and separate. A
 * transcript question always carries the highest sensitivity among its facts, so it stays on
 * this device unless the user opted in.
 */
export async function askAboutMeetings(
  engine: ContextEngine,
  generate: GenerateFn | null,
  question: string,
  viewer: Viewer,
  options: { limit?: number; tokenBudget?: number; nonce?: () => string } = {},
): Promise<MeetingAnswer> {
  const text = question.slice(0, MAX_QUERY_CHARS);
  const answer = await ask(
    {
      question: text,
      viewer,
      domains: ["meeting"],
      scopes: [MEETING_SCOPE],
      limit: options.limit ?? 8,
      tokenBudget: options.tokenBudget ?? 1500,
    },
    { generate, engine, ...(options.nonce ? { nonce: options.nonce } : {}) },
  );
  const citations = answer.facts.flatMap((fact) => {
    const citation = citationOf(fact);
    return citation
      ? [
          {
            ref: fact.ref,
            text: fact.text,
            citation,
            origin:
              fact.source === REVIEW_MEMORY_SOURCE ? ("reviewed" as const) : ("kage" as const),
          },
        ]
      : [];
  });
  return { question: text, answer, citations };
}
