// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! The dictation pill, its opt-in global hotkey, and the only bridge between physical keys
//! and the web page's dictation session. The page does the capture; this module never opens a
//! microphone or holds audio. A Core-status check (with the session token) gates every hotkey
//! start; Core's POST /api/dictation/sessions is the final, authoritative guard.

use crate::connection::{connection, CoreConnection, Locator};
use crate::core_status::{self, Gate};
use crate::dictation_hotkey::{self, HotkeyListener, Permission};
use crate::dictation_keys::{Action, DictationKey, DictationKeys, Mode, PasteChord};
use crate::island_geometry::{primary_first, MonitorInfo};
use crate::pill_geometry::{pill_monitor, pill_rect, PILL_SIZE};
use crate::position::{Point, Rect};
use crate::Shell;
use parking_lot::Mutex;
use serde::Serialize;
use std::sync::mpsc::{self, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};

pub const LABEL: &str = "phoenix-pill";
pub const EVENT: &str = "pill://dictation";
pub const ERROR_EVENT: &str = "pill://error";
const TICK: Duration = Duration::from_millis(25);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PillMode {
    Hold,
    HandsFree,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PillAction {
    Start,
    Stop,
    Cancel,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Command {
    pub action: PillAction,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<PillMode>,
}

impl Command {
    fn start(mode: Mode) -> Self {
        Self {
            action: PillAction::Start,
            mode: Some(match mode {
                Mode::Hold => PillMode::Hold,
                Mode::HandsFree => PillMode::HandsFree,
            }),
        }
    }

    fn stop() -> Self {
        Self {
            action: PillAction::Stop,
            mode: None,
        }
    }

    fn cancel() -> Self {
        Self {
            action: PillAction::Cancel,
            mode: None,
        }
    }
}

/// Pure ordering: the page confirms both listeners before `pill_ready`; commands sent before
/// then are queued and flushed in order. A hotkey release while the page is loading cannot get
/// ahead of its start. No physical event is lost silently.
#[derive(Default)]
struct Pending {
    ready: bool,
    commands: Vec<Command>,
}

impl Pending {
    fn queue(&mut self, command: Command) -> Option<Command> {
        if self.ready {
            Some(command)
        } else {
            self.commands.push(command);
            None
        }
    }

    fn ready(&mut self) -> Vec<Command> {
        self.ready = true;
        std::mem::take(&mut self.commands)
    }

    fn unload(&mut self) {
        self.ready = false;
        self.commands.clear();
    }
}

#[derive(Default)]
struct State {
    machine: DictationKeys,
    pending: Pending,
    /// Invalidate an in-flight status check when the user releases/cancels before it returns.
    generation: u64,
    /// A Core check in progress for a Start. No second check until it resolves.
    checking: bool,
    /// A release/Esc while Core's status check is in flight: deliver it after Start.
    after_check: Option<Command>,
    /// The latest successful dictation only, kept in memory for paste-again. Never persisted.
    last_text: Option<String>,
}

/// The live shell state. The listener is separate from the pure state so it may be dropped
/// without holding the machine lock while waiting for its OS thread to exit.
pub struct Host {
    state: Arc<Mutex<State>>,
    listener: Mutex<Option<HotkeyListener>>,
    actions: Mutex<Option<Sender<Action>>>,
    began: Instant,
    /// The lifecycle tests use Tauri's mock runtime and must not access real OS hooks.
    mock: bool,
}

impl Host {
    pub fn new(mock: bool) -> Self {
        Self {
            state: Arc::new(Mutex::new(State::default())),
            listener: Mutex::new(None),
            actions: Mutex::new(None),
            began: Instant::now(),
            mock,
        }
    }

    pub fn paste_finished(&self, text: String) {
        let mut state = self.state.lock();
        state.last_text = Some(text);
        state.machine.finished();
        state.checking = false;
        state.after_check = None;
        state.generation = state.generation.wrapping_add(1);
    }

    pub fn ended(&self) {
        let mut state = self.state.lock();
        state.machine.finished();
        state.checking = false;
        state.after_check = None;
        state.generation = state.generation.wrapping_add(1);
    }

    pub fn ready<R: Runtime>(&self, app: &AppHandle<R>) {
        let queued = self.state.lock().pending.ready();
        if let Some(window) = app.get_webview_window(LABEL) {
            for command in queued {
                let _ = window.emit(EVENT, command);
            }
        }
    }

    pub fn unload(&self) {
        let mut state = self.state.lock();
        state.pending.unload();
        state.generation = state.generation.wrapping_add(1);
        state.checking = false;
        state.after_check = None;
        state.machine.reset();
    }

    /// First enabling the hotkey is the ONLY operation that may request Input Monitoring and
    /// Accessibility permissions. A saved `on` setting at startup uses preflight only. The
    /// microphone is requested by the page only when Core accepts a session and its WS is ready.
    pub fn enable<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        key: DictationKey,
        chord: PasteChord,
        locator: Locator,
        first_enable: bool,
    ) -> Result<(), String> {
        if self.mock {
            return Ok(());
        }
        if !dictation_hotkey::is_supported() {
            return Err("Global dictation keys are not supported on this desktop session.".into());
        }
        if first_enable && !dictation_hotkey::request_permission() {
            return Err("Give Phoenix Input Monitoring and Accessibility access in System Settings, then enable the dictation key again.".into());
        }
        if dictation_hotkey::listen_permission() != Permission::Granted {
            return Err("Phoenix does not have keyboard monitoring permission; turn the dictation key off and back on to request it.".into());
        }
        if self.listener.lock().is_some() {
            self.disable(app);
        }
        let state = Arc::clone(&self.state);
        let began = self.began;
        let (tx, rx) = mpsc::channel::<Action>();
        let handler = tx.clone();
        let listener = dictation_hotkey::spawn_listener(key, chord, move |event| {
            let now = began.elapsed().as_millis() as u64;
            let result = state.lock().machine.handle(event, now);
            if let Some(action) = result.action {
                // A single FIFO worker processes actions in physical-event order. Never do a
                // Core GET, clipboard operation or window dispatch inside the OS callback.
                let _ = handler.send(action);
            }
            result.consume
        })?;
        *self.actions.lock() = Some(tx);
        let app = app.clone();
        let state = Arc::clone(&self.state);
        std::thread::spawn(move || {
            for action in rx {
                dispatch(&app, &state, &locator, action);
            }
        });
        *self.listener.lock() = Some(listener);
        Ok(())
    }

    pub fn disable<R: Runtime>(&self, app: &AppHandle<R>) {
        let listener = self.listener.lock().take();
        // Clear/mark the state before the OS hook can deliver another action. Do not hold the
        // state lock while joining the hook thread.
        let action = {
            let mut state = self.state.lock();
            state.generation = state.generation.wrapping_add(1);
            state.checking = false;
            state.after_check = None;
            state.machine.reset()
        };
        drop(listener);
        self.actions.lock().take();
        if let Some(Action::Cancel) = action {
            send(app, &self.state, Command::cancel());
        }
    }

    pub fn spawn_ticks<R: Runtime>(&self, app: AppHandle<R>) {
        if self.mock {
            return;
        }
        let state = Arc::clone(&self.state);
        let began = self.began;
        std::thread::spawn(move || loop {
            std::thread::sleep(TICK);
            // The shell's lifetime owns this loop (as it does the island loop). No network or
            // clipboard work is done here; Core checks are performed on separate worker threads.
            if app.try_state::<Shell<R>>().is_none() {
                break;
            }
            let action = state
                .lock()
                .machine
                .tick(began.elapsed().as_millis() as u64);
            if let Some(action) = action {
                if let Some(sender) = app.state::<Shell<R>>().dictation.actions.lock().as_ref() {
                    let _ = sender.send(action);
                }
            }
        });
    }
}

/// Emits a page command, or queues it until the page registered its event listener. Never
/// call Tauri while holding the state lock (page events can re-enter the shell).
fn send<R: Runtime>(app: &AppHandle<R>, state: &Arc<Mutex<State>>, command: Command) {
    let maybe = state.lock().pending.queue(command);
    // `run_on_main_thread` also works from the OS hook thread. `show` is idempotent and
    // makes a pill hidden after a previous dictation visible again for the next one.
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let _ = show(&handle);
        if let Some(command) = maybe {
            if let Some(window) = handle.get_webview_window(LABEL) {
                let _ = window.emit(EVENT, command);
            }
        }
    });
}

