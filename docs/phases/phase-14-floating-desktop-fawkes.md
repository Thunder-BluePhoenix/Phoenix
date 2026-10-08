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
- [x] Transparent borderless window rendering pet runtime (macOS: transparent corners, no Dock icon, 200×220)
- [ ] Drag + persist position; multi-monitor sanity (drag and restart persistence verified on one display; multi-monitor placement is unit-tested only)
- [x] Opt-in always-on-top; hide without disabling Phoenix (macOS: off by default, layer change verified, hiding leaves Core and the connection alone)
- [ ] Tray menu: show/hide, open panel, quit (show/hide and quit verified; "Open Phoenix" not exercised)
- [x] Short contextual speech bubbles; click opens relevant page (bubble verified in the real window; routing tested in `apps/web/test/floating.test.tsx`; the shell only opens validated in-app routes)
- [x] Configurable start-on-login (macOS: LaunchAgent created and removed from the menu)
- [x] Visibility must never imply recording: show explicit indicator only when RECORDING (tested, and seen in the real window)
- [ ] Desktop tests: window lifecycle, tray, position (23 Rust tests cover position, settings, Core discovery and route validation; window lifecycle and tray were checked by hand, not automated)

## Deliverables

- apps/desktop floating Fawkes

## Exit criteria

- [ ] PRD Phase 3 exit: independent desktop pet works (works on macOS; Linux and Windows untested)
- [x] Launch, move, close all work (macOS)

## Notes & risks

- Isolate OS-specific shell code from runtime (portability risk).
- Spike result (ADR-0013): only macOS (Apple silicon) was built and launched. The Linux and Windows spikes have not been run.
- Transparency on macOS needs Tauri's `macos-private-api` feature, which rules out Mac App Store distribution.
- On macOS, `available_monitors()` returned an empty list while the app was starting, which put the window at (0, 0). Placement now falls back to the primary/current monitor, and a saved position is kept when monitors are unknown.
- Checked on a real macOS desktop (Apple silicon, one display) with a live Core, using synthetic mouse events, accessibility queries and window screenshots:
  - The window is 200×220 points and its corner pixels are fully transparent.
  - A real mouse drag moved it, saved the new position, and a restart put it back at the same spot.
  - The tray icon exists. A left click hides or shows Fawkes. A right click opens the menu with all seven entries.
  - "Keep Fawkes on top" moves the window layer 0 → 5 and back, and the check mark follows the setting.
  - "Quit Fawkes" ends the app and leaves Core running.
  - "Start Fawkes when I log in" writes `~/Library/LaunchAgents/Phoenix.plist` and the menu removes it. That agent points at the binary that is running, so a debug build registers the debug binary. A packaged build still needs checking.
  - Stopping Core leaves the window up and showing OFFLINE. Restarting Core with a new token reconnected without restarting the app.
  - The speech bubble, red ERROR outline and recording pill appear in the captured window.
- Not checked: "Open Phoenix" and click-to-open (they open a browser), the right-click menu on Fawkes itself (a popup window appeared, but I did not read its entries), more than one monitor, and how Fawkes looks to a person (checks used pixel counts and an ASCII rendering, not eyes).
- Verified against a live Core on macOS: the desktop webview finds the session token and opens a WebSocket (Core reported one live connection while the app ran). The first run found no token because the dev Core keeps its data in `<repo>/.phoenix/dev`, not `~/.phoenix/dev`; a debug build of the shell now looks in both and uses the newest token.
- Found by measuring a real drag: the shell wrote `desktop.json` on every `Moved` event, 13 writes for one 200-pixel drag (about one per mouse step, so dozens per second on a long drag), each a temp file plus rename. Fixed: position is now kept in memory while the window moves and written when the drag ends, when any setting changes, and when the app exits. After the fix, polling the file at ~100 Hz during a drag saw no writes while it moved; the drag-end write put the final position on disk; and a window moved by something other than a drag (macOS accessibility, so no drag-end event) was still saved when quitting from the tray. A crash or force-quit between a non-drag move and the next write would lose that move; a drag survives because it writes at its end.

## Source documents

- Full System PRD v2.0 §5.2, §15
- Fawkes PRD v1.0 §5.2, FR-003
- Technical Spec Suite 04–14 §11

---
Back to [TRACKER](TRACKER.md)
