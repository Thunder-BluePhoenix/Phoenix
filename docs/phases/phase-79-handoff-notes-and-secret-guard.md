# Phase 79 — Session Handoff Notes & Secret Guard

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | ⬜ Not started |
| Depends on | [Phase 58 — Live Agent Sessions, Diffs & Plan Usage](phase-58-live-sessions-diffs-plan-usage.md) |
| Unblocks | — |

## Goal

What an agent did travels with its work, and secrets never leave through an agent.

## Tasks

- [ ] Handoff note at session end: goal, what changed, commands run, open questions; local model by default
- [ ] Attach the note to the commit message, PR description or task with approval
- [ ] Secret guard: block an agent tool call, commit or push that contains a secret (Phoenix's detector), with an explanation and override by approval
- [ ] Guard results in the audit log

## Deliverables

- Handoff generator
- Secret guard hook

## Exit criteria

- [ ] A planted test secret in an agent's commit is blocked
- [ ] A handoff note is attached to a real PR

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