pub fn error<R: Runtime>(app: &AppHandle<R>, message: &str) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.emit(ERROR_EVENT, message);
    }
}

/// Called only on a hotkey action, not at startup: Core is queried before every Start. The
/// Core check runs off the CGEventTap callback thread (which must return promptly).
fn dispatch<R: Runtime>(
    app: &AppHandle<R>,
    state: &Arc<Mutex<State>>,
    locator: &Locator,
    action: Action,
) {
    match action {
        Action::Start { mode } => {
            // Remember where the user is typing BEFORE the pill, Core check or any window work
            // can change focus; the paste is refused if the target differs.
            crate::capture_dictation_focus(app);
            let generation = {
                let mut state = state.lock();
                state.generation = state.generation.wrapping_add(1);
                state.checking = true;
                state.after_check = None;
                state.generation
            };
            let (state, app, locator) = (Arc::clone(state), app.clone(), locator.clone());
            std::thread::spawn(move || {
                let connected = connection(&locator);
                let gate = core_status::fetch(&connected.base_url, connected.token.as_deref());
                let after_check = {
                    let mut state = state.lock();
                    if state.generation != generation {
                        return;
                    }
                    state.checking = false;
                    state.after_check.take()
                };
                match gate {
                    Gate::Open => {
                        send(&app, &state, Command::start(mode));
                        if let Some(command) = after_check {
                            send(&app, &state, command);
                        }
                    }
                    Gate::Closed(reason) => {
                        state.lock().machine.finished();
                        let next = app.clone();
                        let _ = app.run_on_main_thread(move || {
                            let _ = show(&next);
                            error(&next, &reason);
                        });
                    }
                }
            });
        }
        Action::Stop | Action::Cancel => {
            let command = if matches!(action, Action::Stop) {
                Command::stop()
            } else {
                Command::cancel()
            };
            let checking = {
                let mut state = state.lock();
                if state.checking {
                    state.after_check = Some(command);
                    true
                } else {
                    false
                }
            };
            if !checking {
                send(app, state, command);
            }
        }
        Action::PasteAgain => {
            // Core is asked again on every paste-again: switching dictation off or engaging the
            // emergency stop must also stop the retained text from being typed anywhere.
            let (state, app, locator) = (Arc::clone(state), app.clone(), locator.clone());
            std::thread::spawn(move || {
                let connected = connection(&locator);
                let gate =
                    core_status::fetch_paste_gate(&connected.base_url, connected.token.as_deref());
                match paste_again_text(&state, gate) {
                    // Use the same platform decision table as an ordinary dictation. Never log
                    // it. X11/GTK clipboard operations must run on the GTK main thread; on
                    // macOS/Windows this worker may sleep briefly while restoring the clipboard.
                    Ok(text) => paste_again(&app, text),
                    Err(message) => {
                        let next = app.clone();
                        let _ = app.run_on_main_thread(move || error(&next, &message));
                    }
                }
            });
        }
    }
}

