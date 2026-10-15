// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Floating desktop Fawkes. A transparent, borderless, draggable window that
//! renders the web app's `floating.html` and mirrors Phoenix Core's state.
//!
//! All OS-specific behaviour (window, tray, autostart) lives in this crate; the
//! page only talks to it through the commands below (ADR-0013).

mod connection;
mod island;
mod island_controller;
mod island_geometry;
#[cfg(target_os = "linux")]
mod island_linux;
#[cfg(target_os = "macos")]
mod island_macos;
mod island_platform;
mod island_state;
#[cfg(windows)]
mod island_windows;
mod position;
mod settings;

use connection::{connection, locate, phoenix_url, CoreConnection, Locator};
use island_controller::{Frame, PageEvent};
use parking_lot::Mutex;
use position::{place, Point, Rect};
use settings::{Mode, Settings};
use std::path::PathBuf;
use tauri::menu::{
    CheckMenuItem, ContextMenu, IsMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem,
};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, RunEvent, Runtime, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_opener::OpenerExt as _;

pub use island::ISLAND_LABEL;
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
    /// Tests only: the mock runtime has no real native window, so styling it (macOS window
    /// level, Windows extended style, GTK hints) would dereference a fake handle.
    pub skip_native_window_styling: bool,
}

struct Shell<R: Runtime> {
    locator: Locator,
    settings_path: PathBuf,
    settings: Mutex<Settings>,
    menu: Mutex<Option<MenuItems<R>>>,
    open_url: UrlOpener,
    island: island::Host,
}

