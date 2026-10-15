# Phase 87 — Remote Access Relay

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | ⬜ Not started |
| Depends on | [Phase 71 — Phone Link & Mobile Companions](phase-71-phone-link-and-mobile.md) |
| Unblocks | [Phase 86 — Approvals in Slack, Discord & Teams](phase-86-chat-app-approvals.md), [Phase 92 — Team Status & Incoming Webhooks](phase-92-team-status-and-webhooks.md) |

## Goal

Reach Phoenix from your phone or chat away from home, without exposing it.

## Tasks

- [ ] Stateless relay that forwards end-to-end-encrypted messages between Core and paired devices
- [ ] Relay sees only routing metadata; keys pinned at pairing
- [ ] Self-hostable relay (container) plus optional hosted instance
- [ ] Device list with revoke; every remote decision audited

## Deliverables

- relay/ service
- Core relay client

## Exit criteria

- [ ] A phone on mobile data approves a request through the relay
- [ ] A revoked device is refused

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
