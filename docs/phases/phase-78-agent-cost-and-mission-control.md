# Phase 78 — Agent Cost Meter & Mission Control

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | ⬜ Not started |
| Depends on | [Phase 58 — Live Agent Sessions, Diffs & Plan Usage](phase-58-live-sessions-diffs-plan-usage.md) |
| Unblocks | — |

## Goal

See every agent session and what it costs in one place.

## Tasks

- [ ] Board of all agent sessions across repos by state: working, waiting on you, finished, stuck
- [ ] Tokens and cost per session, project, agent and day, from agent reports and plan usage
- [ ] Budgets with alerts before they are reached
- [ ] Filters and search; jump to a session's terminal or detail

## Deliverables

- Mission-control page
- Cost model per provider

## Exit criteria

- [ ] Board shows real sessions from three agents
- [ ] Cost totals match the providers' own figures for a test day

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
