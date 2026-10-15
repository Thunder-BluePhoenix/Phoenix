# Phase 85 — Focus Mode & Screenshot-to-Issue

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | ⬜ Not started |
| Depends on | [Phase 26 — Issue Tracker Capabilities & v0.2 Release](phase-26-issue-tracker-capabilities.md) |
| Unblocks | — |

## Goal

Quiet Fawkes on demand, and turn what is on screen into an issue.

## Tasks

- [ ] Focus mode: holds notifications except approvals and errors; optional Pomodoro with Fawkes timer
- [ ] Respects OS focus/do-not-disturb where readable
- [ ] Capture a screen region, annotate (arrow, box, text), redact, attach to a draft issue for GitHub/Linear/Jira (Phase 26)
- [ ] Issue is created only with approval

## Deliverables

- Focus mode
- Capture + annotate tool

## Exit criteria

- [ ] Focus mode holds a normal notification and lets an approval through
- [ ] A screenshot becomes a real draft issue

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
