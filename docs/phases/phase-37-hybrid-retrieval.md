# Phase 37 — Hybrid Retrieval (Lexical + Vector + Rerank)

| Field | Value |
|---|---|
| Stage | Stage 7 — Knowledge Graph (v0.7) |
| Release target | v0.7 |
| Priority | High |
| Status | 🟨 Built, measured and wired into Core (off by default); the Settings UI and an eval-harness hook are not built |
| Depends on | [Phase 36 — Action Items → Engineering Tasks](phase-36-action-items-to-engineering-tasks.md) |
| Unblocks | [Phase 38 — Knowledge Graph & Provenance](phase-38-knowledge-graph-and-provenance.md) |

## Goal

Upgrade retrieval to BM25 + embeddings + reranking with grounded, cited answers.

## Scope

**In scope**

- Vector index
- Reranker
- Retrieval pipeline

## Tasks

- [x] Embedding pipeline through model router (local preferred) — `VectorIndexer` + `AiEmbedder`; ran against the real `nomic-embed-text` in Ollama (839 items, 9.3 ms/item); not yet triggered by the runtime
- [x] Hybrid retrieval + rerank + context assembly + grounding — `Retriever` (bm25 + vectors, reciprocal-rank fusion, feature and model rerankers, cited bundle); package level only, `ContextEngine` does not call it yet
- [x] Retrieval relevance metrics in eval harness — `evaluateRetrieval` (recall@k, MRR, nDCG@k, per-query) is exported; the Phase 33 harness has not been changed to call it
- [x] Deletion propagates to vector index — triggers in migration 10; tested for forget, `forgetWhere`, `expire()`, purge and meeting purge

## Deliverables

- ai/retrieval

## Exit criteria

- [x] Measured relevance improvement over lexical baseline — on the held-out half, hybrid + feature rerank beats bm25 on recall@5 (0.778 → 0.896), MRR (0.825 → 0.878) and nDCG@5 (0.752 → 0.853). The benchmark is small (24 held-out queries) and the MRR gain is within noise; read the caveats below before relying on it

## Implementation notes

### What was built (`ai/retrieval`, `@phoenix/ai-retrieval`)

