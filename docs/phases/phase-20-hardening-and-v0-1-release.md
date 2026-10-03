# Phase 20 — Hardening, E2E, Observability & v0.1 Release

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | Critical |
| Status | ⬜ Not started |
| Depends on | [Phase 14 — Floating Desktop Fawkes](phase-14-floating-desktop-fawkes.md), [Phase 16 — Meetings UI & Recording Indicator](phase-16-meetings-ui.md), [Phase 17 — Git Capability](phase-17-git-capability.md), [Phase 18 — Terminal / Process Capability](phase-18-terminal-process-capability.md), [Phase 19 — Settings & Privacy Controls](phase-19-settings-and-privacy.md), [Phase 10 — Animation System & P0 States](phase-10-animation-system-p0-states.md) |
| Unblocks | [Phase 21 — Post-MVP Stabilisation](phase-21-post-mvp-stabilization.md) |

## Goal

Prove the MVP is safe and reliable, then package and release Phoenix v0.1.

## Scope

**In scope**

- Security review + threat model check
- E2E suite
- Observability
- Packaging + release notes
- Licence compliance

**Out of scope**

- New features

## Tasks

- [ ] Walk the threat model (PRD §18) and verify each mitigation
- [ ] E2E: meeting start → transcript → summary → approved action
- [ ] Failure tests: broken capability cannot crash core
- [ ] Observability: structured logs, capability health, event latency/failure, active tasks, Kage duration, WS reconnects
- [ ] Diagnostic export without secrets or raw meeting content
- [ ] Package web + desktop builds with licence notices
- [ ] Update dependency/asset licence inventory
- [ ] Verify v0.1 Definition of Done checklist; tag release

## Deliverables

- Phoenix v0.1 release
- Security review notes
- E2E suite in CI

## Exit criteria

- [ ] Every item in PRD v2.0 §30 Definition of Done is checked
- [ ] MVP success: a developer installs Phoenix, sees Fawkes react to real events, runs a Kage meeting and gets a summary

## Notes & risks

- Gate MVP → v0.2: core event/state/pet loop is stable.

## Source documents

- Full System PRD v2.0 §18, §20, §21, §24, §30
- Fawkes PRD v1.0 §16, §24

---
Back to [TRACKER](TRACKER.md)
