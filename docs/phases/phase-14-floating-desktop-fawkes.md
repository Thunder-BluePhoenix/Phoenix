# Phase 14 — Floating Desktop Fawkes

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | High |
| Status | ⬜ Not started |
| Depends on | [Phase 07 — Fawkes Pet Runtime & Placeholder Character](phase-07-fawkes-pet-runtime.md), [Phase 06 — Core API — HTTP & WebSocket](phase-06-core-api-http-websocket.md) |
| Unblocks | [Phase 20 — Hardening, E2E, Observability & v0.1 Release](phase-20-hardening-and-v0-1-release.md) |

## Goal

Ship an independent, transparent, draggable desktop Fawkes that mirrors core state.

## Scope

**In scope**

- Transparent borderless window
- Drag + persisted position
- Opt-in always-on-top
- Tray
- Short messages
- Configurable startup
- Quit always available

**Out of scope**

- Full local AI runtime on desktop

## Tasks

- [ ] Scaffold apps/desktop with chosen shell (from Phase 00 spike)
- [ ] Transparent borderless window rendering pet runtime
- [ ] Drag + persist position; multi-monitor sanity
- [ ] Opt-in always-on-top; hide without disabling Phoenix
- [ ] Tray menu: show/hide, open panel, quit
- [ ] Short contextual speech bubbles; click opens relevant capability page
- [ ] Configurable start-on-login
- [ ] Visibility must never imply recording — show explicit indicator only when RECORDING
- [ ] Desktop tests: window lifecycle, tray, position

## Deliverables

- apps/desktop floating Fawkes

## Exit criteria

- [ ] PRD Phase 3 exit: independent desktop pet works
- [ ] Launch, move, close all work

## Notes & risks

- Isolate OS-specific shell code from runtime (portability risk).

## Source documents

- Full System PRD v2.0 §5.2, §15
- Fawkes PRD v1.0 §5.2, FR-003
- Technical Spec Suite 04–14 §11

---
Back to [TRACKER](TRACKER.md)
