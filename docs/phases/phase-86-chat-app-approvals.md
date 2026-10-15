# Phase 86 — Approvals in Slack, Discord & Teams

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | High |
| Status | ⬜ Not started |
| Depends on | [Phase 56 — Agent Approvals & Questions from Fawkes](phase-56-agent-approvals-from-fawkes.md), [Phase 87 — Remote Access Relay](phase-87-remote-access-relay.md) |
| Unblocks | — |

## Goal

Answer an agent or Phoenix approval from the chat tool you are already in.

## Tasks

- [ ] Slack, Discord and Teams apps that post approval cards with Allow / Deny
- [ ] Decisions go through the same audited path as Phase 56 and are bound to the exact request
- [ ] Notifications and digests to a channel or DM (opt-in)
- [ ] Bot tokens in the OS keychain; least-privilege scopes

## Deliverables

- capabilities/slack, discord, teams

## Exit criteria

- [ ] A real agent request is approved from Slack

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.
- Approve from chat can be turned off per project for sensitive repos.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
