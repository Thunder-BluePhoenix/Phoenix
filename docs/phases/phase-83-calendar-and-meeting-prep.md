# Phase 83 — Calendar Awareness & Meeting Prep

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | High |
| Status | ⬜ Not started |
| Depends on | [Phase 65 — Botless Notetaker](phase-65-botless-notetaker.md), [Phase 35 — Kage Decisions & Action-Item Extraction](phase-35-kage-decisions-and-action-items.md) |
| Unblocks | — |

## Goal

Fawkes knows what is coming up and prepares you for it.

## Tasks

- [ ] Read-only calendar capability (CalDAV, Google, Microsoft, macOS Calendar)
- [ ] "Meeting in 5 minutes" with a one-click offer to start the notetaker (Phase 65)
- [ ] Prep note: earlier decisions and open action items with the same people or project
- [ ] Deploy-freeze windows from the calendar feed workflow safety (Phase 40)

## Deliverables

- capabilities/calendar
- Meeting prep view

## Exit criteria

- [ ] A real calendar event triggers a reminder and a prep note

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.
- Read-only: Phoenix never creates or changes calendar events without approval.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