- **Vector index** (`vectors.ts`, migration **10**): `memory_vectors(memory_id, model, dim, vector BLOB, created_at)`, primary key `(memory_id, model)`, with `CHECK (length(vector) = dim * 4)`. Vectors are L2-normalised Float32 blobs, so cosine similarity is a dot product. No SQLite extension and no new dependency. Search is a brute-force scan over live, unexpired, permitted rows **of the active model only**; a query or a stored vector whose width differs from the model's stored width is rejected (`VectorDimensionError`), and `putMany` is all-or-nothing. `memory_vector_failures` records items whose embedding failed (see pipeline).
- **Deletion**: two triggers on `memory_items` (`AFTER DELETE`, `AFTER UPDATE OF text, deleted_at`) remove the item's vector and failure record in the same statement, exactly like the FTS triggers in migration 7, so there is nothing for a caller to forget. `putMany` also refuses a vector for an item that was tombstoned, expired or edited while its embedding was in flight (the insert is `INSERT … SELECT … WHERE deleted_at IS NULL AND text = ?`), and search joins live items, so a late write cannot bring a deleted memory back. Tests: hard delete (`purge`), raw `DELETE`, `forget`, `forgetWhere`, `expire()`, meeting purge via `ingestMeetings`, text edit, late embedding of a forgotten/edited/expired item.
- **Embedding pipeline** (`embedder.ts`, `indexer.ts`): `AiEmbedder` calls `AiService.run({kind: "embed"})` with `preferred` set to the configured provider, and refuses an answer from a different provider/model (`EmbedderMismatchError`) so vectors are never stored under the wrong key. The vector-space key is `<provider>/<model>` plus `#prefixed` when document/query prefixes are used (nomic-embed-text wants `search_document: ` / `search_query: `). `VectorIndexer.run()` is incremental (only items with no vector for the active key), batched (default 16), capped per run (default 256) so a large backlog is resumed rather than swallowed, paced (`minIntervalMs`, injected sleeper), single-flight (concurrent triggers share one run) and resumable (all state is in SQLite). **Privacy**: each batch carries one data class, the sensitivity of its items, and the purposes `embed memory for retrieval` / `embed a retrieval query` / `rerank retrieval candidates` are not in `SENSITIVE_CLOUD_PURPOSES`, so sensitive text can never reach a cloud embedder, even with every opt-in on (tested). **AI off**: nothing is embedded, no provider is contacted, nothing is recorded against any item, and the report says `ai_disabled` with the sentence "AI is turned off, so memories are not embedded; search is keyword-only." **Failures**: when a batch fails, items are retried one at a time; items that fail while a sibling succeeds are recorded with exponential backoff (30 s doubling, capped at 1 h) and parked after 5 attempts (`retryParked()` re-enables them); two failures in a row before any success are treated as an outage, nothing is recorded against the items, and the indexer cools down. Capture never waits for embedding, so a dead provider costs nothing at capture time.
- **Hybrid retrieval** (`retriever.ts`): `Retriever.retrieve({query, viewer, scopes?, domains?, limit, tokenBudget?, mode?, rerank?})`. The same permission predicate (`canView` + scope narrowing + domain) is handed to **both** candidate searches and runs on each row before it is scored or counted; vector hits are re-checked when loaded. Fusion is reciprocal-rank fusion, `score(d) = Σ weight_list / (k + rank_list(d))`, ranks from 1; **default `k = 60`** (Cormack, Clarke & Buettcher 2009), weights 1/1. Then the optional reranker reorders the top `rerankDepth` (20), then assembly drops near-duplicates (the engine's 0.85 word-overlap rule), applies the limit and the token budget, and returns items with `citation {memoryId, source, sourceRef, scope, observedAt}`, `kind` (fact | interpretation), freshness, per-list ranks, similarity and fused score, plus a `ContextBundle` so `answerFromContext` and `buildAskMessages` work unchanged. Time phrases in the question ("yesterday") apply to both lists. When vectors cannot be used (no embedder, AI off, empty index, provider outage, unusable query vector) the result is the lexical result and `report.vectorSkipped` says why.
- **Rerankers** (`rerank.ts`): `FeatureReranker` is deterministic: fused score, query-term coverage, term proximity (smallest window containing all matched terms), recency (half-life 90 days), source authority (docs 0.9, kage 0.8, git 0.7, interpretations 0.3, times confidence, ×0.7 when stale). `ModelReranker` asks `AiService.generate` to score the top 8 candidates 0-10 as `{"scores":{"C1":7,…}}`. The reply is accepted only if it is exactly that JSON object with exactly the refs asked for and numbers in range; anything else, an AI-off error, no allowed provider or a provider failure returns `null` and retrieval order is kept (counted in `stats`). Memory text goes into the prompt as one JSON object per line between `<<<CANDIDATES nonce>>>` markers with an unpredictable nonce, truncated to 600 characters, and the system prompt says it is untrusted data. The request's privacy class is the highest sensitivity among the candidates, so sensitive candidates can only go to a local model.
- **Metrics** (`metrics.ts`): `evaluateRetrieval(queries, retrieve, k)` → recall@k, MRR, nDCG@k (binary gain) and per-query results; `sliceByKind` for exact vs paraphrase. Relevance is by source key (`source:sourceRef`), counted over distinct sources.
- **Permission scoping** (tested with narrower viewers): restricted text appears in no output and in no reranker prompt; refused items change no count, rank, fused score, `omitted` total or report field (the report with and without hidden items is byte-equal); a refused item never occupies a candidate slot (pool of 1, five better-matching secrets).

### Benchmark: lexical vs vector vs hybrid vs rerank on real content

`ai/retrieval/benchmark/` (`queries.json`, `run.ts`, `results.json`, `scale.ts`, `results.scale-*.json`). Corpus: this repository's `docs/**/*.md` at commit `9413132` minus `docs/gaps.md` (88 files → 780 chunks via the Phase 28 `ingestDocs`) plus the 59 commit messages reachable from it (Phase 28 `ingestCommits`) = **839 memories** in a SQLite file. Embeddings: real `nomic-embed-text` (768-d) through `AiService` → Ollama. Model reranker: real `llama3.2`. **48 queries**, each with the expected source(s), written and frozen **before any retrieval result was looked at** (sha256 `bf087af6d569838d549adb05b23758359c55ed368a9e2753683609d727e61f83` of the generator's `indent=1` serialisation; the file on disk was later reformatted by prettier, parsed content identical. Nothing external, such as a commit, timestamps the freeze: it rests on that hash having been taken before the first benchmark run): 24 exact-term queries (`X-Frappe-Site-Name header`, `Electron`, `retain_data`, commit subjects) and 24 paraphrases that share few or no words with the target (`Why was the heavyweight Chromium-based option rejected for the floating pet window?` → ADR-0013). Odd-numbered queries of each kind are the **dev half** (n=24), even-numbered the **held-out test half** (n=24). The RRF constant `k` ∈ {5,10,20,60,100} and the vector weight ∈ {0.5,1,1.5,2} and the feature-reranker preset were chosen on dev only (chosen: `k=20`, vector weight 0.5, default preset); the test half was computed last, once. Ground truth was checked by grepping the pinned documents and commit log, not by running a retriever.

