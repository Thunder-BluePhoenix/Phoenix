# Phase 60 — Fawkes Island (Notch / Top Edge) & Desktop Platforms

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | ⬜ Not started |
| Depends on | [Phase 14 — Floating Desktop Fawkes](phase-14-floating-desktop-fawkes.md) |
| Unblocks | [Phase 64 — Dictation Anywhere](phase-64-dictation-anywhere.md) |

## Goal

An optional island mode: Fawkes lives in the notch on Macs that have one and at the top edge of the screen elsewhere.

## Tasks — parity with Coucou

- [ ] Island states hidden → small → expanded
- [ ] Invisible when idle, peeks on hover
- [ ] Pick the display or follow the mouse; works without a notch
- [ ] Linux: gtk-layer-shell (wlroots, KDE, COSMIC), XWayland dock on GNOME, click-through input region
- [ ] Windows: top-edge window that never steals focus
- [ ] Windows Credential Manager for secrets

## Tasks — Phoenix improvements

- [ ] Island, floating Fawkes and navbar Fawkes share one state and can be switched live
- [ ] Closes the Phase 14 Linux/Windows gaps with CI builds on all three OSes

## Deliverables

- apps/desktop island window
- Linux and Windows desktop CI jobs

## Exit criteria

- [ ] Island works on macOS (notch and no notch), one Linux compositor and Windows

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
