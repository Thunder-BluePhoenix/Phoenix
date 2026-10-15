// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Per-OS decisions for the island, as plain data. Nothing here calls the OS, so the choices
//! (which Linux path, which window flags, which pointer source, what is click-through) are
//! unit-tested on any machine. The code that applies them lives in `island_linux.rs`
//! (cfg linux), `island_macos.rs` (cfg macos) and `lib.rs` (Tauri window builder, all OSes).
//!
//! What the tests prove is the *decision*. Whether a given compositor or Windows version
//! honours the result has only been run where noted in `apps/desktop/README.md`.

// Some items serve one OS only (the Windows style bits, the Linux backend choice) but are tested
// on every OS, so on the others they look unused.
#![allow(dead_code)]

use crate::island_state::IslandState;
use crate::position::Rect;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Os {
    Mac,
    Windows,
    Linux,
}

impl Os {
    pub const fn current() -> Os {
        if cfg!(target_os = "macos") {
            Os::Mac
        } else if cfg!(windows) {
            Os::Windows
        } else {
            Os::Linux
        }
    }
}

/// Tauri window attributes for the island window.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WindowFlags {
    /// `false` = the window never takes keyboard focus (Windows: `WS_EX_NOACTIVATE`; Linux:
    /// `accept_focus(false)`), so showing the island never steals focus from what you type in.
    pub focusable: bool,
    /// Not focused when first shown (Windows: shown with `SW_SHOWNOACTIVATE`).
    pub focused: bool,
    pub skip_taskbar: bool,
    pub always_on_top: bool,
    pub all_workspaces: bool,
}

pub fn window_flags(os: Os) -> WindowFlags {
    WindowFlags {
        // macOS: the app is an Accessory (no Dock icon) and a click on the island must work on
        // the first click, so it stays focusable there. Elsewhere a focus steal is the bug.
        focusable: os == Os::Mac,
        focused: false,
        skip_taskbar: true,
        always_on_top: true,
        all_workspaces: true,
    }
}

// ── Windows ─────────────────────────────────────────────────────────────────

pub const WS_EX_TOPMOST: u32 = 0x0000_0008;
pub const WS_EX_TOOLWINDOW: u32 = 0x0000_0080;
pub const WS_EX_NOACTIVATE: u32 = 0x0800_0000;

/// Extended window style for the island: never activated (a click or a show cannot take focus
/// from the app being typed in), a tool window (no taskbar button, not in Alt-Tab) and topmost.
/// Other bits (layered, transparent ...) are left exactly as they were.
pub fn windows_ex_style(current: u32) -> u32 {
    current | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TOPMOST
}

// ── Linux ───────────────────────────────────────────────────────────────────

/// The environment a Linux island decision is made from.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SessionEnv {
    pub xdg_session_type: Option<String>,
    pub xdg_current_desktop: Option<String>,
    pub wayland_display: Option<String>,
    pub x11_display: Option<String>,
    pub gdk_backend: Option<String>,
}

impl SessionEnv {
    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Self {
        let non_empty = |k: &str| get(k).filter(|v| !v.is_empty());
        Self {
            xdg_session_type: non_empty("XDG_SESSION_TYPE"),
            xdg_current_desktop: non_empty("XDG_CURRENT_DESKTOP"),
            wayland_display: non_empty("WAYLAND_DISPLAY"),
            x11_display: non_empty("DISPLAY"),
            gdk_backend: non_empty("GDK_BACKEND"),
        }
    }

    pub fn is_wayland_session(&self) -> bool {
        self.xdg_session_type
            .as_deref()
            .is_some_and(|t| t.eq_ignore_ascii_case("wayland"))
            || self.wayland_display.is_some()
    }

    /// `XDG_CURRENT_DESKTOP` is a colon-separated list ("ubuntu:GNOME").
    pub fn desktop_is(&self, name: &str) -> bool {
        self.xdg_current_desktop
            .as_deref()
            .is_some_and(|d| d.split(':').any(|part| part.eq_ignore_ascii_case(name)))
    }
}

/// Which way the island is placed on Linux.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LinuxBackend {
    /// wlr-layer-shell through `libgtk-layer-shell`: wlroots compositors (Sway, Hyprland, ...),
    /// KDE Plasma and COSMIC.
    LayerShell,
    /// An X11 window with the `_NET_WM_WINDOW_TYPE_DOCK` hint: X11 sessions and GNOME, which
    /// has no layer-shell, through XWayland.
    DockHint,
    /// Neither is possible (a Wayland session with no layer-shell and no X display): an
    /// ordinary window the compositor places.
    Plain,
}