Held-out TEST half, k = 5 (n = 24; 12 exact, 12 paraphrase):

| Method | recall@5 | MRR | nDCG@5 | exact: recall / MRR | paraphrase: recall / MRR |
| --- | --- | --- | --- | --- | --- |
| Existing Phase 28 `ContextEngine` (bm25) | 0.778 | 0.825 | 0.754 | 1.000 / 1.000 | 0.556 / 0.650 |
| Lexical only (`Retriever`, bm25) | 0.778 | 0.825 | 0.752 | 1.000 / 1.000 | 0.556 / 0.650 |
| Vector only | 0.590 | 0.660 | 0.573 | 0.514 / 0.583 | 0.667 / 0.736 |
| Hybrid RRF, untuned (`k=60`, weight 1) | 0.799 | 0.816 | 0.745 | 0.875 / 0.861 | 0.722 / 0.771 |
| Hybrid RRF, tuned on dev (`k=20`, weight 0.5) | 0.875 | 0.817 | 0.789 | 1.000 / 0.878 | 0.750 / 0.757 |
| **Hybrid + feature rerank** | **0.896** | **0.878** | **0.853** | 1.000 / 1.000 | 0.792 / 0.757 |
| Hybrid + model rerank (llama3.2, top 8) | 0.875 | 0.731 | 0.743 | 1.000 / 0.753 | 0.750 / 0.708 |

Dev half (n = 24), for transparency: bm25 0.833 / 0.750 / 0.735; vector 0.646 / 0.632 / 0.587; hybrid tuned 0.813 / 0.821 / 0.771; hybrid + feature rerank 0.833 / 0.793 / 0.778; hybrid + model rerank 0.813 / 0.626 / 0.658 (recall@5 / MRR / nDCG@5). On dev the hybrid does not find more than bm25 (recall@5 0.813 vs 0.833; with the feature reranker 0.833, equal); the dev gain is in ranking (MRR 0.750 → 0.793 at most) and the tuned settings were chosen there, so dev numbers are optimistic for the hybrid.

What the numbers say, without spin:

