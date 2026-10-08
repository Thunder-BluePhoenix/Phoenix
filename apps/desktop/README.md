# apps/desktop

Floating desktop Fawkes ([Phase 14](../../docs/phases/phase-14-floating-desktop-fawkes.md), in progress): a transparent, borderless, draggable window that mirrors Phoenix Core's state. Built with Tauri v2 ([ADR-0013](../../docs/adr/ADR-0013-desktop-shell-tauri-v2.md)).

## How it works

- The window shows `apps/web/floating.html`, which uses the same pet runtime as the navbar Fawkes.
- The Rust shell (`src-tauri/`) owns everything OS-specific: the window, tray, context menu, start on login and the saved position. The page reaches it only through five commands (`core_connection`, `move_window_by`, `drag_finished`, `open_in_phoenix`, `show_menu`).
- The shell finds Core on `127.0.0.1` (`PHOENIX_PORT`, default 4870) and reads the session token from `<data dir>/session.token`, the same file `curl` users read. The page re-reads it before every reconnect, so restarting Core needs no restart of the desktop app.
- `open_in_phoenix` accepts only plain in-app routes such as `/meetings`; the page cannot choose the host.
- Position, "keep on top" and visibility are stored in `desktop.json` in the app data directory, not in Core's database, so Fawkes remembers its place when Core is down. Keep-on-top is off by default.
- Quit is always available from the tray and from the right-click menu on Fawkes.

## Run

Needs Rust ≥ 1.90 and a running core (`pnpm dev:core` in another terminal):

```sh
pnpm --filter @phoenix/desktop dev      # hot reload against the Vite dev server
pnpm --filter @phoenix/desktop build    # bundle
pnpm --filter @phoenix/desktop test:rust
```

## Status

Checked on macOS (Apple silicon) on a real desktop: transparent window, drag, position saved across restarts, tray (show/hide, menu, quit), keep-on-top, start on login, and reconnecting after Core restarts. Not yet verified: a person looking at it, more than one monitor, the "Open Phoenix" menu item, and any other OS (Linux and Windows have not been built). See the phase file for the checklist.
