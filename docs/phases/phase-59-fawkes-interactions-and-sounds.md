# Phase 59 — Fawkes Interactions, Emotes & Sounds

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | ⬜ Not started |
| Depends on | [Phase 10 — Animation System & P0 States](phase-10-animation-system-p0-states.md) |
| Unblocks | [Phase 61 — Wardrobe, Per-Source Fawkes & Visible Capabilities](phase-61-wardrobe-and-per-source-fawkes.md), [Phase 91 — Fawkes Rebirth, Milestones, Skin Packs & Accessibility](phase-91-fawkes-rebirth-and-skins.md) |

## Goal

Make Fawkes a character you can interact with, with original motion and sound.

## Tasks — parity with Coucou

- [ ] Greeting on launch
- [ ] Eyes follow the cursor
- [ ] Hover: blinks, eyes grow; click: squish + annoyed; 3 fast clicks: dizzy
- [ ] Emotes with real triggers; happy jump when an agent finishes
- [ ] Sound set for events, a sounds folder to replace any sound, mute
- [ ] On the desktop: follows the cursor, flies home on an alert and back

## Tasks — Phoenix improvements

- [ ] All motion respects reduced motion with a still pose (Phase 10 rule)
- [ ] Sounds respect quiet mode and quiet hours, and are off by default
- [ ] Every emote maps to a real event; Fawkes never fakes a state (Tech Spec §10)

## Deliverables

- pet/assets: original emotes and sounds (CC BY-SA 4.0)
- pet/runtime interactions

## Exit criteria

- [ ] Interaction tests for hover, poke, dizzy and cursor tracking
- [ ] Asset provenance in the licence inventory

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.
- Own assets only: nothing from Coucou's Mochi, sounds or icons.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
