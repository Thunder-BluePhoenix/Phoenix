# Phase 52 — Predictive & Proactive Intelligence

| Field | Value |
|---|---|
| Stage | Stage 11 — AI Evolution (v1.1 → v2.0) |
| Release target | v1.8 |
| Priority | Medium |
| Status | 🟨 Consent-driven Kage action-item suggestions with optional scheduled cadence, quiet/noise controls; other trusted producers, user study and v1.8 absent |
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
- [x] Per-user/capability opt-in, nullable explicit 15/30/60/1440-minute cadence, timezone quiet hours, deduplication and hourly limits.
- [x] Delivery/suppression/dismissal counters and Settings controls (real user noise threshold still unmeasured).

## Deliverables

- v1.8 release

## Exit criteria

- [x] Kage suggestions remain bounded and user-tunable; automatic delivery requires persisted opt-in and cadence and rechecks current evidence/kill switch; cross-source usefulness unverified.

## Implementation notes

`@phoenix/ai-proactive` generates bounded read-only suggestions only from structured sources. Core rechecks reviewed accepted unassigned actions against a still-present Kage summary at each evaluation. Suggestions default off: a user must explicitly enable Kage and select a cadence before local scheduling begins. Kill switch, capability disable, source withdrawal and Core shutdown cancel delivery; timezone quiet hours, rate/dedup and dismissal feedback remain enforced. Deployment-window risk, related-incident and dependency-update suggestions produce none because their authenticated providers do not exist. No representative user-rated usefulness study or v1.8 release is claimed.

## Source documents

- AI Evolution v1.0→v2.0 §12

---
Back to [TRACKER](TRACKER.md)