struct MenuItems<R: Runtime> {
    menu: Menu<R>,
    toggle: MenuItem<R>,
    on_top: CheckMenuItem<R>,
    login: CheckMenuItem<R>,
    modes: Vec<(Mode, CheckMenuItem<R>)>,
    display: MenuItem<R>,
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
    // The island is placed by the shell, never dragged by its page.
    if window.label() != WINDOW_LABEL || !dx.is_finite() || !dy.is_finite() {
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
    if window.label() != WINDOW_LABEL {
        return;
    }
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

/// What the island page may report (hover where the shell cannot see the pointer, click,
/// Escape, what Fawkes is doing). Only the island window may call it.
#[tauri::command]
fn island_event<R: Runtime>(
    window: WebviewWindow<R>,
    shell: tauri::State<'_, Shell<R>>,
    event: PageEvent,
) {
    if window.label() != island::ISLAND_LABEL {
        return;
    }
    let now = shell.island.now_ms();
    let frame = shell.island.controller().handle(event.into(), now);
    if let Some(frame) = frame {
        island::apply_frame(window.app_handle(), shell.island.platform, frame);
    }
}

/// The island's current frame, for a page that loaded after the last one was emitted.
#[tauri::command]
fn island_frame<R: Runtime>(
    window: WebviewWindow<R>,
    shell: tauri::State<'_, Shell<R>>,
) -> Option<Frame> {
    (window.label() == island::ISLAND_LABEL)
        .then(|| shell.island.controller().frame())
        .flatten()
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
    Ok(window)
}

/// Shows the window of the current mode (when Fawkes is not hidden) and hides the others.
/// Navbar mode has no desktop window at all.
fn apply_mode<R: Runtime>(app: &AppHandle<R>) {
    let shell = app.state::<Shell<R>>();
    let (mode, visible) = {
        let settings = shell.settings.lock();
        (settings.mode, settings.visible)
    };
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = if mode == Mode::Floating && visible {
            window.show()
        } else {
            window.hide()
        };
    }
    if mode == Mode::Island && visible {
        island::show(app);
    } else {
        island::hide(app);
    }
}

fn set_visible<R: Runtime>(app: &AppHandle<R>, visible: bool) {
    let shell = app.state::<Shell<R>>();
    shell.update(|s| s.visible = visible);
    apply_mode(app);
    let menu = shell.menu.lock();
    if let Some(items) = menu.as_ref() {
        let _ = items.toggle.set_text(if visible {
            "Hide Fawkes"
        } else {
            "Show Fawkes"
        });
    }
}

/// Switches between the floating window, the island and the navbar, live. Fawkes' state comes
/// from Core in every mode, so nothing about the pet changes; only where it is drawn.
fn set_mode<R: Runtime>(app: &AppHandle<R>, mode: Mode) {
    let shell = app.state::<Shell<R>>();
    shell.update(|s| s.mode = mode);
    apply_mode(app);
    let menu = shell.menu.lock();
    if let Some(items) = menu.as_ref() {
        for (m, item) in &items.modes {
            let _ = item.set_checked(*m == mode);
        }
    }
}

/// Island display: main screen -> follows the mouse -> each other screen -> main screen.
fn cycle_island_display<R: Runtime>(app: &AppHandle<R>) {
    let shell = app.state::<Shell<R>>();
    let next = {
        let mut controller = shell.island.controller();
        let next = island_geometry::next_display(controller.display(), controller.monitors());
        controller.set_display(next.clone(), None);
        controller.republish().inspect(|frame| {
            island::apply_frame(app, shell.island.platform, *frame);
        });
        next
    };
    if let Some(items) = shell.menu.lock().as_ref() {
        let _ = items
            .display
            .set_text(island_geometry::display_label(&next));
    }
    shell.update(|s| s.island_display = next);
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

fn build_menu<R: Runtime>(
    app: &AppHandle<R>,
    settings: &Settings,
    display_choice: bool,
) -> tauri::Result<MenuItems<R>> {
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
    let modes = [
        (Mode::Floating, "Floating Fawkes"),
        (Mode::Island, "Island (top of the screen)"),
        (Mode::Navbar, "Navbar only (no desktop window)"),
    ]
    .into_iter()
    .map(|(mode, text)| {
        CheckMenuItem::with_id(
            app,
            format!("mode_{}", mode.as_str()),
            text,
            true,
            settings.mode == mode,
            None::<&str>,
        )
        .map(|item| (mode, item))
    })
    .collect::<tauri::Result<Vec<_>>>()?;
    let display = MenuItem::with_id(
        app,
        "island_display",
        island_geometry::display_label(&settings.island_display),
        display_choice,
        None::<&str>,
    )?;
    let mut entries: Vec<&dyn IsMenuItem<R>> = vec![&toggle, &open];
    let separators = [
        PredefinedMenuItem::separator(app)?,
        PredefinedMenuItem::separator(app)?,
        PredefinedMenuItem::separator(app)?,
    ];
    entries.push(&separators[0]);
    entries.extend(modes.iter().map(|(_, item)| item as &dyn IsMenuItem<R>));
    entries.push(&display);
    entries.push(&separators[1]);
    entries.extend([&on_top as &dyn IsMenuItem<R>, &login, &separators[2], &quit]);
    let menu = Menu::with_items(app, &entries)?;
    Ok(MenuItems {
        menu,
        toggle,
        on_top,
        login,
        modes,
        display,
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
        id if id.starts_with("mode_") => {
            if let Some(mode) = Mode::parse(&id["mode_".len()..]) {
                set_mode(app, mode);
            }
        }
        "island_display" => cycle_island_display(app),
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
            show_menu,
            island_event,
            island_frame
        ])
        .setup(move |app| {
            let handle = app.handle();
            #[cfg(target_os = "macos")]
            handle.set_activation_policy(tauri::ActivationPolicy::Accessory)?;

            let ShellOptions {
                settings_dir,
                open_url,
                env,
                skip_native_window_styling,
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

            let platform = island::Platform::detect();
            let items = build_menu(handle, &settings, platform.display_choice())?;
            build_tray(handle, &items.menu)?;
            app.manage(Shell {
                locator,
                settings_path,
                settings: Mutex::new(settings.clone()),
                menu: Mutex::new(Some(items)),
                open_url,
                island: island::Host::new(
                    settings.island_display.clone(),
                    platform,
                    !skip_native_window_styling,
                ),
            });
            create_window(handle, &settings)?;
            // Only the window of the saved mode is shown; the island window is created on
            // first use, so a user who never picks the island never gets one.
            apply_mode(handle);
            island::spawn_loop(handle.clone());
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

/// GNOME on Wayland has no layer-shell: the island needs GTK on X11 (XWayland), and the backend
/// can only be chosen before GTK starts, so it is decided here from the saved mode.
#[cfg(target_os = "linux")]
fn choose_gtk_backend() {
    let env = island_platform::SessionEnv::from_lookup(|k| std::env::var(k).ok());
    let identifier = "dev.phoenix.desktop";
    let Some(dir) = island_platform::linux_settings_dir(|k| std::env::var(k).ok(), identifier)
    else {
        return;
    };
    let island_mode = settings::load(&dir.join(SETTINGS_FILE)).mode == Mode::Island;
    if let Some(backend) = island_platform::startup_gdk_backend(&env, island_mode) {
        // Single-threaded here: nothing has started yet.
        std::env::set_var("GDK_BACKEND", backend);
    }
}

pub fn run() {
    #[cfg(target_os = "linux")]
    choose_gtk_backend();
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
