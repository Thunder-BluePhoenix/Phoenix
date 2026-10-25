// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Floating desktop Fawkes. A transparent, borderless, draggable window that
//! renders the web app's `floating.html` and mirrors Phoenix Core's state.
//!
//! All OS-specific behaviour (window, tray, autostart) lives in this crate; the
//! page only talks to it through the commands below (ADR-0013).

mod awake_tray;
pub mod browser;
pub mod browser_core;
pub mod browser_extensions;
mod browser_native;
pub mod browser_page;
pub mod browser_policy;
pub mod browser_profiles;
pub mod browser_rules;
mod connection;
mod core_status;
mod deeplink;
mod dictation_hotkey;
mod dictation_keys;
mod dictation_paste;
pub mod file_drop;
mod focus_target;
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
mod mailto;
mod native_dialog;
mod pill;
mod pill_geometry;
mod position;
pub mod quit_veto;
mod settings;
pub mod shortcuts;
mod system_audio;
#[cfg(target_os = "macos")]
mod system_audio_macos;
pub mod terminal_jump;
pub mod voice_window;

use connection::{connection, locate, phoenix_url, CoreConnection, Locator};
use island_controller::{Frame, PageEvent};
use parking_lot::Mutex;
use position::{place, Point, Rect};
use serde::Serialize;
use settings::{Mode, Settings};
use std::path::PathBuf;
use std::time::Duration;
use tauri::menu::{
    CheckMenuItem, ContextMenu, IsMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem,
};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, RunEvent, Runtime, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_opener::OpenerExt as _;

pub use island::ISLAND_LABEL;
pub const WINDOW_LABEL: &str = "fawkes";
/// Logical size of the transparent window: Fawkes plus room for a speech bubble.
const WINDOW_SIZE: (f64, f64) = (200.0, 220.0);
pub const TRAY_ID: &str = "phoenix-tray";
/// Menu id of the disabled Keep-awake countdown entry (Phase 72).
pub const AWAKE_ITEM_ID: &str = "awake_status";
/// Settings file name inside the settings directory.
pub const SETTINGS_FILE: &str = "desktop.json";

/// Opens a URL in the user's browser.
pub type UrlOpener = Box<dyn Fn(&str) + Send + Sync>;
/// Shows the "changes still need undoing" dialog: `Some(true)` is Quit anyway, `Some(false)` is
/// Cancel, `None` means it could not be shown (Phoenix then stays running).
pub type QuitAsk = Box<dyn Fn(&quit_veto::Prompt) -> Option<bool> + Send + Sync>;
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
    /// Default: the system's own message box (`native_dialog`). Tests inject a fake.
    pub confirm_quit: Option<QuitAsk>,
    /// Tests only: the mock runtime has no real native window, so styling it (macOS window
    /// level, Windows extended style, GTK hints) would dereference a fake handle.
    pub skip_native_window_styling: bool,
    /// Phase 93: DNS, the download-folder dialog and Core's shields for the browser host. Default:
    /// the system's own (`browser::Hooks::system`). Tests inject fakes.
    pub browser_hooks: Option<browser::Hooks>,
}

struct Shell<R: Runtime> {
    locator: Locator,
    settings_path: PathBuf,
    settings: Mutex<Settings>,
    menu: Mutex<Option<MenuItems<R>>>,
    open_url: UrlOpener,
    island: island::Host,
    dictation: pill::Host,
    /// Phase 66: the voice assistant's window and its shell-enforced indicator and kill switch.
    voice: voice_window::Host,
    /// Where keyboard focus was when the current dictation started (set by the hotkey worker).
    focus: focus_target::FocusGuard<focus_target::SystemFocus>,
    shortcuts: shortcuts::Host,
    /// Phase 62: the files just dropped on the floating or island window, which the page may read
    /// once each (`read_dropped_file`).
    file_drop: file_drop::Registry,
    /// One "jump to terminal" at a time (it can wait for the person to confirm in Core).
    terminal_jump: terminal_jump::Guard,
    /// Phase 73: holds every exit while Core is asked whether a change still needs undoing.
    quit: quit_veto::Gate,
    confirm_quit: QuitAsk,
    /// False under the mock runtime: no operating-system hotkey is ever registered there.
    native_shortcuts: bool,
}

