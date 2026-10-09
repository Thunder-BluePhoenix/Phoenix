# ADR-0005: Hybrid retrieval architecture

**Status:** Accepted (Phase 37; package level — not yet wired into Core)  
**Date:** 2026-10-03 (proposed), 2026-10-09 (accepted)

## Context

Memory retrieval needs lexical, vector and graph strategies (Tech Spec §08). Phase 28 shipped lexical retrieval only (SQLite FTS5, bm25). The original decision was to add vectors and reranking "only when measurably useful". Phase 37 built them and measured them.

## Decision

1. **Lexical stays the base.** bm25 over FTS5 (`MemoryStore.search`) is always run. Vectors add candidates; they never replace it.
2. **Vectors live in SQLite, no extension.** Table `memory_vectors` (migration 10): L2-normalised Float32 blobs keyed by `(memory_id, model)`, one embedding model per row, width checked against the model. Search is a brute-force dot product over the live, unexpired, permitted rows of the active model. Practical ceiling: tens of thousands of memories (measured: 20,000 items = 0.2 s, 50,000 = 0.56 s per scan, dominated by reading the blobs); `maxScan` caps a scan at 50,000 and reports truncation. An approximate index (sqlite-vec, HNSW) is not adopted; revisit it if a deployment exceeds that range. No new dependency was added.
3. **Fusion is reciprocal-rank fusion**, `Σ weight / (k + rank)`, because it uses ranks only and so needs no score calibration between bm25 and cosine similarity. The textbook `k = 60` was worse than `k = 20` with the vector list weighted 0.5 on this corpus (tuned on a dev half only); the defaults in code stay at `k = 60`, weight 1, and the runtime should pass the tuned values (or tune again on its own data).
4. **Reranking is optional and bounded.** A deterministic feature reranker (term coverage and proximity, recency, source authority) is the recommended one. A model reranker through `AiService.generate` exists, scores at most 8 candidates, requires exact JSON and falls back to retrieval order; on this benchmark it made rankings worse and is off by default.
5. **Embeddings go through the model router** (ADR-0004) with the memory item's sensitivity as the privacy class. The embedding and rerank purposes are not in the sensitive-cloud purpose list, so sensitive text is never sent to a cloud provider for them. With AI off nothing is embedded and retrieval is lexical-only, with the reason reported.
6. **Permission scoping precedes ranking.** The viewer's `canView` predicate runs on each row inside both candidate searches, before scoring, counting or any prompt. A hidden item cannot influence a rank, a count, a fusion score or a reranker prompt.
7. **Deletion propagates by trigger**, in the same statement as the memory change (hard delete, tombstone, expiry, text edit), like the FTS index. Late embeddings for items that changed in the meantime are refused.
8. **Graph retrieval (Phase 38) is unchanged and still deferred.**

## Evidence (Phase 37 benchmark)

48 queries (24 exact-term, 24 paraphrase) over this repository's docs and git history (839 memories), real `nomic-embed-text` embeddings, queries frozen before any result was seen (sha256 `bf087af6d569838d549adb05b23758359c55ed368a9e2753683609d727e61f83` of the generator's `indent=1` serialisation; the file on disk was later reformatted by prettier, parsed content identical. Nothing external, such as a commit, timestamps the freeze: it rests on that hash having been taken before the first benchmark run), tuning on one half only. On the held-out half (n = 24) at k = 5: bm25 recall@5 0.778 / MRR 0.825 / nDCG@5 0.752; vector only 0.590 / 0.660 / 0.573; tuned hybrid 0.875 / 0.817 / 0.789; hybrid + feature rerank **0.896 / 0.878 / 0.853**; hybrid + llama3.2 rerank 0.875 / 0.731 / 0.743. The recall gain of hybrid + feature rerank over bm25 is +0.118 (95% CI +0.028 to +0.229); the MRR gain (+0.053) is within noise. Untuned `k = 60` hybrid was no better than bm25 on the held-out half. Full tables, caveats and costs: [Phase 37](../phases/phase-37-hybrid-retrieval.md).

## Consequences

- Hybrid retrieval is worth wiring in on this evidence, but the evidence is one small corpus; a larger, differently authored benchmark should be run before the margin is quoted.
- Vector-only retrieval must not be offered: it loses exact identifiers.
- The vector index is derived data. It can be dropped and rebuilt at any time (`VectorStore.dropModel`), and changing the embedding model re-embeds everything in the background without mixing vector spaces.
- Each embedding model change costs one embedding call per memory (about 9 ms each locally).
