// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Phase 70: customisable global shortcuts.
//!
//! Global hotkeys can steal keys from every other application, so they are off until the user
//! turns them on (`shortcuts_enabled`), and every binding fails closed: an accelerator that does
//! not parse, has fewer than two modifiers (a bare letter, or Ctrl+C alone, would swallow typing
//! or copy everywhere), is a reserved operating-system chord, collides with the dictation
//! paste-again chord, or is claimed by two actions leaves that action *unbound*. It never falls
//! back to another key and never panics.
//!
//! This module is pure apart from [`NativeRegistrar`], the only code that talks to the
//! operating system (through `tauri-plugin-global-shortcut`). Everything else goes through the
//! [`Registrar`] trait, so the registration bookkeeping is tested with a fake. The lifecycle tests
//! use [`Refusing`], which never touches the OS (headless Linux/Windows CI has no hotkey API).
//!
//! The dictation key itself (a lone modifier such as Right Control) cannot collide with a
//! shortcut: every shortcut needs a non-modifier main key, and Esc (which cancels a dictation) is
//! not in the shortcut key grammar.

use crate::dictation_keys::{Modifiers, PasteChord};
use crate::settings::Mode;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::BTreeMap;
use std::fmt;
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{AppHandle, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt as _, ShortcutState};

/// The Pet Panel tab the "Wardrobe" menu entry and shortcut open (same route the web app's
/// `WARDROBE_ROUTE` names).
pub const WARDROBE_ROUTE: &str = "/panel/wardrobe";
/// Pet Panel chat tab.
pub const CHAT_ROUTE: &str = "/panel/chat";
/// The Pet Panel overview lists the approvals Fawkes is waiting for.
pub const ALERT_ROUTE: &str = "/panel/overview";
/// Agent sessions. Focusing the real terminal needs Core's session token, which this shell does
/// not hold for that route, so this opens the page that lists the sessions instead.
pub const TERMINAL_ROUTE: &str = "/agents";
/// What "switch pills" cycles through, in order: the places that show what each source is doing.
const PILL_ROUTES: [&str; 3] = ["/panel/activity", "/panel/capabilities", "/agents"];
/// Event sent to the desktop pages when the mute flag changes: `{ "muted": bool }`.
pub const MUTE_EVENT: &str = "shortcuts://mute";
/// Event sent to the desktop pages after bindings are (re)registered: a [`Report`].
pub const STATUS_EVENT: &str = "shortcuts://status";
/// Longest accelerator text the shell parses.
const MAX_ACCELERATOR: usize = 64;

/// What a shortcut does.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    OpenChat,
    JumpToAlert,
    JumpToTerminal,
    SwitchPills,
    Mute,
    SendToDesktop,
    Wardrobe,
}

impl Action {
    pub const ALL: [Action; 7] = [
        Action::OpenChat,
        Action::JumpToAlert,
        Action::JumpToTerminal,
        Action::SwitchPills,
        Action::Mute,
        Action::SendToDesktop,
        Action::Wardrobe,
    ];

    /// Settings key and command argument (identical to the serde name).
    pub fn as_str(self) -> &'static str {
        match self {
            Action::OpenChat => "open_chat",
            Action::JumpToAlert => "jump_to_alert",
            Action::JumpToTerminal => "jump_to_terminal",
            Action::SwitchPills => "switch_pills",
            Action::Mute => "mute",
            Action::SendToDesktop => "send_to_desktop",
            Action::Wardrobe => "wardrobe",
        }
    }

    pub fn parse(text: &str) -> Option<Action> {
        Action::ALL.into_iter().find(|a| a.as_str() == text)
    }

    pub fn label(self) -> &'static str {
        match self {
            Action::OpenChat => "Open chat",
            Action::JumpToAlert => "Jump to alert",
            Action::JumpToTerminal => "Jump to terminal",
            Action::SwitchPills => "Switch pills",
            Action::Mute => "Mute sounds and notifications",
            Action::SendToDesktop => "Send Fawkes to the desktop",
            Action::Wardrobe => "Open the wardrobe",
        }
    }

    /// Every action has a default, so turning shortcuts on gives a working set. Three modifiers:
    /// hard to press by accident and unused by the common desktop environments (Ctrl+Alt+T opens
    /// a terminal on GNOME, which is why the plain Ctrl+Alt pair is not used).
    pub fn default_accelerator(self) -> &'static str {
        match self {
            Action::OpenChat => "Ctrl+Alt+Shift+C",
            Action::JumpToAlert => "Ctrl+Alt+Shift+A",
            Action::JumpToTerminal => "Ctrl+Alt+Shift+T",
            Action::SwitchPills => "Ctrl+Alt+Shift+P",
            Action::Mute => "Ctrl+Alt+Shift+M",
            Action::SendToDesktop => "Ctrl+Alt+Shift+D",
            Action::Wardrobe => "Ctrl+Alt+Shift+W",
        }
    }

    /// The in-app route for actions that only open a page.
    pub fn route(self) -> Option<&'static str> {
        match self {
            Action::OpenChat => Some(CHAT_ROUTE),
            Action::JumpToAlert => Some(ALERT_ROUTE),
            Action::JumpToTerminal => Some(TERMINAL_ROUTE),
            Action::Wardrobe => Some(WARDROBE_ROUTE),
            Action::SwitchPills | Action::Mute | Action::SendToDesktop => None,
        }
    }
}

/// Why an accelerator was refused. Shown to the person, never raised as a panic.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BindError {
    TooLong,
    Malformed(String),
    NeedsModifiers,
    /// Ctrl+Alt or Alt+Shift with a letter or digit: AltGr / Option type symbols with those.
    NeedsThirdModifier,
    Reserved,
    DictationChord,
    Conflict(Action),
}

impl BindError {
    pub fn code(&self) -> &'static str {
        match self {
            BindError::TooLong | BindError::Malformed(_) => "invalid",
            BindError::NeedsModifiers => "needs_modifiers",
            BindError::NeedsThirdModifier => "needs_third_modifier",
            BindError::Reserved => "reserved",
            BindError::DictationChord => "dictation_chord",
            BindError::Conflict(_) => "conflict",
        }
    }
}