- **Hybrid + feature rerank beat the lexical baseline on every held-out metric**, and the gain sits where it should: paraphrase recall@5 0.556 → 0.792, exact-term queries unchanged at 1.000/1.000. Paired bootstrap over the 24 held-out queries (5,000 resamples): recall@5 +0.118, 95% CI [+0.028, +0.229] (5 queries better, 0 worse); MRR +0.053, CI [−0.033, +0.154] (4 better, 1 worse). So the recall gain is distinguishable from zero, the MRR gain is not.
- **Tuned hybrid alone** (no rerank) is +0.097 recall (CI [0.000, +0.215]) with MRR flat (−0.008): it finds more but does not put it higher, and it pushed two exact-term answers down from rank 1 (`validateReport` to 3, `retain_data` to 5), which the feature reranker then restored. **With the untuned textbook `k = 60` the hybrid is barely better than lexical on test (+0.021 recall, −0.009 MRR) and worse on dev (−0.104 recall).** The improvement depends on the dev-tuned `k` and weight; the dev grid shows `k ≤ 20` and a vector weight ≤ 1 are better for this corpus.
- **Vector only is worse than lexical** (−0.187 recall, CI [−0.417, +0.028]): it loses exact identifiers (`Electron`, `Lottie`, `KeychainSecretStore`, `validateReport`, `retain_data` all missed) and wins on some paraphrases. Vectors help only in combination.
- **The llama3.2 model reranker does not help**: MRR 0.817 → 0.731 against the un-reranked hybrid (8 queries worse, 4 better against bm25), and in the final run 12 of its 48 calls (25%) returned something other than the exact JSON and fell back to retrieval order. Treat it as an experiment; do not enable it by default. A larger model may do better; that was not measured.

