# Phase 66 — « OK Fawkes » Voice Assistant

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | ⬜ Not started |
| Depends on | [Phase 54 — Multimodal Interaction (Speech & Vision)](phase-54-multimodal-interaction.md), [Phase 64 — Dictation Anywhere](phase-64-dictation-anywhere.md) |
| Unblocks | — |

## Goal

Talk to Fawkes hands-free and have it answer and act through Phoenix's capabilities.

## Tasks — parity with Coucou

- [ ] Wake phrase, local recognition, spoken answers
- [ ] Questions about services, switching pills, music, web search, drafting emails
- [ ] Off by default; < 1 % CPU when idle (voice activity detection first); audio never saved

## Tasks — Phoenix improvements

- [ ] Actions go through the tool gateway (Phase 30) with the same approvals as a click; voice may deny but never approve
- [ ] Every voice action is in the audit log

## Deliverables

- Voice assistant in apps/desktop
- Intent → tool mapping

## Exit criteria

- [ ] CPU budget measured and documented
- [ ] A voice request runs a read-only capability action end to end

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
