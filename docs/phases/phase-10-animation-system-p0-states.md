# Phase 10 — Animation System & P0 States

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | High |
| Status | ✅ Done |
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

- [x] Create original Fawkes artwork (`pet/assets/src/fawkes.ts`, hand-written SVG); licence + provenance in the inventory
- [x] Produce P0 animations in chosen format (SVG + CSS keyframes, ADR-0018): idle (breathe, blink, embers), working, thinking, waiting, success, error
- [x] Interruptibility: every loop starts at the neutral pose (test-enforced), state changes switch immediately, ERROR pre-empts a celebration (runtime test). No cross-fades: switches move at most a few degrees
- [x] Reduced-motion still pose for every state, distinct from each other (test-enforced)
- [x] Performance budget: keyframes may animate only transform/opacity; idle runs at most three loops of ≥3 s (test-enforced). Measured in the app: idle = 3 slow loops; error settles to 1 pulse; all pause when the tab is hidden
- [x] Animation tests: state→animation mapping, every animation implemented, interruption
- [x] P1 animations: recording, deploying, sleep, celebration (plus listening, warning, offline)

## Deliverables

- pet/assets Fawkes P0 set
- pet/animations system

## Exit criteria

- [x] PRD Phase 1 exit: P0 states work
- [x] Provenance documented in licence inventory

## Notes & risks

- Animations supplement information; they never replace critical text.

## Implementation notes

- Previews: [animated](../images/fawkes-states.svg) and [reduced motion](../images/fawkes-states-still.svg), generated from the shipped asset by `scripts/render-fawkes-gallery.ts`.
- The Phase 07 placeholder (and its preview PNG) was removed; `fawkes` is the runtime default.
- ERROR shakes three times, then settles into one slow crest pulse: persistent without being frantic.

## Source documents

- Full System PRD v2.0 §17, §25
- Fawkes PRD v1.0 §19

---
Back to [TRACKER](TRACKER.md)
