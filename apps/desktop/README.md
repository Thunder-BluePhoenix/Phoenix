# apps/desktop

Floating desktop Fawkes ([Phase 14](../../docs/phases/phase-14-floating-desktop-fawkes.md), in progress): a transparent, borderless, draggable window that mirrors Phoenix Core's state. Since [Phase 60](../../docs/phases/phase-60-fawkes-island.md) the same Fawkes can instead live in an optional **island** at the top edge of the screen. Built with Tauri v2 ([ADR-0013](../../docs/adr/ADR-0013-desktop-shell-tauri-v2.md)).

## How it works

- The window shows `apps/web/floating.html`, which uses the same pet runtime as the navbar Fawkes.
- The Rust shell (`src-tauri/`) owns everything OS-specific: the window, tray, context menu, start on login and the saved position. The pages reach it only through seven commands (`core_connection`, `move_window_by`, `drag_finished`, `open_in_phoenix`, `show_menu`, `island_event`, `island_frame`); the move and save commands refuse any window but the floating one, and the island commands any window but the island.
- The shell finds Core on `127.0.0.1` (`PHOENIX_PORT`, default 4870) and reads the session token from `<data dir>/session.token`, the same file `curl` users read. The page re-reads it before every reconnect, so restarting Core needs no restart of the desktop app.
- `open_in_phoenix` accepts only plain in-app routes such as `/meetings`; the page cannot choose the host.
- Position, "keep on top" and visibility are stored in `desktop.json` in the app data directory, not in Core's database, so Fawkes remembers its place when Core is down. Keep-on-top is off by default.
- Quit is always available from the tray and from the right-click menu on Fawkes.

## Island (Phase 60)

Tray menu → **Floating Fawkes / Island / Navbar only** switches live; the choice is saved in `desktop.json` (`mode`, default `floating`, so nothing changes until you pick the island). There is one Fawkes: every mode reads the same state from Core, only where it is drawn changes. "Hide Fawkes" hides whichever window the mode uses.

- **States:** hidden → small → expanded. Hidden is invisible (a 4 px transparent strip along the top edge). Moving the pointer onto that strip peeks it (small); a click on Fawkes expands it, Escape or a second click collapses it, and it steps back down after the pointer leaves. It never hides while Fawkes needs you (approval, error, recording) and stays small while Fawkes is busy.
- **Display:** the tray item "Island display" cycles main screen → follows the mouse → each other screen. The island only changes screen while hidden.
- **Notch:** on macOS the notch width comes from `NSScreen.safeAreaInsets` and the two `auxiliaryTop…Area` rects (a default width if the OS reports a notch but no areas); the island is the notch plus an "ear" on each side. Without a notch (any other Mac, Linux, Windows) it is a 220 pt pill at the top centre.
- **Linux:** wlroots compositors, KDE Plasma and COSMIC use `libgtk-layer-shell` (loaded at run time with `dlopen`, so Phoenix still starts without it; the surface is top-anchored, overlay layer, no keyboard focus). GNOME has no layer-shell, so in island mode the app starts GTK on X11 (XWayland, `GDK_BACKEND=x11`, chosen from the saved mode before GTK starts) and sets the dock window hints. On layer-shell the compositor picks the output, so the display choice is disabled, and because Wayland never tells a client where the pointer is outside its surfaces, the page reports hover there instead of the shell polling the cursor. Switching to the island on GNOME-Wayland takes effect fully after a restart.
- **Windows:** the window is created non-focusable (`WS_EX_NOACTIVATE`), re-applied with `WS_EX_TOOLWINDOW | WS_EX_TOPMOST` on the live handle, so showing or clicking the island does not take focus from the app you are typing in.
- **Click-through:** a hidden island ignores the mouse wherever the shell polls the pointer; on Wayland the strip stays live so hover reaches the page.

All geometry, the state machine and the per-OS decisions are pure Rust (`island_state.rs`, `island_geometry.rs`, `island_controller.rs`, `island_platform.rs`) with unit tests; `island.rs`, `island_macos.rs`, `island_linux.rs` and `island_windows.rs` only apply them to the OS.

## Run

Needs Rust ≥ 1.90 and a running core (`pnpm dev:core` in another terminal):

```sh
pnpm --filter @phoenix/desktop dev      # hot reload against the Vite dev server
pnpm --filter @phoenix/desktop build    # bundle
pnpm --filter @phoenix/desktop test:rust   # unit tests + window/tray lifecycle (mock runtime)
```

The lifecycle tests (`src-tauri/tests/lifecycle.rs`) run on Tauri's mock runtime on the main thread (`harness = false`, because macOS only builds menus and tray icons there). They never open a browser, write login items or touch your settings.

## Status

**Floating window (Phase 14).** Checked on macOS (Apple silicon) on a real desktop: transparent window, drag, position saved across restarts, tray (show/hide, menu, quit), keep-on-top, start on login, and reconnecting after Core restarts. The tray's "Open Phoenix" opened Core in the browser. Not yet verified: a person looking at it, more than one monitor.

**Linux and Windows are still unverified.** Phase 60 adds CI jobs that build, lint and test the shell on `ubuntu-latest` and `windows-latest` next to `macos-latest`; a green job means it compiles and the unit and lifecycle tests pass there. Nobody has run the app on a Linux desktop or on Windows, so the floating window, the tray, the layer-shell and XWayland placement, the click-through region and the no-focus-steal behaviour are untested on real compositors and on real Windows.

**Island: not run by a person on any OS.** The pure modules (state machine, notch and no-notch placement, multi-monitor choice, hover, per-OS decisions) are unit-tested. Window creation and the island menu are covered by the lifecycle tests on Tauri's mock runtime, which has no real window, so they say nothing about pixels, stacking or hover. No notch Mac was available: the `NSScreen` notch code compiles and runs on a Mac without a notch (reports none) but is untested against a real notch. The Linux code was compile-checked, not run on a desktop, and the Windows code was never compiled locally. See the phase file for the checklist.
