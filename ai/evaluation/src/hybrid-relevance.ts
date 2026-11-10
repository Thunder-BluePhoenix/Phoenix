// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Hybrid relevance check (Phase 33 x Phase 37). The offline `bench-retrieval-relevance` scenario
// measures lexical retrieval over six docs. This runs the Phase 37 hybrid retriever (bm25 + vector,
// fused with reciprocal-rank fusion) over the SAME six docs, with queries that paraphrase a doc
// without sharing a keyword with it (where vector similarity should help), and scores both the
// lexical-only and the hybrid ranking with the same relevance metric (`evaluateRetrieval`).
//
// Two embedders drive it:
//   - FakeParaphraseEmbedder: a fixed table mapping each doc and its paraphrase queries to near
//     vectors. Deterministic, runs in CI, and proves the harness wiring only (not embedding quality).
//   - ollamaRelevanceEmbedder: the loopback-only Ollama adapter with nomic-embed-text. Used only by
//     test/real-hybrid-relevance.test.ts, which runs when PHOENIX_REAL_OLLAMA is set (a release check).
import { type Clock } from "@phoenix/ai-context";
import { MemoryPipeline, MemoryStore, createDefaultPolicy, ownerViewer } from "@phoenix/ai-memory";
import { AiService, OllamaProvider, ProviderRegistry, type AiSettings } from "@phoenix/ai-models";
import {
  AiEmbedder,
  Retriever,
  VectorIndexer,
  VectorStore,
  evaluateRetrieval,
  sliceByKind,
  sourceKey,
  type Embedder,
  type EvalQuery,
  type IndexReport,
  type RetrievalEvaluation,
  type RetrievalMode,
} from "@phoenix/ai-retrieval";
import { openDatabase } from "@phoenix/persistence";
import { RELEVANCE_DOCS, RELEVANCE_EXACT_QUERIES } from "./scenarios/benchmark";

/** The embedding model the real run uses. */
export const HYBRID_EMBED_MODEL = "nomic-embed-text";

/** Metric depth: the same k as the lexical scenario. */
export const HYBRID_K = 3;

/**
 * Queries that paraphrase one doc each and share no content word with it (after stop-word removal
 * and the porter stemmer), so lexical search returns nothing for them. The harness test asserts that.
 */
export const PARAPHRASE_QUERIES: readonly EvalQuery[] = [
  {
    id: "p1",
    kind: "paraphrase",
    query: "what open source terms govern this software",
    relevant: ["project-docs:doc-license"],
  },
  {
    id: "p2",
    kind: "paraphrase",
    query: "which component asks for consent prior to any modification",
    relevant: ["project-docs:doc-gateway"],
  },
  {
    id: "p3",
    kind: "paraphrase",
    query: "how do I halt everything immediately in a crisis",
    relevant: ["project-docs:doc-killswitch"],
  },
  {
    id: "p4",
    kind: "paraphrase",
    query: "how long are recorded conversations kept",
    relevant: ["project-docs:doc-retention"],
  },
  {
    id: "p5",
    kind: "paraphrase",
    query: "does the language model stay on this machine",
    relevant: ["project-docs:doc-ollama"],
  },
  {
    id: "p6",
    kind: "paraphrase",
    query: "is there a tamper-evident history of rulings",
    relevant: ["project-docs:doc-audit"],
  },
];

/** The five keyword queries of the lexical scenario (unchanged) plus the paraphrases. */
export const HYBRID_QUERIES: readonly EvalQuery[] = [
  ...RELEVANCE_EXACT_QUERIES.map((q) => ({ ...q, kind: "exact" })),
  ...PARAPHRASE_QUERIES,
];

const NOW = new Date("2026-10-08T12:00:00.000Z");
const CLOCK: Clock = { now: () => NOW, timeZone: "UTC" };

/** The fixed table: one concept per doc, with the paraphrase query that means the same thing. */
const FAKE_TABLE: readonly { concept: number; doc: string; paraphrase: string }[] = [
  { concept: 0, doc: "doc-license", paraphrase: "p1" },
  { concept: 1, doc: "doc-gateway", paraphrase: "p2" },
  { concept: 2, doc: "doc-killswitch", paraphrase: "p3" },
  { concept: 3, doc: "doc-retention", paraphrase: "p4" },
  { concept: 4, doc: "doc-ollama", paraphrase: "p5" },
  { concept: 5, doc: "doc-audit", paraphrase: "p6" },
];
const FAKE_DIM = 8;
const FAKE_UNKNOWN = 7;

function buildFakeConcepts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of FAKE_TABLE) {
    const doc = RELEVANCE_DOCS.find((d) => d.key === row.doc);
    const para = PARAPHRASE_QUERIES.find((q) => q.id === row.paraphrase);
    const exact = RELEVANCE_EXACT_QUERIES.filter(
      (q) => q.relevant[0] === `project-docs:${row.doc}`,
    );
    if (!doc || !para)
      throw new Error(`fake embedder table names a missing doc or query: ${row.doc}`);
    out[doc.text] = row.concept;
    out[para.query] = row.concept;
    for (const q of exact) out[q.query] = row.concept;
  }
  return out;
}