Why this may not generalise: 24 held-out queries, one corpus (this repository's docs and commits), one embedding model, queries written by the same agent that built the retriever (even though before looking at results), small docs-only chunks, and a corpus with short, keyword-heavy commit subjects. The tuned `k`/weight were selected among 20 settings on 24 dev queries. The ground truth is by source, so a retrieved chunk from a different but equally correct document counts as a miss (recall is conservative for paraphrases). Do not read 0.896 vs 0.778 as an expected production gain; read it as "hybrid did not hurt exact-term search here, helped paraphrases here, and the effect is small enough that a bigger benchmark could shrink it".

### Cost

- Embedding: **9.3 ms/item** (839 items in 7.8 s, batches of 16, `nomic-embed-text` on this Mac via Ollama, model already loaded). One query embedding ≈ 13 ms.
- Index size: 768 dimensions = 3,072 bytes per vector; 839 vectors = 2.6 MB payload; the whole benchmark database file (text, FTS, vectors) is 5.8 MB.
- Query latency on the real corpus (839 items, query embedding cached so Ollama is not in the number): hybrid retrieval **p50 11.7 ms / p95 14.1 ms**; the vector scan alone p50 5.6 ms / p95 7.9 ms. Adding the query embedding, a real query is about 25 ms.
- Synthetic corpus (random 768-d vectors and generated sentences; cost only, says nothing about relevance), `benchmark/scale.ts`: 

| Items | DB file | Vector scan p50 / p95 | Hybrid retrieval p50 / p95 | Lexical only p50 / p95 |
| --- | --- | --- | --- | --- |
| 20,000 | 106 MB | 200 / 236 ms | 226 / 282 ms | 17.7 / 22.7 ms |
| 50,000 | 266 MB | 557 / 618 ms | 602 / 671 ms | 41.7 / 52.9 ms |

- **Practical ceiling**: the scan is linear. About 150 ms of the 200 ms at 20k is `node:sqlite` copying the BLOBs into JavaScript (the dot products themselves are about 11 ms), so it will not get faster without an index. The scan is capped at `maxScan` (default 50,000, newest first); the result reports `truncated` when the cap cut candidates off. Tens of thousands of memories is the supported range; beyond that an approximate index is needed and is not built. A permission filter that rejects most rows does not make the scan cheaper (it still reads them).

### Not done

- Nothing in the web app shows retrieval settings or status yet (the routes exist, see "Wired into Core").
- The Phase 33 evaluation harness does not call `evaluateRetrieval` yet.
- The benchmark scripts need a running local Ollama with `nomic-embed-text` and `llama3.2`; the repository tests do not (they use fakes).

## Wired into Core

`core/runtime/src/retrieval.ts` (`RetrievalRuntime`), routes in `core/api/src/memory-routes.ts`, tests in `core/runtime/test/retrieval.test.ts`, deletion and viewer tests included.

- **Off by default.** `retrieval.enabled` (persisted in settings key `retrieval.settings`) is false, and it also needs AI on. With either off nothing is embedded, no provider is called, and `/api/memory/search` and `/api/memory/ask` run the Phase 28 lexical path unchanged (tested: zero network requests).
- **Defaults** are the dev-tuned values: `k = 20`, `vector_weight = 0.5`, `reranker: "feature"`; embedding provider `ollama`, model `nomic-embed-text` (with its `search_document:`/`search_query:` prefixes, so the vector space is `ollama/nomic-embed-text#prefixed`). The model reranker is not offered. Queries are embedded with data class `sensitive`, so they can only go to a local provider. Changing the model starts a new vector space; the old vectors stay apart, are never searched, and are shown under `other_models` in the status.
- **Indexer.** `MemoryRuntime.maintain()` (startup and hourly) calls `RetrievalRuntime.index()`: incremental, batches of 16, at most 256 items per run and 40 runs per trigger, single-flight, never throws for provider problems. Turning retrieval on or changing the model triggers a run. Memory is not embedded the instant it is captured; it is embedded by the next maintenance run or settings change (a gap).
- **Search/ask.** The retriever runs with the viewer-scoped filter. Every search/ask response carries `retrieval: { mode: "lexical" | "hybrid", vector_skipped_reason?, truncated? }` additively. When the vector half cannot run (provider down, index empty, AI off) the mode is `lexical` and `vector_skipped_reason` says why; when retrieval is simply off there is no reason field.
- **Deletion** reaches vectors through the migration 10 triggers; tested through the real routes: forget one memory, delete-all, a memory forgotten while its embedding was in flight.

### API

| Route | Notes |
|---|---|
| `GET /api/retrieval/settings` | `{ enabled, provider, model, k, vector_weight, reranker }` |
| `POST /api/retrieval/settings` | any subset of those keys; exact keys; `provider` must be a provider that can embed (`ollama`), `model` 1-100 plain characters, `k` integer 1-200, `vector_weight` 0-5, `reranker` `feature`\|`none`; audit entry `retrieval.settings.changed` |
| `GET /api/retrieval/status` | `{ enabled, active, inactive_reason: null\|"retrieval_disabled"\|"ai_disabled", provider, model, vector_space, embedded, total, unembedded, failures, other_models: [{model, vectors}], payload_bytes, last_run: null\|{at, embedded, failed, remaining, capped, degraded: string[]} }` |

### Real run (this Mac, real Ollama `nomic-embed-text` and `llama3.2`)

289 memories (4 real commits via the event route + 285 chunks of `docs/phases/phase-2*.md`/`phase-3*.md`) were embedded in about 8 seconds; the status then read `embedded 289 / total 289, failures 0`. Three reworded questions, retrieval off versus on (top 3 sources):

- "how does the assistant stop a cloud model from seeing private meeting transcripts": off = phase-35, phase-20, phase-35; on = phase-35, phase-29, phase-20.
- "what makes an automatic bot unable to approve its own actions": off = phase-20, phase-35, phase-36; on = phase-35, phase-36, phase-20.
- "how slow is looking through many thousands of stored numbers": off = phase-31, phase-38, phase-20 (none about vector scan cost); on = **phase-37** first (its cost section), then phase-20, phase-29.

Only the third is a clear find that keyword search missed; the first two reorder results that were already roughly right. Three queries prove nothing about relevance; the benchmark above is the measurement.

## Source documents

- Technical Spec Suite 04–14 §08
- AI Evolution v1.0→v2.0 §6.2

---
Back to [TRACKER](TRACKER.md)
