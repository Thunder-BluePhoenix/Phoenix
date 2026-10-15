# Phase 46 — Personal Knowledge Engine

| Field | Value |
|---|---|
| Stage | Stage 11 — AI Evolution (v1.1 → v2.0) |
| Release target | v1.2 |
| Priority | High |
| Status | 🟨 Typed knowledge ingestion and classified answer UI built; authenticated issue-transition and PR/CI/deployment metadata wired beyond existing git/meeting/docs, other domains lack vetted producers; v1.2 not released |
| Depends on | [Phase 45 — Cross-Device Context & Sync](phase-45-cross-device-context.md) |
| Unblocks | [Phase 47 — Multi-Agent Runtime](phase-47-multi-agent-runtime.md) |

## Goal

Evolve memory into a structured knowledge system across all engineering domains.

## Scope

**In scope**

- Domains: repos, PRs, issues, meetings, decisions, architecture docs, deployments, infra, people, incidents, Fawkes interactions

## Tasks

- [ ] Ingest all engineering domains (typed 11-domain ingestor exists; trusted issue transitions now join PR/CI/deployments, while decisions, architecture, infra, people, incidents and Fawkes interactions lack verified producers).
- [x] Answer with per-item source id, source, confidence and freshness; generated text is a separate hypothesis.
- [x] Distinguish stored fact, retrieved evidence, earlier interpretation and generated hypothesis in the UI.

## Deliverables

- v1.2 release

## Exit criteria

- [ ] Fawkes never presents inference as source-backed fact

## Source documents

- AI Evolution v1.0→v2.0 §6

## Implementation notes

`@phoenix/ai-memory` accepts bounded source-authenticated structured records, never raw descriptions, transcripts, logs or prompts. Core maps validated issue tracker keys/category transitions, GitHub PR/CI/deployment identifiers/status and existing git/meetings/docs. Issue titles, status labels, URLs and people are excluded; owner/issue scope, freshness and retention are enforced. The answer API separates `facts`, `retrieved_evidence`, `stored_interpretations` and generated `hypothesis`; source confidence does not certify model output. Migration 19 adds the `evidence` memory kind. Migration 21 adds the cascade that removes git- and GitHub-derived memories (with their FTS, vector and graph copies) when their source events are deleted; migration 24 recreates that trigger to cover issue-derived memories as well. Neither loses existing FTS, vectors or graph provenance (populated-upgrade tests). The UI invariant has behavioral tests, but independent corpus evaluation across domains remains open.

---
Back to [TRACKER](TRACKER.md)
