// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! macOS-only parts of the island: notch detection and window styling. The arithmetic lives
//! in `island_geometry` (tested everywhere); this file only reads `NSScreen` and sets
//! `NSWindow` properties. Both need the main thread.

use crate::island_geometry::{notch_from_areas, ScreenNotch};
use objc2::rc::Retained;
use objc2::runtime::NSObjectProtocol;
use objc2::{sel, MainThreadMarker};
use objc2_app_kit::{NSScreen, NSStatusWindowLevel, NSWindow, NSWindowCollectionBehavior};
use std::ffi::c_void;

/// The notch of every screen, or `None` when not on the main thread. A screen without a
/// notch (or on macOS < 12, which has no safe-area API) reports `notch: None`.
pub fn screens() -> Option<Vec<ScreenNotch>> {
    let mtm = MainThreadMarker::new()?;
    Some(
        NSScreen::screens(mtm)
            .iter()
            .map(|screen| {
                let frame = screen.frame();
                // `safeAreaInsets` / `auxiliary*Area` appeared in macOS 12.
                let notch = screen
                    .respondsToSelector(sel!(safeAreaInsets))
                    .then(|| {
                        notch_from_areas(
                            frame.size.width,
                            screen.safeAreaInsets().top,
                            screen.auxiliaryTopLeftArea().size.width,
                            screen.auxiliaryTopRightArea().size.width,
                        )
                    })
                    .flatten();
                ScreenNotch {
                    width: frame.size.width,
                    height: frame.size.height,
                    notch,
                }
            })
            .collect(),
    )
}

/// Draws the island over the menu bar (that is where the notch is), on every Space and over
/// full-screen apps, and keeps it out of Cmd-Tab / Mission Control. Call on the main thread.
///
/// # Safety
/// `ns_window` must be the live `NSWindow*` of the island window (Tauri's `ns_window()`).
pub unsafe fn style_window(ns_window: *mut c_void) {
    let Some(window) = (unsafe { Retained::retain(ns_window.cast::<NSWindow>()) }) else {
        return;
    };
    window.setLevel(NSStatusWindowLevel);
    window.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::IgnoresCycle,
    );
}
