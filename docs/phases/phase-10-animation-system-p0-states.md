# Phase 10 — Animation System & P0 States

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | High |
| Status | ⬜ Not started |
| Depends on | [Phase 07 — Fawkes Pet Runtime & Placeholder Character](phase-07-fawkes-pet-runtime.md) |
| Unblocks | [Phase 20 — Hardening, E2E, Observability & v0.1 Release](phase-20-hardening-and-v0-1-release.md) |

## Goal

Replace placeholders with original Fawkes artwork and a proper animation system covering all P0 states.

## Scope

**In scope**

- P0: idle, blink, working, thinking, waiting, success, error
- P1 stretch: recording, deploying, sleep, celebration
- Reduced-motion fallbacks
- Asset provenance

**Out of scope**

- Personality / chat

## Tasks

- [ ] Commission or create original Fawkes artwork; record licence + provenance
- [ ] Produce P0 animations in chosen format
- [ ] Implement smooth transitions + interruptibility (ERROR pre-empts anything)
- [ ] Reduced-motion static variant for every animation
- [ ] Performance budget test (CPU/GPU at idle)
- [ ] Animation tests: state→animation mapping
- [ ] Start P1 animations if time allows

## Deliverables

- pet/assets Fawkes P0 set
- pet/animations system

## Exit criteria

- [ ] PRD Phase 1 exit: P0 states work
- [ ] Provenance documented in licence inventory

## Notes & risks

- Animations supplement information; they never replace critical text.

## Source documents

- Full System PRD v2.0 §17, §25
- Fawkes PRD v1.0 §19

---
Back to [TRACKER](TRACKER.md)
