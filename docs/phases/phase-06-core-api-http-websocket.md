# Phase 06 — Core API — HTTP & WebSocket

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | Critical |
| Status | ✅ Done |
| Depends on | [Phase 05 — Fawkes State Engine](phase-05-state-engine.md) |
| Unblocks | [Phase 08 — Web App Shell & Navbar Fawkes](phase-08-web-shell-navbar-fawkes.md), [Phase 12 — Capability Manager & Manifest](phase-12-capability-manager.md), [Phase 14 — Floating Desktop Fawkes](phase-14-floating-desktop-fawkes.md) |

## Goal

Expose Phoenix Core to UIs via REST and real-time WebSocket channels with stable error codes.

## Scope

**In scope**

- Endpoints from PRD v2.0 §14 (non-meeting ones now)
- WebSocket channels
- Local auth between UI and core
- Operation/correlation IDs for long operations

**Out of scope**

- Meeting endpoints (Phase 15)

## Tasks

- [x] GET /api/health, /api/pet/state, /api/events, /api/capabilities
- [x] POST /api/capabilities/{id}/enable|disable (stubs until Phase 12)
- [x] WebSocket channels: state.changed, event.created, task.updated, capability.health, notification.created
- [x] Local session token / secure IPC so only local UI can connect
- [x] Uniform error body using standard error codes
- [x] Reconnect-friendly WS (resume from last event id); count reconnects
- [x] OpenAPI spec + contract tests

## Deliverables

- HTTP API
- WS server
- docs/api/openapi.yaml

## Exit criteria

- [x] Contract tests pass
- [x] UI can subscribe and receive live state changes

## Progress log

- 2026-10-03: core/api — all PRD §14 endpoints plus pet tasks/sleep/acknowledge, events publish, permissions, confirmations, audit, kill switch. Docs: docs/api/openapi.yaml, docs/api/websocket.md.
- Security: per-start session token (Bearer or WebSocket subprotocol) written to <dataDir>/session.token (0600); Host check against DNS rebinding; Origin allow-list + CORS; 256 KiB body limit (413).
- WebSocket: 5 channels, resume via since_seq, ping/pong liveness, slow-client drop. 22 contract tests against the real server.
- Capability enable/disable return RESOURCE_NOT_FOUND until the registry lands in Phase 12.

## Source documents

- Full System PRD v2.0 §14
- Technical Spec Suite 04–14 §11 secure IPC

---
Back to [TRACKER](TRACKER.md)