impl fmt::Display for BindError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BindError::TooLong => write!(f, "The shortcut text is too long."),
            BindError::Malformed(why) => write!(f, "Not a valid shortcut: {why}."),
            BindError::NeedsModifiers => write!(
                f,
                "A global shortcut needs at least two modifier keys (Ctrl, Alt, Shift or Cmd) \
                 so it cannot take over normal typing."
            ),
            BindError::NeedsThirdModifier => write!(
                f,
                "Ctrl+Alt and Alt+Shift with a letter or digit type symbols on many keyboards \
                 (AltGr / Option), so add a third modifier."
            ),
            BindError::Reserved => write!(f, "That combination is reserved by the system."),
            BindError::DictationChord => {
                write!(f, "That combination is the dictation paste-again chord.")
            }
            BindError::Conflict(other) => {
                write!(f, "\"{}\" already uses that combination.", other.label())
            }
        }
    }
}

/// Modifiers plus one main key, in a canonical form (so `ctrl+alt+c` and `Alt+Control+C` compare
/// equal).
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Combo {
    mods: Modifiers,
    key: String,
}

const NAMED_KEYS: [(&str, &str); 16] = [
    ("space", "Space"),
    ("tab", "Tab"),
    ("enter", "Enter"),
    ("return", "Enter"),
    ("up", "ArrowUp"),
    ("arrowup", "ArrowUp"),
    ("down", "ArrowDown"),
    ("arrowdown", "ArrowDown"),
    ("left", "ArrowLeft"),
    ("arrowleft", "ArrowLeft"),
    ("right", "ArrowRight"),
    ("arrowright", "ArrowRight"),
    ("home", "Home"),
    ("end", "End"),
    ("pageup", "PageUp"),
    ("pagedown", "PageDown"),
];

fn modifier(token: &str) -> Option<Modifiers> {
    Some(match token {
        "ctrl" | "control" => Modifiers::CTRL,
        "alt" | "option" => Modifiers::ALT,
        "shift" => Modifiers::SHIFT,
        "cmd" | "command" | "super" | "meta" | "win" => Modifiers::META,
        "cmdorctrl" | "cmdorcontrol" | "commandorctrl" | "commandorcontrol" => {
            if cfg!(target_os = "macos") {
                Modifiers::META
            } else {
                Modifiers::CTRL
            }
        }
        _ => return None,
    })
}

/// Canonical key name for a main-key token (already lower-case), or `None` if it is not allowed.
/// Letters, digits, F1-F24 and a few navigation keys. Esc is deliberately absent: it cancels a
/// dictation in progress.
fn main_key(token: &str) -> Option<String> {
    let mut chars = token.chars();
    if let (Some(c), None) = (chars.next(), chars.next()) {
        return c
            .is_ascii_alphanumeric()
            .then(|| c.to_ascii_uppercase().to_string());
    }
    if let Some(digits) = token.strip_prefix('f') {
        if !digits.is_empty()
            && !digits.starts_with('0')
            && digits.bytes().all(|b| b.is_ascii_digit())
        {
            return digits
                .parse::<u8>()
                .ok()
                .filter(|n| (1..=24).contains(n))
                .map(|n| format!("F{n}"));
        }
    }
    NAMED_KEYS
        .iter()
        .find(|(name, _)| *name == token)
        .map(|(_, canonical)| (*canonical).to_string())
}

impl Combo {
    /// Grammar only (`Mod+Mod+Key`, case-insensitive, modifiers first, one main key). The safety
    /// rules (modifier count, reserved, collisions) are [`Combo::vetted`].
    pub fn parse(text: &str) -> Result<Combo, BindError> {
        if text.len() > MAX_ACCELERATOR {
            return Err(BindError::TooLong);
        }
        let lower = text.trim().to_ascii_lowercase();
        let malformed = |why: &str| BindError::Malformed(why.to_string());
        let tokens: Vec<&str> = lower.split('+').map(str::trim).collect();
        let Some((key_token, modifier_tokens)) = tokens.split_last() else {
            return Err(malformed("empty"));
        };
        if tokens.iter().any(|t| t.is_empty()) {
            return Err(malformed("empty part"));
        }
        let mut mods = Modifiers::NONE;
        for token in modifier_tokens {
            let Some(m) = modifier(token) else {
                return Err(malformed(
                    "modifiers must come first and only one main key is allowed",
                ));
            };
            if mods.contains(m) {
                return Err(malformed("a modifier is repeated"));
            }
            mods = mods | m;
        }
        if modifier(key_token).is_some() {
            return Err(malformed("it has no main key"));
        }
        let Some(key) = main_key(key_token) else {
            return Err(malformed("unsupported main key"));
        };
        Ok(Combo { mods, key })
    }

    fn modifier_count(&self) -> usize {
        [
            Modifiers::CTRL,
            Modifiers::ALT,
            Modifiers::SHIFT,
            Modifiers::META,
        ]
        .into_iter()
        .filter(|m| self.mods.contains(*m))
        .count()
    }

    /// Parse, then apply the rules that make a global binding safe on `platform`. `paste_chord` is
    /// the dictation paste-again chord; a shortcut equal to it would fire both.
    pub fn vetted(text: &str, paste_chord: &Combo, platform: Platform) -> Result<Combo, BindError> {
        let combo = Combo::parse(text)?;
        if combo.modifier_count() < 2 {
            return Err(BindError::NeedsModifiers);
        }
        // Before the AltGr rule, so a chord the system owns says so.
        if platform
            .reserved()
            .filter_map(|r| Combo::parse(r).ok())
            .any(|r| r == combo)
        {
            return Err(BindError::Reserved);
        }
        if combo == *paste_chord {
            return Err(BindError::DictationChord);
        }
        if combo.types_symbols() {
            return Err(BindError::NeedsThirdModifier);
        }
        Ok(combo)
    }

    /// Ctrl+Alt and Alt+Shift with a letter or digit are how AltGr / Option type symbols and
    /// accented letters on common layouts (Ctrl+Alt is AltGr on Windows and Linux): a global
    /// binding would swallow typing. A third modifier avoids it. F-keys and navigation keys do not
    /// type anything, so those pairs are fine. (The grammar has no punctuation main keys; if one is
    /// ever added it has a single-character key and falls under this rule too.)
    fn types_symbols(&self) -> bool {
        let pair = self.mods == (Modifiers::CTRL | Modifiers::ALT)
            || self.mods == (Modifiers::ALT | Modifiers::SHIFT);
        pair && self.key.len() == 1
    }

