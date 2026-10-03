# Phase 39 — Workflow Engine

| Field | Value |
|---|---|
| Stage | Stage 8 — Automation & Workflows (v0.8) |
| Release target | v0.8 |
| Priority | High |
| Status | ⬜ Not started |
| Depends on | [Phase 38 — Knowledge Graph & Provenance](phase-38-knowledge-graph-and-provenance.md) |
| Unblocks | [Phase 40 — Workflow Safety & v0.8 Release](phase-40-workflow-safety.md) |

## Goal

Let users define event-driven WHEN / IF / THEN workflows.

## Scope

**In scope**

- Primitives: trigger, condition, context lookup, AI step, capability action, approval gate, retry, timeout, compensation, result event

## Tasks

- [ ] Workflow definition format + validation (declared permissions)
- [ ] Engine executing steps with correlation IDs
- [ ] Example: production deploy fails → inspect logs → diagnose → notify → recovery plan → wait for approval
- [ ] Workflow UI: list, run history, status

## Deliverables

- core/workflows

## Exit criteria

- [ ] Example workflow runs end-to-end

## Source documents

- Post-MVP Roadmap v1.0 §10

---
Back to [TRACKER](TRACKER.md)
