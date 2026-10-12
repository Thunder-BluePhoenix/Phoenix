# Phase 47 — Multi-Agent Runtime

| Field | Value |
|---|---|
| Stage | Stage 11 — AI Evolution (v1.1 → v2.0) |
| Release target | v1.3 |
| Priority | High |
| Status | 🟨 Typed CI and meeting-decision specialists registered in Core with scoped tools and structured handoffs; planning specialist and v1.3 release absent |
| Depends on | [Phase 46 — Personal Knowledge Engine](phase-46-personal-knowledge-engine.md) |
| Unblocks | [Phase 48 — Phoenix World Model](phase-48-world-model.md) |

## Goal

Move from one general agent to specialised agents (coding, research, DevOps, meeting, planning).

## Scope

**In scope**

- Agent contracts: identity, allowed capabilities, context needs, output schema, max scope, approvals, timeouts, audit, eval criteria
- Shared context

## Tasks

- [x] Agent contract schema + registry (identity, grants, schemas, scope, approvals, timeout, audit/eval).
- [ ] Implement 2–3 specialised agents (two: CI investigation and Kage meeting-decision review; planning remains).
- [x] Agents exchange verified structured handoffs, not chat dumps.
- [x] Per-agent evaluation tests for tool scope, malformed output, provenance and cancellation.

## Deliverables

- v1.3 release

## Exit criteria

- [ ] Specialised agents run under typed contracts

## Source documents

- AI Evolution v1.0→v2.0 §7
- Technical Spec Suite 04–14 §07

## Implementation notes

`@phoenix/ai-orchestrator` validates specialist contracts at submission, planning, tool invocation and handoff. The CI specialist only reads the exact authorised repository context; the meeting specialist reads Kage summary as sensitive and emits advisory decisions with evidence ids. Core registers both. External coding agents are not the specialised runtime: the Phase 34 real-agent gap remains. No v1.3 release or broad production evaluation was performed.

---
Back to [TRACKER](TRACKER.md)
