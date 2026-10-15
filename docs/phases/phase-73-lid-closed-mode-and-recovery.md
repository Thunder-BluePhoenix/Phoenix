# Phase 73 — Lid-Closed Mode, Recovery & Power Floors

| Field | Value |
|---|---|
| Stage | Stage 13 — Insomnia parity and beyond (keep awake) |
| Release target | Post-v2.0 track |
| Priority | High |
| Status | ⬜ Not started |
| Depends on | [Phase 72 — Keep-Awake Sessions (No Root)](phase-72-keep-awake-sessions.md) |
| Unblocks | [Phase 74 — Lid-Close Actions](phase-74-lid-close-actions.md), [Phase 90 — Scheduled Awake Windows & Power-Aware Scheduling](phase-90-scheduled-awake-and-power-aware.md) |

## Goal

Keep a laptop working with the lid closed, and always undo what was changed.

## Tasks — parity with Insomnia

- [ ] `pmset -a disablesleep` during a session through an opt-in privileged helper
- [ ] Recovery journal written before every change; reconcile at launch; launchd backstop every minute; recovery lock
- [ ] Lid observer
- [ ] Battery floors (Low Power Mode below 40 %, end below 10 %) and heat rules (Low Power Mode at serious, end at critical), on by default
- [ ] Quit refuses while a change still needs undoing

## Tasks — Phoenix improvements

- [ ] The helper exposes only the two settings it needs; Phoenix's runtime never holds root; install and uninstall scripts the user runs and can read
- [ ] Safety warning (ventilation, bag) before the first lid-closed session
- [ ] Every privileged change is in the audit log

## Deliverables

- Privileged helper + install/uninstall scripts
- Recovery journal and backstop

## Exit criteria

- [ ] Killing Phoenix mid-session still restores sleep within a minute of the session end
- [ ] Uninstall leaves no root rule behind

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.
- Phoenix does not install the helper itself; the user runs the reviewed script.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
