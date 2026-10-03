# Phase 11 — Permissions & Audit Primitives

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | Critical |
| Status | ⬜ Not started |
| Depends on | [Phase 04 — Local Event Bus](phase-04-event-bus.md) |
| Unblocks | [Phase 12 — Capability Manager & Manifest](phase-12-capability-manager.md) |

## Goal

Implement identity, permission categories, confirmation flow and audit trail before any capability can act.

## Scope

**In scope**

- Permission categories (PRD §10.2)
- Read vs write/execute separation
- Confirmation requirement (ACTION_REQUIRES_CONFIRMATION)
- Audit events
- Emergency disable-all

**Out of scope**

- Full AI policy engine with risk tiers (Phase 30)

## Tasks

- [ ] Define permission categories: microphone, camera, meeting_recording, filesystem_read, filesystem_write, network, shell_command, repository_access, production_action, external_api, AI_external_processing
- [ ] Implement grant store per capability (scoped, revocable)
- [ ] Implement check API returning PERMISSION_DENIED / ACTION_REQUIRES_CONFIRMATION
- [ ] Implement confirmation request → user decision → resume flow
- [ ] Emit audit events for every grant, denial and side-effecting command
- [ ] Implement emergency disable-all-capabilities switch
- [ ] Security tests: unauthorised action blocked; secrets redacted

## Deliverables

- core/permissions package
- Audit log

## Exit criteria

- [ ] No command with side effects runs without a grant
- [ ] Kill switch disables all capabilities instantly

## Source documents

- Full System PRD v2.0 §10.2, §18
- Technical Spec Suite 04–14 §09, §14 milestone 5

---
Back to [TRACKER](TRACKER.md)