/// The text paste-again may type, given Core's current answer. A closed gate (dictation off, or
/// the emergency stop) forgets the retained text, so it cannot come back later.
fn paste_again_text(state: &Mutex<State>, gate: Gate) -> Result<String, String> {
    let mut state = state.lock();
    if let Gate::Closed(reason) = gate {
        state.last_text = None;
        return Err(reason);
    }
    state
        .last_text
        .clone()
        .ok_or_else(|| "There is no previous dictation to paste again.".into())
}

#[cfg(target_os = "linux")]
fn paste_again<R: Runtime>(app: &AppHandle<R>, text: String) {
    let next = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Err(e) = crate::dictation_paste::paste(&text) {
            error(&next, e.message);
        }
    });
}

#[cfg(not(target_os = "linux"))]
fn paste_again<R: Runtime>(app: &AppHandle<R>, text: String) {
    if let Err(e) = crate::dictation_paste::paste(&text) {
        error(app, e.message);
    }
}

/// Builds the pill on the same loopback origin as Core, so its single-use dictation WebSocket
/// meets Core's exact same-origin rule. This URL is fixed by the shell, never supplied by a page.
fn page_url(connected: &CoreConnection) -> Option<tauri::Url> {
    let url = tauri::Url::parse(&format!("{}/pill.html", connected.base_url)).ok()?;
    (url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.path() == "/pill.html")
        .then_some(url)
}

