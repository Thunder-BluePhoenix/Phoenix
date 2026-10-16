// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Dictation hotkey state machine: hold-to-talk, double-tap hands-free, Esc, paste-again.
//!
//! Pure: time is injected (`now_ms`, milliseconds on any clock) and nothing here reads a
//! clock, a keyboard, a window or the clipboard. The platform listener decodes physical
//! events into [`Event`]s (`KeyDown(Key)` / `KeyUp(Key)`), feeds them to
//! [`DictationKeys::handle`], calls [`DictationKeys::tick`] every 20-50 ms while
//! [`DictationKeys::needs_tick`] is true (a hold is detected by time, not by an event) and
//! obeys the returned [`Action`]s. The listener decides which physical key is
//! [`Key::Dictation`] from the user's [`DictationKey`] setting, so changing the key needs no
//! state here; call [`DictationKeys::reset`] when the setting changes.
//!
//! Behaviour (durations are [`Timing`], defaults in parentheses):
//!
//! * **Hold-to-talk**: `Dictation` held for `hold_ms` (250) starts a capture on the next
//!   tick (`Start { Hold }`); releasing it stops (`Stop`).
//! * **Hands-free**: a tap (down and up in under `hold_ms`) followed by a second press whose
//!   *down* comes at most `double_tap_ms` (350) after the first tap's *up* starts a capture
//!   at once (`Start { HandsFree }`). The next press (on key down) stops it (`Stop`).
//! * **Esc** while a capture is active cancels it (`Cancel`, `consume = true`). The rest of
//!   that same Esc press (auto-repeats, release) is consumed too so the application never
//!   sees half a key press. Esc while nothing is being captured is ignored and never
//!   consumed, so it keeps working in every other application.
//! * **Paste again**: `KeyDown(PasteChord)` answers `PasteAgain` unless a capture is active
//!   (then it is ignored). Auto-repeat of the chord is suppressed. The chord is never
//!   consumed (`consume` is only ever true for the Esc that cancels).
//! * **Noise**: key auto-repeat is suppressed; a press shorter than `debounce_ms` (20) and a
//!   press that starts less than `debounce_ms` after the previous release are contact bounce
//!   and are ignored. Another key pressed while `Dictation` is pending (a modifier combo such
//!   as Option+E) abandons the gesture instead of starting a dictation.
//! * **Time** is made monotonic internally: a clock reading below the previous one counts as
//!   "no time passed" and counting resumes from the new reading, so a rollback can neither
//!   start a hold early nor freeze the machine.
//!
//! Events of the dictation key itself are never consumed: swallowing a modifier press would
//! leave the operating system's modifier state inconsistent.

use serde::{Deserialize, Serialize};
use std::fmt;
use std::ops::BitOr;

/// Which physical key drives dictation (the user's setting).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DictationKey {
    RightOption,
    #[serde(rename = "fn")]
    Fn,
    RightCommand,
    RightControl,
}

impl Default for DictationKey {
    /// Right Option on macOS, Right Control everywhere else.
    fn default() -> Self {
        if cfg!(target_os = "macos") {
            Self::RightOption
        } else {
            Self::RightControl
        }
    }
}

impl DictationKey {
    /// Every key the setting can name, in the order the settings UI lists them.
    pub const ALL: [DictationKey; 4] = [
        DictationKey::RightOption,
        DictationKey::Fn,
        DictationKey::RightCommand,
        DictationKey::RightControl,
    ];

    /// Stable settings/JSON identifier (identical to the serde representation).
    #[cfg(test)]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::RightOption => "right_option",
            Self::Fn => "fn",
            Self::RightCommand => "right_command",
            Self::RightControl => "right_control",
        }
    }

    /// Inverse of [`DictationKey::as_str`]; `None` for anything else.
    #[cfg(test)]
    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|k| k.as_str() == s)
    }

    /// Human text for the settings UI.
    pub fn label(self) -> &'static str {
        match self {
            Self::RightOption => "Right Option",
            Self::Fn => "Fn",
            Self::RightCommand => "Right Command",
            Self::RightControl => "Right Control",
        }
    }

    /// The keys the settings UI may offer on this operating system: all four on macOS, only
    /// Right Control elsewhere (the others do not exist or are not reported as key events).
    pub fn supported() -> &'static [DictationKey] {
        if cfg!(target_os = "macos") {
            &Self::ALL
        } else {
            &[DictationKey::RightControl]
        }
    }

    pub fn is_supported(self) -> bool {
        Self::supported().contains(&self)
    }
}

/// Modifier bitset for [`PasteChord`]. `ALT` is the Option key on macOS and `META` the
/// Command key (Windows/Super key elsewhere).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct Modifiers(u8);

impl Modifiers {
    pub const NONE: Modifiers = Modifiers(0);
    pub const CTRL: Modifiers = Modifiers(1);
    pub const ALT: Modifiers = Modifiers(2);
    pub const SHIFT: Modifiers = Modifiers(4);
    pub const META: Modifiers = Modifiers(8);

    pub const fn contains(self, other: Modifiers) -> bool {
        self.0 & other.0 == other.0
    }

    pub const fn is_empty(self) -> bool {
        self.0 == 0
    }
}

impl BitOr for Modifiers {
    type Output = Modifiers;
    fn bitor(self, rhs: Modifiers) -> Modifiers {
        Modifiers(self.0 | rhs.0)
    }
}

/// The user-configurable "paste the last dictation again" chord: modifiers plus one letter or
/// digit. Default Ctrl+Option+V on macOS and Ctrl+Alt+V elsewhere, i.e. `CTRL | ALT` + `'v'`
/// on every platform. The platform layer matches physical key events with
/// [`PasteChord::matches`] and sends `KeyDown(Key::PasteChord)` when it returns true.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct PasteChord {
    modifiers: Modifiers,
    key: char,
}

impl Default for PasteChord {
    fn default() -> Self {
        Self {
            modifiers: Modifiers::CTRL | Modifiers::ALT,
            key: 'v',
        }
    }
}

impl PasteChord {
    /// `None` unless there is at least one modifier (a bare letter would steal typing) and the
    /// key is an ASCII letter or digit (stored lower-case).
    pub fn new(modifiers: Modifiers, key: char) -> Option<Self> {
        if modifiers.is_empty() || !key.is_ascii_alphanumeric() {
            return None;
        }
        Some(Self {
            modifiers,
            key: key.to_ascii_lowercase(),
        })
    }

    #[cfg(test)]
    pub fn modifiers(&self) -> Modifiers {
        self.modifiers
    }

    #[cfg(test)]
    pub fn key(&self) -> char {
        self.key
    }

    /// True when exactly these modifiers are down (no extra ones) and the typed character is
    /// the chord's key, case-insensitively.
    pub fn matches(&self, pressed: Modifiers, ch: char) -> bool {
        pressed == self.modifiers && ch.to_ascii_lowercase() == self.key
    }

    /// Parse `"ctrl+alt+v"` style text (case-insensitive, any order of modifiers; names
    /// `ctrl|control`, `alt|option`, `shift`, `cmd|command|meta|super`). Duplicate modifiers,
    /// unknown names, a missing modifier or a multi-character key are rejected.
    pub fn parse(s: &str) -> Option<Self> {
        let lower = s.trim().to_ascii_lowercase();
        let mut parts: Vec<&str> = lower.split('+').map(str::trim).collect();
        let key_part = parts.pop()?;
        let mut chars = key_part.chars();
        let key = chars.next()?;
        if chars.next().is_some() {
            return None;
        }
        let mut modifiers = Modifiers::NONE;
        for p in parts {
            let m = match p {
                "ctrl" | "control" => Modifiers::CTRL,
                "alt" | "option" => Modifiers::ALT,
                "shift" => Modifiers::SHIFT,
                "cmd" | "command" | "meta" | "super" => Modifiers::META,
                _ => return None,
            };
            if modifiers.contains(m) {
                return None;
            }
            modifiers = modifiers | m;
        }
        Self::new(modifiers, key)
    }
}

