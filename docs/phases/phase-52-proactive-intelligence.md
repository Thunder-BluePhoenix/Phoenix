# Phase 52 — Predictive & Proactive Intelligence

| Field | Value |
|---|---|
| Stage | Stage 11 — AI Evolution (v1.1 → v2.0) |
| Release target | v1.8 |
| Priority | Medium |
| Status | 🟨 Opt-in manual Kage action-item suggestions, quiet hours and noise controls built; deploy/incident/dependency sources and v1.8 release absent |
| Depends on | [Phase 51 — Agent-to-Agent Collaboration](phase-51-agent-to-agent-collaboration.md) |
| Unblocks | [Phase 53 — Self-Improving Workflows & Evaluation Loop](phase-53-evaluation-feedback-loop.md) |

## Goal

Surface useful information before the user asks — without becoming noisy.

## Scope

**In scope**

- Proactive insights
- Notification policies, quiet hours, per-capability controls

## Tasks

- [ ] Four insight generators have typed input contracts; only accepted unassigned Kage action items have a trusted current Core producer. Deployment windows, incidents and dependency updates remain unavailable.
- [x] Per-user/capability opt-in, timezone-aware quiet hours, deduplication and hourly limits.
- [x] Delivery/suppression/dismissal counters and Settings controls (real user noise threshold still unmeasured).

## Deliverables

- v1.8 release

## Exit criteria

- [x] Current Kage suggestions are bounded, manual-only and user-tunable; cross-source usefulness remains unverified.

## Implementation notes

`@phoenix/ai-proactive` produces bounded read-only suggestions only from structured sources. Core previews and rechecks reviewed, accepted, unassigned action items against a still-present Kage meeting summary before manual delivery. Proactive notifications default off and require explicit `kage` opt-in; no background polling or unsolicited external effects. Deploy-window risk, related-incident and dependency-update suggestions return none because their verified providers do not exist. No representative user-rated usefulness study or v1.8 release is claimed.

## Source documents

- AI Evolution v1.0→v2.0 §12

---
Back to [TRACKER](TRACKER.md)
