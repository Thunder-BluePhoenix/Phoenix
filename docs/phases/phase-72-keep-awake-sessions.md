# Phase 72 — Keep-Awake Sessions (No Root)

| Field | Value |
|---|---|
| Stage | Stage 13 — Insomnia parity and beyond (keep awake) |
| Release target | Post-v2.0 track |
| Priority | High |
| Status | ⬜ Not started |
| Depends on | [Phase 13 — Capability SDK, Mock Capability & Event Simulator](phase-13-capability-sdk-mock-simulator.md) |
| Unblocks | [Phase 73 — Lid-Closed Mode, Recovery & Power Floors](phase-73-lid-closed-mode-and-recovery.md), [Phase 75 — Agent Continuity: Network Failover, tmux Nudge, Browser Throttling](phase-75-agent-continuity-extras.md) |

## Goal

Keep the computer awake for a bounded time while agents, builds or meetings run, without root.

## Tasks — parity with Insomnia

- [ ] A timed session (days, hours, minutes) is the only way to stay awake; add time; hold-to-end
- [ ] Countdown shown where Fawkes is
- [ ] Battery rule ends the session below a floor (default 10 %)

## Tasks — Phoenix improvements

- [ ] macOS (`caffeinate`), Linux (`systemd-inhibit`) and Windows (`SetThreadExecutionState`)
- [ ] "Stay awake while agents work": a session that ends a set time after the last agent finishes
- [ ] Fawkes shows an awake indicator; history in the activity feed

## Deliverables

- capabilities/awake
- Countdown UI in web, tray and island

## Exit criteria

- [ ] A session keeps a real Mac awake and always releases when it ends, is cancelled, or Phoenix quits

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.
- Lid-closed sleep needs root and is Phase 73.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
