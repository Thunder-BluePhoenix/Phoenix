# Phase 74 — Lid-Close Actions

| Field | Value |
|---|---|
| Stage | Stage 13 — Insomnia parity and beyond (keep awake) |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | ⬜ Not started |
| Depends on | [Phase 73 — Lid-Closed Mode, Recovery & Power Floors](phase-73-lid-closed-mode-and-recovery.md) |
| Unblocks | — |

## Goal

When the lid closes during a session, save power and quiet the machine; undo it all when it opens.

## Tasks — parity with Insomnia

- [ ] Display and keyboard light off, brightness saved and restored
- [ ] Freeze listed apps with `SIGSTOP` (default Slack, WhatsApp, Discord); never meeting, recording or dictation apps; only unfreeze what it can prove it froze
- [ ] Mute every output, restore on open even after switching outputs
- [ ] Low Power Mode on
- [ ] Freeze Docker Desktop when no container runs (off by default)
- [ ] Turn App Nap off for agent apps (opt-in, journalled)

## Tasks — Phoenix improvements

- [ ] Protected list always includes Phoenix, terminals, editors and running coding agents
- [ ] Docker idleness comes from Phoenix's Docker capability

## Deliverables

- Lid actions in capabilities/awake

## Exit criteria

- [ ] Each action is undone on lid open and by the backstop; tested with a lid simulation

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
