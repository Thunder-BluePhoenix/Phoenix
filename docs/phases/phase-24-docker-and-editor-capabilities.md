# Phase 24 — Docker & Editor Capabilities

| Field | Value |
|---|---|
| Stage | Stage 2 — Useful Fawkes (v0.2) |
| Release target | v0.2 |
| Priority | Medium |
| Status | ⬜ Not started |
| Depends on | [Phase 21 — Post-MVP Stabilisation](phase-21-post-mvp-stabilization.md) |
| Unblocks | [Phase 26 — Issue Tracker Capabilities & v0.2 Release](phase-26-issue-tracker-capabilities.md) |

## Goal

Add container lifecycle and editor (VS Code-compatible) events.

## Scope

**In scope**

- Docker container lifecycle, build, health
- Editor events (workspace open, save, tasks, diagnostics count)

**Out of scope**

- Kubernetes (later ecosystem)

## Tasks

- [ ] Docker: read-only socket access with explicit permission
- [ ] Events: container started/stopped/unhealthy, image build start/fail
- [ ] Editor extension that emits workspace + task events to Phoenix
- [ ] Map unhealthy → WARNING/ERROR

## Deliverables

- capabilities/docker
- Editor extension

## Exit criteria

- [ ] Unhealthy container visible in Fawkes

## Source documents

- Post-MVP Roadmap v1.0 §4
- Fawkes PRD v1.0 §10

---
Back to [TRACKER](TRACKER.md)
