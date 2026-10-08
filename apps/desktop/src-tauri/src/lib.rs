// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Floating desktop Fawkes. A transparent, borderless, draggable window that
//! renders the web app's `floating.html` and mirrors Phoenix Core's state.
//!
//! All OS-specific behaviour (window, tray, autostart) lives in this crate; the
//! page only talks to it through the commands below (ADR-0013).

mod connection;
mod position;
mod settings;

use connection::{connection, locate, phoenix_url, CoreConnection, Locator};
use parking_lot::Mutex;
use position::{place, Point, Rect};
use settings::Settings;
use std::path::PathBuf;
use tauri::menu::{CheckMenuItem, ContextMenu, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, RunEvent, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_opener::OpenerExt as _;

const WINDOW_LABEL: &str = "fawkes";
/// Logical size of the transparent window: Fawkes plus room for a speech bubble.
const WINDOW_SIZE: (f64, f64) = (200.0, 220.0);
const TRAY_ID: &str = "phoenix-tray";

struct Shell {
    locator: Locator,
    settings_path: PathBuf,
    settings: Mutex<Settings>,
    menu: Mutex<Option<MenuItems>>,
}

struct MenuItems {
    menu: Menu<tauri::Wry>,
    toggle: MenuItem<tauri::Wry>,
    on_top: CheckMenuItem<tauri::Wry>,
    login: CheckMenuItem<tauri::Wry>,
}

impl Shell {
    /// Changes a setting and writes it to disk.
    fn update(&self, change: impl FnOnce(&mut Settings)) {
        let mut settings = self.settings.lock();
        change(&mut settings);
        // Best effort: failing to remember a preference must never break the pet.
        let _ = settings::save(&self.settings_path, &settings);
    }

    /// Changes a setting in memory only; `flush` or the next `update` writes it.
    fn remember(&self, change: impl FnOnce(&mut Settings)) {
        change(&mut self.settings.lock());
    }

    fn flush(&self) {
        let _ = settings::save(&self.settings_path, &self.settings.lock());
    }
}

/// Connected monitors. `available_monitors()` can be empty while the app is still
/// starting (observed on macOS), so fall back to the primary and current monitors.
fn monitor_rects(window: &WebviewWindow) -> Vec<Rect> {
    let mut monitors = window.available_monitors().unwrap_or_default();
    if monitors.is_empty() {
        monitors.extend(window.primary_monitor().ok().flatten());
        monitors.extend(window.current_monitor().ok().flatten());
    }
    let mut rects: Vec<Rect> = monitors
        .iter()
        .map(|m| {
            let p = m.position();
            let s = m.size();
            Rect::new(p.x, p.y, s.width as i32, s.height as i32)
        })
        .collect();
    rects.dedup();
    rects
}

// ── Commands (the whole surface the page can use) ───────────────────────────

#[tauri::command]
fn core_connection(shell: tauri::State<Shell>) -> CoreConnection {
    connection(&shell.locator)
}

/// Where `pnpm dev:core` keeps its data (`config/dev.json` sets `.phoenix/dev` relative to
/// the repository). Only a development build of the shell looks there; a release build
/// has no repository to point at.
fn repo_dev_data_dir() -> Option<PathBuf> {
    cfg!(debug_assertions).then(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../.phoenix/dev")
            .components()
            .collect::<PathBuf>()
    })
}

#[tauri::command]
fn move_window_by(window: WebviewWindow, dx: f64, dy: f64) {
    if !dx.is_finite() || !dy.is_finite() {
        return;
    }
    let scale = window.scale_factor().unwrap_or(1.0);
    if let Ok(p) = window.outer_position() {
        let _ = window.set_position(PhysicalPosition::new(
            p.x + (dx * scale).round() as i32,
            p.y + (dy * scale).round() as i32,
        ));
    }
}

#[tauri::command]
fn drag_finished(window: WebviewWindow, shell: tauri::State<Shell>) {
    save_position(&window, &shell);
}

#[tauri::command]
fn open_in_phoenix(app: AppHandle, shell: tauri::State<Shell>, route: String) {
    if let Some(url) = phoenix_url(&shell.locator.base_url, &route) {
        let _ = app.opener().open_url(url, None::<&str>);
    }
}

#[tauri::command]
fn show_menu(window: WebviewWindow, shell: tauri::State<Shell>) {
    if let Some(items) = shell.menu.lock().as_ref() {
        let _ = items.menu.popup(window.as_ref().window().clone());
    }
}

fn save_position(window: &WebviewWindow, shell: &Shell) {
    if let Ok(p) = window.outer_position() {
        shell.update(|s| s.position = Some(Point { x: p.x, y: p.y }));
    }
}

// ── Window and tray ──────────────────────────────────────────────────────────

fn create_window(app: &AppHandle, settings: &Settings) -> tauri::Result<WebviewWindow> {
    let window =
        WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::App("floating.html".into()))
            .title("Fawkes")
            .inner_size(WINDOW_SIZE.0, WINDOW_SIZE.1)
            .transparent(true)
            .decorations(false)
            .shadow(false)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            // Never in the taskbar / Dock switcher: Fawkes is a companion, not a document.
            .skip_taskbar(true)
            .always_on_top(settings.always_on_top)
            .visible(false)
            .build()?;

    let scale = window.scale_factor().unwrap_or(1.0);
    let size = (
        (WINDOW_SIZE.0 * scale).round() as i32,
        (WINDOW_SIZE.1 * scale).round() as i32,
    );
    let target = place(settings.position, size, &monitor_rects(&window));
    window.set_position(PhysicalPosition::new(target.x, target.y))?;
    window.set_size(PhysicalSize::new(size.0 as u32, size.1 as u32))?;
    if settings.visible {
        window.show()?;
    }
    Ok(window)
}

