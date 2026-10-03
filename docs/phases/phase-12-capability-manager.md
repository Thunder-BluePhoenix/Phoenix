# Phase 12 — Capability Manager & Manifest

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | Critical |
| Status | ✅ Done |
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

- [x] Define manifest schema: id, name, version, description, license, compatibility, events, commands, permissions, healthcheck, config_schema, ui_extensions
- [x] Implement discovery + manifest validation
- [x] Implement enable flow that requests declared permissions
- [x] Run capabilities isolated (separate process or sandboxed worker) so failures cannot crash core
- [x] Health polling → capability.health events
- [x] Disable safely; uninstall with data-retention choice
- [x] Wire /api/capabilities endpoints
- [x] Lifecycle + permission tests

## Deliverables

- core/capability-manager package
- Manifest schema

## Exit criteria

- [x] Capability can be registered, enabled, disabled
- [x] Killing a capability process leaves core healthy

## Progress log

- 2026-10-03: core/capability-manager — manifest v1 schema + validator (protocol), register/enable/disable/configure/uninstall, guarded builtin calls, external capabilities over loopback HTTP with per-capability tokens (ADR-0016), declared-events enforcement, health checks with availability transitions, command operations through the permission gateway, kill-switch disables everything, resume-after-restart unless permissions grew. Docs: docs/capabilities/model.md.
- Isolation: builtins are first-party and guarded (errors/timeouts contained); anything untrusted runs as an external process. Tested by SIGKILL-ing a real child process — core stays healthy and Fawkes shows "… is unavailable".
- API: register, get, enable, disable, config, uninstall, commands (202 + operation), operations, capability event ingestion. 33 new tests.

## Source documents

- Full System PRD v2.0 §10
- Fawkes PRD v1.0 §8, FR-007, FR-008
- Technical Spec Suite 04–14 §06

---
Back to [TRACKER](TRACKER.md)
