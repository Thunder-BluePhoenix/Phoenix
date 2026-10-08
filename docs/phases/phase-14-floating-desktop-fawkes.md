# Phase 14 — Floating Desktop Fawkes

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | High |
| Status | 🟨 In progress |
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

- [x] Scaffold apps/desktop with chosen shell (Tauri v2 in `apps/desktop/src-tauri`; builds and launches on macOS)
- [ ] Transparent borderless window rendering pet runtime (configured: transparent, no decorations, no shadow, hidden from the Dock/taskbar; not yet seen on screen)
- [ ] Drag + persist position; multi-monitor sanity (placement and persistence logic unit-tested in `position.rs`/`settings.rs`, drag deltas tested in the web app; a real window drag is untested)
- [ ] Opt-in always-on-top; hide without disabling Phoenix (implemented in the tray and window menu; not exercised)
- [ ] Tray menu: show/hide, open Phoenix, quit (implemented; not exercised)
- [x] Short contextual speech bubbles; click opens relevant page (tested in `apps/web/test/floating.test.tsx`; the shell only opens validated in-app routes)
- [ ] Configurable start-on-login (implemented with `tauri-plugin-autostart`; not exercised)
- [x] Visibility must never imply recording: show explicit indicator only when RECORDING (tested)
- [ ] Desktop tests: window lifecycle, tray, position (20 Rust tests cover position, settings, Core discovery and route validation; window lifecycle and tray need a display)

## Deliverables

- apps/desktop floating Fawkes

## Exit criteria

- [ ] PRD Phase 3 exit: independent desktop pet works
- [ ] Launch, move, close all work (launch verified on macOS; move and close not yet exercised)

## Notes & risks

- Isolate OS-specific shell code from runtime (portability risk).
- Spike result (ADR-0013): only macOS (Apple silicon) was built and launched. The Linux and Windows spikes have not been run.
- Transparency on macOS needs Tauri's `macos-private-api` feature, which rules out Mac App Store distribution.
- On macOS, `available_monitors()` returned an empty list while the app was starting, which put the window at (0, 0). Placement now falls back to the primary/current monitor, and a saved position is kept when monitors are unknown.
- The Phase 14 checks were made with the screen locked, so the window was never seen. Transparency, dragging, the tray and the context menu still need a manual check on each OS.
- Verified against a live Core on macOS: the desktop webview finds the session token and opens a WebSocket (Core reported one live connection while the app ran). The first run found no token because the dev Core keeps its data in `<repo>/.phoenix/dev`, not `~/.phoenix/dev`; a debug build of the shell now looks in both and uses the newest token.

## Source documents

- Full System PRD v2.0 §5.2, §15
- Fawkes PRD v1.0 §5.2, FR-003
- Technical Spec Suite 04–14 §11

---
Back to [TRACKER](TRACKER.md)