    /// The text the global-shortcut plugin parses.
    fn plugin_string(&self) -> String {
        let mut text = String::new();
        for (m, name) in [
            (Modifiers::CTRL, "ctrl"),
            (Modifiers::ALT, "alt"),
            (Modifiers::SHIFT, "shift"),
            (Modifiers::META, "super"),
        ] {
            if self.mods.contains(m) {
                text.push_str(name);
                text.push('+');
            }
        }
        text.push_str(&self.key);
        text
    }
}

impl fmt::Display for Combo {
    /// Canonical text accepted by [`Combo::parse`].
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (m, name) in [
            (Modifiers::CTRL, "Ctrl"),
            (Modifiers::ALT, "Alt"),
            (Modifiers::SHIFT, "Shift"),
            (Modifiers::META, "Cmd"),
        ] {
            if self.mods.contains(m) {
                write!(f, "{name}+")?;
            }
        }
        write!(f, "{}", self.key)
    }
}

/// The operating system a shortcut is vetted for. Every table below is compiled and unit-tested on
/// every OS (a runtime `match`, never `#[cfg]` around the logic); only [`Platform::current`] asks
/// which one this build runs on, so tests can vet for any of them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Platform {
    MacOs,
    Windows,
    Linux,
}

impl Platform {
    pub const ALL: [Platform; 3] = [Platform::MacOs, Platform::Windows, Platform::Linux];

    /// The platform this build runs on (anything that is not macOS or Windows is treated as Linux).
    pub const fn current() -> Platform {
        if cfg!(target_os = "macos") {
            Platform::MacOs
        } else if cfg!(target_os = "windows") {
            Platform::Windows
        } else {
            Platform::Linux
        }
    }

    /// Chords the operating system owns on this platform: the shared table plus its own.
    fn reserved(self) -> impl Iterator<Item = &'static str> {
        let own: &'static [&'static str] = match self {
            Platform::MacOs => &[],
            Platform::Windows => WINDOWS_RESERVED,
            Platform::Linux => LINUX_RESERVED,
        };
        RESERVED.iter().chain(own).copied()
    }
}

/// Chords the operating system owns (task switching, logout, screenshots, workspace switching).
/// Binding one globally would break something the person relies on. This is the macOS table and
/// applies on every platform; Windows and Linux add their own below. All of these parse and none is
/// a default (both checked by tests).
const RESERVED: &[&str] = &[
    "Alt+Shift+Tab",
    "Ctrl+Alt+Tab",
    "Cmd+Shift+Tab",
    "Cmd+Shift+Q",
    "Cmd+Ctrl+Q",
    "Cmd+Ctrl+Space",
    "Cmd+Alt+Space",
    "Cmd+Ctrl+F",
    "Cmd+Shift+3",
    "Cmd+Shift+4",
    "Cmd+Shift+5",
    "Ctrl+Alt+ArrowLeft",
    "Ctrl+Alt+ArrowRight",
    "Ctrl+Alt+ArrowUp",
    "Ctrl+Alt+ArrowDown",
];

/// Windows: `Cmd` is the Windows key. Win+L, Win+D etc. have one modifier and are already refused
/// for that; they are listed anyway so the table says what the system owns. Ctrl+Alt+Delete has no
/// main key in the accelerator grammar (no Delete key), so it cannot be bound at all.
const WINDOWS_RESERVED: &[&str] = &[
    "Cmd+Shift+S",
    "Cmd+L",
    "Cmd+D",
    "Cmd+E",
    "Cmd+R",
    "Cmd+Tab",
    "Cmd+Shift+M",
    "Cmd+Ctrl+D",
    "Cmd+Ctrl+F4",
    "Cmd+Ctrl+ArrowLeft",
    "Cmd+Ctrl+ArrowRight",
    "Cmd+Shift+ArrowLeft",
    "Cmd+Shift+ArrowRight",
];

/// Linux: Ctrl+Alt+F1..F12 switch virtual terminals, Ctrl+Alt+L locks the screen on many desktops,
/// Ctrl+Alt+T opens a terminal on GNOME. Ctrl+Alt+Delete / Backspace have no main key in the
/// grammar, so they cannot be bound at all.
const LINUX_RESERVED: &[&str] = &[
    "Ctrl+Alt+F1",
    "Ctrl+Alt+F2",
    "Ctrl+Alt+F3",
    "Ctrl+Alt+F4",
    "Ctrl+Alt+F5",
    "Ctrl+Alt+F6",
    "Ctrl+Alt+F7",
    "Ctrl+Alt+F8",
    "Ctrl+Alt+F9",
    "Ctrl+Alt+F10",
    "Ctrl+Alt+F11",
    "Ctrl+Alt+F12",
    "Ctrl+Alt+L",
    "Ctrl+Alt+T",
    "Cmd+L",
    "Cmd+D",
];

/// What the settings say about one action.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outcome {
    Bound(Combo),
    /// The user cleared it (empty accelerator).
    Unbound,
    Rejected(BindError),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub action: Action,
    pub outcome: Outcome,
}

fn paste_combo(paste_chord: &str) -> Combo {
    let chord = PasteChord::parse(paste_chord).unwrap_or_default();
    // `PasteChord`'s canonical text is `ctrl+alt+v`, which the shortcut grammar also reads.
    Combo::parse(&chord.to_string()).unwrap_or(Combo {
        mods: Modifiers::CTRL | Modifiers::ALT,
        key: "V".into(),
    })
}

/// [`resolve_on`] for the platform this build runs on.
pub fn resolve(user: &BTreeMap<String, String>, paste_chord: &str) -> Vec<Entry> {
    resolve_on(Platform::current(), user, paste_chord)
}

