# Phase 22 — GitHub & CI/CD Capability

| Field | Value |
|---|---|
| Stage | Stage 2 — Useful Fawkes (v0.2) |
| Release target | v0.2 |
| Priority | High |
| Status | ✅ Done, with documented gaps (see [gaps register](../gaps.md)) |
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

- [x] OAuth/token auth stored in secure storage (a fine-grained personal access token in the OS keychain; OAuth app flow not built, see notes)
- [x] Read-only events: pr.opened, review requested, ci.started/failed/passed, deploy.started/succeeded/failed
- [x] Map: review requested → WAITING, CI running → WORKING, deploy completed → SUCCESS, build failed → ERROR + link
- [x] Show source + severity distinctly in activity feed (events carry `source: github` and info/success/warning/error severity; rendering belongs to the existing feed, not re-implemented here)
- [x] Contract tests with recorded fixtures (`capabilities/github/test/fixtures/`, recorded from Thunder-BluePhoenix/Phoenix)

## Deliverables

- capabilities/github
- CI/CD event mapping

## Exit criteria

- [x] Real CI failure shows ERROR with a diagnosis link (harness test using the recorded failed run 37145498780; Fawkes ERROR, payload `url` is that run's page)

## Source documents

- Post-MVP Roadmap v1.0 §4
- Fawkes PRD v1.0 §10
- Technical Spec Suite 04–14 §06 examples

## Implementation notes

- Package: [capabilities/github](../../capabilities/github/README.md). Events `github.*`; permissions `network` + `external_api`; secret `token` (optional).
- **Issues are not in this capability.** The scope above lists issues, but Phase 26 owns issue trackers; delivering them once there avoids two implementations.
- Verified against the real API (public repo, unauthenticated and with a token): failed run → `github.ci.failed` with the run's `html_url`, passing run → `github.ci.passed`, `If-None-Match` → `304`, failed job name from the jobs endpoint, PR list. Not verifiable against the real repo (it has none): review requests/reviews, deployments, rate-limit responses, a `401`. Those are covered by a mock GitHub server only.
- Deployments: the repository has no deployments, so that mapping is tested against the documented GitHub shape, not a recorded response.

---
Back to [TRACKER](TRACKER.md)
