# Phase 07 — Fawkes Pet Runtime & Placeholder Character

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | Critical |
| Status | ✅ Done |
| Depends on | [Phase 05 — Fawkes State Engine](phase-05-state-engine.md) |
| Unblocks | [Phase 08 — Web App Shell & Navbar Fawkes](phase-08-web-shell-navbar-fawkes.md), [Phase 10 — Animation System & P0 States](phase-10-animation-system-p0-states.md), [Phase 14 — Floating Desktop Fawkes](phase-14-floating-desktop-fawkes.md) |

## Goal

Build the reusable pet runtime that turns state into visuals, using a placeholder Fawkes so UI work is not blocked on art.

## Scope

**In scope**

- pet/runtime, pet/states, pet/interaction
- State→animation mapping
- Placeholder Fawkes asset
- Asset/runtime separation

**Out of scope**

- Final artwork (Phase 10)

## Tasks

- [x] Define renderer interface (DOM/SVG or Canvas per ADR) independent of character assets
- [x] Implement state→animation mapping table loaded from pet/states
- [x] Implement interaction hooks: click, hover, drag (pet.clicked event)
- [x] Create original placeholder Fawkes (simple shape per state + text label)
- [x] Implement reduced-motion mode (static frames + text)
- [x] Keep CPU/GPU idle cost low (pause when hidden)
- [x] Unit tests for state→animation mapping

## Deliverables

- pet/ runtime package
- Placeholder Fawkes asset set

## Exit criteria

- [x] Each state renders a distinct visual with text
- [x] Reduced-motion works

## Notes & risks

- Never ship Codex Pets / Coucou assets.

## Progress log

- 2026-10-03: pet/states (declarative state → animation/label/tone), pet/assets (original placeholder Fawkes SVG + CSS animations, CC BY-SA 4.0), pet/runtime (mountFawkes: accessible button, live-region announcements, recording badge independent of state, reduced motion auto/forced, pause when hidden, click + pointer drag).
- pet/interaction was folded into pet/runtime/src/interaction.ts — too small for its own package.
- Browser code typechecks separately (tsconfig.web.json) so DOM globals never leak into core. 35 tests (happy-dom).

## Source documents

- Full System PRD v2.0 §17, §22 Phase 1
- Fawkes PRD v1.0 §7.1

---
Back to [TRACKER](TRACKER.md)