/// The effective binding of every action: the user's text if present, else the default. Two
/// actions with the same combination are both rejected (neither wins arbitrarily).
pub fn resolve_on(
    platform: Platform,
    user: &BTreeMap<String, String>,
    paste_chord: &str,
) -> Vec<Entry> {
    let paste = paste_combo(paste_chord);
    let mut entries: Vec<Entry> = Action::ALL
        .into_iter()
        .map(|action| {
            let text = user
                .get(action.as_str())
                .map_or(action.default_accelerator(), String::as_str);
            let outcome = if text.trim().is_empty() {
                Outcome::Unbound
            } else {
                match Combo::vetted(text, &paste, platform) {
                    Ok(combo) => Outcome::Bound(combo),
                    Err(e) => Outcome::Rejected(e),
                }
            };
            Entry { action, outcome }
        })
        .collect();
    let bound: Vec<(Action, Combo)> = entries
        .iter()
        .filter_map(|e| match &e.outcome {
            Outcome::Bound(c) => Some((e.action, c.clone())),
            _ => None,
        })
        .collect();
    for entry in &mut entries {
        let Outcome::Bound(combo) = &entry.outcome else {
            continue;
        };
        if let Some((other, _)) = bound.iter().find(|(a, c)| *a != entry.action && c == combo) {
            entry.outcome = Outcome::Rejected(BindError::Conflict(*other));
        }
    }
    entries
}

/// [`validate_set_on`] for the platform this build runs on.
pub fn validate_set(
    action: Action,
    text: &str,
    user: &BTreeMap<String, String>,
    paste_chord: &str,
) -> Result<Option<String>, BindError> {
    validate_set_on(Platform::current(), action, text, user, paste_chord)
}

/// Checks a new binding for `action` against everything else, for the `set` command. `Ok(None)`
/// is an explicit unbind; `Ok(Some(text))` is the canonical text to store.
pub fn validate_set_on(
    platform: Platform,
    action: Action,
    text: &str,
    user: &BTreeMap<String, String>,
    paste_chord: &str,
) -> Result<Option<String>, BindError> {
    if text.trim().is_empty() {
        return Ok(None);
    }
    let combo = Combo::vetted(text, &paste_combo(paste_chord), platform)?;
    let canonical = combo.to_string();
    let mut candidate = user.clone();
    candidate.insert(action.as_str().to_string(), canonical.clone());
    match resolve_on(platform, &candidate, paste_chord)
        .into_iter()
        .find(|e| e.action == action)
    {
        Some(Entry {
            outcome: Outcome::Rejected(e),
            ..
        }) => Err(e),
        _ => Ok(Some(canonical)),
    }
}

/// How one action stands, for the menu, the page and the event.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum State {
    /// Registered with the operating system.
    Active,
    /// Valid, but shortcuts are turned off.
    Off,
    /// The user cleared it.
    Unbound,
    /// The settings text was refused (invalid, reserved, duplicate...). Fails closed.
    Rejected,
    /// The operating system would not register it (another app owns it, or hotkeys are not
    /// available). The other actions are unaffected.
    Unavailable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ActionStatus {
    pub action: Action,
    pub label: &'static str,
    pub default_accelerator: &'static str,
    /// Canonical text of the binding; absent when unbound or rejected.
    pub accelerator: Option<String>,
    pub state: State,
    pub detail: Option<String>,
}

/// What `shortcuts_list` returns and `shortcuts://status` carries.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Report {
    pub enabled: bool,
    pub muted: bool,
    pub shortcuts: Vec<ActionStatus>,
}

/// Payload of [`MUTE_EVENT`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct MutePayload {
    pub muted: bool,
}

/// Text of the menu's on/off entry; it also tells when some bindings are not registered.
pub fn menu_text(statuses: &[ActionStatus], enabled: bool) -> String {
    let failed = statuses
        .iter()
        .filter(|s| matches!(s.state, State::Unavailable | State::Rejected))
        .count();
    match (enabled, failed) {
        (false, _) => "Enable global shortcuts".to_string(),
        (true, 0) => "Global shortcuts".to_string(),
        (true, 1) => "Global shortcuts (1 not active)".to_string(),
        (true, n) => format!("Global shortcuts ({n} not active)"),
    }
}

/// A refused command, in words for the person.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Refusal {
    pub code: &'static str,
    pub message: String,
}

impl Refusal {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl From<BindError> for Refusal {
    fn from(e: BindError) -> Self {
        Refusal::new(e.code(), e.to_string())
    }
}

/// Operating-system registration, so the bookkeeping can be tested without one.
pub trait Registrar {
    fn register(&self, accelerator: &str, action: Action) -> Result<(), String>;
    fn unregister(&self, accelerator: &str) -> Result<(), String>;
}

/// Registers nothing: the lifecycle tests and any environment without a hotkey API. Every
/// registration is reported as unavailable with `reason`.
pub struct Refusing {
    pub reason: String,
}

impl Refusing {
    pub fn new(reason: impl Into<String>) -> Self {
        Self {
            reason: reason.into(),
        }
    }
}

impl Registrar for Refusing {
    fn register(&self, _accelerator: &str, _action: Action) -> Result<(), String> {
        Err(self.reason.clone())
    }

    fn unregister(&self, _accelerator: &str) -> Result<(), String> {
        Ok(())
    }
}

/// The only code that reaches the operating system. A shortcut press is handed to the main
/// thread (the hotkey callback can arrive on a helper thread) and runs [`crate::run_shortcut`].
pub struct NativeRegistrar<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> NativeRegistrar<R> {
    /// The registrar if the plugin is already loaded; otherwise loads it when `load` is set
    /// (shortcuts are on) and `None` when not (nothing can be registered, so nothing to undo).
    /// The plugin is added lazily so a user who never turns shortcuts on never creates an OS
    /// hotkey manager.
    pub fn open(app: &AppHandle<R>, load: bool) -> Result<Option<Self>, String> {
        use tauri::Manager as _;
        let loaded = app
            .try_state::<tauri_plugin_global_shortcut::GlobalShortcut<R>>()
            .is_some();
        if !loaded {
            if !load {
                return Ok(None);
            }
            app.plugin(tauri_plugin_global_shortcut::Builder::<R>::new().build())
                .map_err(|e| format!("Global shortcuts are not available here: {e}"))?;
        }
        Ok(Some(Self { app: app.clone() }))
    }
}

impl<R: Runtime> Registrar for NativeRegistrar<R> {
    fn register(&self, accelerator: &str, action: Action) -> Result<(), String> {
        self.app
            .global_shortcut()
            .on_shortcut(accelerator, move |app, _shortcut, event| {
                if event.state != ShortcutState::Pressed {
                    return;
                }
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || crate::run_shortcut(&handle, action));
            })
            .map_err(|e| e.to_string())
    }

