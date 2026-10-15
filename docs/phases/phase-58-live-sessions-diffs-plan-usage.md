# Phase 58 — Live Agent Sessions, Diffs & Plan Usage

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | High |
| Status | ⬜ Not started |
| Depends on | [Phase 57 — Universal Agent Relay & Hook Installers](phase-57-agent-relay-and-installers.md) |
| Unblocks | [Phase 78 — Agent Cost Meter & Mission Control](phase-78-agent-cost-and-mission-control.md), [Phase 79 — Session Handoff Notes & Secret Guard](phase-79-handoff-notes-and-secret-guard.md) |

## Goal

See what each agent is doing right now: steps, file changes, and how much of its plan is left.

## Tasks — parity with Coucou

- [ ] Step ticker: what the agent reads, edits and runs, step by step
- [ ] Live diffs: file name and +N −M, open the full diff
- [ ] Jump to the session's terminal window
- [ ] Claude plan usage (5-hour and weekly) through a `statusLine` relay that still runs the user's previous status line
- [ ] Codex plan usage and free resets left

## Tasks — Phoenix improvements

- [ ] Diffs link to the commit and CI run they ended up in (knowledge graph, Phase 38)
- [ ] Session timeline export (Markdown)
- [ ] Plan usage warnings before a limit is hit, not after
- [ ] Jump to terminal on Linux and Windows, not only macOS

## Deliverables

- Session detail view
- Plan usage capability

## Exit criteria

- [ ] Live steps and diffs of a real session appear within a second
- [ ] Plan usage matches the agent's own display

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
