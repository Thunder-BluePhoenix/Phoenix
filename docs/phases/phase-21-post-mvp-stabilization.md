# Phase 21 — Post-MVP Stabilisation

| Field | Value |
|---|---|
| Stage | Stage 2 — Useful Fawkes (v0.2) |
| Release target | v0.2 |
| Priority | Critical |
| Status | ⬜ Not started |
| Depends on | [Phase 20 — Hardening, E2E, Observability & v0.1 Release](phase-20-hardening-and-v0-1-release.md) |
| Unblocks | [Phase 22 — GitHub & CI/CD Capability](phase-22-github-and-cicd-capability.md), [Phase 23 — Frappe / ERPNext Capability](phase-23-frappe-erpnext-capability.md), [Phase 24 — Docker & Editor Capabilities](phase-24-docker-and-editor-capabilities.md), [Phase 25 — Coding-Agent Lifecycle Events](phase-25-coding-agent-lifecycle-events.md) |

## Goal

Harden the MVP based on real usage before adding breadth (90-day plan, weeks 1–2).

## Scope

**In scope**

- Bug fixing
- State-machine hardening
- Opt-in telemetry/feedback loop
- Desktop + settings polish

**Out of scope**

- New integrations

## Tasks

- [ ] Triage and fix MVP bugs from early users
- [ ] Add regression tests for every fixed state-engine bug
- [ ] Opt-in, documented telemetry + feedback channel
- [ ] Polish floating Fawkes and settings (90-day plan weeks 5–6)
- [ ] Tune notification noise defaults

## Deliverables

- v0.1.x patch releases

## Exit criteria

- [ ] Core event/state/pet loop stable (gate MVP → v0.2)

## Notes & risks

- Metrics never justify weakening privacy or safety.

## Source documents

- Post-MVP Roadmap v1.0 §18, §19

---
Back to [TRACKER](TRACKER.md)