/// GNOME on Wayland has no layer-shell, so the process must run its toolkit on X11 (XWayland).
/// `GDK_BACKEND` must be set before GTK starts, which is why this is decided from the
/// environment alone, before any window exists.
pub fn needs_x11_backend(env: &SessionEnv) -> bool {
    env.is_wayland_session()
        && env.desktop_is("GNOME")
        && env.x11_display.is_some()
        && env.gdk_backend.is_none()
}

/// `GDK_BACKEND` value to export before GTK starts, if any. Only when the saved mode is the
/// island: forcing XWayland on everyone under GNOME would degrade the floating window for
/// users who never open the island. (Switching live to the island on GNOME-Wayland therefore
/// shows a plain window until the app is restarted in island mode.)
pub fn startup_gdk_backend(env: &SessionEnv, island_mode: bool) -> Option<&'static str> {
    (island_mode && needs_x11_backend(env)).then_some("x11")
}

/// Where the desktop shell keeps `desktop.json` on Linux, needed before Tauri exists (the
/// backend must be chosen before GTK starts). Mirrors Tauri's `app_data_dir`:
/// `$XDG_DATA_HOME` or `~/.local/share`, then the bundle identifier.
pub fn linux_settings_dir(
    get: impl Fn(&str) -> Option<String>,
    identifier: &str,
) -> Option<std::path::PathBuf> {
    let base = get("XDG_DATA_HOME")
        .filter(|v| v.starts_with('/'))
        .map(std::path::PathBuf::from)
        .or_else(|| {
            get("HOME")
                .filter(|v| !v.is_empty())
                .map(|home| std::path::PathBuf::from(home).join(".local/share"))
        })?;
    Some(base.join(identifier))
}

/// `layer_shell_supported` is the answer of `gtk_layer_is_supported()` on the running display
/// (false when the library is missing, or the compositor lacks the protocol).
pub fn choose_backend(env: &SessionEnv, layer_shell_supported: bool) -> LinuxBackend {
    let gtk_on_x11 = env
        .gdk_backend
        .as_deref()
        .is_some_and(|b| b.split(',').next() == Some("x11"));
    if gtk_on_x11 || !env.is_wayland_session() {
        return if env.x11_display.is_some() || gtk_on_x11 {
            LinuxBackend::DockHint
        } else {
            LinuxBackend::Plain
        };
    }
    if layer_shell_supported {
        LinuxBackend::LayerShell
    } else {
        // A Wayland session without layer-shell and GTK already on Wayland: only the
        // compositor decides placement.
        LinuxBackend::Plain
    }
}

/// How the pointer is observed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PointerSource {
    /// The shell polls the global cursor position.
    Poll,
    /// The page reports `pointerenter` / `pointerleave`: Wayland never tells a client where the
    /// pointer is outside its own surfaces.
    Page,
}

pub fn pointer_source(os: Os, backend: Option<LinuxBackend>) -> PointerSource {
    match (os, backend) {
        (Os::Linux, Some(LinuxBackend::LayerShell | LinuxBackend::Plain)) => PointerSource::Page,
        _ => PointerSource::Poll,
    }
}

