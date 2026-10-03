# Phase 08 — Web App Shell & Navbar Fawkes

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | Critical |
| Status | ✅ Done |
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

- [x] Scaffold apps/web with chosen framework
- [x] Implement AppShell → Navbar → FawkesAvatar component tree
- [x] Subscribe to state.changed; animate avatar + optional badge
- [x] Accessible label / tooltip with current state text
- [x] Keyboard focusable avatar; Enter opens panel
- [x] Offline/disconnected indicator when WS drops
- [x] UI tests: avatar renders and reflects state (US-01)

## Deliverables

- apps/web with navbar Fawkes

## Exit criteria

- [x] US-01: avatar renders and reflects state

## Progress log

- 2026-10-03: apps/web (React 19 + Vite) — AppShell → Navbar → FawkesAvatar wrapping pet/runtime; live state over WebSocket with reconnect + since_seq resume; visible + announced state text; recording pill; OFFLINE / not-connected states; minimal accessible Pet Panel (dialog, Escape, focus return) with active tasks — full panel in Phase 09.
- Core serves the build at "/" and injects the session token into index.html (no-store, CSP, frame-ancestors 'none', X-Frame-Options DENY, path-traversal safe). Dev: `pnpm dev:web` proxies /api and reads the token file.
- Verified in real Chromium against a running core: IDLE → DEPLOYING (with progress) → ERROR from live events, no console errors under CSP. Screenshot: docs/images/web-pet-panel.png. 18 new tests.

## Source documents

- Full System PRD v2.0 §5.1, §16, US-01
- Fawkes PRD v1.0 §5.1, FR-001

---
Back to [TRACKER](TRACKER.md)
