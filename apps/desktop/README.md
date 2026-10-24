# apps/desktop

Floating desktop Fawkes ([Phase 14](../../docs/phases/phase-14-floating-desktop-fawkes.md), in progress): a transparent, borderless, draggable window that mirrors Phoenix Core's state. Since [Phase 60](../../docs/phases/phase-60-fawkes-island.md) the same Fawkes can instead live in an optional **island** at the top edge of the screen. Built with Tauri v2 ([ADR-0013](../../docs/adr/ADR-0013-desktop-shell-tauri-v2.md)).

## How it works

- The window shows `apps/web/floating.html`, which uses the same pet runtime as the navbar Fawkes.
- The Rust shell (`src-tauri/`) owns the window, tray, context menu, start on login, saved position, dictation hotkey and clipboard paste. Tauri commands are scoped to their intended webview: movement to the floating window, island events to the island, and dictation events/paste to the pill.
- The shell finds Core on `127.0.0.1` (`PHOENIX_PORT`, default 4870) and reads the session token from `<data dir>/session.token`, the same file `curl` users read. The page re-reads it before every reconnect, so restarting Core needs no restart of the desktop app.
- `open_in_phoenix` accepts only plain in-app routes such as `/meetings`; the page cannot choose the host.
- `read_dropped_file` (Phase 62) hands the page the bytes of a file that was just dropped on the Fawkes or island window. The OS drop is received by the shell (Tauri's `DragDropEvent`; the page gets no HTML5 drop on those two windows), checked in `file_drop.rs` (at most 3 entries; absolute path; no `..` or control characters; a regular file by `symlink_metadata`, so no symlink, folder, FIFO or device; at most 5 MiB) and announced to that window as numbers, names and sizes, never paths. The page can only ask for those numbers: each works once, for 60 seconds, for the window it was dropped on, and the read re-checks the file (same device and inode, never following a link, bounded). The bytes then take the web app's normal attachment path with origin `drop`. Paths and contents are never logged.
- `open_mailto` opens an editable draft in your mail app; Phoenix never sends mail. It accepts only a `mailto:` link of at most 2,000 characters with no control, bidi or zero-width character. It does not inspect recipients or headers the page builds.
- Position, "keep on top" and visibility are stored in `desktop.json` in the app data directory, not in Core's database, so Fawkes remembers its place when Core is down. Keep-on-top is off by default.
- The tray shows a disabled **Keep awake: …** entry (and tooltip) with the time left while a Keep-awake session runs (`GET /api/awake/status`, session token, loopback, read-only; every 20 s while it runs, one probe a minute otherwise). It hides when nothing runs or Core cannot be read. Never seen in a real tray; see [Phase 72](../../docs/phases/phase-72-keep-awake-sessions.md).
- Floating Fawkes can follow the mouse pointer and fly home on an alert, **off by default** (Settings → Fawkes). It uses Tauri's core window commands the floating window already has and the existing `move_window_by`; no new permission. Never run on a real display; see [Phase 59](../../docs/phases/phase-59-fawkes-interactions-and-sounds.md).
- Quit is always available from the tray and from the right-click menu on Fawkes. Before the app exits (tray Quit, Cmd+Q, the last window closing) the shell asks Core (`GET /api/awake/quit-check`, session token, loopback). While a change still needs undoing (lid-closed mode, Phase 73) it holds the exit and shows a native dialog with **Cancel** (default) and **Quit anyway**; Core not running, no token or an unreadable answer quits normally. A second Quit while the dialog is open does not stack another. The native dialogs (AppKit, Win32, GTK) have not been run on a real desktop; see [Phase 73](../../docs/phases/phase-73-lid-closed-mode-and-recovery.md).
- The "jump to terminal" shortcut asks Core (`GET /api/agent/sessions`, then `POST .../focus-terminal`, session token) to bring the newest active agent session's terminal to the front; Core asks you to confirm first. If Core cannot, it opens `/agents`. Not run against a real terminal; see [Phase 70](../../docs/phases/phase-70-shortcuts-i18n-demo.md).

## Island (Phase 60)

Tray menu → **Floating Fawkes / Island / Navbar only** switches live; the choice is saved in `desktop.json` (`mode`, default `floating`, so nothing changes until you pick the island). There is one Fawkes: every mode reads the same state from Core, only where it is drawn changes. "Hide Fawkes" hides whichever window the mode uses.

- **States:** hidden → small → expanded. Hidden is invisible (a 4 px transparent strip along the top edge). Moving the pointer onto that strip peeks it (small); a click on Fawkes expands it, Escape or a second click collapses it, and it steps back down after the pointer leaves. It never hides while Fawkes needs you (approval, error, recording) and stays small while Fawkes is busy.
- **Display:** the tray item "Island display" cycles main screen → follows the mouse → each other screen. The island only changes screen while hidden.
- **Notch:** on macOS the notch width comes from `NSScreen.safeAreaInsets` and the two `auxiliaryTop…Area` rects (a default width if the OS reports a notch but no areas); the island is the notch plus an "ear" on each side. Without a notch (any other Mac, Linux, Windows) it is a 220 pt pill at the top centre.
- **Linux:** wlroots compositors, KDE Plasma and COSMIC use `libgtk-layer-shell` (loaded at run time with `dlopen`, so Phoenix still starts without it; the surface is top-anchored, overlay layer, no keyboard focus). GNOME has no layer-shell, so in island mode the app starts GTK on X11 (XWayland, `GDK_BACKEND=x11`, chosen from the saved mode before GTK starts) and sets the dock window hints. On layer-shell the compositor picks the output, so the display choice is disabled, and because Wayland never tells a client where the pointer is outside its surfaces, the page reports hover there instead of the shell polling the cursor. Switching to the island on GNOME-Wayland takes effect fully after a restart.
- **Windows:** the window is created non-focusable (`WS_EX_NOACTIVATE`), re-applied with `WS_EX_TOOLWINDOW | WS_EX_TOPMOST` on the live handle, so showing or clicking the island does not take focus from the app you are typing in.
- **Click-through:** a hidden island ignores the mouse wherever the shell polls the pointer; on Wayland the strip stays live so hover reaches the page.

All geometry, the state machine and the per-OS decisions are pure Rust (`island_state.rs`, `island_geometry.rs`, `island_controller.rs`, `island_platform.rs`) with unit tests; `island.rs`, `island_macos.rs`, `island_linux.rs` and `island_windows.rs` only apply them to the OS.

## Dictation pill (Phase 64)

Dictation is off by default in Core and separately off in the desktop tray. **Enable dictation hotkey** requests keyboard/Accessibility access only when selected; a saved opt-in merely preflights permission on startup. The pill is hidden by default (tray: **Show dictation pill**). The desktop preference `dictation_key` selects `right_option`, `fn`, `right_command`, or `right_control` on macOS (only `right_control` elsewhere). `paste_again_chord` in `desktop.json` accepts a modifier-plus-letter/digit such as `ctrl+alt+v`; an invalid value resets to the default. Restart the hotkey listener after editing the file. The page requests microphone access only upon starting a Core-approved session. The pill's Record a call button opens `/notetaker`; it does not begin recording.

macOS uses a Core Graphics event tap for modifier flags changes and Esc/key presses; ordinary global-shortcut libraries cannot observe a bare Option/Fn press or swallow a consumed Esc. Linux uses XRecord/XTest on X11; Wayland global key listening/paste is unavailable. Windows uses a low-level keyboard hook/SendInput. The OS listener only queues actions; Core's authenticated `GET /api/dictation/status` gates every hotkey start and Core's session API is the final guard. No session token or dictated text is logged. Paste is guarded in several ways, and as a result it works effectively on macOS only:

- The text is refused if it contains a newline or a tab (it would press Return or Tab in the target), and it is refused unless the field that had keyboard focus when the dictation started (captured by the shell on a hotkey start, never by the page) still has it. The pill's own **Dictate** button captures no focus target, so its text is shown instead of pasted.
- It is refused unless the focused field is proven not to be a protected one. macOS has a positive signal (Secure Event Input); on Linux the check always refuses; on Windows only a standard `Edit` control can be proven (browsers and custom controls are refused). Wayland has no key listening and no paste.
- The paste-again shortcut asks Core again every time, so turning dictation off or the emergency stop also stops it.
- The clipboard decision table preserves non-text data (typing the text with key events instead) and restores the previous text about 350 ms after the paste chord unless you copied something meanwhile; for that time the dictated text is on the clipboard.

The pill runs as an explicitly scoped loopback webview with a narrowly scoped Tauri IPC capability. Its capture/level display runs in the web page, while the shell owns only the key, window and paste. The Rust state machine, paste decision table, mailto validator and page behavior are covered with fake-driven tests; no test exercises real microphone access, key capture, permission prompts, or pasting into an application. The shell handles file drops on the Fawkes windows only as described above (never exercised with a real OS drag); it does not capture other windows, adds a Wardrobe entry to the menu, captures system audio or asks you before a call is recorded (Phase 65 needs that dialog, so "Record a call" is disabled today).

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

**Dictation, attachments and recording (Phases 62, 64, 65).** The hotkey state machine, paste decision table, focus guard, mailto validator and pill page are unit-tested (278 Rust unit tests plus the lifecycle tests on macOS). No person has used the hotkey, the microphone, a permission prompt or the paste in a real application, and the Linux X11 and Windows listeners and pasters were never run (the Windows hook was never compiled). See the [gap register](../../docs/gaps.md).
