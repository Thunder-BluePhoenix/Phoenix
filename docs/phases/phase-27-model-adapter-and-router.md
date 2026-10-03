# Phase 27 — Model Adapter & Router

| Field | Value |
|---|---|
| Stage | Stage 3 — Memory & Context (v0.3) |
| Release target | v0.3 |
| Priority | High |
| Status | ⬜ Not started |
| Depends on | [Phase 26 — Issue Tracker Capabilities & v0.2 Release](phase-26-issue-tracker-capabilities.md) |
| Unblocks | [Phase 28 — Context Engine & Basic Memory Store](phase-28-context-engine-and-memory-store.md) |

## Goal

Introduce a provider-agnostic AI layer with one cloud and one local adapter, optional to core.

## Scope

**In scope**

- Common model interface (text first; embedding role)
- Router by task, privacy, latency, cost, availability
- Visible provider choice

**Out of scope**

- Vision/speech models (Phase 54)

## Tasks

- [ ] Define model interface: generate, stream, embed
- [ ] Implement one local and one cloud adapter
- [ ] Router factors: privacy class, latency, cost, offline availability, user choice
- [ ] Timeouts, retries, safe fallback; never auto-retry side effects
- [ ] AI_external_processing permission gate + visible 'processed by X' label
- [ ] Core keeps working with AI disabled

## Deliverables

- ai/models package

## Exit criteria

- [ ] No silent external AI transmission
- [ ] Core functional without AI

## Source documents

- Technical Spec Suite 04–14 §04, §14 milestone 8
- AI Evolution v1.0→v2.0 §16
- Full System PRD v2.0 §12

---
Back to [TRACKER](TRACKER.md)
