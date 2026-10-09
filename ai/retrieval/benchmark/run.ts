// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Retrieval relevance benchmark on REAL content: this repository's docs/**/*.md (chunked and
// ingested by the Phase 28 docs ingestor) and its git commit messages (Phase 28 git ingestor),
// pinned to one commit so the corpus does not move. Embeddings come from the real nomic-embed-text
// model in a local Ollama; the model reranker uses llama3.2. Run:
//
//   rm -rf /tmp/p37/corpus && mkdir -p /tmp/p37/corpus && git archive 9413132 docs | tar -x -C /tmp/p37/corpus && rm /tmp/p37/corpus/docs/gaps.md
//   node_modules/.bin/tsx ai/retrieval/benchmark/run.ts [--dev-only] [--no-model-rerank]
//   OUT=/tmp/p37/rerun.json node_modules/.bin/tsx ai/retrieval/benchmark/run.ts   # write the results there, leave results.json alone
//
// Method (fixed before any result was looked at; see queries.json, committed first):
//   - queries.json has 48 queries, each with its expected source(s). Half are exact-term queries
//     (where keyword search should win), half are paraphrases (where vectors should help). Even
//     numbered queries of each kind are the held-out TEST half, odd numbered the DEV half.
//   - The RRF constant k and the vector weight are tuned on DEV only. The reranker weights are
//     chosen on DEV only. TEST numbers are computed once, for the chosen settings, last.
//   - A retrieved item counts toward a query when its source key matches an expected one:
//     "doc:<path relative to docs/>" or "commit:<7-char sha>". Metrics are over distinct sources
//     in the first 10 returned items (see src/metrics.ts).
import { execFile } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import {
  GIT_LOG_FORMAT,
  MemoryPipeline,
  MemoryStore,
  createDefaultPolicy,
  ingestCommits,
  ingestDocs,
  nodeDocReader,
  ownerViewer,
  parseGitLog,
} from "@phoenix/ai-memory";
import { ContextEngine, type Clock } from "@phoenix/ai-context";
import {
  AiService,
  OllamaProvider,
  ProviderRegistry,
  type PrivacyClass,
  type AiSettings,
} from "@phoenix/ai-models";
import { openDatabase } from "@phoenix/persistence";
import {
  AiEmbedder,
  FeatureReranker,
  ModelReranker,
  Retriever,
  VectorIndexer,
  VectorStore,
  evaluateRetrieval,
  sliceByKind,
  type Embedder,
  type EvalQuery,
  type FeatureWeights,
  type RetrievalEvaluation,
  type RetrievalMode,
  type Reranker,
} from "../src";

const run = promisify(execFile);
const PINNED = "9413132";
const CORPUS = "/tmp/p37/corpus/docs";
const DB_PATH = "/tmp/p37/bench.db";
const REPO = join(import.meta.dirname, "..", "..", "..");
const args = new Set(process.argv.slice(2));
const DEV_ONLY = args.has("--dev-only");
const MODEL_RERANK = !args.has("--no-model-rerank");
const K = 5;
const LIMIT = 10;
const CLOCK: Clock = { now: () => new Date("2026-10-09T00:00:00.000Z"), timeZone: "UTC" };

interface BenchQuery extends EvalQuery {
  split: "dev" | "test";
}

interface Counting {
  calls: number;
  ms: number;
}

/** Caches query embeddings so tuning does not re-embed 48 queries per configuration. */
class CachingEmbedder implements Embedder {
  readonly modelKey: string;
  readonly queryCalls: Counting = { calls: 0, ms: 0 };
  readonly docCalls: Counting = { calls: 0, ms: 0 };
  private readonly cache: Record<string, number[]> = {};
  constructor(private readonly inner: Embedder) {
    this.modelKey = inner.modelKey;
  }
  async embedDocuments(texts: readonly string[], privacy: PrivacyClass, signal?: AbortSignal) {
    const t0 = performance.now();
    const out = await this.inner.embedDocuments(texts, privacy, signal);
    this.docCalls.calls += texts.length;
    this.docCalls.ms += performance.now() - t0;
    return out;
  }
  async embedQuery(text: string, privacy: PrivacyClass, signal?: AbortSignal) {
    const hit = this.cache[text];
    if (hit) return hit;
    const t0 = performance.now();
    const v = await this.inner.embedQuery(text, privacy, signal);
    this.queryCalls.calls++;
    this.queryCalls.ms += performance.now() - t0;
    this.cache[text] = v;
    return v;
  }
}

