# Phase 22 — GitHub & CI/CD Capability

| Field | Value |
|---|---|
| Stage | Stage 2 — Useful Fawkes (v0.2) |
| Release target | v0.2 |
| Priority | High |
| Status | ⬜ Not started |
| Depends on | [Phase 21 — Post-MVP Stabilisation](phase-21-post-mvp-stabilization.md) |
| Unblocks | [Phase 26 — Issue Tracker Capabilities & v0.2 Release](phase-26-issue-tracker-capabilities.md), [Phase 36 — Action Items → Engineering Tasks](phase-36-action-items-to-engineering-tasks.md) |

## Goal

Bring remote repository, pull request and pipeline events into Fawkes.

## Scope

**In scope**

- GitHub: PRs, reviews, issues, checks
- CI/CD pipeline events (GitHub Actions first)
- Deployment events

**Out of scope**

- Writing to GitHub (comes with approved actions later)

## Tasks

- [ ] OAuth/token auth stored in secure storage
- [ ] Read-only events: pr.opened, review requested, ci.started/failed/passed, deploy.started/succeeded/failed
- [ ] Map: review requested → WAITING, CI running → WORKING, deploy completed → SUCCESS, build failed → ERROR + link
- [ ] Show source + severity distinctly in activity feed
- [ ] Contract tests with recorded fixtures

## Deliverables

- capabilities/github
- CI/CD event mapping

## Exit criteria

- [ ] Real CI failure shows ERROR with a diagnosis link

## Source documents

- Post-MVP Roadmap v1.0 §4
- Fawkes PRD v1.0 §10
- Technical Spec Suite 04–14 §06 examples

---
Back to [TRACKER](TRACKER.md)