/**
 * A deterministic stand-in for an embedding model. A doc and every query that means the same thing
 * map to NEAR vectors (cosine about 0.98); a different concept is far (about 0.2 at most); a text
 * outside the table gets its own unit vector. It says nothing about how good a real model is.
 */
export class FakeParaphraseEmbedder implements Embedder {
  readonly modelKey = ["fake", "paraphrase-table"].join("/");
  private readonly concepts = buildFakeConcepts();

  private vec(text: string, query: boolean): number[] {
    const v = Array.from({ length: FAKE_DIM }, (): number => 0);
    const concept = this.concepts[text];
    if (concept === undefined) {
      v[FAKE_UNKNOWN] = 1;
      return v;
    }
    v[concept] = 1;
    // A query sits close to, not on, its doc.
    if (query) v[(concept + 1) % FAKE_TABLE.length] = 0.2;
    return v;
  }

  embedDocuments(texts: readonly string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((t) => this.vec(t, false)));
  }

  embedQuery(text: string): Promise<number[]> {
    return Promise.resolve(this.vec(text, true));
  }
}

/**
 * The real embedder: nomic-embed-text through the Ollama adapter, which accepts only a loopback
 * address and refuses a model that forwards to a remote host. Cloud is never opted in.
 */
export function ollamaRelevanceEmbedder(): Embedder {
  const settings: AiSettings = {
    enabled: true,
    cloudOptIn: { public: false, internal: false, sensitive: false },
  };
  const registry = new ProviderRegistry();
  registry.register(new OllamaProvider({ generateTimeoutMs: 120_000 }));
  const ai = new AiService({
    registry,
    policy: { allowed: () => false },
    settings: () => settings,
  });
  return new AiEmbedder(ai, {
    provider: "ollama",
    model: HYBRID_EMBED_MODEL,
    documentPrefix: "search_document: ",
    queryPrefix: "search_query: ",
    timeoutMs: 120_000,
  });
}

export interface HybridRelevanceResult {
  k: number;
  embedderKey: string;
  indexed: IndexReport;
  /** Query ids for which the vector leg did not run (embedding failed or the index was empty). */
  vectorSkipped: string[];
  lexical: RetrievalEvaluation;
  hybrid: RetrievalEvaluation;
  /** The same two rankings restricted to one query kind. */
  byKind: Record<string, { lexical: RetrievalEvaluation; hybrid: RetrievalEvaluation }>;
}

/**
 * Seeds the six docs exactly like the lexical scenario, indexes them with `embedder`, then scores
 * the lexical-only and the hybrid ranking over `queries` with the shared relevance metric.
 */
export async function runHybridRelevance(
  embedder: Embedder,
  options: { queries?: readonly EvalQuery[]; k?: number } = {},
): Promise<HybridRelevanceResult> {
  const queries = options.queries ?? HYBRID_QUERIES;
  const k = options.k ?? HYBRID_K;
  const db = openDatabase(":memory:");
  try {
    const store = new MemoryStore(db, { now: () => NOW });
    const pipeline = new MemoryPipeline({
      store,
      owner: "me",
      policy: createDefaultPolicy({ isSourceEnabled: () => true, allowSensitive: () => true }),
    });
    for (const seed of RELEVANCE_DOCS) {
      const out = pipeline.capture({
        source: "project-docs",
        sourceRef: seed.key,
        scope: "path:/docs",
        contentType: "doc",
        observedAt: new Date(NOW.getTime() - 86_400_000).toISOString(),
        provenance: {},
        text: seed.text,
        dedupeKey: `eval:${seed.key}`,
      });
      if (out.status !== "stored")
        throw new Error(`memory seed "${seed.key}" not stored: ${out.status}`);
    }
    const vectors = new VectorStore(db, { now: () => NOW });
    const indexed = await new VectorIndexer({ vectors, embedder, batchSize: 16 }).run();
    const retriever = new Retriever({ store, vectors, embedder, clock: CLOCK });
    const viewer = ownerViewer("me");
    const vectorSkipped = new Set<string>();

    const score = (mode: RetrievalMode, qs: readonly EvalQuery[]) =>
      evaluateRetrieval(
        qs,
        async (q) => {
          const res = await retriever.retrieve({ query: q.query, viewer, limit: k, mode });
          if (mode === "hybrid" && res.report.vectorSkipped) vectorSkipped.add(q.id);
          return res.items.map(sourceKey);
        },
        k,
      );
    const lexical = await score("lexical", queries);
    const hybrid = await score("hybrid", queries);
    const byKind: HybridRelevanceResult["byKind"] = {};
    for (const kind of new Set(queries.map((q) => q.kind ?? ""))) {
      byKind[kind] = { lexical: sliceByKind(lexical, kind), hybrid: sliceByKind(hybrid, kind) };
    }
    return {
      k,
      embedderKey: embedder.modelKey,
      indexed,
      vectorSkipped: [...vectorSkipped],
      lexical,
      hybrid,
      byKind,
    };
  } finally {
    db.close();
  }
}

/** One-line figures for the release record. */
export function formatEvaluation(e: RetrievalEvaluation): string {
  return `recall@${e.k} ${e.recallAtK.toFixed(3)}  MRR ${e.mrr.toFixed(3)}  nDCG@${e.k} ${e.ndcgAtK.toFixed(3)}  (n=${e.queries})`;
}
