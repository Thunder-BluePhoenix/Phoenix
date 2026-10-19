// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

use std::path::PathBuf;

fn main() {
    // Explicit application ACL: the loopback-hosted pill is a remote Tauri origin. Only
    // commands listed here can be granted to its exact window and URL at runtime. Keep the
    // Windows test-manifest setup below unchanged.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "core_connection",
            "move_window_by",
            "drag_finished",
            "open_in_phoenix",
            "open_mailto",
            "show_menu",
            "island_event",
            "island_frame",
            "pill_ready",
            "dictation_ended",
            "dictation_paste",
            "shortcuts_list",
            "shortcuts_set",
            "shortcuts_reset",
        ]),
    ))
    .expect("Tauri build failed");
    embed_test_manifest();
}

/// Windows only: give the integration-test executables (tests/lifecycle.rs) a Common-Controls v6
/// manifest.
///
/// `tauri_build::build()` embeds the app manifest with `cargo:rustc-link-arg-bins`, so it reaches
/// the real binary but not test executables. Those link tauri/wry, which import functions that
/// only exist in comctl32 v6 (e.g. `TaskDialogIndirect`); without the manifest Windows loads
/// comctl32 v5 and the process dies at start with 0xc0000139 STATUS_ENTRYPOINT_NOT_FOUND.
/// See https://github.com/tauri-apps/tauri/issues/13419 (the manifest workaround is from a
/// Tauri maintainer there). `-tests` leaves the bin manifest above untouched.
fn embed_test_manifest() {
    const MANIFEST: &str = "windows-test-manifest.xml";
    println!("cargo:rerun-if-changed={MANIFEST}");

    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    // `/MANIFEST*` are MSVC linker flags; the GNU toolchain does not understand them.
    if target_os != "windows" || target_env != "msvc" {
        return;
    }

    let dir = std::env::var_os("CARGO_MANIFEST_DIR").expect("cargo sets CARGO_MANIFEST_DIR");
    let manifest = PathBuf::from(dir).join(MANIFEST);
    println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
    println!(
        "cargo:rustc-link-arg-tests=/MANIFESTINPUT:{}",
        manifest.display()
    );
}