function listMarkdown(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...listMarkdown(path));
    else if (name.endsWith(".md")) out.push(path);
  }
  return out;
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}

const fmt = (e: RetrievalEvaluation) =>
  `recall@${e.k} ${e.recallAtK.toFixed(3)}  MRR ${e.mrr.toFixed(3)}  nDCG@${e.k} ${e.ndcgAtK.toFixed(3)}  (n=${e.queries})`;

async function main(): Promise<void> {
  const all = (
    JSON.parse(readFileSync(join(import.meta.dirname, "queries.json"), "utf8")) as {
      queries: BenchQuery[];
    }
  ).queries;
  const dev = all.filter((q) => q.split === "dev");
  const test = all.filter((q) => q.split === "test");

  rmSync(DB_PATH, { force: true });
  rmSync(`${DB_PATH}-wal`, { force: true });
  rmSync(`${DB_PATH}-shm`, { force: true });
  const db = openDatabase(DB_PATH);
  const store = new MemoryStore(db, { now: CLOCK.now });
  const pipeline = new MemoryPipeline({
    store,
    owner: "bench",
    policy: createDefaultPolicy({ isSourceEnabled: () => true, allowSensitive: () => false }),
  });

  // ---- ingest the real corpus -------------------------------------------------------------
  const docPaths = listMarkdown(CORPUS);
  const docReport = await ingestDocs({ pipeline, store, reader: nodeDocReader, paths: docPaths });
  const { stdout } = await run("git", ["-C", REPO, "log", PINNED, GIT_LOG_FORMAT], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const commitReport = ingestCommits(pipeline, parseGitLog("phoenix", stdout));
  console.log(
    `corpus: ${docPaths.length} doc files -> ${docReport.stored} chunks; ${commitReport.stored} commits; ${store.count()} memories`,
  );

  // ---- real embeddings through the router ---------------------------------------------------
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
  const embedder = new CachingEmbedder(
    new AiEmbedder(ai, {
      provider: "ollama",
      model: "nomic-embed-text",
      documentPrefix: "search_document: ",
      queryPrefix: "search_query: ",
      timeoutMs: 120_000,
    }),
  );
  const vectors = new VectorStore(db);
  const indexer = new VectorIndexer({ vectors, embedder, batchSize: 16, maxItemsPerRun: 10_000 });
  const t0 = performance.now();
  const indexReport = await indexer.run();
  const indexMs = performance.now() - t0;
  console.log(
    `embedded ${indexReport.embedded} items in ${(indexMs / 1000).toFixed(1)} s (${(indexMs / Math.max(1, indexReport.embedded)).toFixed(1)} ms/item), failed ${indexReport.failed}, remaining ${indexReport.remaining}, degraded ${JSON.stringify(indexReport.degraded)}`,
  );
  if (indexReport.remaining > 0)
    throw new Error("not every item was embedded; refusing to benchmark");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const dbBytes = statSync(DB_PATH).size;

  // ---- retrievers ---------------------------------------------------------------------------
  const viewer = ownerViewer("bench");
  const makeRetriever = (
    over: { k?: number; vectorWeight?: number; reranker?: Reranker | null } = {},
  ) =>
    new Retriever({
      store,
      vectors,
      embedder,
      clock: CLOCK,
      k: over.k,
      vectorWeight: over.vectorWeight,
      reranker: over.reranker ?? null,
    });

  const keyOf = (item: {
    source: string;
    sourceRef: string;
    provenance: Record<string, unknown>;
  }) => {
    if (item.source === "project-docs") return `doc:${relative(CORPUS, item.sourceRef)}`;
    const sha = item.provenance.sha;
    return `commit:${typeof sha === "string" ? sha.slice(0, 7) : "?"}`;
  };

  const evalRetriever = (
    retriever: Retriever,
    mode: RetrievalMode,
    queries: EvalQuery[],
    rerank = true,
    latencies?: number[],
  ) =>
    evaluateRetrieval(
      queries,
      async (q) => {
        const s = performance.now();
        const res = await retriever.retrieve({
          query: q.query,
          viewer,
          limit: LIMIT,
          mode,
          rerank,
        });
        latencies?.push(performance.now() - s);
        return res.items.map(keyOf);
      },
      K,
    );

  const engine = new ContextEngine({ store, clock: CLOCK });
  const evalExistingEngine = (queries: EvalQuery[]) =>
    evaluateRetrieval(
      queries,
      (q) =>
        Promise.resolve(
          engine
            .assemble({ question: q.query, viewer, limit: LIMIT, tokenBudget: 1_000_000 })
            .items.map(keyOf),
        ),
      K,
    );

  // ---- tune on DEV only ---------------------------------------------------------------------
  console.log("\n=== DEV half: tuning (nDCG@5) ===");
  const grid: { k: number; vectorWeight: number; ndcg: number; mrr: number }[] = [];
  for (const k of [5, 10, 20, 60, 100]) {
    for (const vectorWeight of [0.5, 1, 1.5, 2]) {
      const e = await evalRetriever(makeRetriever({ k, vectorWeight }), "hybrid", dev);
      grid.push({ k, vectorWeight, ndcg: e.ndcgAtK, mrr: e.mrr });
    }
  }
  for (const g of grid) {
    console.log(
      `  k=${String(g.k).padEnd(3)} vectorWeight=${g.vectorWeight}  nDCG@5 ${g.ndcg.toFixed(3)}  MRR ${g.mrr.toFixed(3)}`,
    );
  }
  // Best dev nDCG; ties go to the setting closest to the textbook default (k=60, weight 1).
  const distance = (g: { k: number; vectorWeight: number }) =>
    Math.abs(Math.log(g.k / 60)) + Math.abs(Math.log(g.vectorWeight));
  const best = [...grid].sort((a, b) => b.ndcg - a.ndcg || distance(a) - distance(b))[0]!;
  console.log(`chosen on DEV: k=${best.k}, vectorWeight=${best.vectorWeight}`);

  const featurePresets: Record<string, Partial<FeatureWeights>> = {
    default: {},
    "fused-heavy": { fused: 0.8, coverage: 0.1, proximity: 0.05, recency: 0, authority: 0.05 },
    "text-heavy": { fused: 0.3, coverage: 0.4, proximity: 0.2, recency: 0, authority: 0.1 },
  };
  let bestPreset = "default";
  let bestPresetNdcg = -1;
  for (const [name, w] of Object.entries(featurePresets)) {
    const e = await evalRetriever(
      makeRetriever({ ...best, reranker: new FeatureReranker(w) }),
      "hybrid",
      dev,
    );
    console.log(
      `  feature reranker "${name}": nDCG@5 ${e.ndcgAtK.toFixed(3)}  MRR ${e.mrr.toFixed(3)}`,
    );
    if (e.ndcgAtK > bestPresetNdcg) {
      bestPreset = name;
      bestPresetNdcg = e.ndcgAtK;
    }
  }
  console.log(`chosen feature reranker preset on DEV: ${bestPreset}`);

  const featureReranker = new FeatureReranker(featurePresets[bestPreset]);
  let modelReranker: ModelReranker | null = null;
  if (MODEL_RERANK) {
    modelReranker = new ModelReranker({
      generate: async (request) =>
        (await ai.run({ kind: "generate", request, timeoutMs: 120_000 })).result,
      maxCandidates: 8,
    });
  }

  const configs: { name: string; mode: RetrievalMode; retriever: Retriever; rerank: boolean }[] = [
    {
      name: "lexical (Retriever, bm25 only)",
      mode: "lexical",
      retriever: makeRetriever(best),
      rerank: false,
    },
    { name: "vector only", mode: "vector", retriever: makeRetriever(best), rerank: false },
    { name: "hybrid (RRF)", mode: "hybrid", retriever: makeRetriever(best), rerank: false },
    {
      name: `hybrid + feature rerank (${bestPreset})`,
      mode: "hybrid",
      retriever: makeRetriever({ ...best, reranker: featureReranker }),
      rerank: true,
    },
  ];
  if (modelReranker) {
    configs.push({
      name: "hybrid + model rerank (llama3.2, top 8)",
      mode: "hybrid",
      retriever: makeRetriever({ ...best, reranker: modelReranker }),
      rerank: true,
    });
  }
  // Also the default-parameter hybrid, so the effect of tuning is visible.
  configs.splice(3, 0, {
    name: "hybrid (RRF, untuned k=60, weight 1)",
    mode: "hybrid",
    retriever: makeRetriever({ k: 60, vectorWeight: 1 }),
    rerank: false,
  });

  const result: Record<string, unknown> = {
    pinnedCommit: PINNED,
    corpus: {
      docFiles: docPaths.length,
      docChunks: docReport.stored,
      commits: commitReport.stored,
      memories: store.count(),
    },
    embedding: {
      model: embedder.modelKey,
      items: indexReport.embedded,
      totalMs: Math.round(indexMs),
      msPerItem: Number((indexMs / Math.max(1, indexReport.embedded)).toFixed(1)),
      dim: vectors.dimOf(embedder.modelKey),
      vectorPayloadBytes: vectors.payloadBytes(),
      databaseFileBytes: dbBytes,
    },
    tuned: { k: best.k, vectorWeight: best.vectorWeight, featurePreset: bestPreset },
  };

  const evalSplit = async (label: "dev" | "test", queries: BenchQuery[]) => {
    console.log(`\n=== ${label.toUpperCase()} half (${queries.length} queries), k=${K} ===`);
    const rows: Record<string, unknown> = {};
    const baseline = await evalExistingEngine(queries);
    console.log(`  ${"existing ContextEngine (lexical)".padEnd(46)} ${fmt(baseline)}`);
    rows["existing ContextEngine (lexical)"] = summarise(baseline);
    for (const c of configs) {
      const e = await evalRetriever(c.retriever, c.mode, queries, c.rerank);
      console.log(`  ${c.name.padEnd(46)} ${fmt(e)}`);
      for (const kind of ["exact", "paraphrase"]) {
        console.log(`      ${kind.padEnd(10)} ${fmt(sliceByKind(e, kind))}`);
      }
      rows[c.name] = summarise(e);
    }
    result[label] = rows;
  };
  await evalSplit("dev", dev);
  if (!DEV_ONLY) await evalSplit("test", test);

  if (modelReranker) {
    console.log(
      `model reranker: ${modelReranker.stats.calls} calls over dev+test, ${modelReranker.stats.fallbacks} fell back to retrieval order (last reason: ${modelReranker.lastFallback ?? "none"})`,
    );
    result.modelReranker = modelReranker.stats;
  }

  // ---- latency on the real corpus -----------------------------------------------------------
  const lat: number[] = [];
  const hybrid = makeRetriever(best);
  for (const q of all) await hybrid.retrieve({ query: q.query, viewer, limit: LIMIT }); // warm query cache
  for (let pass = 0; pass < 5; pass++) await evalRetriever(hybrid, "hybrid", all, false, lat);
  lat.sort((a, b) => a - b);
  const vecLat: number[] = [];
  for (const q of all) {
    const v = await embedder.embedQuery(q.query, "internal");
    for (let i = 0; i < 5; i++) {
      const s = performance.now();
      vectors.search(embedder.modelKey, v, { limit: 50 });
      vecLat.push(performance.now() - s);
    }
  }
  vecLat.sort((a, b) => a - b);
  result.latency = {
    note: "hybrid retrieval with the query embedding cached (no Ollama call), and the brute-force vector scan alone",
    hybridMsP50: Number(percentile(lat, 0.5).toFixed(2)),
    hybridMsP95: Number(percentile(lat, 0.95).toFixed(2)),
    vectorScanMsP50: Number(percentile(vecLat, 0.5).toFixed(2)),
    vectorScanMsP95: Number(percentile(vecLat, 0.95).toFixed(2)),
    queryEmbedMsMean: Number(
      (embedder.queryCalls.ms / Math.max(1, embedder.queryCalls.calls)).toFixed(1),
    ),
  };
  console.log("\nlatency:", JSON.stringify(result.latency));

  writeFileSync(
    process.env.OUT ??
      join(import.meta.dirname, DEV_ONLY ? "results.dev-only.json" : "results.json"),
    JSON.stringify(result, null, 1),
  );
}

function summarise(e: RetrievalEvaluation) {
  const byKind = (kind: string) => {
    const s = sliceByKind(e, kind);
    return {
      n: s.queries,
      recall: Number(s.recallAtK.toFixed(4)),
      mrr: Number(s.mrr.toFixed(4)),
      ndcg: Number(s.ndcgAtK.toFixed(4)),
    };
  };
  return {
    n: e.queries,
    recall: Number(e.recallAtK.toFixed(4)),
    mrr: Number(e.mrr.toFixed(4)),
    ndcg: Number(e.ndcgAtK.toFixed(4)),
    exact: byKind("exact"),
    paraphrase: byKind("paraphrase"),
    perQuery: e.perQuery.map((m) => ({
      id: m.id,
      rank: m.firstRelevantRank,
      recall: Number(m.recall.toFixed(3)),
    })),
  };
}

await main();
