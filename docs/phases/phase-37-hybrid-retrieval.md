# Phase 37 — Hybrid Retrieval (Lexical + Vector + Rerank)

| Field | Value |
|---|---|
| Stage | Stage 7 — Knowledge Graph (v0.7) |
| Release target | v0.7 |
| Priority | High |
| Status | ⬜ Not started |
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

- [ ] Embedding pipeline through model router (local preferred)
- [ ] Hybrid retrieval + rerank + context assembly + grounding
- [ ] Retrieval relevance metrics in eval harness
- [ ] Deletion propagates to vector index

## Deliverables

- ai/retrieval

## Exit criteria

- [ ] Measured relevance improvement over lexical baseline

## Source documents

- Technical Spec Suite 04–14 §08
- AI Evolution v1.0→v2.0 §6.2

---
Back to [TRACKER](TRACKER.md)
