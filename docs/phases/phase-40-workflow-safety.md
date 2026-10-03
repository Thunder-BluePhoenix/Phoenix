# Phase 40 — Workflow Safety & v0.8 Release

| Field | Value |
|---|---|
| Stage | Stage 8 — Automation & Workflows (v0.8) |
| Release target | v0.8 |
| Priority | High |
| Status | ⬜ Not started |
| Depends on | [Phase 39 — Workflow Engine](phase-39-workflow-engine.md) |
| Unblocks | [Phase 41 — SDK Stabilisation & Developer Docs](phase-41-sdk-stabilization-and-docs.md) |

## Goal

Make workflows stop safely, require authorisation for production, and roll back where possible.

## Scope

**In scope**

- Approval gates
- Rollback/compensation
- Kill switch
- Failure handling

## Tasks

- [ ] Production workflows require explicit authorisation
- [ ] Failed workflows stop safely; compensation where supported
- [ ] Destructive steps require confirmation
- [ ] Workflow reliability metrics
- [ ] Release v0.8

## Deliverables

- Workflow safety layer
- v0.8 release

## Exit criteria

- [ ] Workflow execution reliable and safe (gate v0.8 → v0.9)

## Source documents

- Post-MVP Roadmap v1.0 §10.2

---
Back to [TRACKER](TRACKER.md)
