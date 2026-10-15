# Phase 65 — Botless Notetaker

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | High |
| Status | ⬜ Not started |
| Depends on | [Phase 15 — Kage Adapter & Meeting Lifecycle](phase-15-kage-adapter-meeting-lifecycle.md), [Phase 35 — Kage Decisions & Action-Item Extraction](phase-35-kage-decisions-and-action-items.md), [Phase 64 — Dictation Anywhere](phase-64-dictation-anywhere.md) |
| Unblocks | [Phase 83 — Calendar Awareness & Meeting Prep](phase-83-calendar-and-meeting-prep.md) |

## Goal

Record a call from this computer, without a bot joining, and get transcript, summary and to-dos in Phoenix's meeting pipeline.

## Tasks — parity with Coucou

- [ ] Record microphone + system audio
- [ ] Transcript per person, summary, key points, to-dos
- [ ] Audio deleted once the transcript is written
- [ ] Reminder to tell people the call is recorded

## Tasks — Phoenix improvements

- [ ] Feeds the existing meeting records (Phase 15/16) and decisions/action items (Phase 35), so to-dos can become tasks (Phase 36)
- [ ] Transcribe locally or hand off to Kage
- [ ] RECORDING shown in every Fawkes view for the whole capture (no silent recording)

## Deliverables

- Local capture in apps/desktop
- Meeting pipeline adapter

## Exit criteria

- [ ] A real call is recorded, transcribed and summarised; the audio file is gone afterwards

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.
- Off by default.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
