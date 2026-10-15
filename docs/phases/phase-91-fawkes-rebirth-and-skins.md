# Phase 91 — Fawkes Rebirth, Milestones, Skin Packs & Accessibility

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Low |
| Status | ⬜ Not started |
| Depends on | [Phase 59 — Fawkes Interactions, Emotes & Sounds](phase-59-fawkes-interactions-and-sounds.md), [Phase 42 — Capability Registry & v0.9 Release](phase-42-capability-registry.md) |
| Unblocks | — |

## Goal

Make Fawkes' identity count, for everyone.

## Tasks

- [ ] Rebirth animation when an error streak is fixed (e.g. CI red → green), only on a real recovery
- [ ] Opt-in milestones (first green build of the week, PR streaks); nothing to farm
- [ ] Skin packs through the capability registry, with licence and provenance checks
- [ ] Spoken state changes and a high-contrast Fawkes

## Deliverables

- Rebirth and milestone animations (original)
- Skin pack format

## Exit criteria

- [ ] Rebirth plays only after a real recovery event
- [ ] A community skin installs with its licence shown

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
