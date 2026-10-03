# Phase 23 — Frappe / ERPNext Capability

| Field | Value |
|---|---|
| Stage | Stage 2 — Useful Fawkes (v0.2) |
| Release target | v0.2 |
| Priority | High |
| Status | ⬜ Not started |
| Depends on | [Phase 21 — Post-MVP Stabilisation](phase-21-post-mvp-stabilization.md) |
| Unblocks | [Phase 26 — Issue Tracker Capabilities & v0.2 Release](phase-26-issue-tracker-capabilities.md), [Phase 36 — Action Items → Engineering Tasks](phase-36-action-items-to-engineering-tasks.md) |

## Goal

Observe bench, site, build, migration and deployment activity for Frappe developers.

## Scope

**In scope**

- frappe.bench.*, frappe.migration.*, frappe.site.unhealthy, build/deploy events

**Out of scope**

- Creating Frappe records (Phase 36)

## Tasks

- [ ] Bench/site discovery and health polling
- [ ] Events: bench restart, build, migration completed, site health, deployment
- [ ] Map site.unhealthy → ERROR
- [ ] Panel view for site health
- [ ] Tests against a local bench fixture

## Deliverables

- capabilities/frappe

## Exit criteria

- [ ] Frappe site failure drives Fawkes ERROR

## Source documents

- Post-MVP Roadmap v1.0 §4
- Full System PRD v2.0 Appendix A
- Fawkes PRD v1.0 §10

---
Back to [TRACKER](TRACKER.md)
