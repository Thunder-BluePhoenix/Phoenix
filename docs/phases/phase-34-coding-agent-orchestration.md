# Phase 34 — Coding-Agent Orchestration

| Field | Value |
|---|---|
| Stage | Stage 5 — Developer-Agent Orchestration (v0.5) |
| Release target | v0.5 |
| Priority | High |
| Status | ⬜ Not started |
| Depends on | [Phase 33 — AI Evaluation Harness & v0.4 Release](phase-33-ai-evaluation-harness.md), [Phase 25 — Coding-Agent Lifecycle Events](phase-25-coding-agent-lifecycle-events.md) |
| Unblocks | — |

## Goal

Coordinate existing coding agents through Phoenix rather than replacing them.

## Scope

**In scope**

- External agent as capability
- Track workspace, lifecycle, waiting states
- Link agent output to commits, tasks, CI
- Provide authorised context to agents
- Audit trail

## Tasks

- [ ] Promote coding-agent adapter to full capability with commands
- [ ] Correlate agent sessions ↔ commits ↔ CI runs via correlation_id
- [ ] Hand authorised context to agents through tool gateway
- [ ] Handoffs between capabilities (agent → git → CI)
- [ ] Release v0.5

## Deliverables

- Agent orchestration capability
- v0.5 release

## Exit criteria

- [ ] ≥1 external agent represented as capability
- [ ] Agent actions permission-controlled
- [ ] Agent output linked to commits/CI (gate v0.5 → v0.6)

## Source documents

- Post-MVP Roadmap v1.0 §7

---
Back to [TRACKER](TRACKER.md)
