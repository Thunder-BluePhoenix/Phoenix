# Phase 11 — Permissions & Audit Primitives

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | Critical |
| Status | ✅ Done |
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

- [x] Define permission categories: microphone, camera, meeting_recording, filesystem_read, filesystem_write, network, shell_command, repository_access, production_action, external_api, AI_external_processing
- [x] Implement grant store per capability (scoped, revocable)
- [x] Implement check API returning PERMISSION_DENIED / ACTION_REQUIRES_CONFIRMATION
- [x] Implement confirmation request → user decision → resume flow
- [x] Emit audit events for every grant, denial and side-effecting command
- [x] Implement emergency disable-all-capabilities switch
- [x] Security tests: unauthorised action blocked; secrets redacted

## Deliverables

- core/permissions package
- Audit log

## Exit criteria

- [x] No command with side effects runs without a grant
- [x] Kill switch disables all capabilities instantly

## Progress log

- 2026-10-03: core/permissions — GrantStore (persistent, revocable, expiring), PermissionGateway.authorize() with confirmation flow (write/execute/external/production side effects and microphone/camera/recording/production permissions always confirm), AuditLog (redacted), persistent kill switch. Protocol 1.1 adds permission categories and side-effect classes.
- Kill switch currently blocks every authorization and rejects pending confirmations; actually stopping running capabilities is wired in Phase 12 (capability manager listens to security.kill_switch.engaged).

## Source documents

- Full System PRD v2.0 §10.2, §18
- Technical Spec Suite 04–14 §09, §14 milestone 5

---
Back to [TRACKER](TRACKER.md)