fn set_visible(app: &AppHandle, visible: bool) {
    let shell = app.state::<Shell>();
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = if visible {
            window.show()
        } else {
            window.hide()
        };
    }
    shell.update(|s| s.visible = visible);
    let menu = shell.menu.lock();
    if let Some(items) = menu.as_ref() {
        let _ = items.toggle.set_text(if visible {
            "Hide Fawkes"
        } else {
            "Show Fawkes"
        });
    }
}

fn toggle_visible(app: &AppHandle) {
    let visible = app.state::<Shell>().settings.lock().visible;
    set_visible(app, !visible);
}

fn set_always_on_top(app: &AppHandle, on: bool) {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.set_always_on_top(on);
    }
    app.state::<Shell>().update(|s| s.always_on_top = on);
}

fn set_start_on_login(app: &AppHandle, on: bool) {
    let manager = app.autolaunch();
    let _ = if on {
        manager.enable()
    } else {
        manager.disable()
    };
}

fn build_menu(app: &AppHandle, settings: &Settings) -> tauri::Result<MenuItems> {
    let toggle = MenuItem::with_id(
        app,
        "toggle",
        if settings.visible {
            "Hide Fawkes"
        } else {
            "Show Fawkes"
        },
        true,
        None::<&str>,
    )?;
    let open = MenuItem::with_id(app, "open", "Open Phoenix", true, None::<&str>)?;
    let on_top = CheckMenuItem::with_id(
        app,
        "on_top",
        "Keep Fawkes on top",
        true,
        settings.always_on_top,
        None::<&str>,
    )?;
    let login_enabled = app.autolaunch().is_enabled().unwrap_or(false);
    let login = CheckMenuItem::with_id(
        app,
        "login",
        "Start Fawkes when I log in",
        true,
        login_enabled,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Quit Fawkes", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &toggle,
            &open,
            &PredefinedMenuItem::separator(app)?,
            &on_top,
            &login,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    Ok(MenuItems {
        menu,
        toggle,
        on_top,
        login,
    })
}

fn handle_menu(app: &AppHandle, id: &str) {
    match id {
        "toggle" => toggle_visible(app),
        "open" => {
            let base = app.state::<Shell>().locator.base_url.clone();
            let _ = app.opener().open_url(base, None::<&str>);
        }
        "on_top" => {
            let on = !app.state::<Shell>().settings.lock().always_on_top;
            set_always_on_top(app, on);
            if let Some(items) = app.state::<Shell>().menu.lock().as_ref() {
                let _ = items.on_top.set_checked(on);
            }
        }
        "login" => {
            let on = !app.autolaunch().is_enabled().unwrap_or(false);
            set_start_on_login(app, on);
            if let Some(items) = app.state::<Shell>().menu.lock().as_ref() {
                let _ = items.login.set_checked(on);
            }
        }
        // Quit is always available from the tray and the window's menu.
        "quit" => app.exit(0),
        _ => {}
    }
}

fn build_tray(app: &AppHandle, menu: &Menu<tauri::Wry>) -> tauri::Result<()> {
    let icon = app
        .default_window_icon()
        .cloned()
        .expect("bundled app icon");
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("Fawkes")
        .menu(menu)
        // Left click toggles Fawkes; the menu opens on right click (or left click on Linux).
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| handle_menu(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_visible(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None::<Vec<&str>>,
        ))
        .invoke_handler(tauri::generate_handler![
            core_connection,
            move_window_by,
            drag_finished,
            open_in_phoenix,
            show_menu
        ])
        .setup(|app| {
            let handle = app.handle();
            #[cfg(target_os = "macos")]
            handle.set_activation_policy(tauri::ActivationPolicy::Accessory)?;

            let data_dir = handle.path().app_data_dir()?;
            let settings_path = data_dir.join("desktop.json");
            let settings = settings::load(&settings_path);
            let locator = locate(
                |k| std::env::var(k).ok(),
                handle.path().home_dir().ok(),
                repo_dev_data_dir(),
            );

            let items = build_menu(handle, &settings)?;
            build_tray(handle, &items.menu)?;
            app.manage(Shell {
                locator,
                settings_path,
                settings: Mutex::new(settings.clone()),
                menu: Mutex::new(Some(items)),
            });
            create_window(handle, &settings)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // The OS moved the window (drag, keyboard, snap, display change). Remember the spot in
            // memory only: this fires for every step of a drag, and writing the file each time is
            // dozens of disk writes per second. It reaches the disk when the drag ends
            // (`drag_finished`), when any setting changes, and on exit.
            if let WindowEvent::Moved(p) = event {
                if window.label() == WINDOW_LABEL {
                    window
                        .app_handle()
                        .state::<Shell>()
                        .remember(|s| s.position = Some(Point { x: p.x, y: p.y }));
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Phoenix desktop")
        .run(|app, event| {
            // Quit from the tray, the OS, or the last window closing: keep the latest position.
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                if let Some(shell) = app.try_state::<Shell>() {
                    shell.flush();
                }
            }
        });
}
