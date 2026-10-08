# Phase 21 — Post-MVP Stabilisation

| Field | Value |
|---|---|
| Stage | Stage 2 — Useful Fawkes (v0.2) |
| Release target | v0.2 |
| Priority | Critical |
| Status | 🟨 In progress |
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

- [ ] Triage and fix MVP bugs from early users (no early-user reports exist yet)
- [x] Add regression tests for every fixed state-engine bug (no state-engine bug has been found; `core/runtime/test/robustness.test.ts` throws 4,500 hostile events at the runtime over 3 seeds and one of them reproduces the Phase 20 crash)
- [ ] Opt-in, documented telemetry + feedback channel (blocked on a decision: the README promises "no telemetry", so what is sent and where it goes must be chosen by the project)
- [ ] Polish floating Fawkes and settings (90-day plan weeks 5–6)
- [ ] Tune notification noise defaults (partly done, see notes)

## Deliverables

- v0.1.x patch releases

## Exit criteria

- [ ] Core event/state/pet loop stable (gate MVP → v0.2)

## Notes & risks

- Metrics never justify weakening privacy or safety.
- This phase was started before Phase 20 closed (packaging, signing and the release tag are still open), only on items that need no decision and no new integration. The stage gate in the tracker still applies to everything else.
- Notification noise, measured by replaying the demo scenarios and synthetic bursts through the real service with the default preferences (warnings and errors, 30 s duplicate window):
  - The 9 demo scenarios produce 0 or 1 notification each; builds, tests, deploys and agent runs that succeed are silent. The defaults were not changed, since there is no real usage to tune them against.
  - A failure that kept repeating re-alerted every 30 s (a build retried every 10 s for 10 minutes gave 20 alerts). The quiet period now slides: it notifies once and stays quiet until the problem has stopped for 30 s (1 alert). Distinct problems still each notify (40 different failing commands: 40).
  - Not changed: a capability that flaps with a period over 30 s (down 20 s, up 20 s, repeatedly) still notifies on every outage, 90 alerts in an hour. Each outage is a separate event outside the window. Folding those would need a rule about how many outages count as "the same problem", which is a product decision.
  - A problem that returns every 2 minutes also notifies each time (20 over 40 minutes).

## Source documents

- Post-MVP Roadmap v1.0 §18, §19

---
Back to [TRACKER](TRACKER.md)
