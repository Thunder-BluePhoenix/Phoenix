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
use tauri::menu::{CheckMenuItem, ContextMenu, Menu, MenuItem, MenuItemKind, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, RunEvent, Runtime, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_opener::OpenerExt as _;

pub const WINDOW_LABEL: &str = "fawkes";
/// Logical size of the transparent window: Fawkes plus room for a speech bubble.
const WINDOW_SIZE: (f64, f64) = (200.0, 220.0);
pub const TRAY_ID: &str = "phoenix-tray";
/// Settings file name inside the settings directory.
pub const SETTINGS_FILE: &str = "desktop.json";

/// Opens a URL in the user's browser.
pub type UrlOpener = Box<dyn Fn(&str) + Send + Sync>;
/// Looks up an environment variable.
pub type EnvLookup = Box<dyn Fn(&str) -> Option<String> + Send + Sync>;

/// What differs between the real app and the automated lifecycle tests, which must not
/// touch the user's settings, browser or environment. `Default` is the real app.
#[derive(Default)]
pub struct ShellOptions {
    /// Directory for `desktop.json`. Default: the OS app-data directory.
    pub settings_dir: Option<PathBuf>,
    /// Default: the system browser (opener plugin).
    pub open_url: Option<UrlOpener>,
    /// Default: the process environment.
    pub env: Option<EnvLookup>,
}

struct Shell<R: Runtime> {
    locator: Locator,
    settings_path: PathBuf,
    settings: Mutex<Settings>,
    menu: Mutex<Option<MenuItems<R>>>,
    open_url: UrlOpener,
}

struct MenuItems<R: Runtime> {
    menu: Menu<R>,
    toggle: MenuItem<R>,
    on_top: CheckMenuItem<R>,
    login: CheckMenuItem<R>,
}

impl<R: Runtime> Shell<R> {
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
fn monitor_rects<R: Runtime>(window: &WebviewWindow<R>) -> Vec<Rect> {
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
// `_app` only pins the runtime type for the generic command.
fn core_connection<R: Runtime>(
    _app: AppHandle<R>,
    shell: tauri::State<'_, Shell<R>>,
) -> CoreConnection {
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
fn move_window_by<R: Runtime>(window: WebviewWindow<R>, dx: f64, dy: f64) {
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
fn drag_finished<R: Runtime>(window: WebviewWindow<R>, shell: tauri::State<'_, Shell<R>>) {
    save_position(&window, &shell);
}

#[tauri::command]
fn open_in_phoenix<R: Runtime>(
    _app: AppHandle<R>,
    shell: tauri::State<'_, Shell<R>>,
    route: String,
) {
    if let Some(url) = phoenix_url(&shell.locator.base_url, &route) {
        (shell.open_url)(&url);
    }
}

#[tauri::command]
fn show_menu<R: Runtime>(window: WebviewWindow<R>, shell: tauri::State<'_, Shell<R>>) {
    if let Some(items) = shell.menu.lock().as_ref() {
        let _ = items.menu.popup(window.as_ref().window().clone());
    }
}

fn save_position<R: Runtime>(window: &WebviewWindow<R>, shell: &Shell<R>) {
    if let Ok(p) = window.outer_position() {
        shell.update(|s| s.position = Some(Point { x: p.x, y: p.y }));
    }
}

// ── Window and tray ──────────────────────────────────────────────────────────

fn create_window<R: Runtime>(
    app: &AppHandle<R>,
    settings: &Settings,
) -> tauri::Result<WebviewWindow<R>> {
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

fn set_visible<R: Runtime>(app: &AppHandle<R>, visible: bool) {
    let shell = app.state::<Shell<R>>();
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

fn toggle_visible<R: Runtime>(app: &AppHandle<R>) {
    let visible = app.state::<Shell<R>>().settings.lock().visible;
    set_visible(app, !visible);
}

fn set_always_on_top<R: Runtime>(app: &AppHandle<R>, on: bool) {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.set_always_on_top(on);
    }
    app.state::<Shell<R>>().update(|s| s.always_on_top = on);
}

fn set_start_on_login<R: Runtime>(app: &AppHandle<R>, on: bool) {
    let manager = app.autolaunch();
    let _ = if on {
        manager.enable()
    } else {
        manager.disable()
    };
}

fn build_menu<R: Runtime>(app: &AppHandle<R>, settings: &Settings) -> tauri::Result<MenuItems<R>> {
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

/// Runs a tray / window menu item. Public for the lifecycle tests.
pub fn handle_menu<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        "toggle" => toggle_visible(app),
        "open" => {
            let shell = app.state::<Shell<R>>();
            (shell.open_url)(&shell.locator.base_url);
        }
        "on_top" => {
            let on = !app.state::<Shell<R>>().settings.lock().always_on_top;
            set_always_on_top(app, on);
            if let Some(items) = app.state::<Shell<R>>().menu.lock().as_ref() {
                let _ = items.on_top.set_checked(on);
            }
        }
        "login" => {
            let on = !app.autolaunch().is_enabled().unwrap_or(false);
            set_start_on_login(app, on);
            if let Some(items) = app.state::<Shell<R>>().menu.lock().as_ref() {
                let _ = items.login.set_checked(on);
            }
        }
        // Quit is always available from the tray and the window's menu.
        "quit" => app.exit(0),
        _ => {}
    }
}

fn build_tray<R: Runtime>(app: &AppHandle<R>, menu: &Menu<R>) -> tauri::Result<()> {
    let mut tray = TrayIconBuilder::with_id(TRAY_ID);
    // Always present in the real app (bundled icon); absent only in tests.
    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }
    tray.tooltip("Fawkes")
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

/// Menu items as (id, text, checked), in order. Public for the lifecycle tests.
#[doc(hidden)]
pub fn menu_snapshot<R: Runtime>(app: &AppHandle<R>) -> Vec<(String, String, Option<bool>)> {
    let shell = app.state::<Shell<R>>();
    let menu = shell.menu.lock();
    let Some(items) = menu.as_ref() else {
        return Vec::new();
    };
    items
        .menu
        .items()
        .unwrap_or_default()
        .iter()
        .filter_map(|item| match item {
            MenuItemKind::MenuItem(i) => {
                Some((i.id().0.clone(), i.text().unwrap_or_default(), None))
            }
            MenuItemKind::Check(i) => Some((
                i.id().0.clone(),
                i.text().unwrap_or_default(),
                i.is_checked().ok(),
            )),
            _ => None,
        })
        .collect()
}

/// The app without its context: `run` uses it with the real runtime, the lifecycle tests
/// with Tauri's mock runtime.
pub fn builder<R: Runtime>(options: ShellOptions) -> tauri::Builder<R> {
    tauri::Builder::<R>::new()
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
        .setup(move |app| {
            let handle = app.handle();
            #[cfg(target_os = "macos")]
            handle.set_activation_policy(tauri::ActivationPolicy::Accessory)?;

            let ShellOptions {
                settings_dir,
                open_url,
                env,
            } = options;
            let settings_dir = match settings_dir {
                Some(dir) => dir,
                None => handle.path().app_data_dir()?,
            };
            let settings_path = settings_dir.join(SETTINGS_FILE);
            let settings = settings::load(&settings_path);
            let env = env.unwrap_or_else(|| Box::new(|k| std::env::var(k).ok()));
            let locator = locate(env, handle.path().home_dir().ok(), repo_dev_data_dir());
            let open_url = open_url.unwrap_or_else(|| {
                let opener = handle.clone();
                Box::new(move |url| {
                    let _ = opener.opener().open_url(url, None::<&str>);
                })
            });

            let items = build_menu(handle, &settings)?;
            build_tray(handle, &items.menu)?;
            app.manage(Shell {
                locator,
                settings_path,
                settings: Mutex::new(settings.clone()),
                menu: Mutex::new(Some(items)),
                open_url,
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
                    if let Some(shell) = window.app_handle().try_state::<Shell<R>>() {
                        shell.remember(|s| s.position = Some(Point { x: p.x, y: p.y }));
                    }
                }
            }
        })
}

pub fn run() {
    builder::<tauri::Wry>(ShellOptions::default())
        .build(tauri::generate_context!())
        .expect("error while building Phoenix desktop")
        .run(|app, event| {
            // Quit from the tray, the OS, or the last window closing: keep the latest position.
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                if let Some(shell) = app.try_state::<Shell<tauri::Wry>>() {
                    shell.flush();
                }
            }
        });
}
