# Phase 25 — Coding-Agent Lifecycle Events

| Field | Value |
|---|---|
| Stage | Stage 2 — Useful Fawkes (v0.2) |
| Release target | v0.2 |
| Priority | High |
| Status | ⬜ Not started |
| Depends on | [Phase 21 — Post-MVP Stabilisation](phase-21-post-mvp-stabilization.md) |
| Unblocks | [Phase 26 — Issue Tracker Capabilities & v0.2 Release](phase-26-issue-tracker-capabilities.md), [Phase 34 — Coding-Agent Orchestration](phase-34-coding-agent-orchestration.md) |

## Goal

Show whether AI coding agents (Codex, Claude Code, …) are working, waiting, done or failed.

## Scope

**In scope**

- agent.started / waiting / completed / failed
- Workspace/repo association

**Out of scope**

- Controlling agents (Phase 34)

## Tasks

- [ ] Define agent.* payload (agent id, workspace, task title)
- [ ] Adapters/hooks for at least one coding agent
- [ ] Map agent.waiting → WAITING with 'input required' notification
- [ ] Show active agents in Pet Panel

## Deliverables

- capabilities/agents (observe-only)

## Exit criteria

- [ ] Fawkes reflects an external agent waiting for input

## Source documents

- Post-MVP Roadmap v1.0 §4
- Fawkes PRD v1.0 §10
- Full System PRD v2.0 Appendix A

---
Back to [TRACKER](TRACKER.md)
