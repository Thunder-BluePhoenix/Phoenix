# Phase 12 — Capability Manager & Manifest

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | Critical |
| Status | ⬜ Not started |
| Depends on | [Phase 11 — Permissions & Audit Primitives](phase-11-permissions-and-audit.md), [Phase 06 — Core API — HTTP & WebSocket](phase-06-core-api-http-websocket.md) |
| Unblocks | [Phase 13 — Capability SDK, Mock Capability & Event Simulator](phase-13-capability-sdk-mock-simulator.md), [Phase 19 — Settings & Privacy Controls](phase-19-settings-and-privacy.md) |

## Goal

Register, validate, authorise and run capabilities through a well-defined lifecycle, isolated from core.

## Scope

**In scope**

- Manifest schema
- Lifecycle: discover → validate → authorise → init → health → run → disable → uninstall
- Health checks
- Isolation / fault containment

**Out of scope**

- Public registry (Phase 42)

## Tasks

- [ ] Define manifest schema: id, name, version, description, license, compatibility, events, commands, permissions, healthcheck, config_schema, ui_extensions
- [ ] Implement discovery + manifest validation
- [ ] Implement enable flow that requests declared permissions
- [ ] Run capabilities isolated (separate process or sandboxed worker) so failures cannot crash core
- [ ] Health polling → capability.health events
- [ ] Disable safely; uninstall with data-retention choice
- [ ] Wire /api/capabilities endpoints
- [ ] Lifecycle + permission tests

## Deliverables

- core/capability-manager package
- Manifest schema

## Exit criteria

- [ ] Capability can be registered, enabled, disabled
- [ ] Killing a capability process leaves core healthy

## Source documents

- Full System PRD v2.0 §10
- Fawkes PRD v1.0 §8, FR-007, FR-008
- Technical Spec Suite 04–14 §06

---
Back to [TRACKER](TRACKER.md)
