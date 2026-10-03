# Phase 17 — Git Capability

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | High |
| Status | ⬜ Not started |
| Depends on | [Phase 13 — Capability SDK, Mock Capability & Event Simulator](phase-13-capability-sdk-mock-simulator.md) |
| Unblocks | [Phase 20 — Hardening, E2E, Observability & v0.1 Release](phase-20-hardening-and-v0-1-release.md) |

## Goal

Make Fawkes react to real local Git activity.

## Scope

**In scope**

- Local repo watcher
- Events: commit.created, branch changed, dirty state, merge conflict

**Out of scope**

- GitHub remote API (Phase 22)

## Tasks

- [ ] Repository selection with repository_access permission (read-only)
- [ ] Watch for commits, branch switches, dirty working tree, merge conflicts
- [ ] Emit normalised git.* events; map to states per Appendix A
- [ ] Show repo status in Pet Panel
- [ ] Tests with fixture repos

## Deliverables

- capabilities/git

## Exit criteria

- [ ] Real Git events drive Fawkes state

## Source documents

- Full System PRD v2.0 §22 Phase 6
- Fawkes PRD v1.0 §10

---
Back to [TRACKER](TRACKER.md)
