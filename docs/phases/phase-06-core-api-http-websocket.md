# Phase 06 — Core API — HTTP & WebSocket

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | Critical |
| Status | ⬜ Not started |
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

- [ ] GET /api/health, /api/pet/state, /api/events, /api/capabilities
- [ ] POST /api/capabilities/{id}/enable|disable (stubs until Phase 12)
- [ ] WebSocket channels: state.changed, event.created, task.updated, capability.health, notification.created
- [ ] Local session token / secure IPC so only local UI can connect
- [ ] Uniform error body using standard error codes
- [ ] Reconnect-friendly WS (resume from last event id); count reconnects
- [ ] OpenAPI spec + contract tests

## Deliverables

- HTTP API
- WS server
- docs/api/openapi.yaml

## Exit criteria

- [ ] Contract tests pass
- [ ] UI can subscribe and receive live state changes

## Source documents

- Full System PRD v2.0 §14
- Technical Spec Suite 04–14 §11 secure IPC

---
Back to [TRACKER](TRACKER.md)