/// Layer-shell surfaces are placed by the compositor on the output it picks (the focused one),
/// so choosing a display or following the mouse cannot be honoured there.
pub fn supports_display_choice(os: Os, backend: Option<LinuxBackend>) -> bool {
    !matches!((os, backend), (Os::Linux, Some(LinuxBackend::LayerShell)))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Layer {
    Top,
    Overlay,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KeyboardMode {
    /// The surface never receives keyboard input.
    None,
}

/// What to ask `libgtk-layer-shell` for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LayerShellConfig {
    pub layer: Layer,
    /// Anchored to the top edge only: the compositor centres the surface horizontally.
    pub anchor_top: bool,
    pub anchor_left: bool,
    pub anchor_right: bool,
    pub margin_top: i32,
    pub namespace: &'static str,
    pub keyboard: KeyboardMode,
    /// -1 = do not push other windows away and draw over panels.
    pub exclusive_zone: i32,
}

pub fn layer_shell_config() -> LayerShellConfig {
    LayerShellConfig {
        // Overlay, not Top: a Top surface sits below fullscreen windows and some panels.
        layer: Layer::Overlay,
        anchor_top: true,
        anchor_left: false,
        anchor_right: false,
        margin_top: 0,
        namespace: "phoenix-fawkes-island",
        keyboard: KeyboardMode::None,
        exclusive_zone: -1,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DockHints {
    pub dock_type: bool,
    pub skip_taskbar: bool,
    pub skip_pager: bool,
    pub sticky: bool,
    pub keep_above: bool,
    pub accept_focus: bool,
}

/// The X11 / XWayland path: a dock window is kept out of the task switcher, on every
/// workspace, above normal windows, and never takes focus.
pub fn dock_hints() -> DockHints {
    DockHints {
        dock_type: true,
        skip_taskbar: true,
        skip_pager: true,
        sticky: true,
        keep_above: true,
        accept_focus: false,
    }
}

/// The part of the window that takes pointer input; everything else is click-through. An empty
/// list is a fully click-through window. `window` is the window size in physical pixels.
///
/// A hidden island is a few pixels tall and invisible: where the shell polls the pointer it
/// must not catch clicks meant for the window below (empty region); where only the page can see
/// the pointer (Wayland) the strip has to stay live so the hover reaches the page.
pub fn input_region(state: IslandState, window: (i32, i32), source: PointerSource) -> Vec<Rect> {
    match (state, source) {
        (IslandState::Hidden, PointerSource::Poll) => Vec::new(),
        _ => vec![Rect::new(0, 0, window.0.max(0), window.1.max(0))],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(session: &str, desktop: &str, wayland: bool, x11: bool) -> SessionEnv {
        SessionEnv {
            xdg_session_type: Some(session.into()),
            xdg_current_desktop: Some(desktop.into()),
            wayland_display: wayland.then(|| "wayland-0".into()),
            x11_display: x11.then(|| ":0".into()),
            gdk_backend: None,
        }
    }

    #[test]
    fn windows_island_never_takes_focus_or_a_taskbar_slot() {
        let f = window_flags(Os::Windows);
        assert!(!f.focusable && !f.focused);
        assert!(f.skip_taskbar && f.always_on_top);
        assert!(!window_flags(Os::Linux).focusable);
    }

    #[test]
    fn windows_style_adds_noactivate_toolwindow_topmost_and_keeps_the_rest() {
        const LAYERED: u32 = 0x0008_0000;
        let s = windows_ex_style(LAYERED);
        assert_eq!(s & LAYERED, LAYERED);
        for bit in [WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST] {
            assert_eq!(s & bit, bit);
        }
        assert_eq!(windows_ex_style(s), s, "idempotent");
    }

    #[test]
    fn mac_island_is_clickable_on_the_first_click() {
        assert!(window_flags(Os::Mac).focusable);
        assert!(!window_flags(Os::Mac).focused);
        assert!(window_flags(Os::Mac).all_workspaces);
    }

    #[test]
    fn wlroots_kde_and_cosmic_use_layer_shell_when_supported() {
        for desktop in ["sway", "Hyprland", "KDE", "COSMIC"] {
            let e = env("wayland", desktop, true, true);
            assert!(!needs_x11_backend(&e), "{desktop}");
            assert_eq!(
                choose_backend(&e, true),
                LinuxBackend::LayerShell,
                "{desktop}"
            );
        }
    }

    #[test]
    fn gnome_on_wayland_runs_on_xwayland_with_the_dock_hint() {
        let e = env("wayland", "ubuntu:GNOME", true, true);
        assert!(needs_x11_backend(&e));
        let forced = SessionEnv {
            gdk_backend: Some("x11".into()),
            ..e
        };
        assert!(
            !needs_x11_backend(&forced),
            "never overrides an explicit GDK_BACKEND"
        );
        assert_eq!(choose_backend(&forced, false), LinuxBackend::DockHint);
        // Even if a layer-shell library is installed: GTK is on X11, so it cannot be used.
        assert_eq!(choose_backend(&forced, true), LinuxBackend::DockHint);
    }

    #[test]
    fn x11_is_forced_on_gnome_wayland_only_for_island_mode() {
        let e = env("wayland", "GNOME", true, true);
        assert_eq!(startup_gdk_backend(&e, true), Some("x11"));
        assert_eq!(startup_gdk_backend(&e, false), None);
        assert_eq!(
            startup_gdk_backend(&env("wayland", "KDE", true, true), true),
            None
        );
    }

    #[test]
    fn linux_settings_dir_follows_xdg_then_home() {
        let id = "dev.phoenix.desktop";
        let both = |k: &str| match k {
            "XDG_DATA_HOME" => Some("/data".to_string()),
            "HOME" => Some("/home/a".to_string()),
            _ => None,
        };
        assert_eq!(
            linux_settings_dir(both, id),
            Some("/data/dev.phoenix.desktop".into())
        );
        let home = |k: &str| (k == "HOME").then(|| "/home/a".to_string());
        assert_eq!(
            linux_settings_dir(home, id),
            Some("/home/a/.local/share/dev.phoenix.desktop".into())
        );
        let relative = |k: &str| match k {
            "XDG_DATA_HOME" => Some("rel".to_string()),
            "HOME" => Some("/home/a".to_string()),
            _ => None,
        };
        assert_eq!(
            linux_settings_dir(relative, id),
            Some("/home/a/.local/share/dev.phoenix.desktop".into()),
            "a relative XDG path is ignored, as the spec says"
        );
        assert_eq!(linux_settings_dir(|_| None, id), None);
    }

    #[test]
    fn gnome_without_xwayland_falls_back_to_a_plain_window() {
        let e = env("wayland", "GNOME", true, false);
        assert!(!needs_x11_backend(&e));
        assert_eq!(choose_backend(&e, false), LinuxBackend::Plain);
    }

    #[test]
    fn x11_sessions_use_the_dock_hint() {
        let e = env("x11", "XFCE", false, true);
        assert_eq!(choose_backend(&e, false), LinuxBackend::DockHint);
        assert!(!needs_x11_backend(&e));
    }

    #[test]
    fn a_wayland_session_without_layer_shell_gets_a_plain_window() {
        assert_eq!(
            choose_backend(&env("wayland", "weston", true, true), false),
            LinuxBackend::Plain
        );
    }

    #[test]
    fn the_environment_is_read_through_a_lookup_and_empty_means_unset() {
        let e = SessionEnv::from_lookup(|k| match k {
            "XDG_SESSION_TYPE" => Some("Wayland".into()),
            "XDG_CURRENT_DESKTOP" => Some("KDE".into()),
            "WAYLAND_DISPLAY" => Some(String::new()),
            _ => None,
        });
        assert!(e.is_wayland_session(), "session type is case-insensitive");
        assert_eq!(e.wayland_display, None);
        assert!(e.desktop_is("kde") && !e.desktop_is("GNOME"));
    }

    #[test]
    fn desktop_lists_are_matched_by_whole_name() {
        let e = env("wayland", "ubuntu:GNOME-Classic", true, true);
        assert!(!e.desktop_is("GNOME"));
        assert!(env("wayland", "ubuntu:GNOME", true, true).desktop_is("gnome"));
    }

    #[test]
    fn layer_shell_config_is_top_anchored_overlay_without_keyboard() {
        let c = layer_shell_config();
        assert_eq!(c.layer, Layer::Overlay);
        assert!(c.anchor_top && !c.anchor_left && !c.anchor_right);
        assert_eq!(c.keyboard, KeyboardMode::None);
        assert_eq!(c.exclusive_zone, -1);
        assert!(!c.namespace.is_empty());
    }

    #[test]
    fn dock_hints_keep_the_window_out_of_the_way() {
        let h = dock_hints();
        assert!(h.dock_type && h.skip_taskbar && h.skip_pager && h.sticky && h.keep_above);
        assert!(!h.accept_focus);
    }

    #[test]
    fn pointer_is_polled_except_where_wayland_hides_it() {
        assert_eq!(pointer_source(Os::Mac, None), PointerSource::Poll);
        assert_eq!(pointer_source(Os::Windows, None), PointerSource::Poll);
        assert_eq!(
            pointer_source(Os::Linux, Some(LinuxBackend::DockHint)),
            PointerSource::Poll
        );
        assert_eq!(
            pointer_source(Os::Linux, Some(LinuxBackend::LayerShell)),
            PointerSource::Page
        );
        assert_eq!(
            pointer_source(Os::Linux, Some(LinuxBackend::Plain)),
            PointerSource::Page
        );
    }

    #[test]
    fn display_choice_is_not_offered_on_layer_shell() {
        assert!(!supports_display_choice(
            Os::Linux,
            Some(LinuxBackend::LayerShell)
        ));
        assert!(supports_display_choice(
            Os::Linux,
            Some(LinuxBackend::DockHint)
        ));
        assert!(supports_display_choice(Os::Mac, None));
        assert!(supports_display_choice(Os::Windows, None));
    }

    #[test]
    fn hidden_island_is_click_through_when_polled_and_a_live_strip_when_not() {
        assert!(input_region(IslandState::Hidden, (220, 4), PointerSource::Poll).is_empty());
        assert_eq!(
            input_region(IslandState::Hidden, (220, 4), PointerSource::Page),
            vec![Rect::new(0, 0, 220, 4)]
        );
    }

    #[test]
    fn a_shown_island_takes_input_over_its_whole_window() {
        for state in [IslandState::Small, IslandState::Expanded] {
            assert_eq!(
                input_region(state, (360, 176), PointerSource::Poll),
                vec![Rect::new(0, 0, 360, 176)]
            );
        }
        // Negative sizes never produce a negative rect.
        assert_eq!(
            input_region(IslandState::Small, (-5, 10), PointerSource::Poll),
            vec![Rect::new(0, 0, 0, 10)]
        );
    }
}
