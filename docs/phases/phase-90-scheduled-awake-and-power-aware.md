# Phase 90 — Scheduled Awake Windows & Power-Aware Scheduling

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | ⬜ Not started |
| Depends on | [Phase 73 — Lid-Closed Mode, Recovery & Power Floors](phase-73-lid-closed-mode-and-recovery.md) |
| Unblocks | — |

## Goal

Plan when the machine stays awake and when heavy work runs.

## Tasks

- [ ] Scheduled awake windows (e.g. 23:00–07:00) for overnight agent runs
- [ ] Wake on a schedule to start a job (`pmset schedule` on macOS, RTC wake on Linux, Task Scheduler on Windows)
- [ ] Power-aware queue: heavy agent or batch jobs wait for the charger
- [ ] Keep awake from the phone (Phase 71)

## Deliverables

- Schedules in capabilities/awake

## Exit criteria

- [ ] A scheduled overnight window keeps a real machine awake and releases it on time

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
