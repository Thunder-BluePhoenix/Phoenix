# Phase 38 — Knowledge Graph & Provenance

| Field | Value |
|---|---|
| Stage | Stage 7 — Knowledge Graph (v0.7) |
| Release target | v0.7 |
| Priority | High |
| Status | ⬜ Not started |
| Depends on | [Phase 37 — Hybrid Retrieval (Lexical + Vector + Rerank)](phase-37-hybrid-retrieval.md) |
| Unblocks | [Phase 39 — Workflow Engine](phase-39-workflow-engine.md) |

## Goal

Model relationships between people, meetings, decisions, features, commits, issues and deployments.

## Scope

**In scope**

- Graph store (evaluate Neo4j or compatible)
- Core entities + relations
- Graph + document retrieval
- Provenance inspection UI

## Tasks

- [ ] Pick graph store via ADR (licence compatible)
- [ ] Entities/relations: Person, Project, Repository, Commit, Service, Deployment, Meeting, Decision, Feature, Issue
- [ ] Ingest from existing capabilities
- [ ] Answer 'why/which/who' graph questions
- [ ] UI to inspect origin of important context
- [ ] Release v0.7

## Deliverables

- ai/knowledge-graph
- v0.7 release

## Exit criteria

- [ ] Graph/hybrid retrieval proves measurable value (gate v0.7 → v0.8)

## Notes & risks

- Add GraphRAG only when measurably useful.

## Source documents

- Post-MVP Roadmap v1.0 §9
- Technical Spec Suite 04–14 §08

---
Back to [TRACKER](TRACKER.md)
