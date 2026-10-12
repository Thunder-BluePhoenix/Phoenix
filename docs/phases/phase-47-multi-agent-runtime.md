# Phase 47 — Multi-Agent Runtime

| Field | Value |
|---|---|
| Stage | Stage 11 — AI Evolution (v1.1 → v2.0) |
| Release target | v1.3 |
| Priority | High |
| Status | 🟨 CI, Kage meeting review and aggregate-only planning review specialists run under typed grants; real production evaluation and v1.3 release absent |
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
- [x] Three bounded specialists: CI investigation, Kage meeting review and aggregate-only planning review (`plans.review_context` contains no plan text or meeting quote).
- [x] Agents exchange verified structured handoffs, not chat dumps.
- [x] Per-agent evaluation tests for tool scope, malformed output, provenance and cancellation.

## Deliverables

- v1.3 release

## Exit criteria

- [x] Three registered specialists run under typed contracts in Core; independent real-task evaluation and v1.3 release remain open.

## Source documents

- AI Evolution v1.0→v2.0 §7
- Technical Spec Suite 04–14 §07

## Implementation notes

`@phoenix/ai-orchestrator` validates specialist contracts at submission, planning, tool invocation and handoff. CI reads only exact authorised repository context. Meeting review reads sensitive Kage summary and emits advisory evidence-bound decisions. Planning review reads only policy-authorized aggregate counts through `plans.review_context`; the command refuses unconsented meeting context, contains no plan titles/bodies or task-creation keys and cannot approve/create. Core registers all three. No real coding-agent specialist, independent production evaluation or v1.3 release was verified.

---
Back to [TRACKER](TRACKER.md)
