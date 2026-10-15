# Phase 75 — Agent Continuity: Network Failover, tmux Nudge, Browser Throttling

| Field | Value |
|---|---|
| Stage | Stage 13 — Insomnia parity and beyond (keep awake) |
| Release target | Post-v2.0 track |
| Priority | Low |
| Status | ⬜ Not started |
| Depends on | [Phase 72 — Keep-Awake Sessions (No Root)](phase-72-keep-awake-sessions.md), [Phase 34 — Coding-Agent Orchestration](phase-34-coding-agent-orchestration.md) |
| Unblocks | — |

## Goal

Keep long agent runs going through network drops and throttled browsers.

## Tasks — parity with Insomnia

- [ ] Wi-Fi drop → join the iPhone hotspot (password in the keychain)
- [ ] No network for 90 s → type `continue` into tmux panes the user marked; Enter off by default
- [ ] Detect Chromium/Arc/Comet throttling and offer "relaunch unthrottled" (asks first)

## Tasks — Phoenix improvements

- [ ] The nudge targets Phoenix-tracked agent sessions (Phase 34), not only tmux
- [ ] Network events appear in the activity feed and Fawkes state

## Deliverables

- Failover, nudge and throttle checks in capabilities/awake

## Exit criteria

- [ ] Each extra tested with a simulation; hotspot join tested on a real Mac

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
