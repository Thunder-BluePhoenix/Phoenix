// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! The island window: the thin layer between the pure modules (`island_state`,
//! `island_geometry`, `island_controller`, `island_platform`) and Tauri / the OS. It builds the
//! window, feeds the controller monitors, the cursor and page events, and applies the frames the
//! controller returns. Nothing here decides anything the pure modules could decide.
//!
//! The island shows the same pet as the floating window: both pages read Fawkes' state from
//! Core through the same client code, and only one window is visible at a time (mode).

use crate::island_controller::{Controller, Frame};
use crate::island_geometry::{
    match_notch, primary_first, IslandDisplay, MonitorInfo, ScreenNotch, DEFAULT_PILL_WIDTH,
    HOT_ZONE_HEIGHT,
};
use crate::island_platform::{
    choose_backend, input_region, pointer_source, supports_display_choice, window_flags,
    LinuxBackend, Os, SessionEnv,
};
use crate::island_state::Timing;
use crate::position::{Point, Rect};
use crate::settings::Mode;
use crate::Shell;
use parking_lot::Mutex;
use std::time::{Duration, Instant};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};

pub const ISLAND_LABEL: &str = "fawkes-island";
/// Event the shell emits to the island page with the current `Frame`.
pub const FRAME_EVENT: &str = "island://frame";
const LOOP_INTERVAL: Duration = Duration::from_millis(80);
/// Monitors are re-read this many loop ticks apart (about two seconds).
const MONITOR_REFRESH_TICKS: u32 = 25;

/// The island's platform, decided once at startup.
#[derive(Clone, Copy, Debug)]
pub struct Platform {
    pub os: Os,
    pub backend: Option<LinuxBackend>,
}

impl Platform {
    pub fn detect() -> Self {
        let os = Os::current();
        let backend = (os == Os::Linux).then(|| {
            let env = SessionEnv::from_lookup(|k| std::env::var(k).ok());
            choose_backend(&env, layer_shell_supported())
        });
        Self { os, backend }
    }

    pub fn display_choice(&self) -> bool {
        supports_display_choice(self.os, self.backend)
    }
}

/// Island state that lives in the shell for the whole run.
pub struct Host {
    controller: Mutex<Controller>,
    started: Instant,
    pub platform: Platform,
    style_native_window: bool,
}

impl Host {
    pub fn new(display: IslandDisplay, platform: Platform, style_native_window: bool) -> Self {
        let source = pointer_source(platform.os, platform.backend);
        Self {
            controller: Mutex::new(Controller::new(Timing::default(), display, source)),
            started: Instant::now(),
            platform,
            style_native_window,
        }
    }

    pub fn now_ms(&self) -> u64 {
        self.started.elapsed().as_millis() as u64
    }

    pub fn controller(&self) -> parking_lot::MutexGuard<'_, Controller> {
        self.controller.lock()
    }
}

#[cfg(target_os = "linux")]
fn layer_shell_supported() -> bool {
    crate::island_linux::layer_shell_supported()
}

#[cfg(not(target_os = "linux"))]
fn layer_shell_supported() -> bool {
    false
}

fn screens() -> Vec<ScreenNotch> {
    #[cfg(target_os = "macos")]
    {
        crate::island_macos::screens().unwrap_or_default()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Vec::new()
    }
}

fn monitor_rect(m: &tauri::Monitor) -> Rect {
    let (p, s) = (m.position(), m.size());
    Rect::new(p.x, p.y, s.width as i32, s.height as i32)
}

/// Connected monitors, primary first, each with its notch when the OS reports one. Read through
/// a window (not the app handle) so the mock runtime used by the lifecycle tests answers too.
fn collect_monitors<R: Runtime>(window: &WebviewWindow<R>) -> Vec<MonitorInfo> {
    let screens = screens();
    let mut infos: Vec<MonitorInfo> = window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let rect = monitor_rect(m);
            MonitorInfo {
                rect,
                scale: m.scale_factor(),
                name: m.name().cloned(),
                notch: match_notch(&rect, m.scale_factor(), &screens),
            }
        })
        .collect();
    let primary = window
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| monitor_rect(&m));
    primary_first(&mut infos, primary);
    infos
}

fn cursor<R: Runtime>(window: &WebviewWindow<R>) -> Option<Point> {
    window.cursor_position().ok().map(|p| Point {
        x: p.x.round() as i32,
        y: p.y.round() as i32,
    })
}

/// Creates the (hidden) island window and styles it for the OS. Main thread only.
fn create_window<R: Runtime>(
    app: &AppHandle<R>,
    platform: Platform,
    style_native_window: bool,
) -> tauri::Result<WebviewWindow<R>> {
    let flags = window_flags(platform.os);
    let window =
        WebviewWindowBuilder::new(app, ISLAND_LABEL, WebviewUrl::App("island.html".into()))
            .title("Fawkes Island")
            .inner_size(DEFAULT_PILL_WIDTH, HOT_ZONE_HEIGHT)
            .transparent(true)
            .decorations(false)
            .shadow(false)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .skip_taskbar(flags.skip_taskbar)
            .always_on_top(flags.always_on_top)
            .visible_on_all_workspaces(flags.all_workspaces)
            .focusable(flags.focusable)
            .focused(flags.focused)
            .visible(false)
            .build()?;
    if style_native_window {
        style_window(&window, platform);
    }
    Ok(window)
}

