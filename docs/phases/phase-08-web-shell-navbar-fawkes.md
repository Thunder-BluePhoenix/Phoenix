# Phase 08 — Web App Shell & Navbar Fawkes

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | Critical |
| Status | ⬜ Not started |
| Depends on | [Phase 06 — Core API — HTTP & WebSocket](phase-06-core-api-http-websocket.md), [Phase 07 — Fawkes Pet Runtime & Placeholder Character](phase-07-fawkes-pet-runtime.md) |
| Unblocks | [Phase 09 — Pet Panel, Activity Feed & Notifications](phase-09-pet-panel-activity-notifications.md) |

## Goal

Create the web AppShell with a persistent, low-noise Fawkes avatar in the navbar that reflects live state.

## Scope

**In scope**

- apps/web AppShell
- Navbar + FawkesAvatar
- Status badge
- Live WS connection

**Out of scope**

- Pet Panel contents (Phase 09)

## Tasks

- [ ] Scaffold apps/web with chosen framework
- [ ] Implement AppShell → Navbar → FawkesAvatar component tree
- [ ] Subscribe to state.changed; animate avatar + optional badge
- [ ] Accessible label / tooltip with current state text
- [ ] Keyboard focusable avatar; Enter opens panel
- [ ] Offline/disconnected indicator when WS drops
- [ ] UI tests: avatar renders and reflects state (US-01)

## Deliverables

- apps/web with navbar Fawkes

## Exit criteria

- [ ] US-01: avatar renders and reflects state

## Source documents

- Full System PRD v2.0 §5.1, §16, US-01
- Fawkes PRD v1.0 §5.1, FR-001

---
Back to [TRACKER](TRACKER.md)
