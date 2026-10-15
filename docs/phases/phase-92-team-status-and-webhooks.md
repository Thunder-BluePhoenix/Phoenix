# Phase 92 — Team Status & Incoming Webhooks

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Low |
| Status | ⬜ Not started |
| Depends on | [Phase 87 — Remote Access Relay](phase-87-remote-access-relay.md) |
| Unblocks | — |

## Goal

Optional shared status for a team, and a universal way to drive Fawkes.

## Tasks

- [ ] Team status: share chosen states (deploying, long agent run, in a meeting) with teammates; off by default, per-item consent
- [ ] Shared through the relay (Phase 87), end-to-end encrypted
- [ ] Incoming webhooks: a URL + token per source turns any tool's POST into a Phoenix event (validated against the event schema)
- [ ] Webhook tokens revocable; rate limits

## Deliverables

- Team status
- Webhook endpoint

## Exit criteria

- [ ] Two Phoenix installs see each other's shared state
- [ ] A webhook from a real service drives Fawkes

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
