# Phase 49 — Controlled Autonomous Agents

| Field | Value |
|---|---|
| Stage | Stage 11 — AI Evolution (v1.1 → v2.0) |
| Release target | v1.5 |
| Priority | High |
| Status | 🟨 User-owned autonomy ceilings, budgets, stop and policy gates built; executable autonomy refused without audited OS sandbox; v1.5 gate not met |
| Depends on | [Phase 48 — Phoenix World Model](phase-48-world-model.md) |
| Unblocks | [Phase 50 — AI Capability Ecosystem](phase-50-ai-capability-ecosystem.md) |

## Goal

Allow bounded tasks to complete without step-by-step interaction, under strict policy.

## Scope

**In scope**

- Autonomy ladder: Observe, Analyze, Propose, Bounded Execute, Supervised Execute, Autonomous Workflow

## Tasks

- [x] Per-capability/environment autonomy ceilings persisted with user-only Core API.
- [x] Action budgets and time limits for non-executing agent sessions.
- [ ] Audited OS sandbox for executable autonomous actions (unavailable; fail closed).
- [x] Kill-switch and rollback safeguards reuse the existing workflow/permission engine; autonomous execution is refused before any effect.
- [ ] CI failure → patch → tests → approval → PR → verified CI (no safe autonomous coding/PR runner exists).
## Deliverables

- v1.5 release

## Exit criteria

- [ ] Autonomy increase passes eval + security release gate

## Source documents

- AI Evolution v1.0→v2.0 §9

## Implementation notes

Migration 18 stores per-capability/environment levels. `AutonomyController` audits the user's settings and enforces process-local run budgets; Core exposes authenticated settings/stop routes but no begin/start API to a browser or agent. The WorkflowEngine's autonomous start refuses because an audited OS sandbox is unavailable. Existing user-driven workflows remain unchanged. Configuring a higher level is **not** permission to execute it. No autonomy-increase eval/security release gate has passed.

---
Back to [TRACKER](TRACKER.md)