pub fn is_pill_page<R: Runtime>(window: &WebviewWindow<R>, locator: &Locator) -> bool {
    if window.label() != LABEL {
        return false;
    }
    let connected = connection(locator);
    window.url().ok().as_ref() == page_url(&connected).as_ref()
}

fn collect_monitors<R: Runtime>(window: &WebviewWindow<R>) -> Vec<MonitorInfo> {
    let mut monitors: Vec<_> = window
        .available_monitors()
        .unwrap_or_default()
        .into_iter()
        .map(|m| {
            let p = m.position();
            let s = m.size();
            MonitorInfo {
                rect: Rect::new(p.x, p.y, s.width as i32, s.height as i32),
                scale: m.scale_factor(),
                name: m.name().cloned(),
                notch: None,
            }
        })
        .collect();
    let primary = window.primary_monitor().ok().flatten().map(|m| {
        let p = m.position();
        let s = m.size();
        Rect::new(p.x, p.y, s.width as i32, s.height as i32)
    });
    primary_first(&mut monitors, primary);
    monitors
}

fn create_window<R: Runtime>(
    app: &AppHandle<R>,
    locator: &Locator,
    mock: bool,
) -> tauri::Result<WebviewWindow<R>> {
    let connected = connection(locator);
    let Some(url) = page_url(&connected) else {
        return Err(tauri::Error::AssetNotFound(
            "Pill must be served by loopback Core".into(),
        ));
    };
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(url))
        .title("Phoenix Dictation")
        .inner_size(PILL_SIZE.0, PILL_SIZE.1)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .focusable(false)
        .focused(false)
        .visible(false)
        .on_page_load(|window, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                if let Some(shell) = window.app_handle().try_state::<Shell<R>>() {
                    shell.dictation.unload();
                }
            }
        })
        .on_permission_request(|_webview, kind| {
            use tauri::webview::{PermissionKind, PermissionResponse};
            // A microphone prompt is only reached after a user click or accepted hotkey
            // session; camera/display capture are never allowed by the pill.
            match kind {
                PermissionKind::Microphone => PermissionResponse::Default,
                _ => PermissionResponse::Deny,
            }
        })
        .build()?;
    if !mock {
        #[cfg(target_os = "macos")]
        if let Ok(ns_window) = window.ns_window() {
            // SAFETY: the live NSWindow on the main thread, same as the island styling.
            unsafe { crate::island_macos::style_window(ns_window) };
        }
        #[cfg(target_os = "linux")]
        if let Ok(gtk_window) = window.gtk_window() {
            crate::island_linux::apply_dock_hints(
                &gtk_window,
                &crate::island_platform::dock_hints(),
            );
        }
        #[cfg(windows)]
        if let Ok(hwnd) = window.hwnd() {
            crate::island_windows::apply_no_activate(hwnd);
        }
    }
    let monitors = collect_monitors(&window);
    let cursor = window.cursor_position().ok().map(|p| Point {
        x: p.x.round() as i32,
        y: p.y.round() as i32,
    });
    if let Some(monitor) = pill_monitor(&monitors, cursor) {
        let r = pill_rect(monitor);
        window.set_position(PhysicalPosition::new(r.x, r.y))?;
        window.set_size(PhysicalSize::new(r.w as u32, r.h as u32))?;
    }
    Ok(window)
}