struct MenuItems<R: Runtime> {
    menu: Menu<R>,
    toggle: MenuItem<R>,
    on_top: CheckMenuItem<R>,
    login: CheckMenuItem<R>,
    modes: Vec<(Mode, CheckMenuItem<R>)>,
    display: MenuItem<R>,
    dictation_hotkey: CheckMenuItem<R>,
    dictation_key: MenuItem<R>,
    dictation_pill: CheckMenuItem<R>,
    shortcuts_enabled: CheckMenuItem<R>,
    mute: CheckMenuItem<R>,
    /// Phase 72: the disabled Keep-awake countdown entry. It sits at the top of `menu` only while
    /// `awake_shown` (Core says a session is running).
    awake: MenuItem<R>,
    awake_separator: PredefinedMenuItem<R>,
    awake_shown: bool,
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

/// The port Core listens on, from its base URL (`http://127.0.0.1:<port>`).
fn locator_port(locator: &Locator) -> u16 {
    locator
        .base_url
        .rsplit(':')
        .next()
        .and_then(|p| p.trim_end_matches('/').parse().ok())
        .unwrap_or(connection::DEFAULT_PORT)
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
/// Opens an editable draft in the user's mail app. It does not send an email.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
struct MailtoRefusal {
    code: mailto::MailtoError,
    message: &'static str,
}

#[tauri::command]
fn open_mailto<R: Runtime>(
    _app: AppHandle<R>,
    shell: tauri::State<'_, Shell<R>>,
    url: String,
) -> Result<(), MailtoRefusal> {
    mailto::validate(&url).map_err(|code| MailtoRefusal {
        code,
        message: code.message(),
    })?;
    // Reuse the existing opener plugin through the injected `open_url` seam (same as
    // open_in_phoenix). Tests inspect the URL without launching a real mail app.
    (shell.open_url)(&url);
    Ok(())
}

/// Hands the bytes of a file that was just dropped on the asking window (a number from the
/// `file-drop://drop` event) to its page. Each number works once, for a minute, and only for the
/// window it was dropped on: there is no way to name a path, so this cannot read any other file.
#[tauri::command]
async fn read_dropped_file<R: Runtime>(
    window: WebviewWindow<R>,
    shell: tauri::State<'_, Shell<R>>,
    id: u64,
) -> Result<tauri::ipc::Response, file_drop::Refusal> {
    if !file_drop::is_drop_target(window.label()) {
        return Err(file_drop::FORBIDDEN);
    }
    let path = shell
        .file_drop
        .take(id, window.label(), std::time::Instant::now())?;
    let bytes = tauri::async_runtime::spawn_blocking(move || file_drop::read_regular_file(&path))
        .await
        .map_err(|_| file_drop::UNREADABLE)?
        .map_err(file_drop::Refusal::from)?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// The pill acknowledges that its event listeners are registered before it can accept a key.
#[tauri::command]
fn pill_ready<R: Runtime>(window: WebviewWindow<R>, shell: tauri::State<'_, Shell<R>>) {
    if pill::is_pill_page(&window, &shell.locator) {
        shell.dictation.ready(window.app_handle());
    }
}

/// Called by the dictation hotkey worker when a dictation starts, before the pill is shown or
/// any page code runs: records which field has keyboard focus so `dictation_paste` can refuse
/// to type into any other. Blocks on the OS; never call it from an OS input callback.
pub(crate) fn capture_dictation_focus<R: Runtime>(app: &AppHandle<R>) {
    if let Some(shell) = app.try_state::<Shell<R>>() {
        shell.focus.capture();
    }
}

/// The page tells the shell that it finished WITHOUT a paste (cancel, error, empty result).
#[tauri::command]
fn dictation_ended<R: Runtime>(window: WebviewWindow<R>, shell: tauri::State<'_, Shell<R>>) {
    if pill::is_pill_page(&window, &shell.locator) {
        shell.dictation.ended();
        shell.focus.clear();
        if !shell.settings.lock().pill {
            pill::hide(window.app_handle());
        }
    }
}

/// `dictation_paste` is the only bridge from recognised text into another application. A
/// worker thread handles the short clipboard restore delay on macOS/Windows. GTK is
/// main-thread-only on Linux, so the Linux command executes on Tauri's GTK main thread.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
struct PasteResponse {
    pasted: &'static str,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
struct PasteRefusal {
    code: &'static str,
    message: &'static str,
}

impl From<dictation_paste::PasteError> for PasteRefusal {
    fn from(error: dictation_paste::PasteError) -> Self {
        let code = match error.code {
            dictation_paste::PasteErrorCode::EmptyText => "empty_text",
            dictation_paste::PasteErrorCode::TooLong => "too_long",
            dictation_paste::PasteErrorCode::ControlCharacters => "bad_characters",
            dictation_paste::PasteErrorCode::SecureInput => "secure_input",
            dictation_paste::PasteErrorCode::TypingUnavailable => "typing_unavailable",
            dictation_paste::PasteErrorCode::PasteUnavailable => "permission_needed",
            _ => "paste_failed",
        };
        Self {
            code,
            message: error.message,
        }
    }
}

impl From<focus_target::GuardRefusal> for PasteRefusal {
    fn from(refusal: focus_target::GuardRefusal) -> Self {
        let code = match refusal.code {
            focus_target::GuardCode::LineBreaks => "multiline_text",
            focus_target::GuardCode::NoTarget => "no_focus_target",
            focus_target::GuardCode::FocusUnknown => "focus_unknown",
            focus_target::GuardCode::FocusChanged => "focus_changed",
        };
        Self {
            code,
            message: refusal.message,
        }
    }
}

#[tauri::command]
async fn dictation_paste<R: Runtime>(
    window: WebviewWindow<R>,
    shell: tauri::State<'_, Shell<R>>,
    text: String,
) -> Result<PasteResponse, PasteRefusal> {
    if !pill::is_pill_page(&window, &shell.locator) {
        return Err(PasteRefusal {
            code: "wrong_window",
            message: "Only the dictation pill can paste a dictation.",
        });
    }
    // Validate *before* any OS access and before queuing work. The decision table checks it
    // again so no platform can accidentally paste an invalid string. A line break or tab is
    // refused (never typed as Return/Tab), and the focus must still be on the target captured
    // when the dictation started; both are rechecked by the guard right before the paste.
    dictation_paste::validate_text(&text).map_err(PasteRefusal::from)?;
    focus_target::check_text(&text).map_err(PasteRefusal::from)?;
    let guard = shell.focus.clone();
    #[cfg(target_os = "linux")]
    let result = guard.run(&text, || dictation_paste::paste(&text));
    #[cfg(not(target_os = "linux"))]
    let result = tauri::async_runtime::spawn_blocking(move || {
        let result = guard.run(&text, || dictation_paste::paste(&text));
        (result, text)
    })
    .await
    .map_err(|_| PasteRefusal {
        code: "paste_failed",
        message: "The dictation could not be pasted.",
    });
    #[cfg(not(target_os = "linux"))]
    let (result, text) = result?;
    let outcome = result
        .map_err(PasteRefusal::from)?
        .map_err(PasteRefusal::from)?;
    shell.dictation.paste_finished(text);
    if !shell.settings.lock().pill {
        pill::hide(window.app_handle());
    }
    Ok(PasteResponse {
        pasted: match outcome {
            dictation_paste::PasteOutcome::Pasted => "clipboard",
            dictation_paste::PasteOutcome::Typed => "typed",
        },
    })
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

/// Only the pet's own windows may read or change the bindings.
fn may_configure_shortcuts<R: Runtime>(
    window: &WebviewWindow<R>,
) -> Result<(), shortcuts::Refusal> {
    if window.label() == WINDOW_LABEL || window.label() == island::ISLAND_LABEL {
        Ok(())
    } else {
        Err(shortcuts::Refusal::new(
            "forbidden",
            "This window cannot change shortcuts.",
        ))
    }
}

/// Every action with its current binding and state, and the mute flag.
#[tauri::command]
fn shortcuts_list<R: Runtime>(
    window: WebviewWindow<R>,
) -> Result<shortcuts::Report, shortcuts::Refusal> {
    may_configure_shortcuts(&window)?;
    Ok(current_report(window.app_handle()))
}

/// Binds `action` to `accelerator` (empty text unbinds it). A refused accelerator changes
/// nothing.
#[tauri::command]
fn shortcuts_set<R: Runtime>(
    window: WebviewWindow<R>,
    shell: tauri::State<'_, Shell<R>>,
    action: String,
    accelerator: String,
) -> Result<shortcuts::Report, shortcuts::Refusal> {
    may_configure_shortcuts(&window)?;
    let Some(action) = shortcuts::Action::parse(&action) else {
        return Err(shortcuts::Refusal::new(
            "unknown_action",
            "That is not a shortcut action.",
        ));
    };
    let (user, chord) = {
        let settings = shell.settings.lock();
        (
            settings.shortcuts.clone(),
            settings.paste_again_chord.clone(),
        )
    };
    let text = shortcuts::validate_set(action, &accelerator, &user, &chord)?;
    shell.update(|s| {
        s.shortcuts
            .insert(action.as_str().to_string(), text.unwrap_or_default());
    });
    Ok(apply_shortcuts(window.app_handle()))
}

/// Restores the default binding of one action (or of all of them when `action` is absent).
#[tauri::command]
fn shortcuts_reset<R: Runtime>(
    window: WebviewWindow<R>,
    shell: tauri::State<'_, Shell<R>>,
    action: Option<String>,
) -> Result<shortcuts::Report, shortcuts::Refusal> {
    may_configure_shortcuts(&window)?;
    match action {
        None => shell.update(|s| s.shortcuts.clear()),
        Some(name) => {
            let Some(action) = shortcuts::Action::parse(&name) else {
                return Err(shortcuts::Refusal::new(
                    "unknown_action",
                    "That is not a shortcut action.",
                ));
            };
            shell.update(|s| {
                s.shortcuts.remove(action.as_str());
            });
        }
    }
    Ok(apply_shortcuts(window.app_handle()))
}

/// Turns the global shortcuts on or off (they start off). Returns the resulting report.
#[tauri::command]
fn shortcuts_set_enabled<R: Runtime>(
    window: WebviewWindow<R>,
    enabled: bool,
) -> Result<shortcuts::Report, shortcuts::Refusal> {
    may_configure_shortcuts(&window)?;
    set_shortcuts_enabled(window.app_handle(), enabled);
    Ok(current_report(window.app_handle()))
}

/// Mutes or unmutes sounds and notification toasts in the desktop pages.
#[tauri::command]
fn shortcuts_set_muted<R: Runtime>(
    window: WebviewWindow<R>,
    muted: bool,
) -> Result<shortcuts::Report, shortcuts::Refusal> {
    may_configure_shortcuts(&window)?;
    set_muted(window.app_handle(), muted);
    Ok(current_report(window.app_handle()))
}

/// The current enabled/muted flags with every action's state.
fn current_report<R: Runtime>(app: &AppHandle<R>) -> shortcuts::Report {
    let shell = app.state::<Shell<R>>();
    let (enabled, muted) = {
        let settings = shell.settings.lock();
        (settings.shortcuts_enabled, settings.muted)
    };
    shortcuts::Report {
        enabled,
        muted,
        shortcuts: shell.shortcuts.statuses(),
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
fn set_dictation_hotkey<R: Runtime>(app: &AppHandle<R>, on: bool) {
    let shell = app.state::<Shell<R>>();
    if on {
        let settings = shell.settings.lock();
        let key = settings.dictation_key;
        let chord =
            dictation_keys::PasteChord::parse(&settings.paste_again_chord).unwrap_or_default();
        drop(settings);
        match shell
            .dictation
            .enable(app, key, chord, shell.locator.clone(), true)
        {
            Ok(()) => {
                shell.update(|s| s.dictation_hotkey = true);
                if let Some(items) = shell.menu.lock().as_ref() {
                    let _ = items.dictation_hotkey.set_checked(true);
                }
            }
            Err(reason) => pill::error(app, &reason),
        }
    } else {
        shell.dictation.disable(app);
        shell.update(|s| s.dictation_hotkey = false);
        if let Some(items) = shell.menu.lock().as_ref() {
            let _ = items.dictation_hotkey.set_checked(false);
        }
    }
}

fn cycle_dictation_key<R: Runtime>(app: &AppHandle<R>) {
    let shell = app.state::<Shell<R>>();
    let current = shell.settings.lock().dictation_key;
    let supported = dictation_keys::DictationKey::supported();
    let index = supported
        .iter()
        .position(|key| *key == current)
        .unwrap_or(0);
    let next = supported[(index + 1) % supported.len()];
    let enabled = shell.settings.lock().dictation_hotkey;
    if enabled {
        shell.dictation.disable(app);
        if let Err(reason) = shell.dictation.enable(
            app,
            next,
            dictation_keys::PasteChord::parse(&shell.settings.lock().paste_again_chord)
                .unwrap_or_default(),
            shell.locator.clone(),
            false,
        ) {
            shell.update(|s| s.dictation_hotkey = false);
            if let Some(items) = shell.menu.lock().as_ref() {
                let _ = items.dictation_hotkey.set_checked(false);
            }
            pill::error(app, &reason);
        }
    }
    shell.update(|s| s.dictation_key = next);
    if let Some(items) = shell.menu.lock().as_ref() {
        let _ = items
            .dictation_key
            .set_text(format!("Dictation key: {}", next.label()));
    };
}

fn set_dictation_pill<R: Runtime>(app: &AppHandle<R>, on: bool) {
    let shell = app.state::<Shell<R>>();
    if on {
        if let Err(e) = pill::show(app) {
            pill::error(app, &format!("Could not show the dictation pill: {e}"));
            return;
        }
    } else {
        pill::hide(app);
    }
    shell.update(|s| s.pill = on);
    if let Some(items) = shell.menu.lock().as_ref() {
        let _ = items.dictation_pill.set_checked(on);
    };
}

/// The page that opens a Phoenix route in the user's browser (the shell chooses the host).
fn open_route<R: Runtime>(app: &AppHandle<R>, route: &str) {
    let shell = app.state::<Shell<R>>();
    if let Some(url) = phoenix_url(&shell.locator.base_url, route) {
        (shell.open_url)(&url);
    }
}

/// A `phoenix://approvals/…` link was opened (macOS `RunEvent::Opened`). Only an exactly matching
/// first URL does anything, and what it does is open the fixed approvals route: nothing from the URL
/// is run, fetched or passed on (see `deeplink`).
pub fn open_links<R: Runtime, S: AsRef<str>>(app: &AppHandle<R>, urls: &[S]) {
    if let Some(route) = deeplink::route_for(urls) {
        open_route(app, route);
        return;
    }
    // Phase 80: `phoenix://browser/open?url=<loopback dev server>` from the port radar. It only
    // asks; the Phoenix browser shows its own confirmation before anything opens.
    if let Some(url) = urls
        .first()
        .and_then(|u| browser_core::radar_link(u.as_ref()))
    {
        let _ = browser::request_open_from_port_radar(app, &url);
    }
}

/// What a global shortcut (or its menu twin) does.
pub fn run_shortcut<R: Runtime>(app: &AppHandle<R>, action: shortcuts::Action) {
    let shell = app.state::<Shell<R>>();
    match action {
        shortcuts::Action::SwitchPills => {
            let (mode, visible) = {
                let settings = shell.settings.lock();
                (settings.mode, settings.visible)
            };
            // The window that shows the pills moves its own selection and opens the page for it
            // (`switch_pills` event); with no such window the shell opens the activity feed.
            let label = match shortcuts::pill_window(mode, visible) {
                Some(shortcuts::PillWindow::Floating) => Some(WINDOW_LABEL),
                Some(shortcuts::PillWindow::Island) => Some(island::ISLAND_LABEL),
                None => None,
            };
            match label {
                Some(label) => {
                    let _ = app.emit_to(
                        label,
                        shortcuts::SWITCH_PILLS_EVENT,
                        shortcuts::SwitchPillsPayload::NEXT,
                    );
                }
                None => open_route(app, shortcuts::PILLS_FALLBACK_ROUTE),
            }
        }
        shortcuts::Action::Mute => {
            let on = !shell.settings.lock().muted;
            set_muted(app, on);
        }
        shortcuts::Action::SendToDesktop => {
            let (mode, visible) = {
                let settings = shell.settings.lock();
                (settings.mode, settings.visible)
            };
            let plan = shortcuts::send_to_desktop(mode, visible);
            if let Some(mode) = plan.mode {
                set_mode(app, mode);
            }
            set_visible(app, plan.visible);
        }
        shortcuts::Action::JumpToTerminal => jump_to_terminal(app),
        other => {
            if let Some(route) = other.route() {
                open_route(app, route);
            }
        }
    }
}

/// "Jump to terminal": asks Core, with the session token, to bring the newest active agent
/// session's terminal to the front (Core asks the person to confirm first). When Core is down,
/// has no such terminal or answers anything unexpected, the agents page opens instead, as before.
/// The call can wait for the confirmation, so it runs off the main thread, one at a time.
fn jump_to_terminal<R: Runtime>(app: &AppHandle<R>) {
    let Some(running) = app.state::<Shell<R>>().terminal_jump.begin() else {
        return;
    };
    let app = app.clone();
    std::thread::spawn(move || {
        let _running = running;
        let connected = connection(&app.state::<Shell<R>>().locator);
        let outcome = terminal_jump::jump(&|method, path, timeout| {
            core_status::call(
                &connected.base_url,
                connected.token.as_deref(),
                method,
                path,
                timeout,
            )
        });
        if outcome == terminal_jump::Outcome::OpenAgents {
            open_route(&app, shortcuts::TERMINAL_ROUTE);
        }
    });
}

/// Phase 73: an exit was requested (tray Quit, Cmd+Q, the last window closing). Returns whether
/// the exit must be held. Asking Core can take a moment and may show a dialog, so the check runs
/// off the main thread and the dialog (and the real exit, `app.exit(0)`, which comes back here as
/// an approved request) on the main thread. Public for the lifecycle tests.
pub fn quit_requested<R: Runtime>(app: &AppHandle<R>) -> bool {
    match app.state::<Shell<R>>().quit.request() {
        quit_veto::Request::Proceed => false,
        quit_veto::Request::AlreadyAsking => true,
        quit_veto::Request::Start => {
            let app = app.clone();
            std::thread::spawn(move || {
                let connected = connection(&app.state::<Shell<R>>().locator);
                let veto = match core_status::call(
                    &connected.base_url,
                    connected.token.as_deref(),
                    core_status::Method::Get,
                    quit_veto::PATH,
                    core_status::TIMEOUT,
                ) {
                    Ok((status, body)) => quit_veto::parse(status, &body),
                    Err(_) => quit_veto::Veto::Unknown,
                };
                let main = app.clone();
                if app
                    .run_on_main_thread(move || {
                        let shell = main.state::<Shell<R>>();
                        let next = quit_veto::resolve(
                            &shell.quit,
                            || veto,
                            |prompt| (shell.confirm_quit)(prompt),
                        );
                        if next == quit_veto::Next::Exit {
                            main.exit(0);
                        }
                    })
                    .is_err()
                {
                    // The event loop is gone, so the app is already ending.
                    app.state::<Shell<R>>().quit.answered(false);
                }
            });
            true
        }
    }
}

/// Remembers the mute flag, tells the desktop pages (`shortcuts://mute`) and ticks the menu.
/// The shell never plays sounds itself; the pages and the web app honour the flag.
fn set_muted<R: Runtime>(app: &AppHandle<R>, muted: bool) {
    let shell = app.state::<Shell<R>>();
    shell.update(|s| s.muted = muted);
    if let Some(items) = shell.menu.lock().as_ref() {
        let _ = items.mute.set_checked(muted);
    }
    emit_to_shell_windows(app, shortcuts::MUTE_EVENT, shortcuts::MutePayload { muted });
}

/// Sends a `shortcuts://` event to the Fawkes and island windows only, never to the remote pill
/// webview (it loads a page from Core's origin, outside this shell's own pages). The pill is told
/// nothing, and a future consumer must NOT trust a `shortcuts://mute` (or status) event that came
/// from the pill: nothing in the shell accepts one from it, and the pill cannot set the flag.
fn emit_to_shell_windows<R: Runtime, S: Serialize + Clone>(
    app: &AppHandle<R>,
    event: &str,
    payload: S,
) {
    for label in [WINDOW_LABEL, island::ISLAND_LABEL] {
        let _ = app.emit_to(label, event, payload.clone());
    }
}

/// Makes the operating system's registrations match the settings and announces the result
/// (`shortcuts://status`). A binding the OS refuses is reported on its own action; the others
/// still register and nothing here can abort the app.
fn apply_shortcuts<R: Runtime>(app: &AppHandle<R>) -> shortcuts::Report {
    let shell = app.state::<Shell<R>>();
    let (enabled, user, chord) = {
        let settings = shell.settings.lock();
        (
            settings.shortcuts_enabled,
            settings.shortcuts.clone(),
            settings.paste_again_chord.clone(),
        )
    };
    let registrar: Box<dyn shortcuts::Registrar> = if shell.native_shortcuts {
        match shortcuts::NativeRegistrar::open(app, enabled) {
            Ok(Some(native)) => Box::new(native),
            Ok(None) => Box::new(shortcuts::Refusing::new("shortcuts are off")),
            Err(reason) => Box::new(shortcuts::Refusing::new(reason)),
        }
    } else {
        Box::new(shortcuts::Refusing::new(
            "global shortcuts are not available in this environment",
        ))
    };
    let statuses = shell
        .shortcuts
        .apply(registrar.as_ref(), enabled, &user, &chord);
    if let Some(items) = shell.menu.lock().as_ref() {
        let _ = items
            .shortcuts_enabled
            .set_text(shortcuts::menu_text(&statuses, enabled));
        let _ = items.shortcuts_enabled.set_checked(enabled);
    }
    let report = shortcuts::Report {
        enabled,
        muted: shell.settings.lock().muted,
        shortcuts: statuses,
    };
    emit_to_shell_windows(app, shortcuts::STATUS_EVENT, &report);
    report
}

fn set_shortcuts_enabled<R: Runtime>(app: &AppHandle<R>, on: bool) {
    app.state::<Shell<R>>().update(|s| s.shortcuts_enabled = on);
    apply_shortcuts(app);
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
    let dictation_hotkey = CheckMenuItem::with_id(
        app,
        "dictation_hotkey",
        "Enable dictation hotkey (requests keyboard permission)",
        true,
        settings.dictation_hotkey,
        None::<&str>,
    )?;
    let dictation_key = MenuItem::with_id(
        app,
        "dictation_key",
        format!("Dictation key: {}", settings.dictation_key.label()),
        true,
        None::<&str>,
    )?;
    let dictation_pill = CheckMenuItem::with_id(
        app,
        "dictation_pill",
        "Show dictation pill",
        true,
        settings.pill,
        None::<&str>,
    )?;
    let voice_open = MenuItem::with_id(
        app,
        "voice_open",
        "Open voice assistant (OK Fawkes)",
        true,
        None::<&str>,
    )?;
    let voice_stop = MenuItem::with_id(
        app,
        "voice_stop",
        "Stop voice listening",
        true,
        None::<&str>,
    )?;
    let wardrobe = MenuItem::with_id(app, "wardrobe", "Wardrobe", true, None::<&str>)?;
    let shortcuts_enabled = CheckMenuItem::with_id(
        app,
        "shortcuts_enabled",
        shortcuts::menu_text(&[], settings.shortcuts_enabled),
        true,
        settings.shortcuts_enabled,
        None::<&str>,
    )?;
    let mute = CheckMenuItem::with_id(
        app,
        "mute",
        "Mute sounds and notifications",
        true,
        settings.muted,
        None::<&str>,
    )?;
    let mut entries: Vec<&dyn IsMenuItem<R>> = vec![&toggle, &open, &wardrobe];
    let separators = [
        PredefinedMenuItem::separator(app)?,
        PredefinedMenuItem::separator(app)?,
        PredefinedMenuItem::separator(app)?,
        PredefinedMenuItem::separator(app)?,
    ];
    entries.push(&separators[0]);
    entries.extend(modes.iter().map(|(_, item)| item as &dyn IsMenuItem<R>));
    entries.push(&display);
    entries.push(&separators[1]);
    entries.extend([
        &dictation_hotkey as &dyn IsMenuItem<R>,
        &dictation_key,
        &dictation_pill,
    ]);
    entries.extend([&voice_open as &dyn IsMenuItem<R>, &voice_stop]);
    entries.push(&separators[3]);
    entries.extend([
        &shortcuts_enabled as &dyn IsMenuItem<R>,
        &mute,
        &on_top,
        &login,
        &separators[2],
        &quit,
    ]);
    let menu = Menu::with_items(app, &entries)?;
    // Not in the menu until Core says a session runs (see `apply_awake`).
    let awake = MenuItem::with_id(app, AWAKE_ITEM_ID, "Keep awake", false, None::<&str>)?;
    let awake_separator = PredefinedMenuItem::separator(app)?;
    Ok(MenuItems {
        menu,
        toggle,
        on_top,
        login,
        modes,
        display,
        dictation_hotkey,
        dictation_key,
        dictation_pill,
        shortcuts_enabled,
        mute,
        awake,
        awake_separator,
        awake_shown: false,
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
        "wardrobe" => run_shortcut(app, shortcuts::Action::Wardrobe),
        "shortcuts_enabled" => {
            let on = !app.state::<Shell<R>>().settings.lock().shortcuts_enabled;
            set_shortcuts_enabled(app, on);
        }
        "mute" => {
            let on = !app.state::<Shell<R>>().settings.lock().muted;
            set_muted(app, on);
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
        "dictation_hotkey" => {
            let on = !app.state::<Shell<R>>().settings.lock().dictation_hotkey;
            set_dictation_hotkey(app, on);
        }
        "dictation_key" => cycle_dictation_key(app),
        "voice_open" => {
            if let Err(e) = voice_window::show(app) {
                pill::error(app, &format!("Could not open the voice assistant: {e}"));
            }
        }
        // The shell-side emergency stop: always available, never asks Core or the page.
        "voice_stop" => {
            voice_window::kill(app);
        }
        "dictation_pill" => {
            let on = !app.state::<Shell<R>>().settings.lock().pill;
            set_dictation_pill(app, on);
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

/// Phase 72: shows (or hides) the Keep-awake countdown as a disabled entry at the top of the tray
/// menu and in the tray tooltip. Main thread only (menus belong to it).
fn apply_awake<R: Runtime>(app: &AppHandle<R>, awake: &awake_tray::Awake) {
    let shell = app.state::<Shell<R>>();
    if let Some(items) = shell.menu.lock().as_mut() {
        match awake_tray::menu_text(awake) {
            Some(text) => {
                let _ = items.awake.set_text(text);
                if !items.awake_shown {
                    items.awake_shown = items
                        .menu
                        .insert_items(
                            &[&items.awake as &dyn IsMenuItem<R>, &items.awake_separator],
                            0,
                        )
                        .is_ok();
                }
            }
            None => {
                if items.awake_shown {
                    let _ = items.menu.remove(&items.awake);
                    let _ = items.menu.remove(&items.awake_separator);
                    items.awake_shown = false;
                }
            }
        }
    }
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        // The voice indicator rides on top of the keep-awake text and is never dropped by it.
        shell.voice.set_base_tooltip(awake_tray::tooltip(awake));
        let _ = tray.set_tooltip(Some(shell.voice.tooltip()));
    }
}

/// Phase 72: asks Core once how long the Keep-awake session has left (blocking, loopback, so never
/// call it on the main thread), updates the tray on the main thread, and returns how long to wait
/// before asking again. Public for the lifecycle tests.
#[doc(hidden)]
pub fn refresh_awake_tray<R: Runtime>(app: &AppHandle<R>) -> Duration {
    let Some(shell) = app.try_state::<Shell<R>>() else {
        return awake_tray::IDLE_PROBE;
    };
    let connected = connection(&shell.locator);
    let awake = awake_tray::fetch(&connected.base_url, connected.token.as_deref());
    let delay = awake_tray::next_delay(&awake);
    let main = app.clone();
    let _ = app.run_on_main_thread(move || apply_awake(&main, &awake));
    delay
}

/// Phase 72: keeps the tray countdown fresh. One loopback request every `ACTIVE_REFRESH` while a
/// session runs (sooner as it is about to end) and one every `IDLE_PROBE` while none does, so a
/// session started elsewhere appears within a minute. It ends when the app is gone. Started by
/// `run`, never by the lifecycle tests.
fn spawn_awake_loop<R: Runtime>(app: AppHandle<R>) {
    std::thread::spawn(move || loop {
        if app.try_state::<Shell<R>>().is_none() {
            break;
        }
        let delay = refresh_awake_tray(&app);
        std::thread::sleep(delay);
    });
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
            open_mailto,
            pill_ready,
            dictation_ended,
            dictation_paste,
            show_menu,
            island_event,
            island_frame,
            shortcuts_list,
            shortcuts_set,
            shortcuts_reset,
            shortcuts_set_enabled,
            shortcuts_set_muted,
            read_dropped_file,
            browser::open_tab,
            browser::close_tab,
            browser::activate_tab,
            browser::navigate,
            browser::back,
            browser::forward,
            browser::reload,
            browser::zoom,
            browser::set_chrome_height,
            browser::set_site_shields,
            browser::shields_status,
            browser::page_snapshot,
            browser::page_action,
            browser::purge_profile_data
        ])
        .setup(move |app| {
            let handle = app.handle();
            #[cfg(target_os = "macos")]
            handle.set_activation_policy(tauri::ActivationPolicy::Accessory)?;

            let ShellOptions {
                settings_dir,
                open_url,
                env,
                confirm_quit,
                skip_native_window_styling,
                browser_hooks,
            } = options;
            let settings_dir = match settings_dir {
                Some(dir) => dir,
                None => handle.path().app_data_dir()?,
            };
            let settings_path = settings_dir.join(SETTINGS_FILE);
            let settings = settings::load(&settings_path);
            let env = env.unwrap_or_else(|| Box::new(|k| std::env::var(k).ok()));
            let locator = locate(env, handle.path().home_dir().ok(), repo_dev_data_dir());
            // Core chooses its loopback port at run time. Grant Tauri IPC to *that exact*
            // pill URL (not other Core routes, wildcard ports, or arbitrary remote pages).
            // This capability is in addition to the static default one for the pet windows.
            let pill_url = format!("{}/pill.html", locator.base_url);
            if !skip_native_window_styling {
                handle.add_capability(
                    tauri::ipc::CapabilityBuilder::new("dictation-pill-current-core")
                        .local(false)
                        .remote(pill_url)
                        .window(pill::LABEL)
                        .permission("core:default")
                        .permission("allow-pill-ready")
                        .permission("allow-dictation-ended")
                        .permission("allow-dictation-paste")
                        .permission("allow-open-in-phoenix"),
                )?;
            }
            let open_url = open_url.unwrap_or_else(|| {
                let opener = handle.clone();
                Box::new(move |url| {
                    let _ = opener.opener().open_url(url, None::<&str>);
                })
            });

            // Phase 93: the browser host. Real DNS, the native folder dialog and Core's shields
            // under the real runtime; the mock runtime (lifecycle tests) injects its own.
            app.manage(browser::Host::new(
                browser_hooks.unwrap_or_else(|| {
                    browser::Hooks::system(locator.clone(), settings_dir.join("browser-profiles"))
                }),
                !skip_native_window_styling,
                locator_port(&locator),
            ));
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
                dictation: pill::Host::new(skip_native_window_styling),
                voice: voice_window::Host::default(),
                focus: focus_target::FocusGuard::new(focus_target::SystemFocus),
                shortcuts: shortcuts::Host::default(),
                file_drop: file_drop::Registry::default(),
                terminal_jump: terminal_jump::Guard::default(),
                quit: quit_veto::Gate::default(),
                confirm_quit: confirm_quit.unwrap_or_else(|| Box::new(native_dialog::confirm)),
                // The mock runtime (lifecycle tests) has no hotkey manager; never touch the OS there.
                native_shortcuts: !skip_native_window_styling,
            });
            // Reports every binding (and registers them only when the user turned shortcuts on). A
            // refused registration is reported per action and never stops startup.
            apply_shortcuts(handle);
            create_window(handle, &settings)?;
            // Only the window of the saved mode is shown; the island window is created on
            // first use, so a user who never picks the island never gets one.
            apply_mode(handle);
            island::spawn_loop(handle.clone());
            if !skip_native_window_styling {
                spawn_awake_loop(handle.clone());
            }
            if settings.pill && !skip_native_window_styling {
                let _ = pill::show(handle);
            }
            // A saved opt-in starts a listener without asking for permissions at startup.
            // A fresh opt-in from the tray is the only path that requests them.
            if settings.dictation_hotkey && !skip_native_window_styling {
                let shell = handle.state::<Shell<R>>();
                if let Err(reason) = shell.dictation.enable(
                    handle,
                    settings.dictation_key,
                    dictation_keys::PasteChord::parse(&settings.paste_again_chord)
                        .unwrap_or_default(),
                    shell.locator.clone(),
                    false,
                ) {
                    pill::error(handle, &reason);
                }
            }
            handle
                .state::<Shell<R>>()
                .dictation
                .spawn_ticks(handle.clone());
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
            // Phase 62: a file dragged onto the floating or island window (native drop; the page
            // gets no HTML5 drop event there). Other windows are ignored.
            if let WindowEvent::DragDrop(drag) = event {
                file_drop::on_drag(
                    window.app_handle(),
                    window.label(),
                    file_drop::Drag::from(drag),
                );
            }
            browser::window_event(window, event);
            voice_window::window_event(window, event);
            if window.label() == pill::LABEL && matches!(event, WindowEvent::Destroyed) {
                if let Some(shell) = window.app_handle().try_state::<Shell<R>>() {
                    shell.dictation.unload();
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
            // Quit from the tray, the OS, or the last window closing: Core is asked first whether
            // a change still needs undoing (Phase 73); a restart cannot be held, so it is not asked.
            if let RunEvent::ExitRequested { code, api, .. } = &event {
                if *code != Some(tauri::RESTART_EXIT_CODE) && quit_requested(app) {
                    api.prevent_exit();
                    return;
                }
            }
            // A `phoenix://approvals/…` link opened from a chat message. Tauri delivers custom-scheme
            // opens as `RunEvent::Opened` on macOS only; other platforms have no handler.
            #[cfg(target_os = "macos")]
            if let RunEvent::Opened { urls } = &event {
                let urls: Vec<&str> = urls.iter().map(|u| u.as_str()).collect();
                open_links(app, &urls);
            }
            // Keep the latest position.
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                if let Some(shell) = app.try_state::<Shell<tauri::Wry>>() {
                    shell.flush();
                }
            }
        });
}
