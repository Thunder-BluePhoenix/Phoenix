# Phase 40 — Workflow Safety & v0.8 Release

| Field | Value |
|---|---|
| Stage | Stage 8 — Automation & Workflows (v0.8) |
| Release target | v0.8 |
| Priority | High |
| Status | 🟨 Safety layer built and tested in-process (seeded stress run, mutation checks); release v0.8 not cut, gate not marked (see [gaps register](../gaps.md)) |
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

- [x] Production workflows require explicit authorisation
- [x] Failed workflows stop safely; compensation where supported
- [x] Destructive steps require confirmation
- [x] Workflow reliability metrics
- [ ] Release v0.8

## Deliverables

- Workflow safety layer
- v0.8 release

## Exit criteria

- [ ] Workflow execution reliable and safe (gate v0.8 → v0.9)

## Implementation notes

- Same package (`core/workflows`); decisions in [ADR-0021](../adr/ADR-0021-workflow-engine.md). Migration 13 adds `workflow_authorisations` and `workflow_counters`.
- Production authorisation: `WorkflowAdmin.authorise` (hash-bound, optional expiry, revocable, audited); required for production environment or any production/critical/unknown tool. Unauthorised triggers are recorded as `refused` runs with a `workflow.run.refused` event and an audit record.
- Destructive steps: decided from the tool contract; validation rejects a destructive action reachable before an approval step; the runner refuses it again until an approval step succeeded in the run.
- Failure: stop, undo in reverse order (once each, never retried), undo failures and unknown outcomes end `failed_needs_attention`; step timeout abandons the call.
- Kill switch: running runs cancelled, no undo attempted (calls are blocked), waiting approvals rejected, new runs refused.
- Metrics: `engine.metrics()` (counts by outcome, step failure rate, p50/p90/p99 duration, approvals waiting/approved/rejected/expired); counters persist in the same transactions as state changes.
- Reliability: `test/stress.test.ts` (seeded; 700+ runs, 7 simulated crashes by closing and reopening the SQLite file, kill-switch toggles, tool errors, timeouts) asserts the invariants from the roadmap.
- Not done: the v0.8 release itself and the gate checkbox.

## Source documents

- Post-MVP Roadmap v1.0 §10.2

---
Back to [TRACKER](TRACKER.md)