    fn unregister(&self, accelerator: &str) -> Result<(), String> {
        self.app
            .global_shortcut()
            .unregister(accelerator)
            .map_err(|e| e.to_string())
    }
}

#[derive(Default)]
struct HostState {
    /// Plugin-syntax text of what is registered right now.
    registered: Vec<String>,
    statuses: Vec<ActionStatus>,
}

/// What is registered and how every action stands.
#[derive(Default)]
pub struct Host {
    state: Mutex<HostState>,
    pill_cursor: AtomicUsize,
}

impl Host {
    pub fn statuses(&self) -> Vec<ActionStatus> {
        self.state.lock().statuses.clone()
    }

    /// Makes the operating system's registrations match the settings: drops what was registered,
    /// then (only if `enabled`) registers every valid binding. A binding the OS refuses is
    /// reported on its own action and the rest still register.
    pub fn apply(
        &self,
        registrar: &dyn Registrar,
        enabled: bool,
        user: &BTreeMap<String, String>,
        paste_chord: &str,
    ) -> Vec<ActionStatus> {
        let mut state = self.state.lock();
        // A registration that cannot be removed stays on the list and is retried next time.
        state
            .registered
            .retain(|accelerator| registrar.unregister(accelerator).is_err());
        let mut statuses = Vec::with_capacity(Action::ALL.len());
        for Entry { action, outcome } in resolve(user, paste_chord) {
            let mut status = ActionStatus {
                action,
                label: action.label(),
                default_accelerator: action.default_accelerator(),
                accelerator: None,
                state: State::Unbound,
                detail: None,
            };
            match outcome {
                Outcome::Unbound => {}
                Outcome::Rejected(why) => {
                    status.state = State::Rejected;
                    status.detail = Some(why.to_string());
                }
                Outcome::Bound(combo) => {
                    status.accelerator = Some(combo.to_string());
                    if !enabled {
                        status.state = State::Off;
                    } else {
                        let plugin_text = combo.plugin_string();
                        match registrar.register(&plugin_text, action) {
                            Ok(()) => {
                                state.registered.push(plugin_text);
                                status.state = State::Active;
                            }
                            Err(why) => {
                                status.state = State::Unavailable;
                                status.detail = Some(format!(
                                    "Could not register {combo}; another app may already use it ({why})."
                                ));
                            }
                        }
                    }
                }
            }
            statuses.push(status);
        }
        state.statuses.clone_from(&statuses);
        statuses
    }

    /// The next route "switch pills" visits (cycles).
    pub fn next_pill_route(&self) -> &'static str {
        let i = self.pill_cursor.fetch_add(1, Ordering::Relaxed);
        PILL_ROUTES[i % PILL_ROUTES.len()]
    }
}

/// What "send Fawkes to the desktop" does from the current state.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DesktopPlan {
    /// Mode to switch to first (`None` keeps the current one).
    pub mode: Option<Mode>,
    pub visible: bool,
}

