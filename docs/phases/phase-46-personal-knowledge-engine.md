# Phase 46 — Personal Knowledge Engine

| Field | Value |
|---|---|
| Stage | Stage 11 — AI Evolution (v1.1 → v2.0) |
| Release target | v1.2 |
| Priority | High |
| Status | 🟨 Typed knowledge ingestion and classified answer UI built; only PR/CI/deployment metadata wired beyond existing git/meeting/docs; v1.2 not released |
| Depends on | [Phase 45 — Cross-Device Context & Sync](phase-45-cross-device-context.md) |
| Unblocks | [Phase 47 — Multi-Agent Runtime](phase-47-multi-agent-runtime.md) |

## Goal

Evolve memory into a structured knowledge system across all engineering domains.

## Scope

**In scope**

- Domains: repos, PRs, issues, meetings, decisions, architecture docs, deployments, infra, people, incidents, Fawkes interactions

## Tasks

- [ ] Ingest remaining domains (typed 11-domain ingestor exists; production sources for issues, decisions, architecture, infra, people, incidents and Fawkes interactions are not wired).
- [x] Answer with per-item source id, source, confidence and freshness; generated text is a separate hypothesis.
- [x] Distinguish stored fact, retrieved evidence, earlier interpretation and generated hypothesis in the UI.

## Deliverables

- v1.2 release

## Exit criteria

- [ ] Fawkes never presents inference as source-backed fact

## Source documents

- AI Evolution v1.0→v2.0 §6

## Implementation notes

`@phoenix/ai-memory` accepts bounded source-authenticated structured engineering records, never raw descriptions, transcripts, logs or prompts. Core currently maps only trusted GitHub PR, CI and deployment event identifiers/status plus existing git/meetings/docs. The memory answer API returns `facts`, `retrieved_evidence`, `stored_interpretations` and a separately labelled generated `hypothesis`; source confidence is not confidence in model output. Migration 19 adds the evidence kind without dropping pre-existing FTS, vectors, citations or graph provenance. The source-backed-fact UI invariant has behavioral tests, but “never” across every future model and integration is not proved. Event history deletion does not yet purge derived engineering memory; explicit forget and retention still apply.

---
Back to [TRACKER](TRACKER.md)
