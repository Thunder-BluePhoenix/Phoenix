# Phase 31 — Agent Runtime & First Vertical Slice

| Field | Value |
|---|---|
| Stage | Stage 4 — Fawkes Becomes an Agent (v0.4) |
| Release target | v0.4 |
| Priority | Critical |
| Status | ⬜ Not started |
| Depends on | [Phase 30 — Policy Gateway & Tool Gateway](phase-30-policy-and-tool-gateway.md) |
| Unblocks | [Phase 32 — Fawkes Chat & Approval UX](phase-32-fawkes-chat-and-approval-ux.md), [Phase 33 — AI Evaluation Harness & v0.4 Release](phase-33-ai-evaluation-harness.md) |

## Goal

Build the AI orchestrator and a single bounded agent, proving the full loop end-to-end.

## Scope

**In scope**

- AI Orchestrator, Intent/Task manager
- Agent object model + states
- Observe → Understand → Propose → Approve → Execute → Verify
- CI-failure use case

**Out of scope**

- Multi-agent (Phase 47)

## Tasks

- [ ] Implement request lifecycle: classify → retrieve context → plan → policy check → execute → verify → respond → audit
- [ ] Agent/Task/Plan/ToolRequest/Result/Verification objects
- [ ] Agent states: CREATED → READY → RUNNING → WAITING_APPROVAL → VERIFYING → COMPLETED/FAILED/CANCELLED
- [ ] First agent: CI failure → read logs → check recent commits → likely cause → propose fix
- [ ] Cancel / disable active automation
- [ ] Vertical slice: Fawkes click → task → context → plan → permission → capability → verify → audit → Fawkes

## Deliverables

- ai/orchestrator
- ai/agents
- Vertical slice demo

## Exit criteria

- [ ] Vertical slice works end-to-end and is fully auditable

## Notes & risks

- Tech Spec: complete this slice before building many isolated features.

## Source documents

- Technical Spec Suite 04–14 §04, §07, §14 vertical slice, §17
- Post-MVP Roadmap v1.0 §6

---
Back to [TRACKER](TRACKER.md)