/// Only the main thread calls this. The URL is served by Core so neither a token nor audio is
/// put into Tauri commands. The pill is created lazily, on first opt-in or first dictation.
pub fn show<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let shell = app.state::<Shell<R>>();
    let window = match app.get_webview_window(LABEL) {
        Some(window) => window,
        None => create_window(app, &shell.locator, shell.dictation.mock)?,
    };
    let _ = window.show();
    Ok(())
}

pub fn hide<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.hide();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state_with(text: &str) -> Mutex<State> {
        Mutex::new(State {
            last_text: Some(text.into()),
            ..State::default()
        })
    }

    #[test]
    fn paste_again_replays_the_text_only_while_core_still_allows_dictation() {
        let state = state_with("hello");
        assert_eq!(paste_again_text(&state, Gate::Open), Ok("hello".into()));
        // Not consumed: it can be pasted again.
        assert_eq!(paste_again_text(&state, Gate::Open), Ok("hello".into()));
    }

    #[test]
    fn paste_again_refuses_and_forgets_the_text_when_dictation_is_off_or_killed() {
        for reason in [
            "Dictation is off. Turn it on in Phoenix Settings, under Dictation.",
            "The emergency stop is engaged.",
            "Phoenix Core did not answer.",
        ] {
            let state = state_with("secret words");
            assert_eq!(
                paste_again_text(&state, Gate::Closed(reason.into())),
                Err(reason.into())
            );
            assert_eq!(state.lock().last_text, None);
            // Re-enabling dictation later must not resurrect the old text.
            assert_eq!(
                paste_again_text(&state, Gate::Open),
                Err("There is no previous dictation to paste again.".into())
            );
        }
    }

    #[test]
    fn commands_serialize_exactly_as_the_page_expects() {
        assert_eq!(
            serde_json::to_value(Command::start(Mode::Hold)).unwrap(),
            serde_json::json!({"action":"start","mode":"hold"})
        );
        assert_eq!(
            serde_json::to_value(Command::start(Mode::HandsFree)).unwrap(),
            serde_json::json!({"action":"start","mode":"hands_free"})
        );
        assert_eq!(
            serde_json::to_value(Command::cancel()).unwrap(),
            serde_json::json!({"action":"cancel"})
        );
        assert_eq!(
            serde_json::to_value(Command::stop()).unwrap(),
            serde_json::json!({"action":"stop"})
        );
    }

    #[test]
    fn queued_commands_keep_the_order_of_a_press_and_release_before_page_ready() {
        let mut q = Pending::default();
        assert_eq!(q.queue(Command::start(Mode::Hold)), None);
        assert_eq!(q.queue(Command::stop()), None);
        assert_eq!(q.ready(), vec![Command::start(Mode::Hold), Command::stop()]);
        assert_eq!(q.queue(Command::cancel()), Some(Command::cancel()));
    }

    #[test]
    fn unloading_disposes_commands_for_the_old_page() {
        let mut q = Pending::default();
        q.queue(Command::start(Mode::HandsFree));
        q.unload();
        assert!(q.ready().is_empty());
    }

    #[test]
    fn page_url_is_fixed_to_the_core_loopback_origin() {
        assert_eq!(
            page_url(&CoreConnection {
                base_url: "http://127.0.0.1:4870".into(),
                token: None
            })
            .unwrap()
            .as_str(),
            "http://127.0.0.1:4870/pill.html"
        );
        assert!(page_url(&CoreConnection {
            base_url: "http://192.0.2.1:4870".into(),
            token: None
        })
        .is_none());
    }
}