#[allow(unused_variables)]
fn style_window<R: Runtime>(window: &WebviewWindow<R>, platform: Platform) {
    #[cfg(target_os = "macos")]
    if let Ok(ns_window) = window.ns_window() {
        // SAFETY: `ns_window` is this window's live NSWindow and we are on the main thread.
        unsafe { crate::island_macos::style_window(ns_window) };
    }
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        crate::island_windows::apply_no_activate(hwnd);
    }
    #[cfg(target_os = "linux")]
    if let Ok(gtk_window) = window.gtk_window() {
        use crate::island_platform::{dock_hints, layer_shell_config};
        let layer_shell = platform.backend == Some(LinuxBackend::LayerShell)
            && crate::island_linux::apply_layer_shell(&gtk_window, &layer_shell_config());
        if !layer_shell && platform.backend != Some(LinuxBackend::Plain) {
            crate::island_linux::apply_dock_hints(&gtk_window, &dock_hints());
        }
    }
}

/// Moves, resizes and click-through-toggles the window, then tells the page. Safe from any
/// thread: every call goes through Tauri's message queue.
pub fn apply_frame<R: Runtime>(app: &AppHandle<R>, platform: Platform, frame: Frame) {
    let Some(window) = app.get_webview_window(ISLAND_LABEL) else {
        return;
    };
    let r = frame.layout.rect;
    let _ = window.set_size(PhysicalSize::new(r.w.max(1) as u32, r.h.max(1) as u32));
    // A layer surface is placed by the compositor from its anchor; asking for a position is
    // at best ignored.
    if !(platform.os == Os::Linux && platform.backend == Some(LinuxBackend::LayerShell)) {
        let _ = window.set_position(PhysicalPosition::new(r.x, r.y));
    }
    let click_through = input_region(frame.state, (r.w, r.h), frame.pointer).is_empty();
    let _ = window.set_ignore_cursor_events(click_through);
    let _ = window.emit(FRAME_EVENT, frame);
}

/// Shows the island (creating it the first time). Main thread only.
pub fn show<R: Runtime>(app: &AppHandle<R>) {
    let shell = app.state::<Shell<R>>();
    let platform = shell.island.platform;
    let window = match app.get_webview_window(ISLAND_LABEL) {
        Some(window) => window,
        None => match create_window(app, platform, shell.island.style_native_window) {
            Ok(window) => window,
            Err(_) => return,
        },
    };
    let frame = {
        let mut controller = shell.island.controller();
        controller.set_monitors(collect_monitors(&window), cursor(&window));
        controller.republish()
    };
    if let Some(frame) = frame {
        apply_frame(app, platform, frame);
    }
    let _ = window.show();
}

pub fn hide<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(ISLAND_LABEL) {
        let _ = window.hide();
    }
}

/// One step of the loop, on the main thread.
fn tick<R: Runtime>(app: &AppHandle<R>, refresh_monitors: bool) {
    let shell = app.state::<Shell<R>>();
    let Some(window) = app.get_webview_window(ISLAND_LABEL) else {
        return;
    };
    if shell.settings.lock().mode != Mode::Island || !window.is_visible().unwrap_or(false) {
        return;
    }
    let cursor = cursor(&window);
    let now = shell.island.now_ms();
    let frame = {
        let mut controller = shell.island.controller();
        let moved = refresh_monitors
            .then(|| controller.set_monitors(collect_monitors(&window), cursor))
            .flatten();
        controller.poll(cursor, now).or(moved)
    };
    if let Some(frame) = frame {
        apply_frame(app, shell.island.platform, frame);
    }
}

/// Polls the cursor and the clock while the island is the chosen mode. The thread only wakes
/// the main thread; it exits when the app is gone. Started by `run`, never by the lifecycle tests.
pub fn spawn_loop<R: Runtime>(app: AppHandle<R>) {
    std::thread::spawn(move || {
        let mut count = 0u32;
        loop {
            std::thread::sleep(LOOP_INTERVAL);
            let in_island_mode = app
                .try_state::<Shell<R>>()
                .is_some_and(|shell| shell.settings.lock().mode == Mode::Island);
            if !in_island_mode {
                continue;
            }
            let refresh = count.is_multiple_of(MONITOR_REFRESH_TICKS);
            count = count.wrapping_add(1);
            let handle = app.clone();
            if app
                .run_on_main_thread(move || tick(&handle, refresh))
                .is_err()
            {
                break;
            }
        }
    });
}
