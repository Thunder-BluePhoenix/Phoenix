# Phase 60 — Fawkes Island (Notch / Top Edge) & Desktop Platforms

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | 🟨 Island state machine, geometry, per-OS decisions, mode switching and the island page built and unit-tested; run on macOS without a notch only; no notch Mac, Linux compositor or Windows run; CI matrix not yet run on GitHub |
| Depends on | [Phase 14 — Floating Desktop Fawkes](phase-14-floating-desktop-fawkes.md) |
| Unblocks | [Phase 64 — Dictation Anywhere](phase-64-dictation-anywhere.md) |

## Goal

An optional island mode: Fawkes lives in the notch on Macs that have one and at the top edge of the screen elsewhere.

## Tasks — parity with Coucou

- [x] Island states hidden → small → expanded (`apps/desktop/src-tauri/src/island_state.rs` and `island_controller.rs`; Rust unit tests in both, island page tests in `apps/web/test/island.test.tsx`). The pixels were never looked at by a person on any OS.
- [x] Invisible when idle, peeks on hover (tests `island_state.rs` "hover_peeks_and_leaving_hides_after_the_linger", `island_controller.rs` "a_hidden_island_has_a_thin_frame_at_the_top_centre" and "hovering_the_hot_zone_peeks…"). "Invisible" is a 4 px transparent strip; real hover and click-through were not observed.
- [x] Pick the display or follow the mouse; works without a notch (`island_geometry.rs`, `island_controller.rs` "follow_mouse…", "choosing_a_display…", "unplugging_the_monitor…", "without_a_notch_the_pill_is_centred…"; the no-notch island window is created in `tests/lifecycle.rs` on Tauri's mock runtime on a Mac without a notch). With more than one real display it was never run.
- [ ] Linux: gtk-layer-shell (wlroots, KDE, COSMIC), XWayland dock on GNOME, click-through input region. The backend choice, layer-shell and dock-hint settings and input region are pure functions with unit tests (`island_platform.rs`); `island_linux.rs`, which calls `libgtk-layer-shell` through `dlopen`, has no test and no run on any compositor. It compiled, passed clippy and the unit tests in a Debian container.
- [ ] Windows: top-edge window that never steals focus. The window flags and extended style bits are unit-tested (`island_platform.rs` "windows_…"); `island_windows.rs` (which calls the Win32 API) was never compiled or run; only the pure modules it relies on compile on every OS. The CI job that would compile it has not run on GitHub.
- [ ] Windows Credential Manager for secrets. A PowerShell backend exists in `core/persistence/src/secret-store.ts` (reference and value as base64 on stdin, not on the command line); `core/persistence/test/secret-store-windows.test.ts` tests it with a fake command runner only. The PowerShell script itself has never run on Windows.

## Tasks — Phoenix improvements

- [x] Island, floating Fawkes and navbar Fawkes share one state and can be switched live (`settings.rs` `mode`, `tests/lifecycle.rs` "modes_switch_live_and_are_remembered", "island_mode_survives_a_restart_…", "hide_applies_to_whichever_mode_is_active", on the mock runtime; every mode reads Core's one state). The mock runtime has no real windows. On GNOME under Wayland the switch needs a restart to take full effect.
- [ ] Closes the Phase 14 Linux/Windows gaps with CI builds on all three OSes. `.github/workflows/ci.yml` has a `desktop` matrix for `macos-latest`, `ubuntu-latest` and `windows-latest` (format, clippy, tests), but it has not run on GitHub yet. A green job would show that it compiles and the tests pass, not that the window behaves on a real desktop.

## Deliverables

- apps/desktop island window (`island.rs`, `island_macos.rs`, `island_linux.rs`, `island_windows.rs`, `apps/web/src/island/`)
- Linux and Windows desktop CI jobs (written, not yet run on GitHub)

## Exit criteria

- [ ] Island works on macOS (notch and no notch), one Linux compositor and Windows

## Implementation notes

All geometry, the state machine and the per-OS decisions are pure Rust with unit tests (`island_state.rs`, `island_geometry.rs`, `island_controller.rs`, `island_platform.rs`; 93 Rust unit tests across the desktop crate, plus the lifecycle tests). The platform modules only apply those decisions to the OS. See [apps/desktop/README.md](../../apps/desktop/README.md) for the behaviour.

What was run: the Rust unit tests and the lifecycle tests with `cargo fmt` and `cargo clippy` clean on a Mac without a notch; a compile, clippy and unit-test pass of the crate in a Debian container for Linux; the island page's component tests.

What was not: a Mac with a notch (the `NSScreen` code only reports "no notch" on the machine used), layer-shell, XWayland and click-through on any Linux compositor, Windows (compiling `island_windows.rs`, no-focus-steal, the credential manager script), GNOME-Wayland switching, more than one real display, and the GitHub CI matrix. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