impl fmt::Display for PasteChord {
    /// Canonical text accepted by [`PasteChord::parse`]: `ctrl+alt+shift+cmd+<key>`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (m, name) in [
            (Modifiers::CTRL, "ctrl"),
            (Modifiers::ALT, "alt"),
            (Modifiers::SHIFT, "shift"),
            (Modifiers::META, "cmd"),
        ] {
            if self.modifiers.contains(m) {
                write!(f, "{name}+")?;
            }
        }
        write!(f, "{}", self.key)
    }
}

/// How a capture was started; the pill shows a different hint for each.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// Key held; releasing it stops.
    Hold,
    /// Double tap; the next press stops.
    HandsFree,
}

/// What the machine asks the shell to do.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Start {
        mode: Mode,
    },
    /// Finish the capture and paste the result.
    Stop,
    /// Throw the capture away; nothing is pasted.
    Cancel,
    /// Paste the last dictation again.
    PasteAgain,
}

/// A logical key, already decoded by the platform listener.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Key {
    /// The configured [`DictationKey`] (modifier press/release, auto-repeats included).
    Dictation,
    /// Esc (auto-repeats included).
    Esc,
    /// The configured [`PasteChord`] was completed (its letter went down with exactly the
    /// right modifiers).
    PasteChord,
    /// Any other key (letters, arrows, other modifiers...). A press abandons a pending
    /// dictation-key gesture; everything else about it is ignored.
    Other,
}

/// One physical event.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Event {
    KeyDown(Key),
    KeyUp(Key),
}

/// Result of one event: whether the platform listener must swallow the original event, and
/// what to do. `consume` is true only for an Esc press that cancels a capture (and the
/// repeats/release of that same press).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Output {
    pub consume: bool,
    pub action: Option<Action>,
}

impl Output {
    const NONE: Output = Output {
        consume: false,
        action: None,
    };

