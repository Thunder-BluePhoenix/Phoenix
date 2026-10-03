# Phase 28 — Context Engine & Basic Memory Store

| Field | Value |
|---|---|
| Stage | Stage 3 — Memory & Context (v0.3) |
| Release target | v0.3 |
| Priority | High |
| Status | ⬜ Not started |
| Depends on | [Phase 27 — Model Adapter & Router](phase-27-model-adapter-and-router.md) |
| Unblocks | [Phase 29 — Memory Governance & Inspection UX](phase-29-memory-governance-ux.md) |

## Goal

Give Phoenix persistent, scoped, provenance-tagged memory and a context engine that retrieves across domains.

## Scope

**In scope**

- Memory layers: working, episodic, project, preference
- Git, meeting and project memory domains
- Required metadata
- Simple (lexical) retrieval

**Out of scope**

- Vector/graph retrieval (Phases 37–38)

## Tasks

- [ ] Memory schema with source, owner, scope, timestamp, freshness, sensitivity, provenance, confidence, retention
- [ ] Capture pipeline: capture → classify → permission-check → store → index
- [ ] Domain ingestors: Git commits, meeting summaries/decisions, project docs
- [ ] Context engine assembling task context from ≥2 domains
- [ ] Answers distinguish stored facts vs generated interpretation
- [ ] Fawkes question flow: 'what did we decide about X yesterday?'

## Deliverables

- ai/context
- ai/memory

## Exit criteria

- [ ] Context retrieval works across ≥2 domains with sources

## Source documents

- Post-MVP Roadmap v1.0 §5
- Technical Spec Suite 04–14 §08, §14 milestones 9–10

---
Back to [TRACKER](TRACKER.md)
