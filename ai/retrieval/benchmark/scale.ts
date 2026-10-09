// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Query latency of the brute-force vector scan and of full hybrid retrieval on a SYNTHETIC corpus
// (random 768-dimensional unit vectors, the width of nomic-embed-text, and generated sentences).
// Synthetic vectors say nothing about relevance, only about cost. Run:
//   node_modules/.bin/tsx ai/retrieval/benchmark/scale.ts [items=20000]
import { statSync, rmSync } from "node:fs";
import { MemoryPipeline, MemoryStore, createDefaultPolicy, ownerViewer } from "@phoenix/ai-memory";
import type { Clock } from "@phoenix/ai-context";
import type { PrivacyClass } from "@phoenix/ai-models";
import { openDatabase } from "@phoenix/persistence";
import { Retriever, VectorStore, type Embedder } from "../src";

const ITEMS = Number(process.argv[2] ?? 20_000);
const DIM = 768;
const DB_PATH = "/tmp/p37/scale.db";
const CLOCK: Clock = { now: () => new Date("2026-10-09T00:00:00.000Z"), timeZone: "UTC" };
const WORDS = (
  "database lock startup capability permission event memory vector index retrieval model router " +
  "meeting summary decision action item commit branch merge deploy build test failure retry timeout " +
  "token secret policy audit gateway agent workspace session notification state pet window tray"
).split(" ");

/** Mulberry32: deterministic, so two runs build the same corpus. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomVector(rand: () => number): number[] {
  return Array.from({ length: DIM }, () => rand() * 2 - 1);
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}

rmSync(DB_PATH, { force: true });
rmSync(`${DB_PATH}-wal`, { force: true });
rmSync(`${DB_PATH}-shm`, { force: true });
const db = openDatabase(DB_PATH);
const store = new MemoryStore(db, { now: CLOCK.now });
const pipeline = new MemoryPipeline({
  store,
  owner: "bench",
  policy: createDefaultPolicy({ isSourceEnabled: () => true, allowSensitive: () => true }),
});
const vectors = new VectorStore(db);
const MODEL = "synthetic/random-768";
const rand = rng(42);

const buildStart = performance.now();
db.exec("BEGIN");
const ids: string[] = [];
for (let i = 0; i < ITEMS; i++) {
  const words = Array.from({ length: 12 }, () => WORDS[Math.floor(rand() * WORDS.length)]);
  const out = pipeline.capture({
    source: "git",
    sourceRef: `repo${i % 50}`,
    scope: `repo:repo${i % 50}`,
    contentType: "commit",
    text: `${words.join(" ")} change ${i}`,
    observedAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
    dedupeKey: `synthetic:${i}`,
    provenance: {},
  });
  if (out.status !== "stored") throw new Error(`not stored: ${out.status}`);
  ids.push(out.item.id);
  vectors.putMany(MODEL, [{ id: out.item.id, text: out.item.text, vector: randomVector(rand) }]);
}
db.exec("COMMIT");
const buildMs = performance.now() - buildStart;
db.exec("PRAGMA wal_checkpoint(TRUNCATE)");

const queryVectors = Array.from({ length: 50 }, () => randomVector(rand));
const scanMs: number[] = [];
for (const q of queryVectors) {
  for (let rep = 0; rep < 3; rep++) {
    const s = performance.now();
    vectors.search(MODEL, q, { limit: 50 });
    scanMs.push(performance.now() - s);
  }
}
scanMs.sort((a, b) => a - b);

const owner = ownerViewer("bench");
const permitted = {
  id: "v",
  grants: [{ scope: "repo:repo1*", maxSensitivity: "internal" as const }],
};
const scanFiltered: number[] = [];
for (const q of queryVectors) {
  const s = performance.now();
  vectors.search(MODEL, q, {
    limit: 50,
    accept: (item) => item.scope.startsWith("repo:repo1"),
  });
  scanFiltered.push(performance.now() - s);
}
scanFiltered.sort((a, b) => a - b);

// Hybrid retrieval end to end with a fixed query vector (the embedder call is not what is measured).
const fixed = queryVectors[0] ?? [];
const embedder: Embedder = {
  modelKey: MODEL,
  embedDocuments: () => Promise.reject(new Error("not used")),
  embedQuery: (_t: string, _p: PrivacyClass) => Promise.resolve(fixed),
};
const retriever = new Retriever({ store, vectors, embedder, clock: CLOCK });
const hybridMs: number[] = [];
const queries = [
  "database lock startup",
  "agent session notification",
  "deploy failure retry",
  "policy audit gateway",
];
for (let rep = 0; rep < 10; rep++) {
  for (const query of queries) {
    const s = performance.now();
    await retriever.retrieve({ query, viewer: owner, limit: 10 });
    hybridMs.push(performance.now() - s);
  }
}
hybridMs.sort((a, b) => a - b);
const permittedMs: number[] = [];
for (const query of queries) {
  const s = performance.now();
  await retriever.retrieve({ query, viewer: permitted, limit: 10 });
  permittedMs.push(performance.now() - s);
}
permittedMs.sort((a, b) => a - b);

const lexicalOnly: number[] = [];
for (let rep = 0; rep < 10; rep++) {
  for (const query of queries) {
    const s = performance.now();
    await retriever.retrieve({ query, viewer: owner, limit: 10, mode: "lexical" });
    lexicalOnly.push(performance.now() - s);
  }
}
lexicalOnly.sort((a, b) => a - b);

const f = (n: number) => Number(n.toFixed(1));
console.log(
  JSON.stringify(
    {
      items: ITEMS,
      dim: DIM,
      buildSeconds: f(buildMs / 1000),
      databaseFileMB: f(statSync(DB_PATH).size / 1e6),
      vectorPayloadMB: f(vectors.payloadBytes() / 1e6),
      vectorScanMs: { p50: f(percentile(scanMs, 0.5)), p95: f(percentile(scanMs, 0.95)) },
      vectorScanWithPermissionFilterMs: {
        p50: f(percentile(scanFiltered, 0.5)),
        p95: f(percentile(scanFiltered, 0.95)),
      },
      hybridRetrievalMs: { p50: f(percentile(hybridMs, 0.5)), p95: f(percentile(hybridMs, 0.95)) },
      hybridRetrievalNarrowViewerMs: {
        p50: f(percentile(permittedMs, 0.5)),
        p95: f(percentile(permittedMs, 0.95)),
      },
      lexicalOnlyMs: {
        p50: f(percentile(lexicalOnly, 0.5)),
        p95: f(percentile(lexicalOnly, 0.95)),
      },
    },
    null,
    1,
  ),
);
