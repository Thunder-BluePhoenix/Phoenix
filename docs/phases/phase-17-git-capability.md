# Phase 17 — Git Capability

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | High |
| Status | ✅ Done |
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

- [x] Repository selection with repository_access permission (read-only)
- [x] Watch for commits, branch switches, dirty working tree, merge conflicts
- [x] Emit normalised git.* events; map to states per Appendix A
- [x] Show repo status in Pet Panel
- [x] Tests with fixture repos

## Deliverables

- capabilities/git

## Exit criteria

- [x] Real Git events drive Fawkes state

## Implementation notes

- Builtin capability `git` (`capabilities/git`), installed in every environment, enabled by the user (grants `repository_access`).
- Polls `git status --porcelain=v2 --branch` per repository (`poll_ms`, default 2 s) with `GIT_OPTIONAL_LOCKS=0`; diffs successive snapshots into `git.commit.created`, `git.branch.changed`, `git.working_tree.dirty/clean`, `git.merge_conflict/_resolved`.
- Repo status appears in the Pet Panel as the capability's health message; a full Repositories view can wait for Phase 19 settings.
- Commit messages are secret-redacted and truncated.

## Source documents

- Full System PRD v2.0 §22 Phase 6
- Fawkes PRD v1.0 §10

---
Back to [TRACKER](TRACKER.md)