/// Fawkes in the navbar or hidden comes to the desktop (floating when it was navbar-only);
/// Fawkes already on the desktop is hidden, the existing show/hide toggle.
pub fn send_to_desktop(mode: Mode, visible: bool) -> DesktopPlan {
    if mode != Mode::Navbar && visible {
        DesktopPlan {
            mode: None,
            visible: false,
        }
    } else {
        DesktopPlan {
            mode: (mode == Mode::Navbar).then_some(Mode::Floating),
            visible: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use tauri_plugin_global_shortcut::Shortcut;

    const PASTE: &str = "ctrl+alt+v";

    fn user(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    fn outcome(entries: &[Entry], action: Action) -> Outcome {
        entries
            .iter()
            .find(|e| e.action == action)
            .unwrap()
            .outcome
            .clone()
    }

    /// Vetted for macOS: the shared table only, so the result does not depend on the build OS.
    fn vetted(text: &str) -> Result<Combo, BindError> {
        vetted_on(Platform::MacOs, text)
    }

    fn vetted_on(platform: Platform, text: &str) -> Result<Combo, BindError> {
        Combo::vetted(text, &paste_combo(PASTE), platform)
    }

    #[test]
    fn the_grammar_is_case_and_order_insensitive_for_modifiers_and_canonical() {
        let a = Combo::parse("ctrl+ALT+shift+c").unwrap();
        let b = Combo::parse(" Alt + Control + Shift + C ").unwrap();
        assert_eq!(a, Combo::parse("shift+option+ctrl+C").unwrap());
        // Spelling and modifier order do not matter, the canonical text does not change.
        assert_eq!(a.to_string(), "Ctrl+Alt+Shift+C");
        assert_eq!(b.to_string(), "Ctrl+Alt+Shift+C");
        assert_eq!(Combo::parse(&a.to_string()).unwrap(), a);
        assert_eq!(
            Combo::parse("cmd+alt+return").unwrap().to_string(),
            "Alt+Cmd+Enter"
        );
    }

    #[test]
    fn malformed_accelerators_are_refused() {
        for text in [
            "",
            "   ",
            "+",
            "ctrl+",
            "+c",
            "ctrl++c",
            "ctrl+alt",
            "ctrl+alt+shift",
            "ctrl+ctrl+c",
            "ctrl+c+alt",
            "ctrl+c+d",
            "ctrl+alt+esc",
            "ctrl+alt+escape",
            "ctrl+alt+f0",
            "ctrl+alt+f01",
            "ctrl+alt+f25",
            "ctrl+alt+f300",
            "ctrl+alt+é",
            "ctrl+alt+;",
            "hyper+alt+c",
            "ctrl+alt+volumeup",
        ] {
            assert!(
                matches!(Combo::parse(text), Err(BindError::Malformed(_))),
                "{text:?} must not parse"
            );
        }
        let long = format!("ctrl+alt+{}", "a".repeat(80));
        assert_eq!(Combo::parse(&long), Err(BindError::TooLong));
    }

    #[test]
    fn a_bare_key_or_a_single_modifier_can_never_be_bound() {
        for text in [
            "c", "7", "f5", "space", "shift+c", "ctrl+c", "alt+f4", "cmd+q",
        ] {
            assert_eq!(
                vetted(text),
                Err(BindError::NeedsModifiers),
                "{text:?} would steal normal keys"
            );
        }
        assert!(vetted("ctrl+shift+c").is_ok());
        assert!(vetted("ctrl+alt+f12").is_ok());
        // A lone modifier (the dictation key) is not a shortcut at all.
        assert!(matches!(vetted("control"), Err(BindError::Malformed(_))));
        assert!(matches!(vetted("ctrl+alt"), Err(BindError::Malformed(_))));
    }

    #[test]
    fn reserved_system_chords_are_refused_and_no_default_is_one() {
        for platform in Platform::ALL {
            for text in platform.reserved() {
                assert!(
                    Combo::parse(text).is_ok(),
                    "{text} is in the {platform:?} table but invalid"
                );
            }
        }
        assert_eq!(vetted("alt+shift+tab"), Err(BindError::Reserved));
        assert_eq!(vetted("Cmd+Shift+4"), Err(BindError::Reserved));
        assert_eq!(vetted("ctrl+alt+left"), Err(BindError::Reserved));
        for platform in Platform::ALL {
            for action in Action::ALL {
                assert!(
                    vetted_on(platform, action.default_accelerator()).is_ok(),
                    "default of {action:?} is refused on {platform:?}"
                );
            }
        }
    }

    #[test]
    fn each_platform_reserves_its_own_chords_and_only_those() {
        // Linux: the virtual terminals and the screen lock.
        for key in 1..=12 {
            let text = format!("ctrl+alt+f{key}");
            assert_eq!(vetted_on(Platform::Linux, &text), Err(BindError::Reserved));
            assert!(vetted_on(Platform::MacOs, &text).is_ok(), "{text} on macOS");
            assert!(
                vetted_on(Platform::Windows, &text).is_ok(),
                "{text} on Windows"
            );
        }
        assert_eq!(
            vetted_on(Platform::Linux, "ctrl+alt+f13"),
            Ok(Combo::parse("ctrl+alt+f13").unwrap())
        );
        assert_eq!(
            vetted_on(Platform::Linux, "ctrl+alt+shift+f1").map(|_| ()),
            Ok(())
        );
        // Windows: screenshot snip, show desktop with a second modifier, virtual desktops.
        for text in ["cmd+shift+s", "cmd+ctrl+d", "cmd+ctrl+left", "cmd+shift+m"] {
            assert_eq!(
                vetted_on(Platform::Windows, text),
                Err(BindError::Reserved),
                "{text}"
            );
            assert!(vetted_on(Platform::MacOs, text).is_ok(), "{text} on macOS");
            assert!(vetted_on(Platform::Linux, text).is_ok(), "{text} on Linux");
        }
        // The shared (macOS) table applies everywhere.
        for platform in Platform::ALL {
            assert_eq!(vetted_on(platform, "cmd+shift+q"), Err(BindError::Reserved));
        }
        // The build's own platform is one of the three.
        assert!(Platform::ALL.contains(&Platform::current()));
    }

    #[test]
    fn ctrl_alt_and_alt_shift_need_a_third_modifier_for_a_letter_or_digit() {
        // Ctrl+Alt is AltGr on Windows and Linux, Alt+Shift (and Option) type symbols on macOS.
        for platform in Platform::ALL {
            for text in [
                "ctrl+alt+a",
                "alt+ctrl+7",
                "alt+shift+q",
                "shift+option+4",
                "ctrl+alt+z",
            ] {
                assert_eq!(
                    vetted_on(platform, text),
                    Err(BindError::NeedsThirdModifier),
                    "{text} on {platform:?} would swallow AltGr typing"
                );
            }
            // A third modifier, or keys that type nothing, are fine.
            for text in [
                "ctrl+alt+shift+a",
                "ctrl+alt+cmd+a",
                "alt+shift+cmd+7",
                "ctrl+shift+a",
                "cmd+alt+a",
                "alt+shift+f9",
                "alt+shift+space",
                "ctrl+alt+home",
            ] {
                assert!(vetted_on(platform, text).is_ok(), "{text} on {platform:?}");
            }
        }
        assert_eq!(BindError::NeedsThirdModifier.code(), "needs_third_modifier");
        // A chord the system owns keeps saying so, and the paste chord keeps its own error.
        assert_eq!(
            vetted_on(Platform::Linux, "ctrl+alt+l"),
            Err(BindError::Reserved)
        );
        assert_eq!(vetted("ctrl+alt+v"), Err(BindError::DictationChord));
        // `set` reports the new error rather than storing the text.
        assert_eq!(
            validate_set_on(
                Platform::Linux,
                Action::Mute,
                "ctrl+alt+m",
                &BTreeMap::new(),
                PASTE
            ),
            Err(BindError::NeedsThirdModifier)
        );
        // `resolve` leaves the action unbound and rejected instead of falling back to the default.
        let entries = resolve_on(Platform::Windows, &user(&[("mute", "alt+shift+m")]), PASTE);
        assert_eq!(
            outcome(&entries, Action::Mute),
            Outcome::Rejected(BindError::NeedsThirdModifier)
        );
    }

    #[test]
    fn every_action_has_a_distinct_valid_default_and_a_stable_name() {
        let entries = resolve(&BTreeMap::new(), PASTE);
        assert_eq!(entries.len(), Action::ALL.len());
        let mut seen = Vec::new();
        for Entry { action, outcome } in entries {
            let Outcome::Bound(combo) = outcome else {
                panic!("{action:?} is not bound by default");
            };
            assert!(!seen.contains(&combo), "{action:?} reuses a default");
            seen.push(combo);
            assert_eq!(Action::parse(action.as_str()), Some(action));
            assert_eq!(
                serde_json::to_string(&action).unwrap(),
                format!("\"{}\"", action.as_str())
            );
        }
        assert_eq!(Action::parse("Mute"), None);
        assert_eq!(Action::parse("rm -rf"), None);
    }

    #[test]
    fn every_key_the_grammar_accepts_is_one_the_operating_system_layer_parses() {
        let mut keys: Vec<String> = ('a'..='z').chain('0'..='9').map(String::from).collect();
        keys.extend((1..=24).map(|n| format!("f{n}")));
        keys.extend(NAMED_KEYS.iter().map(|(name, _)| (*name).to_string()));
        for key in keys {
            let combo = Combo::parse(&format!("ctrl+alt+{key}")).unwrap();
            let text = combo.plugin_string();
            assert!(
                text.parse::<Shortcut>().is_ok(),
                "{key}: plugin refuses {text:?}"
            );
        }
        for action in Action::ALL {
            let combo = vetted(action.default_accelerator()).unwrap();
            assert!(combo.plugin_string().parse::<Shortcut>().is_ok());
        }
    }

    #[test]
    fn two_actions_on_one_combination_are_both_unbound() {
        let entries = resolve(
            &user(&[
                ("open_chat", "ctrl+alt+shift+k"),
                ("wardrobe", "Shift+Control+Alt+K"),
            ]),
            PASTE,
        );
        assert_eq!(
            outcome(&entries, Action::OpenChat),
            Outcome::Rejected(BindError::Conflict(Action::Wardrobe))
        );
        assert_eq!(
            outcome(&entries, Action::Wardrobe),
            Outcome::Rejected(BindError::Conflict(Action::OpenChat))
        );
        assert!(matches!(outcome(&entries, Action::Mute), Outcome::Bound(_)));
    }

    #[test]
    fn a_user_binding_that_takes_another_actions_default_conflicts() {
        let entries = resolve(&user(&[("open_chat", "ctrl+alt+shift+w")]), PASTE);
        assert_eq!(
            outcome(&entries, Action::OpenChat),
            Outcome::Rejected(BindError::Conflict(Action::Wardrobe))
        );
        // The action that kept its default is rejected too: neither wins by order.
        assert_eq!(
            outcome(&entries, Action::Wardrobe),
            Outcome::Rejected(BindError::Conflict(Action::OpenChat))
        );
    }

    #[test]
    fn the_dictation_paste_chord_cannot_be_a_shortcut() {
        assert_eq!(vetted("ctrl+alt+v"), Err(BindError::DictationChord));
        let custom = paste_combo("ctrl+shift+9");
        assert_eq!(
            Combo::vetted("Shift+Ctrl+9", &custom, Platform::MacOs),
            Err(BindError::DictationChord)
        );
        // An unparsable chord setting falls back to the default chord, as the dictation code does.
        assert_eq!(paste_combo("v"), paste_combo(PASTE));
        let entries = resolve(&user(&[("mute", "ctrl+alt+v")]), PASTE);
        assert_eq!(
            outcome(&entries, Action::Mute),
            Outcome::Rejected(BindError::DictationChord)
        );
    }

    #[test]
    fn invalid_user_text_unbinds_the_action_instead_of_using_its_default() {
        let entries = resolve(
            &user(&[
                ("mute", "m"),
                ("open_chat", "ctrl+alt+shift+;;"),
                ("wardrobe", ""),
                ("jump_to_alert", "   "),
            ]),
            PASTE,
        );
        assert!(matches!(
            outcome(&entries, Action::Mute),
            Outcome::Rejected(BindError::NeedsModifiers)
        ));
        assert!(matches!(
            outcome(&entries, Action::OpenChat),
            Outcome::Rejected(BindError::Malformed(_))
        ));
        assert_eq!(outcome(&entries, Action::Wardrobe), Outcome::Unbound);
        assert_eq!(outcome(&entries, Action::JumpToAlert), Outcome::Unbound);
        assert!(matches!(
            outcome(&entries, Action::SwitchPills),
            Outcome::Bound(_)
        ));
    }

    #[test]
    fn set_validates_and_returns_the_canonical_text() {
        let none = BTreeMap::new();
        assert_eq!(
            validate_set(Action::Mute, "option+SHIFT+ctrl+8", &none, PASTE),
            Ok(Some("Ctrl+Alt+Shift+8".into()))
        );
        assert_eq!(validate_set(Action::Mute, "  ", &none, PASTE), Ok(None));
        assert_eq!(
            validate_set(Action::Mute, "m", &none, PASTE),
            Err(BindError::NeedsModifiers)
        );
        assert_eq!(
            validate_set(Action::Mute, "ctrl+alt+shift+d", &none, PASTE),
            Err(BindError::Conflict(Action::SendToDesktop))
        );
        // Setting an action to the combination it already holds is not a conflict with itself.
        assert_eq!(
            validate_set(Action::Mute, "ctrl+alt+shift+m", &none, PASTE),
            Ok(Some("Ctrl+Alt+Shift+M".into()))
        );
        // A cleared action frees its combination for another one.
        let cleared = user(&[("send_to_desktop", "")]);
        assert!(validate_set(Action::Mute, "ctrl+alt+shift+d", &cleared, PASTE).is_ok());
    }

    #[derive(Default)]
    struct Fake {
        registered: RefCell<Vec<String>>,
        ever: RefCell<Vec<String>>,
        refuse: Vec<&'static str>,
    }

    impl Registrar for Fake {
        fn register(&self, accelerator: &str, _action: Action) -> Result<(), String> {
            self.ever.borrow_mut().push(accelerator.to_string());
            if self.refuse.contains(&accelerator) {
                return Err("already registered".into());
            }
            self.registered.borrow_mut().push(accelerator.to_string());
            Ok(())
        }

        fn unregister(&self, accelerator: &str) -> Result<(), String> {
            self.registered.borrow_mut().retain(|a| a != accelerator);
            Ok(())
        }
    }

    fn state_of(statuses: &[ActionStatus], action: Action) -> State {
        statuses.iter().find(|s| s.action == action).unwrap().state
    }

    #[test]
    fn nothing_is_registered_while_shortcuts_are_off() {
        let fake = Fake::default();
        let host = Host::default();
        let statuses = host.apply(&fake, false, &BTreeMap::new(), PASTE);
        assert!(fake.ever.borrow().is_empty());
        assert!(statuses.iter().all(|s| s.state == State::Off));
        assert!(statuses.iter().all(|s| s.accelerator.is_some()));
    }

    #[test]
    fn one_refused_registration_does_not_stop_the_others() {
        let fake = Fake {
            refuse: vec!["ctrl+alt+shift+M"],
            ..Fake::default()
        };
        let host = Host::default();
        let statuses = host.apply(&fake, true, &BTreeMap::new(), PASTE);
        assert_eq!(state_of(&statuses, Action::Mute), State::Unavailable);
        let detail = statuses
            .iter()
            .find(|s| s.action == Action::Mute)
            .unwrap()
            .detail
            .clone()
            .unwrap();
        assert!(detail.contains("another app"), "{detail}");
        for action in Action::ALL.into_iter().filter(|a| *a != Action::Mute) {
            assert_eq!(state_of(&statuses, action), State::Active, "{action:?}");
        }
        assert_eq!(fake.registered.borrow().len(), Action::ALL.len() - 1);
        assert_eq!(host.statuses(), statuses);
    }

    #[test]
    fn rejected_and_unbound_actions_never_reach_the_operating_system() {
        let fake = Fake::default();
        let host = Host::default();
        let statuses = host.apply(
            &fake,
            true,
            &user(&[("mute", "m"), ("wardrobe", ""), ("open_chat", "ctrl+alt+v")]),
            PASTE,
        );
        assert_eq!(state_of(&statuses, Action::Mute), State::Rejected);
        assert_eq!(state_of(&statuses, Action::Wardrobe), State::Unbound);
        assert_eq!(state_of(&statuses, Action::OpenChat), State::Rejected);
        let ever = fake.ever.borrow();
        assert_eq!(ever.len(), Action::ALL.len() - 3);
        assert!(!ever
            .iter()
            .any(|a| a == "ctrl+alt+V" || a == "ctrl+alt+shift+W"));
    }

    #[test]
    fn changing_a_binding_releases_the_old_one_and_turning_off_releases_everything() {
        let fake = Fake::default();
        let host = Host::default();
        host.apply(&fake, true, &BTreeMap::new(), PASTE);
        assert!(fake
            .registered
            .borrow()
            .contains(&"ctrl+alt+shift+C".to_string()));
        host.apply(
            &fake,
            true,
            &user(&[("open_chat", "ctrl+alt+shift+k")]),
            PASTE,
        );
        {
            let registered = fake.registered.borrow();
            assert!(!registered.contains(&"ctrl+alt+shift+C".to_string()));
            assert!(registered.contains(&"ctrl+alt+shift+K".to_string()));
            assert_eq!(registered.len(), Action::ALL.len());
        }
        host.apply(&fake, false, &BTreeMap::new(), PASTE);
        assert!(fake.registered.borrow().is_empty());
    }

    #[test]
    fn a_registration_that_cannot_be_released_is_retried() {
        struct Stuck {
            unregistered: RefCell<Vec<String>>,
            release_works: RefCell<bool>,
        }
        impl Registrar for Stuck {
            fn register(&self, _: &str, _: Action) -> Result<(), String> {
                Ok(())
            }
            fn unregister(&self, accelerator: &str) -> Result<(), String> {
                if *self.release_works.borrow() {
                    self.unregistered.borrow_mut().push(accelerator.to_string());
                    Ok(())
                } else {
                    Err("busy".into())
                }
            }
        }
        let stuck = Stuck {
            unregistered: RefCell::new(Vec::new()),
            release_works: RefCell::new(false),
        };
        let host = Host::default();
        host.apply(&stuck, false, &BTreeMap::new(), PASTE);
        host.apply(&stuck, true, &BTreeMap::new(), PASTE);
        host.apply(&stuck, false, &BTreeMap::new(), PASTE);
        assert!(stuck.unregistered.borrow().is_empty());
        *stuck.release_works.borrow_mut() = true;
        host.apply(&stuck, false, &BTreeMap::new(), PASTE);
        assert_eq!(stuck.unregistered.borrow().len(), Action::ALL.len());
    }

    #[test]
    fn the_refusing_registrar_reports_every_binding_as_unavailable() {
        let host = Host::default();
        let refusing = Refusing {
            reason: "no hotkey api".into(),
        };
        let statuses = host.apply(&refusing, true, &BTreeMap::new(), PASTE);
        assert!(statuses.iter().all(|s| s.state == State::Unavailable));
    }

    #[test]
    fn the_menu_entry_says_how_many_bindings_are_not_active() {
        let host = Host::default();
        let fake = Fake {
            refuse: vec!["ctrl+alt+shift+M"],
            ..Fake::default()
        };
        let off = host.apply(&fake, false, &BTreeMap::new(), PASTE);
        assert_eq!(menu_text(&off, false), "Enable global shortcuts");
        assert_eq!(menu_text(&[], false), "Enable global shortcuts");
        let on = host.apply(&fake, true, &user(&[("wardrobe", "w")]), PASTE);
        assert_eq!(menu_text(&on, true), "Global shortcuts (2 not active)");
        let clean = host.apply(&Fake::default(), true, &BTreeMap::new(), PASTE);
        assert_eq!(menu_text(&clean, true), "Global shortcuts");
    }

    #[test]
    fn send_to_desktop_brings_fawkes_down_or_hides_it() {
        let plan = |mode, visible| send_to_desktop(mode, visible);
        // Navbar-only Fawkes comes to the desktop as the floating pet.
        assert_eq!(
            plan(Mode::Navbar, true),
            DesktopPlan {
                mode: Some(Mode::Floating),
                visible: true
            }
        );
        assert_eq!(
            plan(Mode::Navbar, false),
            DesktopPlan {
                mode: Some(Mode::Floating),
                visible: true
            }
        );
        // Hidden on the desktop: show, keep the chosen mode (island stays island).
        assert_eq!(
            plan(Mode::Island, false),
            DesktopPlan {
                mode: None,
                visible: true
            }
        );
        // Already on the desktop: the same key hides it again.
        assert_eq!(
            plan(Mode::Floating, true),
            DesktopPlan {
                mode: None,
                visible: false
            }
        );
    }

    #[test]
    fn switch_pills_cycles_through_every_route_and_wraps() {
        let host = Host::default();
        let seen: Vec<&str> = (0..PILL_ROUTES.len() * 2)
            .map(|_| host.next_pill_route())
            .collect();
        assert_eq!(seen[..PILL_ROUTES.len()], PILL_ROUTES);
        assert_eq!(seen[PILL_ROUTES.len()..], PILL_ROUTES);
    }

    #[test]
    fn routes_the_shell_opens_are_ones_it_will_accept() {
        use crate::connection::phoenix_url;
        for route in Action::ALL
            .into_iter()
            .filter_map(Action::route)
            .chain(PILL_ROUTES)
        {
            assert!(
                phoenix_url("http://127.0.0.1:4870", route).is_some(),
                "{route} would be refused by open_in_phoenix's own check"
            );
        }
        assert_eq!(WARDROBE_ROUTE, "/panel/wardrobe");
    }
}
