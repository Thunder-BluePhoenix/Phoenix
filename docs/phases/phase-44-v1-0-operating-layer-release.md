# Phase 44 — v1.0 — Developer Operating Layer Release

| Field | Value |
|---|---|
| Stage | Stage 10 — Developer Operating Layer (v1.0) |
| Release target | v1.0 |
| Priority | Critical |
| Status | 🟨 v1 inventory, compatibility and release decision checklist documented; beta, L2–L3 evidence, independent security/licence review and v1.0 tag remain outstanding |
| Depends on | [Phase 43 — Developer Preview Programme](phase-43-developer-preview-program.md) |
| Unblocks | [Phase 45 — Cross-Device Context & Sync](phase-45-cross-device-context.md) |

## Goal

Ship the stable platform: ambient Fawkes, events, SDK, memory, hybrid/graph retrieval, agents, meeting pipeline, workflows, security.

## Scope

**In scope**

- Stable contracts + compatibility guarantees
- AI maturity L2–L3

## Tasks

- [ ] Verify the v1.0 capability set against end-to-end clean-profile evidence (inventory and acceptance tests defined in `docs/release/v1-verification.md`).
- [x] Publish the current protocol/SDK compatibility baseline and conditional publication guarantees (not yet a published SDK v1 package).
- [ ] Final independent security & licence review.
- [ ] Tag v1.0 only after the preview and release gates pass and the owner signs off.

## Deliverables

- Phoenix v1.0

## Exit criteria

- [ ] All v1.0 capabilities present and stable
- [ ] AI reliably supports L2–L3

## Source documents

- Post-MVP Roadmap v1.0 §12
- AI Evolution v1.0→v2.0 §3


## Implementation notes

See [v1 verification and release decision](../release/v1-verification.md). No v1.0 release is claimed: the third-party sandbox, independent preview/install evidence and human-reviewed L2–L3 measurements are missing. A passing offline test suite alone does not meet this phase's exit criteria.
---
Back to [TRACKER](TRACKER.md)