    fn act(action: Action) -> Output {
        Output {
            consume: false,
            action: Some(action),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Timing {
    /// Held at least this long: hold-to-talk. Shorter presses are taps.
    pub hold_ms: u64,
    /// Longest gap between a tap's release and the next press for a hands-free toggle.
    pub double_tap_ms: u64,
    /// Contact-bounce window (0 disables).
    pub debounce_ms: u64,
}

impl Default for Timing {
    fn default() -> Self {
        Self {
            hold_ms: 250,
            double_tap_ms: 350,
            debounce_ms: 20,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum State {
    Idle,
    /// Key down, deciding between tap and hold.
    Pending {
        down_at: u64,
    },
    /// First tap released, waiting for the second press.
    Tapped {
        up_at: u64,
    },
    /// Hold-to-talk capture running; key is down.
    Holding,
    /// Hands-free capture running; the second press is still down.
    HandsFreeKeyDown,
    /// Hands-free capture running; key is up.
    HandsFree,
    /// Key is down but its press was already used (cancel, stop, abandoned): wait for release.
    Ignoring,
}

/// Monotonic view of the injected clock.
#[derive(Clone, Copy, Debug)]
struct Clock {
    raw: u64,
    mono: u64,
}

#[derive(Debug)]
pub struct DictationKeys {
    timing: Timing,
    state: State,
    clock: Option<Clock>,
    /// Physical state of the dictation key (as far as events told us).
    key_down: bool,
    /// The current press began inside the debounce window: its release is bounce too.
    swallow_up: bool,
    last_up: Option<u64>,
    /// Physical state of Esc, to recognise auto-repeat.
    esc_down: bool,
    /// The current Esc press was consumed; so are its repeats and its release.
    esc_consumed: bool,
    /// Physical state of the paste chord, to suppress auto-repeat.
    chord_down: bool,
}

impl Default for DictationKeys {
    fn default() -> Self {
        Self::new()
    }
}

impl DictationKeys {
    pub fn new() -> Self {
        Self::with_timing(Timing::default())
    }

    pub fn with_timing(timing: Timing) -> Self {
        Self {
            timing,
            state: State::Idle,
            clock: None,
            key_down: false,
            swallow_up: false,
            last_up: None,
            esc_down: false,
            esc_consumed: false,
            chord_down: false,
        }
    }

    #[cfg(test)]
    pub fn timing(&self) -> Timing {
        self.timing
    }

    /// True while a capture is running (hold or hands-free).
    pub fn capturing(&self) -> bool {
        matches!(
            self.state,
            State::Holding | State::HandsFreeKeyDown | State::HandsFree
        )
    }

    /// The mode of the running capture, if any.
    #[cfg(test)]
    pub fn mode(&self) -> Option<Mode> {
        match self.state {
            State::Holding => Some(Mode::Hold),
            State::HandsFreeKeyDown | State::HandsFree => Some(Mode::HandsFree),
            _ => None,
        }
    }

    /// True when time alone can change the state (a hold or a double-tap window is open), so
    /// the listener only needs to tick while this holds.
    #[cfg(test)]
    pub fn needs_tick(&self) -> bool {
        matches!(self.state, State::Pending { .. } | State::Tapped { .. })
    }

    /// Forget everything: feature switched off, key setting changed, permission lost,
    /// listener restarted. Returns `Cancel` when a capture was running so the shell can drop
    /// it. A key that is still physically down is treated as released.
    pub fn reset(&mut self) -> Option<Action> {
        let action = self.capturing().then_some(Action::Cancel);
        self.state = State::Idle;
        self.key_down = false;
        self.swallow_up = false;
        self.last_up = None;
        self.chord_down = false;
        action
    }

    /// The dictation ended by other means (page error, paste done, Core refused, timeout):
    /// a running capture, hands-free included, goes back to idle. A dictation key that is
    /// still down is ignored until it is released. No effect when no capture is running.
    pub fn finished(&mut self) {
        if self.capturing() {
            self.state = if self.key_down {
                State::Ignoring
            } else {
                State::Idle
            };
        }
    }

    /// Time passed. Returns `Start { Hold }` once the key has been held for `hold_ms`, and
    /// lets an unanswered first tap expire.
    pub fn tick(&mut self, now_ms: u64) -> Option<Action> {
        let now = self.observe(now_ms);
        match self.state {
            State::Pending { down_at } if now.saturating_sub(down_at) >= self.timing.hold_ms => {
                self.state = State::Holding;
                Some(Action::Start { mode: Mode::Hold })
            }
            State::Tapped { up_at } if now.saturating_sub(up_at) > self.timing.double_tap_ms => {
                self.state = State::Idle;
                None
            }
            _ => None,
        }
    }

    pub fn handle(&mut self, event: Event, now_ms: u64) -> Output {
        let now = self.observe(now_ms);
        match event {
            Event::KeyDown(Key::Dictation) => self.on_key_down(now),
            Event::KeyUp(Key::Dictation) => self.on_key_up(now),
            Event::KeyDown(Key::Esc) => self.on_esc_down(),
            Event::KeyUp(Key::Esc) => self.on_esc_up(),
            Event::KeyDown(Key::PasteChord) => self.on_chord_down(),
            Event::KeyUp(Key::PasteChord) => {
                self.chord_down = false;
                Output::NONE
            }
            Event::KeyDown(Key::Other) => self.on_other_key(),
            Event::KeyUp(Key::Other) => Output::NONE,
        }
    }

    /// Monotonic time: a reading below the previous one adds nothing, later readings add
    /// their distance from the (lower) previous reading.
    fn observe(&mut self, raw: u64) -> u64 {
        let mono = match self.clock {
            None => raw,
            Some(c) => c.mono.saturating_add(raw.saturating_sub(c.raw)),
        };
        self.clock = Some(Clock { raw, mono });
        mono
    }

    fn within_debounce(&self, now: u64) -> bool {
        matches!(self.last_up, Some(t) if now.saturating_sub(t) < self.timing.debounce_ms)
    }

    fn on_key_down(&mut self, now: u64) -> Output {
        if self.key_down {
            // Auto-repeat, or a duplicate event from the platform.
            return Output::NONE;
        }
        self.key_down = true;
        if self.within_debounce(now) {
            self.swallow_up = true;
            return Output::NONE;
        }
        match self.state {
            State::Tapped { up_at } if now.saturating_sub(up_at) <= self.timing.double_tap_ms => {
                self.state = State::HandsFreeKeyDown;
                Output::act(Action::Start {
                    mode: Mode::HandsFree,
                })
            }
            State::HandsFree => {
                self.state = State::Ignoring;
                Output::act(Action::Stop)
            }
            // Idle, or an expired double-tap window. Any other state is unreachable while the
            // key is up; treating it as a fresh press is the safe recovery.
            _ => {
                self.state = State::Pending { down_at: now };
                Output::NONE
            }
        }
    }

    fn on_key_up(&mut self, now: u64) -> Output {
        if !self.key_down {
            return Output::NONE;
        }
        self.key_down = false;
        self.last_up = Some(now);
        if self.swallow_up {
            self.swallow_up = false;
            return Output::NONE;
        }
        match self.state {
            State::Pending { down_at } => {
                let held = now.saturating_sub(down_at);
                self.state = if held >= self.timing.debounce_ms && held < self.timing.hold_ms {
                    State::Tapped { up_at: now }
                } else {
                    // Bounce, or a hold whose tick never came (not a tap, not a capture).
                    State::Idle
                };
                Output::NONE
            }
            State::Holding => {
                self.state = State::Idle;
                Output::act(Action::Stop)
            }
            State::HandsFreeKeyDown => {
                self.state = State::HandsFree;
                Output::NONE
            }
            State::Ignoring => {
                self.state = State::Idle;
                Output::NONE
            }
            _ => Output::NONE,
        }
    }

    fn on_other_key(&mut self) -> Output {
        match self.state {
            State::Pending { .. } => self.state = State::Ignoring,
            State::Tapped { .. } => self.state = State::Idle,
            _ => {}
        }
        Output::NONE
    }

    fn on_esc_down(&mut self) -> Output {
        if self.esc_down {
            return Output {
                consume: self.esc_consumed,
                action: None,
            };
        }
        self.esc_down = true;
        if !self.capturing() {
            self.esc_consumed = false;
            return Output::NONE;
        }
        self.esc_consumed = true;
        self.state = if self.key_down {
            State::Ignoring
        } else {
            State::Idle
        };
        Output {
            consume: true,
            action: Some(Action::Cancel),
        }
    }

    fn on_esc_up(&mut self) -> Output {
        self.esc_down = false;
        Output {
            consume: std::mem::take(&mut self.esc_consumed),
            action: None,
        }
    }

    fn on_chord_down(&mut self) -> Output {
        if self.chord_down {
            return Output::NONE;
        }
        self.chord_down = true;
        if self.capturing() {
            return Output::NONE;
        }
        match self.state {
            // The chord uses the dictation key itself: the press was a chord, not a hold.
            State::Pending { .. } => self.state = State::Ignoring,
            State::Tapped { .. } => self.state = State::Idle,
            _ => {}
        }
        Output::act(Action::PasteAgain)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const START_HOLD: Action = Action::Start { mode: Mode::Hold };
    const START_FREE: Action = Action::Start {
        mode: Mode::HandsFree,
    };

    fn machine() -> DictationKeys {
        DictationKeys::new()
    }

    fn down(m: &mut DictationKeys, t: u64) -> Output {
        m.handle(Event::KeyDown(Key::Dictation), t)
    }

    fn up(m: &mut DictationKeys, t: u64) -> Output {
        m.handle(Event::KeyUp(Key::Dictation), t)
    }

    fn esc_down(m: &mut DictationKeys, t: u64) -> Output {
        m.handle(Event::KeyDown(Key::Esc), t)
    }

    fn esc_up(m: &mut DictationKeys, t: u64) -> Output {
        m.handle(Event::KeyUp(Key::Esc), t)
    }

    fn chord_down(m: &mut DictationKeys, t: u64) -> Output {
        m.handle(Event::KeyDown(Key::PasteChord), t)
    }

    fn other(m: &mut DictationKeys, t: u64) -> Output {
        m.handle(Event::KeyDown(Key::Other), t)
    }

    fn act(a: Action) -> Output {
        Output::act(a)
    }

    const CANCEL_CONSUMED: Output = Output {
        consume: true,
        action: Some(Action::Cancel),
    };
    const CONSUMED_ONLY: Output = Output {
        consume: true,
        action: None,
    };

    /// Hold-to-talk running, key down.
    fn holding(m: &mut DictationKeys, t0: u64) {
        down(m, t0);
        assert_eq!(m.tick(t0 + 250), Some(START_HOLD));
    }

    /// Hands-free running, key up. Ends at `t0 + 160`.
    fn hands_free(m: &mut DictationKeys, t0: u64) {
        down(m, t0);
        up(m, t0 + 60);
        assert_eq!(down(m, t0 + 120), act(START_FREE));
        up(m, t0 + 160);
        assert_eq!(m.mode(), Some(Mode::HandsFree));
    }

    // ---- DictationKey ---------------------------------------------------------------

    #[test]
    fn default_key_is_platform_specific() {
        if cfg!(target_os = "macos") {
            assert_eq!(DictationKey::default(), DictationKey::RightOption);
        } else {
            assert_eq!(DictationKey::default(), DictationKey::RightControl);
        }
        assert!(DictationKey::default().is_supported());
    }

    #[test]
    fn supported_keys_per_platform() {
        let keys = DictationKey::supported();
        assert!(keys.contains(&DictationKey::RightControl));
        if cfg!(target_os = "macos") {
            assert_eq!(keys, &DictationKey::ALL);
            assert!(DictationKey::Fn.is_supported());
        } else {
            assert_eq!(keys, &[DictationKey::RightControl]);
            assert!(!DictationKey::Fn.is_supported());
            assert!(!DictationKey::RightOption.is_supported());
            assert!(!DictationKey::RightCommand.is_supported());
        }
    }

    #[test]
    fn all_lists_each_key_once() {
        let mut v = DictationKey::ALL.to_vec();
        v.sort_by_key(|k| k.as_str());
        v.dedup();
        assert_eq!(v.len(), 4);
    }

    #[test]
    fn key_serialises_as_snake_case() {
        let json = |k| serde_json::to_string(&k).unwrap();
        assert_eq!(json(DictationKey::RightOption), "\"right_option\"");
        assert_eq!(json(DictationKey::Fn), "\"fn\"");
        assert_eq!(json(DictationKey::RightCommand), "\"right_command\"");
        assert_eq!(json(DictationKey::RightControl), "\"right_control\"");
        let back: DictationKey = serde_json::from_str("\"right_command\"").unwrap();
        assert_eq!(back, DictationKey::RightCommand);
        assert!(serde_json::from_str::<DictationKey>("\"left_option\"").is_err());
    }

    #[test]
    fn as_str_matches_serde_and_parse_round_trips() {
        for k in DictationKey::ALL {
            let json = serde_json::to_string(&k).unwrap();
            assert_eq!(json, format!("\"{}\"", k.as_str()));
            assert_eq!(DictationKey::parse(k.as_str()), Some(k));
        }
    }

    #[test]
    fn parse_rejects_unknown_and_differently_cased_text() {
        for s in [
            "",
            "Fn",
            "FN",
            "right option",
            "left_option",
            "right_alt",
            " fn",
        ] {
            assert_eq!(DictationKey::parse(s), None, "{s:?}");
        }
    }

    #[test]
    fn labels_are_human_text() {
        assert_eq!(DictationKey::RightOption.label(), "Right Option");
        assert_eq!(DictationKey::Fn.label(), "Fn");
        assert_eq!(DictationKey::RightCommand.label(), "Right Command");
        assert_eq!(DictationKey::RightControl.label(), "Right Control");
    }

    // ---- PasteChord -----------------------------------------------------------------

    #[test]
    fn default_chord_is_ctrl_alt_v() {
        let c = PasteChord::default();
        assert_eq!(c.modifiers(), Modifiers::CTRL | Modifiers::ALT);
        assert_eq!(c.key(), 'v');
        assert_eq!(c.to_string(), "ctrl+alt+v");
    }

    #[test]
    fn chord_matches_exact_modifiers_and_any_case() {
        let c = PasteChord::default();
        let ca = Modifiers::CTRL | Modifiers::ALT;
        assert!(c.matches(ca, 'v'));
        assert!(c.matches(ca, 'V'));
        assert!(!c.matches(ca, 'c'));
        assert!(!c.matches(Modifiers::CTRL, 'v'));
        assert!(!c.matches(Modifiers::ALT, 'v'));
        assert!(!c.matches(ca | Modifiers::SHIFT, 'v'));
        assert!(!c.matches(Modifiers::NONE, 'v'));
    }

    #[test]
    fn chord_new_validates() {
        assert!(PasteChord::new(Modifiers::NONE, 'v').is_none());
        assert!(PasteChord::new(Modifiers::CTRL, '-').is_none());
        assert!(PasteChord::new(Modifiers::CTRL, 'é').is_none());
        assert!(PasteChord::new(Modifiers::CTRL, ' ').is_none());
        let c = PasteChord::new(Modifiers::META | Modifiers::SHIFT, 'K').unwrap();
        assert_eq!(c.key(), 'k');
        assert!(PasteChord::new(Modifiers::CTRL, '7').is_some());
    }

    #[test]
    fn chord_parse_and_display_round_trip() {
        for s in [
            "ctrl+alt+v",
            "ctrl+shift+9",
            "alt+cmd+p",
            "ctrl+alt+shift+cmd+z",
        ] {
            let c = PasteChord::parse(s).unwrap();
            assert_eq!(c.to_string(), s);
            assert_eq!(PasteChord::parse(&c.to_string()), Some(c));
        }
    }

    #[test]
    fn chord_parse_accepts_aliases_order_case_and_spaces() {
        let want = PasteChord::default();
        assert_eq!(PasteChord::parse("Control + Option + V"), Some(want));
        assert_eq!(PasteChord::parse("option+ctrl+v"), Some(want));
        assert_eq!(PasteChord::parse("  CTRL+ALT+v "), Some(want));
        let c = PasteChord::parse("command+shift+v").unwrap();
        assert_eq!(c.modifiers(), Modifiers::META | Modifiers::SHIFT);
        for alias in ["cmd", "command", "meta", "super"] {
            let c = PasteChord::parse(&format!("{alias}+v")).unwrap();
            assert_eq!(c.modifiers(), Modifiers::META);
        }
    }

    #[test]
    fn chord_parse_rejects_bad_input() {
        for s in [
            "",
            "v",
            "ctrl",
            "ctrl+",
            "+v",
            "ctrl++v",
            "ctrl+alt+vv",
            "ctrl+ctrl+v",
            "ctrl+hyper+v",
            "ctrl+alt+-",
            "ctrl+f1",
            "ctrl+alt+é",
        ] {
            assert_eq!(PasteChord::parse(s), None, "{s:?}");
        }
    }

    #[test]
    fn modifiers_bitset() {
        let m = Modifiers::CTRL | Modifiers::SHIFT;
        assert!(m.contains(Modifiers::CTRL));
        assert!(m.contains(Modifiers::SHIFT));
        assert!(!m.contains(Modifiers::ALT));
        assert!(!m.contains(Modifiers::META));
        assert!(m.contains(Modifiers::NONE));
        assert!(Modifiers::NONE.is_empty());
        assert!(!m.is_empty());
        assert_eq!(Modifiers::default(), Modifiers::NONE);
    }

    // ---- hold to talk ---------------------------------------------------------------

    #[test]
    fn hold_starts_on_tick_at_250ms_and_release_stops() {
        let mut m = machine();
        assert_eq!(down(&mut m, 1_000), Output::NONE);
        assert!(m.needs_tick());
        assert_eq!(m.tick(1_249), None);
        assert!(!m.capturing());
        assert_eq!(m.tick(1_250), Some(START_HOLD));
        assert_eq!(m.mode(), Some(Mode::Hold));
        assert!(m.capturing());
        assert!(!m.needs_tick());
        assert_eq!(m.tick(5_000), None);
        assert_eq!(up(&mut m, 6_000), act(Action::Stop));
        assert!(!m.capturing());
        assert_eq!(m.mode(), None);
    }

    #[test]
    fn hold_does_not_start_without_a_tick() {
        let mut m = machine();
        down(&mut m, 0);
        // Release after 400 ms but no tick arrived: not a tap, not a capture.
        assert_eq!(up(&mut m, 400), Output::NONE);
        assert!(!m.capturing());
        assert!(!m.needs_tick());
        // And it did not arm a double tap.
        assert_eq!(down(&mut m, 500), Output::NONE);
        assert!(!m.capturing());
    }

    #[test]
    fn start_is_emitted_once() {
        let mut m = machine();
        down(&mut m, 0);
        assert_eq!(m.tick(250), Some(START_HOLD));
        for t in [260, 300, 1_000, 10_000] {
            assert_eq!(m.tick(t), None);
        }
    }

    #[test]
    fn tick_when_idle_does_nothing() {
        let mut m = machine();
        assert_eq!(m.tick(0), None);
        assert_eq!(m.tick(1_000_000), None);
        assert!(!m.needs_tick());
    }

    #[test]
    fn hold_then_release_does_not_arm_a_double_tap() {
        let mut m = machine();
        holding(&mut m, 0);
        assert_eq!(up(&mut m, 600), act(Action::Stop));
        // A quick press right after is a fresh first press, not a second tap.
        assert_eq!(down(&mut m, 700), Output::NONE);
        assert!(!m.capturing());
        assert_eq!(up(&mut m, 760), Output::NONE);
        assert!(!m.capturing());
    }

    #[test]
    fn hold_can_repeat_many_times() {
        let mut m = machine();
        let mut t = 0;
        for _ in 0..5 {
            holding(&mut m, t);
            assert_eq!(up(&mut m, t + 500), act(Action::Stop));
            t += 2_000;
        }
    }

    // ---- taps and hands-free --------------------------------------------------------

    #[test]
    fn single_tap_does_nothing_and_expires() {
        let mut m = machine();
        assert_eq!(down(&mut m, 0), Output::NONE);
        assert_eq!(up(&mut m, 100), Output::NONE);
        assert!(m.needs_tick());
        assert_eq!(m.tick(450), None);
        assert!(m.needs_tick());
        assert_eq!(m.tick(451), None);
        assert!(!m.needs_tick());
        assert!(!m.capturing());
    }

    #[test]
    fn tap_just_under_hold_threshold_is_a_tap() {
        let mut m = machine();
        down(&mut m, 0);
        up(&mut m, 249);
        assert_eq!(down(&mut m, 300), act(START_FREE));
    }

    #[test]
    fn double_tap_starts_hands_free_on_second_press() {
        let mut m = machine();
        down(&mut m, 0);
        up(&mut m, 80);
        assert_eq!(down(&mut m, 200), act(START_FREE));
        assert_eq!(m.mode(), Some(Mode::HandsFree));
        assert!(!m.needs_tick());
        // Releasing the second press keeps the capture running.
        assert_eq!(up(&mut m, 260), Output::NONE);
        assert_eq!(m.mode(), Some(Mode::HandsFree));
        assert_eq!(m.tick(5_000), None);
        assert!(m.capturing());
    }

    #[test]
    fn double_tap_window_is_inclusive_at_350ms() {
        let mut m = machine();
        down(&mut m, 0);
        up(&mut m, 100);
        assert_eq!(down(&mut m, 450), act(START_FREE));
    }

    #[test]
    fn double_tap_window_closes_after_350ms() {
        let mut m = machine();
        down(&mut m, 0);
        up(&mut m, 100);
        assert_eq!(down(&mut m, 451), Output::NONE);
        assert!(!m.capturing());
        // That press is a fresh first press: holding it starts a hold capture.
        assert_eq!(m.tick(701), Some(START_HOLD));
    }

    #[test]
    fn double_tap_window_closes_even_without_a_tick() {
        let mut m = machine();
        down(&mut m, 0);
        up(&mut m, 100);
        // No ticks at all for a long time.
        assert_eq!(down(&mut m, 10_000), Output::NONE);
        assert!(!m.capturing());
        assert_eq!(up(&mut m, 10_080), Output::NONE);
        assert_eq!(down(&mut m, 10_200), act(START_FREE));
    }

    #[test]
    fn second_tap_toggles_hands_free_off_on_key_down() {
        let mut m = machine();
        hands_free(&mut m, 0);
        assert_eq!(down(&mut m, 5_000), act(Action::Stop));
        assert!(!m.capturing());
        // The release of that press does nothing.
        assert_eq!(up(&mut m, 5_070), Output::NONE);
        assert!(!m.capturing());
        assert!(!m.needs_tick());
    }

    #[test]
    fn stopping_hands_free_does_not_arm_another_double_tap() {
        let mut m = machine();
        hands_free(&mut m, 0);
        down(&mut m, 5_000);
        up(&mut m, 5_070);
        // A press 100 ms later is a first press, not a second tap.
        assert_eq!(down(&mut m, 5_170), Output::NONE);
        assert!(!m.capturing());
    }

    #[test]
    fn long_hold_of_the_second_press_still_means_hands_free() {
        let mut m = machine();
        down(&mut m, 0);
        up(&mut m, 60);
        assert_eq!(down(&mut m, 120), act(START_FREE));
        assert_eq!(m.tick(2_000), None);
        assert_eq!(up(&mut m, 3_000), Output::NONE);
        assert_eq!(m.mode(), Some(Mode::HandsFree));
    }

    #[test]
    fn hands_free_can_restart_after_stop() {
        let mut m = machine();
        hands_free(&mut m, 0);
        down(&mut m, 3_000);
        up(&mut m, 3_060);
        hands_free(&mut m, 6_000);
        assert!(m.capturing());
    }

    #[test]
    fn triple_tap_starts_then_stops() {
        let mut m = machine();
        down(&mut m, 0);
        up(&mut m, 60);
        assert_eq!(down(&mut m, 120), act(START_FREE));
        assert_eq!(up(&mut m, 180), Output::NONE);
        assert_eq!(down(&mut m, 240), act(Action::Stop));
        assert_eq!(up(&mut m, 300), Output::NONE);
        assert!(!m.capturing());
    }

    // ---- noise ----------------------------------------------------------------------

    #[test]
    fn auto_repeat_down_is_suppressed_while_pending() {
        let mut m = machine();
        down(&mut m, 0);
        for t in [30, 60, 90, 120, 150] {
            assert_eq!(down(&mut m, t), Output::NONE);
        }
        // Repeats must not restart the hold timer.
        assert_eq!(m.tick(250), Some(START_HOLD));
    }

    #[test]
    fn auto_repeat_down_is_suppressed_while_holding() {
        let mut m = machine();
        holding(&mut m, 0);
        for t in [300, 330, 360, 5_000] {
            assert_eq!(down(&mut m, t), Output::NONE);
        }
        assert_eq!(m.mode(), Some(Mode::Hold));
        assert_eq!(up(&mut m, 6_000), act(Action::Stop));
    }

    #[test]
    fn auto_repeat_while_hands_free_stop_press_is_suppressed() {
        let mut m = machine();
        hands_free(&mut m, 0);
        assert_eq!(down(&mut m, 5_000), act(Action::Stop));
        assert_eq!(down(&mut m, 5_030), Output::NONE);
        assert_eq!(down(&mut m, 5_060), Output::NONE);
        assert_eq!(up(&mut m, 5_100), Output::NONE);
        assert!(!m.capturing());
    }

    #[test]
    fn auto_repeat_on_second_press_does_not_toggle_off() {
        let mut m = machine();
        down(&mut m, 0);
        up(&mut m, 60);
        assert_eq!(down(&mut m, 120), act(START_FREE));
        for t in [150, 180, 210, 240] {
            assert_eq!(down(&mut m, t), Output::NONE);
        }
        assert_eq!(m.mode(), Some(Mode::HandsFree));
    }

    #[test]
    fn duplicate_release_is_ignored() {
        let mut m = machine();
        holding(&mut m, 0);
        assert_eq!(up(&mut m, 500), act(Action::Stop));
        assert_eq!(up(&mut m, 505), Output::NONE);
        assert_eq!(up(&mut m, 900), Output::NONE);
    }

    #[test]
    fn release_without_press_is_ignored() {
        let mut m = machine();
        assert_eq!(up(&mut m, 10), Output::NONE);
        assert!(!m.capturing());
        assert!(!m.needs_tick());
    }

    #[test]
    fn contact_bounce_after_release_does_not_start_a_second_tap() {
        let mut m = machine();
        down(&mut m, 0);
        up(&mut m, 80);
        // Bounce: down at +5 ms, up at +8 ms.
        assert_eq!(down(&mut m, 85), Output::NONE);
        assert_eq!(up(&mut m, 88), Output::NONE);
        assert!(!m.capturing());
        // A real second tap shortly after still works.
        assert_eq!(down(&mut m, 200), act(START_FREE));
    }

    #[test]
    fn bounce_after_hold_release_does_not_start_anything() {
        let mut m = machine();
        holding(&mut m, 0);
        assert_eq!(up(&mut m, 500), act(Action::Stop));
        assert_eq!(down(&mut m, 505), Output::NONE);
        assert_eq!(up(&mut m, 510), Output::NONE);
        assert!(!m.capturing());
        assert!(!m.needs_tick());
    }

    #[test]
    fn bounce_after_hands_free_start_release_does_not_toggle_off() {
        let mut m = machine();
        down(&mut m, 0);
        up(&mut m, 60);
        assert_eq!(down(&mut m, 120), act(START_FREE));
        assert_eq!(up(&mut m, 180), Output::NONE);
        assert_eq!(down(&mut m, 190), Output::NONE);
        assert_eq!(up(&mut m, 195), Output::NONE);
        assert_eq!(m.mode(), Some(Mode::HandsFree));
        // A real press later does stop it.
        assert_eq!(down(&mut m, 2_000), act(Action::Stop));
    }

    #[test]
    fn repeated_bounce_chain_is_suppressed() {
        let mut m = machine();
        holding(&mut m, 0);
        assert_eq!(up(&mut m, 500), act(Action::Stop));
        for i in 0..5 {
            let t = 505 + i * 6;
            assert_eq!(down(&mut m, t), Output::NONE);
            assert_eq!(up(&mut m, t + 3), Output::NONE);
        }
        assert!(!m.capturing());
    }

    #[test]
    fn too_short_press_is_noise_not_a_tap() {
        let mut m = machine();
        down(&mut m, 0);
        assert_eq!(up(&mut m, 5), Output::NONE);
        assert!(!m.needs_tick());
        // 100 ms later a real press must not count as a second tap (the first was noise).
        assert_eq!(down(&mut m, 100), Output::NONE);
        assert!(!m.capturing());
    }

    #[test]
    fn debounce_zero_disables_bounce_handling() {
        let mut m = DictationKeys::with_timing(Timing {
            debounce_ms: 0,
            ..Timing::default()
        });
        down(&mut m, 0);
        up(&mut m, 5);
        // 5 ms tap is a tap now and a press 1 ms later is a second tap.
        assert_eq!(down(&mut m, 6), act(START_FREE));
    }

    #[test]
    fn press_exactly_at_debounce_boundary_is_accepted() {
        let mut m = machine();
        down(&mut m, 0);
        up(&mut m, 60);
        assert_eq!(down(&mut m, 80), act(START_FREE));
    }

    #[test]
    fn other_key_during_pending_press_abandons_the_gesture() {
        let mut m = machine();
        down(&mut m, 0);
        assert_eq!(other(&mut m, 50), Output::NONE);
        // Held long enough, but it was a modifier combo: nothing starts.
        assert_eq!(m.tick(400), None);
        assert!(!m.capturing());
        assert_eq!(up(&mut m, 500), Output::NONE);
        assert!(!m.needs_tick());
        // The release did not arm a double tap.
        assert_eq!(down(&mut m, 600), Output::NONE);
        assert!(!m.capturing());
    }

    #[test]
    fn other_key_cancels_a_waiting_double_tap() {
        let mut m = machine();
        down(&mut m, 0);
        up(&mut m, 80);
        assert_eq!(other(&mut m, 150), Output::NONE);
        assert!(!m.needs_tick());
        assert_eq!(down(&mut m, 200), Output::NONE);
        assert!(!m.capturing());
    }

    #[test]
    fn other_key_during_capture_changes_nothing() {
        let mut m = machine();
        holding(&mut m, 0);
        assert_eq!(other(&mut m, 400), Output::NONE);
        assert_eq!(m.mode(), Some(Mode::Hold));
        let mut m = machine();
        hands_free(&mut m, 0);
        assert_eq!(other(&mut m, 400), Output::NONE);
        assert_eq!(m.mode(), Some(Mode::HandsFree));
    }

    #[test]
    fn other_key_release_is_ignored() {
        let mut m = machine();
        down(&mut m, 0);
        assert_eq!(m.handle(Event::KeyUp(Key::Other), 10), Output::NONE);
        assert_eq!(m.tick(250), Some(START_HOLD));
    }

    // ---- Esc ------------------------------------------------------------------------

    #[test]
    fn esc_when_idle_is_ignored_and_not_consumed() {
        let mut m = machine();
        assert_eq!(esc_down(&mut m, 0), Output::NONE);
        assert_eq!(esc_down(&mut m, 30), Output::NONE);
        assert_eq!(esc_up(&mut m, 60), Output::NONE);
    }

    #[test]
    fn esc_while_pending_or_tapped_is_ignored() {
        let mut m = machine();
        down(&mut m, 0);
        assert_eq!(esc_down(&mut m, 50), Output::NONE);
        esc_up(&mut m, 60);
        assert_eq!(m.tick(250), Some(START_HOLD));

        let mut m = machine();
        down(&mut m, 0);
        up(&mut m, 80);
        assert_eq!(esc_down(&mut m, 100), Output::NONE);
        assert_eq!(down(&mut m, 200), act(START_FREE));
    }

    #[test]
    fn esc_cancels_hold_and_is_consumed() {
        let mut m = machine();
        holding(&mut m, 0);
        assert_eq!(esc_down(&mut m, 400), CANCEL_CONSUMED);
        assert!(!m.capturing());
        // Releasing the key afterwards must not stop (nothing is running) nor re-arm.
        assert_eq!(up(&mut m, 600), Output::NONE);
        assert!(!m.needs_tick());
        // Esc release is consumed too.
        assert_eq!(esc_up(&mut m, 650), CONSUMED_ONLY);
    }

    #[test]
    fn esc_while_hold_key_still_down_does_not_restart_on_tick() {
        let mut m = machine();
        holding(&mut m, 0);
        esc_down(&mut m, 400);
        assert_eq!(m.tick(2_000), None);
        assert_eq!(m.tick(4_000), None);
        assert!(!m.capturing());
        assert_eq!(up(&mut m, 5_000), Output::NONE);
    }

    #[test]
    fn esc_cancels_hands_free() {
        let mut m = machine();
        hands_free(&mut m, 0);
        assert_eq!(esc_down(&mut m, 3_000), CANCEL_CONSUMED);
        assert!(!m.capturing());
        assert!(!m.needs_tick());
        // The next press is a fresh first press (the key is up, so no swallow).
        assert_eq!(down(&mut m, 4_000), Output::NONE);
        assert_eq!(m.tick(4_250), Some(START_HOLD));
    }

    #[test]
    fn esc_cancels_hands_free_while_second_press_is_down() {
        let mut m = machine();
        down(&mut m, 0);
        up(&mut m, 60);
        down(&mut m, 120);
        assert_eq!(esc_down(&mut m, 200).action, Some(Action::Cancel));
        assert_eq!(up(&mut m, 260), Output::NONE);
        assert!(!m.capturing());
    }

    #[test]
    fn esc_auto_repeats_and_release_are_consumed_once_cancelled() {
        let mut m = machine();
        hands_free(&mut m, 0);
        assert_eq!(esc_down(&mut m, 1_000), CANCEL_CONSUMED);
        for t in [1_030, 1_060, 1_090] {
            assert_eq!(esc_down(&mut m, t), CONSUMED_ONLY);
        }
        assert_eq!(esc_up(&mut m, 1_120), CONSUMED_ONLY);
        // The next Esc (idle) is not consumed again.
        assert_eq!(esc_down(&mut m, 2_000), Output::NONE);
        assert_eq!(esc_up(&mut m, 2_040), Output::NONE);
    }

    #[test]
    fn esc_held_from_before_capture_is_not_consumed() {
        let mut m = machine();
        // Esc pressed while idle (and forwarded to the app), then a capture starts.
        assert_eq!(esc_down(&mut m, 0), Output::NONE);
        hands_free(&mut m, 10);
        // Esc auto-repeat while it is physically still down must not cancel.
        assert_eq!(esc_down(&mut m, 300), Output::NONE);
        assert!(m.capturing());
        assert_eq!(esc_up(&mut m, 400), Output::NONE);
        // A fresh Esc press now does cancel.
        assert_eq!(esc_down(&mut m, 500), CANCEL_CONSUMED);
    }

    #[test]
    fn esc_after_stop_is_ignored() {
        let mut m = machine();
        holding(&mut m, 0);
        up(&mut m, 500);
        assert_eq!(esc_down(&mut m, 600), Output::NONE);
        assert_eq!(esc_up(&mut m, 650), Output::NONE);
    }

    #[test]
    fn esc_release_without_press_is_not_consumed() {
        let mut m = machine();
        assert_eq!(esc_up(&mut m, 0), Output::NONE);
    }

    #[test]
    fn consume_is_only_ever_true_for_esc() {
        let mut m = machine();
        let keys = [Key::Dictation, Key::PasteChord, Key::Other];
        let mut t = 0;
        for round in 0..200u64 {
            let key = keys[(round % 3) as usize];
            for ev in [Event::KeyDown(key), Event::KeyUp(key)] {
                t += 40;
                assert!(!m.handle(ev, t).consume);
            }
            m.tick(t + 10);
        }
    }

    // ---- paste again ----------------------------------------------------------------

    #[test]
    fn paste_again_when_idle_fires_and_is_not_consumed() {
        let mut m = machine();
        assert_eq!(chord_down(&mut m, 0), act(Action::PasteAgain));
        assert!(!m.capturing());
    }

    #[test]
    fn paste_again_can_fire_repeatedly_once_released() {
        let mut m = machine();
        for t in [0, 100, 5_000] {
            assert_eq!(chord_down(&mut m, t).action, Some(Action::PasteAgain));
            m.handle(Event::KeyUp(Key::PasteChord), t + 30);
        }
    }

    #[test]
    fn paste_again_auto_repeat_is_suppressed() {
        let mut m = machine();
        assert_eq!(chord_down(&mut m, 0).action, Some(Action::PasteAgain));
        for t in [30, 60, 90, 2_000] {
            assert_eq!(chord_down(&mut m, t), Output::NONE);
        }
        m.handle(Event::KeyUp(Key::PasteChord), 2_100);
        assert_eq!(chord_down(&mut m, 2_200).action, Some(Action::PasteAgain));
    }

    #[test]
    fn paste_again_is_ignored_while_capturing() {
        let mut m = machine();
        holding(&mut m, 0);
        assert_eq!(chord_down(&mut m, 400), Output::NONE);
        assert_eq!(m.mode(), Some(Mode::Hold));
        let mut m = machine();
        hands_free(&mut m, 0);
        assert_eq!(chord_down(&mut m, 400), Output::NONE);
        assert_eq!(m.mode(), Some(Mode::HandsFree));
    }

    #[test]
    fn paste_again_with_dictation_key_in_the_chord_does_not_start_a_hold() {
        let mut m = machine();
        down(&mut m, 0);
        assert_eq!(chord_down(&mut m, 100).action, Some(Action::PasteAgain));
        assert_eq!(m.tick(500), None);
        assert!(!m.capturing());
        assert_eq!(up(&mut m, 600), Output::NONE);
        assert!(!m.needs_tick());
    }

    #[test]
    fn paste_again_cancels_a_waiting_double_tap() {
        let mut m = machine();
        down(&mut m, 0);
        up(&mut m, 80);
        assert_eq!(chord_down(&mut m, 150).action, Some(Action::PasteAgain));
        assert_eq!(down(&mut m, 200), Output::NONE);
        assert!(!m.capturing());
    }

    // ---- clock ----------------------------------------------------------------------

    #[test]
    fn clock_rollback_counts_as_no_time_passed() {
        let mut m = machine();
        down(&mut m, 10_000);
        // Clock jumps back: the hold must not start early.
        assert_eq!(m.tick(5_000), None);
        assert_eq!(m.tick(0), None);
        assert!(!m.capturing());
    }

    #[test]
    fn clock_keeps_counting_after_a_rollback() {
        let mut m = machine();
        down(&mut m, 10_000);
        assert_eq!(m.tick(10_100), None); // 100 ms
        assert_eq!(m.tick(500), None); // rolled back: 0 ms added
        assert_eq!(m.tick(649), None); // +149 => 249 ms
        assert_eq!(m.tick(650), Some(START_HOLD)); // +1 => 250 ms
    }

    #[test]
    fn clock_rollback_between_taps_is_a_bounce_not_a_double_tap() {
        let mut m = machine();
        down(&mut m, 5_000);
        up(&mut m, 5_060);
        // Rollback: no time elapsed since the release, so this press is bounce.
        assert_eq!(down(&mut m, 100), Output::NONE);
        assert_eq!(up(&mut m, 150), Output::NONE);
        assert!(!m.capturing());
        // 200 ms of real time after the first tap: a genuine second tap still works.
        assert_eq!(down(&mut m, 300), act(START_FREE));
    }

    #[test]
    fn clock_rollback_does_not_extend_the_double_tap_window_forever() {
        let mut m = machine();
        down(&mut m, 5_000);
        up(&mut m, 5_060);
        assert_eq!(m.tick(100), None); // rollback: 0 ms
        assert_eq!(m.tick(500), None); // +400 ms since the release: expired
        assert!(!m.needs_tick());
        assert_eq!(down(&mut m, 600), Output::NONE);
        assert!(!m.capturing());
    }

    #[test]
    fn clock_rollback_during_hold_still_stops_on_release() {
        let mut m = machine();
        holding(&mut m, 10_000);
        assert_eq!(up(&mut m, 1), act(Action::Stop));
    }

    #[test]
    fn clock_rollback_cannot_turn_a_hold_into_a_tap_or_bounce_release() {
        let mut m = machine();
        down(&mut m, 10_000);
        // Release stamped before the press: zero elapsed, i.e. bounce, never a negative tap.
        assert_eq!(up(&mut m, 9_000), Output::NONE);
        assert!(!m.needs_tick());
    }

    #[test]
    fn same_timestamp_events_are_handled_in_order() {
        let mut m = machine();
        down(&mut m, 100);
        assert_eq!(m.tick(100), None);
        // Release at the same instant is a bounce (0 ms): ignored, not a tap.
        assert_eq!(up(&mut m, 100), Output::NONE);
        assert!(!m.needs_tick());
    }

    #[test]
    fn huge_timestamps_do_not_overflow() {
        let mut m = machine();
        down(&mut m, u64::MAX - 10);
        assert_eq!(m.tick(u64::MAX), None);
        assert_eq!(m.tick(u64::MAX), None);
        assert_eq!(up(&mut m, u64::MAX), Output::NONE);
        // Fresh machine near the limit still starts a hold (saturating arithmetic).
        let mut m = machine();
        down(&mut m, u64::MAX - 300);
        assert_eq!(m.tick(u64::MAX), Some(START_HOLD));
    }

    #[test]
    fn forward_jump_while_pending_starts_on_next_tick() {
        let mut m = machine();
        down(&mut m, 0);
        assert_eq!(m.tick(60_000), Some(START_HOLD));
    }

    // ---- rapid sequences ------------------------------------------------------------

    #[test]
    fn rapid_hold_release_hold_release() {
        let mut m = machine();
        holding(&mut m, 0);
        assert_eq!(up(&mut m, 300), act(Action::Stop));
        holding(&mut m, 400);
        assert_eq!(up(&mut m, 700), act(Action::Stop));
        assert!(!m.capturing());
    }

    #[test]
    fn hold_followed_quickly_by_double_tap() {
        let mut m = machine();
        holding(&mut m, 0);
        assert_eq!(up(&mut m, 300), act(Action::Stop));
        down(&mut m, 400);
        up(&mut m, 460);
        assert_eq!(down(&mut m, 520), act(START_FREE));
    }

    #[test]
    fn mashing_the_key_keeps_start_and_stop_balanced() {
        // Alternating down/up every 20 ms for 2 s: taps toggle hands-free on and off; every
        // Start is answered by a Stop and `capturing()` always agrees.
        let mut m = machine();
        let mut running = false;
        let mut t = 0;
        for _ in 0..50 {
            for o in [down(&mut m, t), up(&mut m, t + 20)] {
                match o.action {
                    Some(Action::Start { .. }) => {
                        assert!(!running, "start while running");
                        running = true;
                    }
                    Some(Action::Stop | Action::Cancel) => {
                        assert!(running, "stop while idle");
                        running = false;
                    }
                    _ => {}
                }
            }
            assert_eq!(m.tick(t + 30), None);
            assert_eq!(running, m.capturing());
            t += 40;
        }
    }

    #[test]
    fn random_walk_keeps_start_stop_balanced() {
        // Deterministic xorshift over every event kind, tick and `finished`; whatever the
        // order (including clock rollbacks), Start/Stop/Cancel alternate and `capturing()`
        // agrees with them.
        let mut m = machine();
        let mut state: u64 = 0x9E37_79B9_7F4A_7C15;
        let mut next = move || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state
        };
        let keys = [Key::Dictation, Key::Esc, Key::PasteChord, Key::Other];
        let mut t = 1_000u64;
        let mut running = false;
        for _ in 0..50_000 {
            t = t.wrapping_add(next() % 120);
            if next() % 50 == 0 {
                t = t.saturating_sub(500); // clock rollback
            }
            let (consume, action) = match next() % 10 {
                0 | 1 => {
                    let o = m.handle(Event::KeyDown(Key::Dictation), t);
                    (o.consume, o.action)
                }
                2 | 3 => {
                    let o = m.handle(Event::KeyUp(Key::Dictation), t);
                    (o.consume, o.action)
                }
                4 | 5 => (false, m.tick(t)),
                6 => {
                    let k = keys[(next() % 4) as usize];
                    let o = m.handle(Event::KeyDown(k), t);
                    assert!(!o.consume || k == Key::Esc);
                    (o.consume, o.action)
                }
                7 => {
                    let k = keys[(next() % 4) as usize];
                    let o = m.handle(Event::KeyUp(k), t);
                    assert!(!o.consume || k == Key::Esc);
                    (o.consume, o.action)
                }
                8 => {
                    if next() % 4 == 0 {
                        m.finished();
                        running = false;
                    }
                    (false, None)
                }
                _ => {
                    if next() % 20 == 0 && m.reset().is_some() {
                        assert!(running);
                        running = false;
                    }
                    (false, None)
                }
            };
            assert!(!consume || matches!(action, None | Some(Action::Cancel)));
            match action {
                Some(Action::Start { mode }) => {
                    assert!(!running);
                    running = true;
                    assert_eq!(m.mode(), Some(mode));
                }
                Some(Action::Stop | Action::Cancel) => {
                    assert!(running);
                    running = false;
                }
                Some(Action::PasteAgain) => assert!(!running),
                None => {}
            }
            assert_eq!(running, m.capturing());
        }
    }

    // ---- reset / finished -----------------------------------------------------------

    #[test]
    fn reset_cancels_a_running_capture() {
        let mut m = machine();
        holding(&mut m, 0);
        assert_eq!(m.reset(), Some(Action::Cancel));
        assert!(!m.capturing());
        // Key release after reset is a spurious release.
        assert_eq!(up(&mut m, 500), Output::NONE);
    }

    #[test]
    fn reset_cancels_hands_free() {
        let mut m = machine();
        hands_free(&mut m, 0);
        assert_eq!(m.reset(), Some(Action::Cancel));
        assert!(!m.capturing());
        assert_eq!(m.reset(), None);
    }

    #[test]
    fn reset_when_idle_returns_nothing_and_clears_pending_press() {
        let mut m = machine();
        down(&mut m, 0);
        assert_eq!(m.reset(), None);
        assert!(!m.needs_tick());
        assert_eq!(m.tick(1_000), None);
        // The machine works normally afterwards.
        holding(&mut m, 2_000);
    }

    #[test]
    fn reset_forgets_a_pending_double_tap() {
        let mut m = machine();
        down(&mut m, 0);
        up(&mut m, 80);
        m.reset();
        assert_eq!(down(&mut m, 150), Output::NONE);
        assert!(!m.capturing());
    }

    #[test]
    fn finished_ends_hands_free() {
        let mut m = machine();
        hands_free(&mut m, 0);
        m.finished();
        assert!(!m.capturing());
        assert_eq!(m.mode(), None);
        // The next press is a first press, not a stop.
        assert_eq!(down(&mut m, 5_000), Output::NONE);
        assert_eq!(m.tick(5_250), Some(START_HOLD));
    }

    #[test]
    fn finished_ends_hold_and_ignores_the_key_until_release() {
        let mut m = machine();
        holding(&mut m, 0);
        m.finished();
        assert!(!m.capturing());
        assert_eq!(m.tick(2_000), None);
        assert_eq!(up(&mut m, 3_000), Output::NONE);
        assert!(!m.capturing());
        assert!(!m.needs_tick());
        // And the next hold works.
        holding(&mut m, 4_000);
    }

    #[test]
    fn finished_while_second_press_of_hands_free_is_down() {
        let mut m = machine();
        down(&mut m, 0);
        up(&mut m, 60);
        assert_eq!(down(&mut m, 120), act(START_FREE));
        m.finished();
        assert!(!m.capturing());
        assert_eq!(up(&mut m, 200), Output::NONE);
        assert!(!m.capturing());
    }

    #[test]
    fn finished_when_not_capturing_changes_nothing() {
        let mut m = machine();
        down(&mut m, 0);
        m.finished();
        assert_eq!(m.tick(250), Some(START_HOLD));
        let mut m = machine();
        down(&mut m, 0);
        up(&mut m, 80);
        m.finished();
        assert_eq!(down(&mut m, 150), act(START_FREE));
    }

    #[test]
    fn finished_then_stray_stop_press_does_not_emit_stop() {
        let mut m = machine();
        hands_free(&mut m, 0);
        m.finished();
        // Nothing is running, so a release or Esc must not produce Stop/Cancel.
        assert_eq!(esc_down(&mut m, 1_000), Output::NONE);
        assert_eq!(up(&mut m, 1_100), Output::NONE);
    }

    // ---- custom timing ---------------------------------------------------------------

    #[test]
    fn custom_timing_is_honoured() {
        let mut m = DictationKeys::with_timing(Timing {
            hold_ms: 100,
            double_tap_ms: 200,
            debounce_ms: 10,
        });
        assert_eq!(m.timing().hold_ms, 100);
        down(&mut m, 0);
        assert_eq!(m.tick(99), None);
        assert_eq!(m.tick(100), Some(START_HOLD));
        up(&mut m, 150);
        down(&mut m, 300);
        up(&mut m, 350);
        assert_eq!(down(&mut m, 550), act(START_FREE));
    }

    #[test]
    fn default_timing_matches_the_spec() {
        let t = Timing::default();
        assert_eq!(t.hold_ms, 250);
        assert_eq!(t.double_tap_ms, 350);
        assert_eq!(t.debounce_ms, 20);
        assert_eq!(DictationKeys::default().timing(), t);
    }
}
