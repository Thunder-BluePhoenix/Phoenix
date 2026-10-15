// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Linux-only: applies the placement chosen in `island_platform` to the GTK window.
//!
//! * Layer shell (wlroots, KDE Plasma, COSMIC): `libgtk-layer-shell` is opened with `dlopen`
//!   at run time instead of being linked, so a machine without it still starts Phoenix and
//!   simply gets a plain window. Its documentation warns that on some systems it must be
//!   loaded before `libwayland-client` (otherwise `LD_PRELOAD`); after the init we therefore
//!   ask the library whether the window really became a layer surface and fall back if not.
//! * Dock hint (X11, and GNOME through XWayland): standard GTK window hints.
//!
//! Compiled only on Linux. Not run on any Linux desktop by the author.

use crate::island_platform::{DockHints, KeyboardMode, Layer, LayerShellConfig};
use gtk::glib::translate::ToGlibPtr;
use gtk::prelude::*;
use libloading::Library;
use std::ffi::{c_int, c_void, CString};
use std::sync::OnceLock;

const LIBRARY_NAMES: [&str; 2] = ["libgtk-layer-shell.so.0", "libgtk-layer-shell.so"];
// GtkLayerShellLayer / Edge / KeyboardMode values from gtk-layer-shell.h.
const LAYER_TOP: c_int = 2;
const LAYER_OVERLAY: c_int = 3;
const EDGE_LEFT: c_int = 0;
const EDGE_RIGHT: c_int = 1;
const EDGE_TOP: c_int = 2;
const KEYBOARD_NONE: c_int = 0;

fn library() -> Option<&'static Library> {
    static LIB: OnceLock<Option<Library>> = OnceLock::new();
    LIB.get_or_init(|| {
        LIBRARY_NAMES
            .iter()
            // SAFETY: loading a shared library runs its initialisers; this is the system's
            // libgtk-layer-shell, which has none beyond GObject type registration.
            .find_map(|name| unsafe { Library::new(name).ok() })
    })
    .as_ref()
}

/// Is the library present and does the running compositor offer wlr-layer-shell? Must run on
/// the main thread after GTK is initialised (it may do a Wayland roundtrip).
pub fn layer_shell_supported() -> bool {
    // Before GTK is up there is no display to ask (also the case under the mock runtime).
    if !gtk::is_initialized_main_thread() {
        return false;
    }
    let Some(lib) = library() else {
        return false;
    };
    // SAFETY: the symbol has this C signature in gtk-layer-shell >= 0.5.
    unsafe {
        lib.get::<unsafe extern "C" fn() -> c_int>(b"gtk_layer_is_supported\0")
            .map(|f| f() != 0)
            .unwrap_or(false)
    }
}

/// Turns the (not yet shown) window into a layer surface. Returns false when the library
/// refused, in which case the caller falls back to a plain window.
pub fn apply_layer_shell(window: &gtk::ApplicationWindow, config: &LayerShellConfig) -> bool {
    let Some(lib) = library() else {
        return false;
    };
    let gtk_window: *mut c_void = {
        let ptr: *mut gtk::ffi::GtkWindow = window.upcast_ref::<gtk::Window>().to_glib_none().0;
        ptr.cast()
    };
    let Ok(namespace) = CString::new(config.namespace) else {
        return false;
    };
    // SAFETY: every symbol is looked up by name with the signature from gtk-layer-shell.h,
    // `gtk_window` is a live GtkWindow, and this runs on the GTK main thread.
    unsafe {
        type WindowFn = unsafe extern "C" fn(*mut c_void);
        type WindowIntFn = unsafe extern "C" fn(*mut c_void, c_int);
        type WindowIntIntFn = unsafe extern "C" fn(*mut c_void, c_int, c_int);
        type WindowStrFn = unsafe extern "C" fn(*mut c_void, *const std::ffi::c_char);
        type IsLayerFn = unsafe extern "C" fn(*mut c_void) -> c_int;

        macro_rules! symbol {
            ($name:literal, $ty:ty) => {
                match lib.get::<$ty>(concat!($name, "\0").as_bytes()) {
                    Ok(f) => f,
                    Err(_) => return false,
                }
            };
        }
        let init = symbol!("gtk_layer_init_for_window", WindowFn);
        let is_layer = symbol!("gtk_layer_is_layer_window", IsLayerFn);
        let set_layer = symbol!("gtk_layer_set_layer", WindowIntFn);
        let set_anchor = symbol!("gtk_layer_set_anchor", WindowIntIntFn);
        let set_margin = symbol!("gtk_layer_set_margin", WindowIntIntFn);
        let set_zone = symbol!("gtk_layer_set_exclusive_zone", WindowIntFn);
        let set_namespace = symbol!("gtk_layer_set_namespace", WindowStrFn);

        init(gtk_window);
        if is_layer(gtk_window) == 0 {
            return false;
        }
        set_layer(
            gtk_window,
            match config.layer {
                Layer::Top => LAYER_TOP,
                Layer::Overlay => LAYER_OVERLAY,
            },
        );
        set_anchor(gtk_window, EDGE_TOP, c_int::from(config.anchor_top));
        set_anchor(gtk_window, EDGE_LEFT, c_int::from(config.anchor_left));
        set_anchor(gtk_window, EDGE_RIGHT, c_int::from(config.anchor_right));
        set_margin(gtk_window, EDGE_TOP, config.margin_top);
        set_zone(gtk_window, config.exclusive_zone);
        set_namespace(gtk_window, namespace.as_ptr());
        // `set_keyboard_mode` needs gtk-layer-shell >= 0.6; older ones only have the boolean.
        match config.keyboard {
            KeyboardMode::None => {
                if let Ok(f) = lib.get::<WindowIntFn>(b"gtk_layer_set_keyboard_mode\0") {
                    f(gtk_window, KEYBOARD_NONE);
                } else if let Ok(f) =
                    lib.get::<WindowIntFn>(b"gtk_layer_set_keyboard_interactivity\0")
                {
                    f(gtk_window, 0);
                }
            }
        }
    }
    true
}

/// The X11 / XWayland dock path. Call before the window is shown.
pub fn apply_dock_hints(window: &gtk::ApplicationWindow, hints: &DockHints) {
    if hints.dock_type {
        window.set_type_hint(gtk::gdk::WindowTypeHint::Dock);
    }
    window.set_skip_taskbar_hint(hints.skip_taskbar);
    window.set_skip_pager_hint(hints.skip_pager);
    window.set_accept_focus(hints.accept_focus);
    window.set_keep_above(hints.keep_above);
    if hints.sticky {
        window.stick();
    }
}
