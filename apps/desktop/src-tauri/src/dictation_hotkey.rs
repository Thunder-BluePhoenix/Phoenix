// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Global keyboard listener for dictation: the platform seam under `dictation_keys`.
//!
//! This file only turns physical key events into [`Event`]s (see `dictation_keys`) and hands
//! them to a callback; the hold / double-tap / Esc logic lives in `dictation_keys`. Nothing
//! here starts at app launch, and no function in this file shows a permission prompt except
//! [`request_permission`], which the shell calls only when the user turns the hotkey on.
//! [`spawn_listener`] refuses to start (so it cannot prompt) while [`listen_permission`] is
//! [`Permission::Missing`].
//!
//! * **macOS**: an active `CGEventTap` (HID, head insert) on its own thread and `CFRunLoop`,
//!   for flagsChanged / keyDown / keyUp. Bare right Option / Fn / right Command / right
//!   Control are told apart by key code and the device-dependent flag bits. When the callback
//!   returns `true` for Esc the event is dropped, so it never reaches the
//!   focused app. Events posted by this process (the paste chord Phoenix itself sends) are
//!   ignored. Needs Input Monitoring plus Accessibility (an active tap).
//! * **Windows**: a `WH_KEYBOARD_LL` hook on its own thread with a message loop; right Ctrl
//!   only; injected events are ignored; a consumed event is swallowed.
//! * **Linux**: X11 only (XRecord through `libXtst`, loaded with `dlopen` so a system without
//!   it still starts); right Ctrl only. XRecord observes, it cannot consume, so the callback's
//!   return value is ignored there. Wayland has no global key capture: [`is_supported`] is
//!   `false`, [`spawn_listener`] returns an error, nothing pretends otherwise.
//!
//! Only Esc can be swallowed; a modifier press or release is never dropped, because that would
//! leave the operating system's modifier state inconsistent. The paste chord is never consumed.
//!
//! The callback runs synchronously on the listener thread (inside the OS hook: keep it quick,
//! never block) and must not drop the [`HotkeyListener`] it belongs to. A panic in it is
//! caught and counts as "do not swallow".

use crate::dictation_keys::{DictationKey, Event, PasteChord};
use std::sync::Arc;
use std::thread::JoinHandle;

/// Whether the operating system lets this app listen to global keys right now.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Permission {
    Granted,
    Missing,
}

/// Called for every decoded event; returns `true` to swallow the original event.
#[cfg_attr(
    not(any(target_os = "macos", target_os = "windows", target_os = "linux", test)),
    allow(dead_code)
)]
type Handler = dyn Fn(Event) -> bool + Send + Sync;

/// A running listener. Dropping it asks the OS hook and its thread to stop and waits when the
/// platform confirms that stop request. Never drop it from inside the callback.
#[must_use = "the listener stops when this is dropped"]
pub struct HotkeyListener {
    /// Asks the thread to stop; returns whether the stop request was accepted (only then is
    /// joining it guaranteed not to hang).
    stop: Option<Box<dyn FnOnce() -> bool + Send>>,
    thread: Option<JoinHandle<()>>,
}

impl HotkeyListener {
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    fn new(stop: Box<dyn FnOnce() -> bool + Send>, thread: JoinHandle<()>) -> Self {
        Self {
            stop: Some(stop),
            thread: Some(thread),
        }
    }
}

impl Drop for HotkeyListener {
    fn drop(&mut self) {
        let finished = self.stop.take().is_none_or(|stop| stop());
        if let Some(thread) = self.thread.take() {
            // A thread that did not confirm is detached rather than waited for forever. A
            // panicked thread has nothing left to clean up.
            if finished {
                let _ = thread.join();
            }
        }
    }
}

/// Whether global key listening can work on this system at all (no permission check).
pub fn is_supported() -> bool {
    platform::is_supported()
}

/// Whether the permissions the listener needs are granted. Never prompts. Always `Granted`
/// where the operating system has no such permission.
pub fn listen_permission() -> Permission {
    platform::listen_permission()
}

/// Asks the operating system for the permissions (this is what shows the prompts / opens
/// System Settings) and returns whether they are granted right now. The shell calls this only
/// after the user turned the hotkey on, never at app start.
pub fn request_permission() -> bool {
    platform::request_permission()
}

/// Starts listening and calls `on_event` for each key event that matters to dictation.
///
/// `key` is the configured dictation key (its press / release arrive as `Key::Dictation`),
/// `chord` the paste-again chord (its completion arrives as `Key::PasteChord`), Esc as
/// `Key::Esc`, every other key and modifier as `Key::Other`. The chord letter is matched by
/// physical key position on macOS and Windows and by the current keyboard map on X11.
///
/// Returning `true` from `on_event` swallows the original event (macOS and Windows; only
/// ever honoured for Esc). XRecord is observe-only, so cannot swallow events on Linux.
///
/// Fails (without prompting) when the key is not available on this system, when
/// [`listen_permission`] is `Missing`, when the system has no usable key capture, or when the
/// system refuses the hook.
pub fn spawn_listener(
    key: DictationKey,
    chord: PasteChord,
    on_event: impl Fn(Event) -> bool + Send + Sync + 'static,
) -> Result<HotkeyListener, String> {
    validate_key(key)?;
    if !is_supported() {
        return Err("Global keyboard listening is not available on this system".to_string());
    }
    if listen_permission() == Permission::Missing {
        return Err(
            "The dictation key needs permission to watch the keyboard; it has not been granted"
                .to_string(),
        );
    }
    platform::spawn(key, chord, Arc::new(on_event))
}

fn validate_key(key: DictationKey) -> Result<(), String> {
    if key.is_supported() {
        Ok(())
    } else {
        Err(format!(
            "The {} key cannot be used for dictation on this operating system",
            key.label()
        ))
    }
}

/// Runs the callback; a panic in it must not unwind into the operating system's hook, so it
/// counts as "do not swallow".
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
fn deliver(handler: &Handler, event: Event) -> bool {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| handler(event))).unwrap_or(false)
}

/// Platform-neutral decoding of physical key events into `dictation_keys` events. Pure, so it
/// is unit-tested on every OS.
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux", test))]
mod decode {
    use crate::dictation_keys::{DictationKey, Event, Key, Modifiers, PasteChord};

    #[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
    /// A physical key as the platform layer identified it.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum Physical {
        RightOption,
        Fn,
        RightCommand,
        RightControl,
        Esc,
        /// A letter or digit key (lower-case ASCII), for the paste chord.
        Char(char),
        /// Everything else, including the other modifiers.
        Other,
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct Decoded {
        pub event: Event,
        /// Whether a `true` answer from the callback may drop the original event. Only Esc:
        /// swallowing a modifier would desynchronise the OS modifier state, and the paste chord
        /// is never consumed.
        pub swallowable: bool,
    }

    #[derive(Debug)]
    pub struct Decoder {
        key: DictationKey,
        chord: PasteChord,
        dictation_down: bool,
        /// A modifier combo invalidates the bare gesture until that key is physically up.
        combo: bool,
        chord_down: Option<char>,
    }

    fn dictation_key_of(physical: Physical) -> Option<DictationKey> {
        match physical {
            Physical::RightOption => Some(DictationKey::RightOption),
            Physical::Fn => Some(DictationKey::Fn),
            Physical::RightCommand => Some(DictationKey::RightCommand),
            Physical::RightControl => Some(DictationKey::RightControl),
            _ => None,
        }
    }

    impl Decoder {
        pub fn new(key: DictationKey, chord: PasteChord) -> Self {
            Self {
                key,
                chord,
                dictation_down: false,
                combo: false,
                chord_down: None,
            }
        }

        /// `mods` is the set of modifiers held when the event happened (the platform's own
        /// view, either side of the keyboard).
        pub fn decode(&mut self, physical: Physical, pressed: bool, mods: Modifiers) -> Decoded {
            let key = match physical {
                Physical::Esc => Key::Esc,
                Physical::Char(c) if pressed && self.chord.matches(mods, c) => {
                    self.chord_down = Some(c);
                    Key::PasteChord
                }
                Physical::Char(c) if !pressed && self.chord_down == Some(c) => {
                    self.chord_down = None;
                    Key::PasteChord
                }
                Physical::Char(_) | Physical::Other => Key::Other,
                modifier => {
                    if dictation_key_of(modifier) == Some(self.key) {
                        let was_down = self.dictation_down;
                        // A bare press has exactly the selected modifier down, not another
                        // modifier making a shortcut. Fn has no public `Modifiers` bit, so
                        // `NONE` is its bare state.
                        let expected = match modifier {
                            Physical::RightOption => Modifiers::ALT,
                            Physical::RightCommand => Modifiers::META,
                            Physical::RightControl => Modifiers::CTRL,
                            Physical::Fn => Modifiers::NONE,
                            _ => unreachable!(),
                        };
                        if pressed && mods != expected {
                            // A modifier combo is noise, not a dictation press. Once a bare
                            // press becomes a combo, its release must still close the held
                            // dictation key; all further downs are Other until that release.
                            self.combo = true;
                            Key::Other
                        } else if pressed && self.combo {
                            Key::Other
                        } else if pressed {
                            self.dictation_down = true;
                            Key::Dictation
                        } else {
                            self.combo = false;
                            if was_down {
                                self.dictation_down = false;
                                Key::Dictation
                            } else {
                                Key::Other
                            }
                        }
                    } else {
                        Key::Other
                    }
                }
            };
            Decoded {
                event: if pressed {
                    Event::KeyDown(key)
                } else {
                    Event::KeyUp(key)
                },
                swallowable: key == Key::Esc,
            }
        }

        /// Releases that the listener would otherwise miss when the OS stops delivering events
        /// for a while (macOS disables a slow tap). No heap allocation in the tap callback.
        #[cfg(any(target_os = "macos", test))]
        pub fn release_all(&mut self) -> [Option<Event>; 2] {
            self.combo = false;
            [
                std::mem::take(&mut self.dictation_down).then_some(Event::KeyUp(Key::Dictation)),
                self.chord_down
                    .take()
                    .map(|_| Event::KeyUp(Key::PasteChord)),
            ]
        }
    }
}

/// macOS key codes and modifier flag bits, as pure functions (tested on every OS).
#[cfg(any(target_os = "macos", test))]
mod mac_keys {
    use super::decode::Physical;
    use crate::dictation_keys::Modifiers;

    pub const FLAG_ALPHA_SHIFT: u64 = 0x0001_0000;
    pub const FLAG_SHIFT: u64 = 0x0002_0000;
    pub const FLAG_CONTROL: u64 = 0x0004_0000;
    pub const FLAG_ALTERNATE: u64 = 0x0008_0000;
    pub const FLAG_COMMAND: u64 = 0x0010_0000;
    pub const FLAG_FN: u64 = 0x0080_0000;
    // Device-dependent bits (IOLLEvent.h NX_DEVICE*KEYMASK) tell the left key from the right.
    const DEV_LEFT_CONTROL: u64 = 0x0000_0001;
    const DEV_LEFT_SHIFT: u64 = 0x0000_0002;
    const DEV_RIGHT_SHIFT: u64 = 0x0000_0004;
    const DEV_LEFT_COMMAND: u64 = 0x0000_0008;
    const DEV_RIGHT_COMMAND: u64 = 0x0000_0010;
    const DEV_LEFT_ALTERNATE: u64 = 0x0000_0020;
    const DEV_RIGHT_ALTERNATE: u64 = 0x0000_0040;
    const DEV_RIGHT_CONTROL: u64 = 0x0000_2000;

    pub const KEY_ESCAPE: u16 = 53;
    pub const KEY_RIGHT_COMMAND: u16 = 54;
    pub const KEY_LEFT_COMMAND: u16 = 55;
    pub const KEY_LEFT_SHIFT: u16 = 56;
    pub const KEY_CAPS_LOCK: u16 = 57;
    pub const KEY_LEFT_OPTION: u16 = 58;
    pub const KEY_LEFT_CONTROL: u16 = 59;
    pub const KEY_RIGHT_SHIFT: u16 = 60;
    pub const KEY_RIGHT_OPTION: u16 = 61;
    pub const KEY_RIGHT_CONTROL: u16 = 62;
    pub const KEY_FN: u16 = 63;

    /// Letters and digits by their key position on an ANSI keyboard (the chord is matched by
    /// position, so it does not depend on the active input source).
    pub fn ansi_char(keycode: u16) -> Option<char> {
        Some(match keycode {
            0 => 'a',
            1 => 's',
            2 => 'd',
            3 => 'f',
            4 => 'h',
            5 => 'g',
            6 => 'z',
            7 => 'x',
            8 => 'c',
            9 => 'v',
            11 => 'b',
            12 => 'q',
            13 => 'w',
            14 => 'e',
            15 => 'r',
            16 => 'y',
            17 => 't',
            18 => '1',
            19 => '2',
            20 => '3',
            21 => '4',
            22 => '6',
            23 => '5',
            25 => '9',
            26 => '7',
            28 => '8',
            29 => '0',
            31 => 'o',
            32 => 'u',
            34 => 'i',
            35 => 'p',
            37 => 'l',
            38 => 'j',
            40 => 'k',
            45 => 'n',
            46 => 'm',
            _ => return None,
        })
    }

    pub fn physical(keycode: u16) -> Physical {
        match keycode {
            KEY_RIGHT_OPTION => Physical::RightOption,
            KEY_FN => Physical::Fn,
            KEY_RIGHT_COMMAND => Physical::RightCommand,
            KEY_RIGHT_CONTROL => Physical::RightControl,
            KEY_ESCAPE => Physical::Esc,
            other => ansi_char(other).map_or(Physical::Other, Physical::Char),
        }
    }

    /// For a flagsChanged event: whether the modifier named by `keycode` went down (`true`) or
    /// up. `None` when the key code is not a modifier.
    pub fn modifier_pressed(keycode: u16, flags: u64) -> Option<bool> {
        let bit = |mask: u64| flags & mask != 0;
        Some(match keycode {
            KEY_RIGHT_COMMAND => bit(DEV_RIGHT_COMMAND),
            KEY_LEFT_COMMAND => bit(DEV_LEFT_COMMAND),
            KEY_LEFT_SHIFT => bit(DEV_LEFT_SHIFT),
            KEY_RIGHT_SHIFT => bit(DEV_RIGHT_SHIFT),
            KEY_CAPS_LOCK => bit(FLAG_ALPHA_SHIFT),
            KEY_LEFT_OPTION => bit(DEV_LEFT_ALTERNATE),
            KEY_RIGHT_OPTION => bit(DEV_RIGHT_ALTERNATE),
            KEY_LEFT_CONTROL => bit(DEV_LEFT_CONTROL),
            KEY_RIGHT_CONTROL => bit(DEV_RIGHT_CONTROL),
            KEY_FN => bit(FLAG_FN),
            _ => return None,
        })
    }

    pub fn modifiers(flags: u64) -> Modifiers {
        [
            (FLAG_CONTROL, Modifiers::CTRL),
            (FLAG_ALTERNATE, Modifiers::ALT),
            (FLAG_SHIFT, Modifiers::SHIFT),
            (FLAG_COMMAND, Modifiers::META),
        ]
        .into_iter()
        .filter(|(flag, _)| flags & flag != 0)
        .fold(Modifiers::NONE, |acc, (_, m)| acc | m)
    }
}

/// Modifier tracking for platforms whose events do not carry a modifier mask (Windows low-level
/// hook, X11 XRecord keysyms). Pure; tested on every OS.
#[cfg(any(target_os = "windows", target_os = "linux", test))]
mod mod_tracker {
    use super::decode::{Decoded, Decoder, Physical};
    use crate::dictation_keys::Modifiers;

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum ModKey {
        LeftShift,
        RightShift,
        LeftCtrl,
        RightCtrl,
        LeftAlt,
        RightAlt,
        LeftMeta,
        RightMeta,
    }

    #[derive(Clone, Copy, Debug, Default)]
    pub struct ModTracker {
        bits: u8,
    }

    impl ModTracker {
        pub fn update(&mut self, key: ModKey, pressed: bool) {
            let bit = 1u8 << key as u8;
            if pressed {
                self.bits |= bit;
            } else {
                self.bits &= !bit;
            }
        }

        fn any(self, keys: [ModKey; 2]) -> bool {
            keys.iter().any(|&k| self.bits & (1u8 << k as u8) != 0)
        }

        pub fn modifiers(self) -> Modifiers {
            [
                ([ModKey::LeftCtrl, ModKey::RightCtrl], Modifiers::CTRL),
                ([ModKey::LeftAlt, ModKey::RightAlt], Modifiers::ALT),
                ([ModKey::LeftShift, ModKey::RightShift], Modifiers::SHIFT),
                ([ModKey::LeftMeta, ModKey::RightMeta], Modifiers::META),
            ]
            .into_iter()
            .filter(|&(keys, _)| self.any(keys))
            .fold(Modifiers::NONE, |acc, (_, m)| acc | m)
        }

        /// Updates the modifier state with `modifier` (if the key is one), then decodes the
        /// event with the resulting modifier set.
        pub fn step(
            &mut self,
            decoder: &mut Decoder,
            (physical, modifier): (Physical, Option<ModKey>),
            pressed: bool,
        ) -> Decoded {
            if let Some(modifier) = modifier {
                self.update(modifier, pressed);
            }
            decoder.decode(physical, pressed, self.modifiers())
        }
    }
}

/// X11 keysym and XRecord wire decoding (pure; tested on every OS).
#[cfg(any(target_os = "linux", test))]
mod x_keys {
    use super::decode::Physical;
    use super::mod_tracker::ModKey;

    /// What a keysym is: the key the decoder cares about plus, for modifiers, which one.
    pub fn classify(keysym: u64) -> (Physical, Option<ModKey>) {
        match keysym {
            0xff1b => (Physical::Esc, None),
            0xffe4 => (Physical::RightControl, Some(ModKey::RightCtrl)),
            0xffe3 => (Physical::Other, Some(ModKey::LeftCtrl)),
            0xffe1 => (Physical::Other, Some(ModKey::LeftShift)),
            0xffe2 => (Physical::Other, Some(ModKey::RightShift)),
            0xffe9 | 0xffe7 => (Physical::Other, Some(ModKey::LeftAlt)),
            0xffea | 0xffe8 => (Physical::Other, Some(ModKey::RightAlt)),
            0xffeb => (Physical::Other, Some(ModKey::LeftMeta)),
            0xffec => (Physical::Other, Some(ModKey::RightMeta)),
            0x30..=0x39 | 0x61..=0x7a => (Physical::Char(keysym as u8 as char), None),
            0x41..=0x5a => (Physical::Char((keysym as u8 + 32) as char), None),
            _ => (Physical::Other, None),
        }
    }

    /// A key press or release read from an XRecord `xEvent`.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct XKey {
        pub pressed: bool,
        pub keycode: u8,
    }

    /// `data` is the raw 32-byte core event: byte 0 type (2 KeyPress, 3 KeyRelease), byte 1
    /// the keycode. Synthetic SendEvent events have bit 7 set and are ignored (they are not a
    /// physical dictation key). Neither byte depends on byte order. `None` for anything else,
    /// including truncated data.
    pub fn parse_event(data: &[u8]) -> Option<XKey> {
        if data.len() < 32 {
            return None;
        }
        if data[0] & 0x80 != 0 {
            return None;
        }
        let pressed = match data[0] {
            2 => true,
            3 => false,
            _ => return None,
        };
        Some(XKey {
            pressed,
            keycode: data[1],
        })
    }

    /// X11 is the only supported session: Wayland (and anything without `DISPLAY`) cannot
    /// observe global keys, and XWayland only shows keys typed into X11 clients, so the
    /// listener would silently miss most input there.
    pub fn session_supported(
        session_type: Option<&str>,
        wayland_display: Option<&str>,
        display: Option<&str>,
    ) -> bool {
        let wayland = session_type.is_some_and(|t| t.eq_ignore_ascii_case("wayland"))
            || wayland_display.is_some_and(|d| !d.is_empty());
        !wayland && display.is_some_and(|d| !d.is_empty())
    }
}

/// Windows virtual-key decoding (pure; tested on every OS).
#[cfg(any(target_os = "windows", test))]
mod win_keys {
    use super::decode::Physical;
    use super::mod_tracker::ModKey;

    pub fn classify(vk: u32) -> (Physical, Option<ModKey>) {
        match vk {
            0x1b => (Physical::Esc, None),
            0xa3 => (Physical::RightControl, Some(ModKey::RightCtrl)),
            0xa2 => (Physical::Other, Some(ModKey::LeftCtrl)),
            0xa0 => (Physical::Other, Some(ModKey::LeftShift)),
            0xa1 => (Physical::Other, Some(ModKey::RightShift)),
            0xa4 => (Physical::Other, Some(ModKey::LeftAlt)),
            0xa5 => (Physical::Other, Some(ModKey::RightAlt)),
            0x5b => (Physical::Other, Some(ModKey::LeftMeta)),
            0x5c => (Physical::Other, Some(ModKey::RightMeta)),
            0x30..=0x39 => (Physical::Char(vk as u8 as char), None),
            0x41..=0x5a => (Physical::Char((vk as u8 + 32) as char), None),
            _ => (Physical::Other, None),
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::decode::Decoder;
    use super::{deliver, mac_keys, Handler, HotkeyListener, Permission};
    use crate::dictation_keys::{DictationKey, PasteChord};
    use core_foundation::base::TCFType;
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::runloop::{
        kCFRunLoopCommonModes, kCFRunLoopDefaultMode, CFRunLoop, CFRunLoopRunResult,
    };
    use core_foundation::string::CFString;
    use core_graphics::event::{
        CGEvent, CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement,
        CGEventTapProxy, CGEventType, CallbackResult, EventField,
    };
    use std::cell::RefCell;
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::{mpsc, Arc};
    use std::time::Duration;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventTapEnable(tap: *mut c_void, enable: bool);
        fn CGEventTapIsEnabled(tap: *mut c_void) -> bool;
    }

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
        static kAXTrustedCheckOptionPrompt: *const c_void;
    }

    extern "C" {
        fn dlsym(handle: *mut c_void, symbol: *const std::ffi::c_char) -> *mut c_void;
    }

    /// `RTLD_DEFAULT` on macOS: search every image already loaded in the process.
    const RTLD_DEFAULT: *mut c_void = -2isize as *mut c_void;

    type ListenAccessFn = unsafe extern "C" fn() -> bool;

    /// `CGPreflightListenEventAccess` / `CGRequestListenEventAccess` only exist from macOS 10.15.
    /// They are looked up at run time so the app still launches on older systems, where there
    /// is no Input Monitoring gate (`None`).
    fn listen_access_fn(name: &std::ffi::CStr) -> Option<ListenAccessFn> {
        // SAFETY: dlsym with a valid NUL-terminated name; a non-null result for these symbols
        // is a function taking no arguments and returning a C `bool`.
        unsafe {
            let symbol = dlsym(RTLD_DEFAULT, name.as_ptr());
            (!symbol.is_null()).then(|| std::mem::transmute::<*mut c_void, ListenAccessFn>(symbol))
        }
    }

    pub fn is_supported() -> bool {
        true
    }

    /// Input Monitoring (to see keys) and Accessibility (an active tap, needed to swallow Esc).
    /// Never prompts.
    pub fn listen_permission() -> Permission {
        let listen = listen_access_fn(c"CGPreflightListenEventAccess")
            // SAFETY: see `listen_access_fn`.
            .is_none_or(|preflight| unsafe { preflight() });
        // SAFETY: plain query without arguments.
        let accessibility = unsafe { AXIsProcessTrusted() };
        if listen && accessibility {
            Permission::Granted
        } else {
            Permission::Missing
        }
    }

    /// Shows the system prompts for both permissions. Both are asked every time (no short
    /// circuit), so the user is not sent back and forth.
    pub fn request_permission() -> bool {
        let listen = listen_access_fn(c"CGRequestListenEventAccess")
            // SAFETY: see `listen_access_fn`.
            .is_none_or(|request| unsafe { request() });
        // SAFETY: macOS exports a permanent CFStringRef. Retain it for the local dictionary.
        let prompt_key =
            unsafe { CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt.cast()) };
        let prompt = CFDictionary::from_CFType_pairs(&[(prompt_key, CFBoolean::true_value())]);
        // SAFETY: the options dictionary is alive for the call.
        let accessibility =
            unsafe { AXIsProcessTrustedWithOptions(prompt.as_concrete_TypeRef().cast()) };
        listen && accessibility
    }

    pub fn spawn(
        key: DictationKey,
        chord: PasteChord,
        handler: Arc<Handler>,
    ) -> Result<HotkeyListener, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let (ready_tx, ready_rx) = mpsc::channel::<Result<CFRunLoop, String>>();
        let thread_stop = Arc::clone(&stop);
        let thread = std::thread::Builder::new()
            .name("dictation-hotkey".to_string())
            .spawn(move || run(key, chord, handler, thread_stop, ready_tx))
            .map_err(|e| format!("Could not start the dictation key listener: {e}"))?;
        match ready_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(run_loop)) => Ok(HotkeyListener::new(
                Box::new(move || {
                    stop.store(true, Ordering::SeqCst);
                    run_loop.stop();
                    true
                }),
                thread,
            )),
            Ok(Err(message)) => {
                let _ = thread.join();
                Err(message)
            }
            Err(_) => {
                // The thread is detached; it exits as soon as it notices the flag.
                stop.store(true, Ordering::SeqCst);
                Err("The dictation key listener did not start".to_string())
            }
        }
    }

    fn run(
        key: DictationKey,
        chord: PasteChord,
        handler: Arc<Handler>,
        stop: Arc<AtomicBool>,
        ready: mpsc::Sender<Result<CFRunLoop, String>>,
    ) {
        let tap_port = Arc::new(AtomicUsize::new(0));
        let callback_port = Arc::clone(&tap_port);
        let decoder = RefCell::new(Decoder::new(key, chord));
        let own_pid = i64::from(std::process::id());
        // An active (not listen-only) HID tap, so the callback can drop Esc.
        let tap = CGEventTap::new(
            CGEventTapLocation::HID,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::Default,
            vec![
                CGEventType::KeyDown,
                CGEventType::KeyUp,
                CGEventType::FlagsChanged,
            ],
            move |_proxy: CGEventTapProxy, kind: CGEventType, event: &CGEvent| {
                on_event(&*handler, &decoder, &callback_port, own_pid, kind, event)
            },
        );
        let Ok(tap) = tap else {
            let _ = ready.send(Err(
                "macOS refused the keyboard event tap: Input Monitoring or Accessibility \
                 permission is missing"
                    .to_string(),
            ));
            return;
        };
        tap_port.store(
            tap.mach_port().as_concrete_TypeRef() as usize,
            Ordering::SeqCst,
        );
        let Ok(source) = tap.mach_port().create_runloop_source(0) else {
            let _ = ready.send(Err(
                "Could not attach the keyboard event tap to a run loop".to_string()
            ));
            return;
        };
        let run_loop = CFRunLoop::get_current();
        // SAFETY: reading an immutable CoreFoundation constant.
        run_loop.add_source(&source, unsafe { kCFRunLoopCommonModes });
        tap.enable();
        // SAFETY: `tap` owns this live port. A denied/disabled tap must not masquerade as
        // successful global listening.
        if !unsafe { CGEventTapIsEnabled(tap.mach_port().as_concrete_TypeRef().cast()) } {
            let _ = ready.send(Err(
                "macOS did not enable the keyboard event tap".to_string()
            ));
            return;
        }
        if ready.send(Ok(run_loop.clone())).is_err() {
            return;
        }
        while !stop.load(Ordering::SeqCst) {
            // The timeout bounds how long a stop request can go unnoticed if `CFRunLoopStop`
            // arrives before the loop is running.
            // SAFETY: reading an immutable CoreFoundation constant.
            let result = CFRunLoop::run_in_mode(
                unsafe { kCFRunLoopDefaultMode },
                Duration::from_millis(250),
                false,
            );
            if result == CFRunLoopRunResult::Finished {
                std::thread::sleep(Duration::from_millis(50));
            }
        }
        // SAFETY: reading an immutable CoreFoundation constant.
        run_loop.remove_source(&source, unsafe { kCFRunLoopCommonModes });
        drop(tap);
    }

    fn on_event(
        handler: &Handler,
        decoder: &RefCell<Decoder>,
        tap_port: &AtomicUsize,
        own_pid: i64,
        kind: CGEventType,
        event: &CGEvent,
    ) -> CallbackResult {
        match kind {
            CGEventType::TapDisabledByTimeout | CGEventType::TapDisabledByUserInput => {
                // macOS switched the tap off (callback too slow, or secure input): key-ups
                // may have been missed, so release what is held and switch the tap back on.
                let released = decoder.borrow_mut().release_all();
                for event in released.into_iter().flatten() {
                    deliver(handler, event);
                }
                let port = tap_port.load(Ordering::SeqCst);
                if port != 0 {
                    // SAFETY: the port belongs to the tap that is still alive on this thread.
                    unsafe { CGEventTapEnable(port as *mut c_void, true) };
                }
                return CallbackResult::Keep;
            }
            CGEventType::KeyDown | CGEventType::KeyUp | CGEventType::FlagsChanged => {}
            _ => return CallbackResult::Keep,
        }
        // The paste chord Phoenix posts itself must not look like typing.
        if event.get_integer_value_field(EventField::EVENT_SOURCE_UNIX_PROCESS_ID) == own_pid {
            return CallbackResult::Keep;
        }
        let Ok(keycode) =
            u16::try_from(event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE))
        else {
            return CallbackResult::Keep;
        };
        let flags = event.get_flags().bits();
        let pressed = match kind {
            CGEventType::KeyDown => true,
            CGEventType::KeyUp => false,
            _ => match mac_keys::modifier_pressed(keycode, flags) {
                Some(pressed) => pressed,
                None => return CallbackResult::Keep,
            },
        };
        let decoded = decoder.borrow_mut().decode(
            mac_keys::physical(keycode),
            pressed,
            mac_keys::modifiers(flags),
        );
        if deliver(handler, decoded.event) && decoded.swallowable {
            CallbackResult::Drop
        } else {
            CallbackResult::Keep
        }
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::decode::Decoder;
    use super::mod_tracker::ModTracker;
    use super::{deliver, x_keys, Handler, HotkeyListener, Permission};
    use crate::dictation_keys::{DictationKey, PasteChord};
    use std::ffi::{c_char, c_int, c_ulong, c_void};
    use std::ptr;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{mpsc, Arc};
    use std::time::Duration;
    use x11_dl::xlib::{self, Xlib};
    use x11_dl::xrecord::{
        XRecordAllClients, XRecordFromServer, XRecordInterceptData, XRecordRange,
        Xf86vmode as XRecordLib,
    };

    /// `KeyPress` and `KeyRelease` are core event types 2 and 3.
    const KEY_PRESS: u8 = 2;
    const KEY_RELEASE: u8 = 3;

    /// `poll(2)` waits for XRecord replies without blocking forever; XPending only counts
    /// ordinary X events and can miss RECORD's reply packets entirely.
    #[repr(C)]
    struct PollFd {
        fd: c_int,
        events: i16,
        revents: i16,
    }

    extern "C" {
        fn poll(fds: *mut PollFd, nfds: usize, timeout_ms: c_int) -> c_int;
    }

    const POLLIN: i16 = 0x0001;
    const POLLERR: i16 = 0x0008;
    const POLLHUP: i16 = 0x0010;

    fn session_ok() -> bool {
        let var = |name: &str| std::env::var(name).ok();
        x_keys::session_supported(
            var("XDG_SESSION_TYPE").as_deref(),
            var("WAYLAND_DISPLAY").as_deref(),
            var("DISPLAY").as_deref(),
        )
    }

    /// Both libraries load (no link-time dependency: a machine without libXtst still starts).
    fn libraries() -> Result<(Xlib, XRecordLib), String> {
        let x = Xlib::open().map_err(|e| format!("libX11 is not available: {e}"))?;
        let record = XRecordLib::open().map_err(|e| format!("libXtst is not available: {e}"))?;
        Ok((x, record))
    }

    pub fn is_supported() -> bool {
        session_ok() && libraries().is_ok()
    }

    /// X11 has no permission gate for observing keys.
    pub fn listen_permission() -> Permission {
        Permission::Granted
    }

    pub fn request_permission() -> bool {
        true
    }

    /// Both X11 connections, their XRecord context and the keyboard map live on the listener
    /// thread. Stop only writes an atomic flag; it never touches Xlib from another thread.
    struct Control {
        x: Xlib,
        record: XRecordLib,
        display: *mut xlib::Display,
        context: c_ulong,
    }

    /// What the XRecord callback needs; lives on the listener thread's stack.
    struct CallbackState {
        free_data: unsafe extern "C" fn(*mut XRecordInterceptData),
        handler: Arc<Handler>,
        decoder: Decoder,
        tracker: ModTracker,
        keymap: Vec<c_ulong>,
        first_keycode: u8,
        keysyms_per_keycode: usize,
    }

    impl CallbackState {
        fn keysym(&self, keycode: u8) -> u64 {
            let Some(index) = usize::from(keycode).checked_sub(usize::from(self.first_keycode))
            else {
                return 0;
            };
            self.keymap
                .get(index * self.keysyms_per_keycode)
                .copied()
                .unwrap_or(0)
        }
    }

    pub fn spawn(
        key: DictationKey,
        chord: PasteChord,
        handler: Arc<Handler>,
    ) -> Result<HotkeyListener, String> {
        if !session_ok() {
            return Err(
                "Global keys can only be watched in an X11 session; this is Wayland or has no \
                 display"
                    .to_string(),
            );
        }
        let stop = Arc::new(AtomicBool::new(false));
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
        let thread_stop = Arc::clone(&stop);
        let thread = std::thread::Builder::new()
            .name("dictation-hotkey".to_string())
            .spawn(move || run(key, chord, handler, thread_stop, ready_tx))
            .map_err(|e| format!("Could not start the dictation key listener: {e}"))?;
        match ready_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(())) => Ok(HotkeyListener::new(
                Box::new(move || {
                    stop.store(true, Ordering::SeqCst);
                    true
                }),
                thread,
            )),
            Ok(Err(message)) => {
                let _ = thread.join();
                Err(message)
            }
            Err(_) => {
                stop.store(true, Ordering::SeqCst);
                Err("The dictation key listener did not start".to_string())
            }
        }
    }

    fn run(
        key: DictationKey,
        chord: PasteChord,
        handler: Arc<Handler>,
        stop: Arc<AtomicBool>,
        ready: mpsc::Sender<Result<(), String>>,
    ) {
        // SAFETY: X connections and XRecord state are opened and used only on this thread.
        let setup = unsafe { setup(key, chord, handler) };
        let (control, data_display, mut state) = match setup {
            Ok(parts) => parts,
            Err(message) => {
                let _ = ready.send(Err(message));
                return;
            }
        };
        // XRecordEnableContextAsync starts monitoring without blocking. Poll the data
        // connection for replies (XPending does not count RECORD replies), with a bounded
        // timeout so RAII stop completes even when the X server is idle.
        // SAFETY: all X connection and state pointers remain alive until teardown below.
        unsafe {
            let ok = (control.record.XRecordEnableContextAsync)(
                data_display,
                control.context,
                Some(on_record_data),
                (&mut *state as *mut CallbackState).cast::<c_char>(),
            );
            if ok == 0 {
                let _ = ready.send(Err("Could not start X11 RECORD listening".to_string()));
                teardown(&control, data_display);
                return;
            }
            // Flush the async enable request before reporting success.
            (control.x.XFlush)(data_display);
            if ready.send(Ok(())).is_err() {
                teardown(&control, data_display);
                return;
            }
            let mut fd = PollFd {
                fd: (control.x.XConnectionNumber)(data_display),
                events: POLLIN,
                revents: 0,
            };
            while !stop.load(Ordering::SeqCst) {
                fd.revents = 0;
                let count = poll(&mut fd, 1, 50);
                if count < 0 {
                    break;
                }
                if count > 0 {
                    if fd.revents & (POLLERR | POLLHUP) != 0 {
                        break;
                    }
                    if fd.revents & POLLIN != 0 {
                        (control.record.XRecordProcessReplies)(data_display);
                    }
                }
            }
            (control.record.XRecordDisableContext)(control.display, control.context);
            (control.x.XSync)(control.display, 0);
            teardown(&control, data_display);
        }
    }

    type Setup = (Control, *mut xlib::Display, Box<CallbackState>);

    /// Opens two connections (one to receive XRecord data and one for control requests),
    /// creates the context for key press / release and snapshots the keyboard map.
    ///
    /// # Safety
    /// Must run on the listener thread.
    unsafe fn setup(
        key: DictationKey,
        chord: PasteChord,
        handler: Arc<Handler>,
    ) -> Result<Setup, String> {
        let (x, record) = libraries()?;
        let control_display = (x.XOpenDisplay)(ptr::null());
        let data_display = (x.XOpenDisplay)(ptr::null());
        let fail = |message: &str, displays: &[*mut xlib::Display]| {
            for &display in displays {
                if !display.is_null() {
                    (x.XCloseDisplay)(display);
                }
            }
            Err(message.to_string())
        };
        if control_display.is_null() || data_display.is_null() {
            return fail(
                "Could not connect to the X server",
                &[control_display, data_display],
            );
        }
        let (mut major, mut minor) = (0 as c_int, 0 as c_int);
        if (record.XRecordQueryVersion)(control_display, &mut major, &mut minor) == 0 {
            return fail(
                "The X server has no RECORD extension, so global keys cannot be watched",
                &[control_display, data_display],
            );
        }
        let range = (record.XRecordAllocRange)();
        if range.is_null() {
            return fail(
                "Could not allocate the X record range",
                &[control_display, data_display],
            );
        }
        let range_ref: &mut XRecordRange = &mut *range;
        range_ref.device_events.first = KEY_PRESS;
        range_ref.device_events.last = KEY_RELEASE;
        let mut clients: c_ulong = XRecordAllClients;
        let mut ranges = [range];
        let context = (record.XRecordCreateContext)(
            control_display,
            0,
            &mut clients,
            1,
            ranges.as_mut_ptr(),
            1,
        );
        (x.XFree)(range.cast::<c_void>());
        if context == 0 {
            return fail(
                "Could not create the X record context",
                &[control_display, data_display],
            );
        }
        (x.XSync)(control_display, 0);

        let (mut min, mut max) = (0 as c_int, 0 as c_int);
        (x.XDisplayKeycodes)(control_display, &mut min, &mut max);
        let count = max - min + 1;
        if count <= 0 || u8::try_from(min).is_err() {
            (record.XRecordFreeContext)(control_display, context);
            return fail(
                "The X keyboard map is invalid",
                &[control_display, data_display],
            );
        }
        let mut per_keycode: c_int = 0;
        let mapping = (x.XGetKeyboardMapping)(control_display, min as u8, count, &mut per_keycode);
        if mapping.is_null() || per_keycode <= 0 || count <= 0 {
            if !mapping.is_null() {
                (x.XFree)(mapping.cast::<c_void>());
            }
            (record.XRecordFreeContext)(control_display, context);
            return fail(
                "Could not read the X keyboard map",
                &[control_display, data_display],
            );
        }
        let per = per_keycode as usize;
        let len = count as usize * per;
        let keymap = std::slice::from_raw_parts(mapping, len).to_vec();
        (x.XFree)(mapping.cast::<c_void>());

        let state = Box::new(CallbackState {
            free_data: record.XRecordFreeData,
            handler,
            decoder: Decoder::new(key, chord),
            tracker: ModTracker::default(),
            keymap,
            first_keycode: min as u8,
            keysyms_per_keycode: per,
        });
        let control = Control {
            x,
            record,
            display: control_display,
            context,
        };
        Ok((control, data_display, state))
    }

    /// Frees the context and closes both connections.
    ///
    /// # Safety
    /// Listener thread only, after disabling the context (or when enabling failed).
    unsafe fn teardown(control: &Control, data_display: *mut xlib::Display) {
        (control.record.XRecordFreeContext)(control.display, control.context);
        (control.x.XCloseDisplay)(data_display);
        (control.x.XCloseDisplay)(control.display);
    }

    /// XRecord data callback, on the listener thread.
    ///
    /// # Safety
    /// Called by libXtst with the closure pointer given to `XRecordEnableContextAsync` and a
    /// block that must be released with `XRecordFreeData`.
    unsafe extern "C" fn on_record_data(closure: *mut c_char, data: *mut XRecordInterceptData) {
        if closure.is_null() || data.is_null() {
            return;
        }
        let state = &mut *closure.cast::<CallbackState>();
        let intercept = &*data;
        if intercept.category == XRecordFromServer && !intercept.data.is_null() {
            let bytes = std::slice::from_raw_parts(
                intercept.data,
                (intercept.data_len as usize).saturating_mul(4),
            );
            // XRecord can pack multiple 32-byte core events in one data block. Decode all of
            // them rather than silently dropping key-up events behind the first key-down.
            for bytes in bytes.chunks_exact(32) {
                if let Some(event) = x_keys::parse_event(bytes) {
                    let keysym = state.keysym(event.keycode);
                    let classified = x_keys::classify(keysym);
                    let decoded = state
                        .tracker
                        .step(&mut state.decoder, classified, event.pressed);
                    // X11 cannot swallow events; the answer is ignored.
                    deliver(&*state.handler, decoded.event);
                }
            }
        }
        (state.free_data)(data);
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::decode::Decoder;
    use super::mod_tracker::ModTracker;
    use super::{deliver, win_keys, Handler, HotkeyListener, Permission};
    use crate::dictation_keys::{DictationKey, PasteChord};
    use std::cell::RefCell;
    use std::sync::{mpsc, Arc};
    use std::time::Duration;
    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, PeekMessageW, PostThreadMessageW,
        SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx, HC_ACTION, KBDLLHOOKSTRUCT,
        LLKHF_EXTENDED, LLKHF_INJECTED, LLKHF_LOWER_IL_INJECTED, MSG, PM_NOREMOVE, WH_KEYBOARD_LL,
        WM_KEYDOWN, WM_KEYUP, WM_QUIT, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    pub fn is_supported() -> bool {
        true
    }

    /// Windows has no permission gate for a low-level keyboard hook.
    pub fn listen_permission() -> Permission {
        Permission::Granted
    }

    pub fn request_permission() -> bool {
        true
    }

    struct HookState {
        handler: Arc<Handler>,
        decoder: Decoder,
        tracker: ModTracker,
    }

    thread_local! {
        /// The hook procedure has no user-data pointer; it runs on the thread that installed
        /// the hook, so its state lives here.
        static STATE: RefCell<Option<HookState>> = const { RefCell::new(None) };
    }

    pub fn spawn(
        key: DictationKey,
        chord: PasteChord,
        handler: Arc<Handler>,
    ) -> Result<HotkeyListener, String> {
        let (ready_tx, ready_rx) = mpsc::channel::<Result<u32, String>>();
        let thread = std::thread::Builder::new()
            .name("dictation-hotkey".to_string())
            .spawn(move || run(key, chord, handler, ready_tx))
            .map_err(|e| format!("Could not start the dictation key listener: {e}"))?;
        match ready_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(thread_id)) => Ok(HotkeyListener::new(
                Box::new(move || {
                    // SAFETY: posting a thread message has no memory-safety preconditions.
                    unsafe { PostThreadMessageW(thread_id, WM_QUIT, WPARAM(0), LPARAM(0)) }.is_ok()
                }),
                thread,
            )),
            Ok(Err(message)) => {
                let _ = thread.join();
                Err(message)
            }
            Err(_) => Err("The dictation key listener did not start".to_string()),
        }
    }

    fn run(
        key: DictationKey,
        chord: PasteChord,
        handler: Arc<Handler>,
        ready: mpsc::Sender<Result<u32, String>>,
    ) {
        STATE.with(|state| {
            *state.borrow_mut() = Some(HookState {
                handler,
                decoder: Decoder::new(key, chord),
                tracker: ModTracker::default(),
            });
        });
        // SAFETY: the hook procedure is a plain function; the hook lives on this thread, which
        // pumps messages below (a low-level hook only works on a thread with a message loop).
        let hook = match unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), None, 0) } {
            Ok(hook) => hook,
            Err(e) => {
                let _ = ready.send(Err(format!("Windows refused the keyboard hook: {e}")));
                return;
            }
        };
        let mut msg = MSG::default();
        // SAFETY: creates this thread's message queue so `PostThreadMessageW` can reach it.
        unsafe {
            let _ = PeekMessageW(&mut msg, None, 0, 0, PM_NOREMOVE);
        }
        // SAFETY: plain query.
        let thread_id = unsafe { GetCurrentThreadId() };
        if ready.send(Ok(thread_id)).is_ok() {
            // SAFETY: standard message loop; GetMessageW returns 0 on WM_QUIT and -1 on error.
            unsafe {
                while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
        }
        // SAFETY: `hook` is the handle returned above.
        unsafe {
            let _ = UnhookWindowsHookEx(hook);
        }
        STATE.with(|state| *state.borrow_mut() = None);
    }

    unsafe extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        let pass = || CallNextHookEx(None, code, wparam, lparam);
        if code != HC_ACTION as i32 || lparam.0 == 0 {
            return pass();
        }
        // SAFETY: for HC_ACTION the system passes a valid KBDLLHOOKSTRUCT.
        let info = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        // Keys sent by software (including Phoenix's own paste chord) are not the user typing.
        if info.flags.contains(LLKHF_INJECTED) || info.flags.contains(LLKHF_LOWER_IL_INJECTED) {
            return pass();
        }
        let message = wparam.0 as u32;
        let pressed = match message {
            WM_KEYDOWN | WM_SYSKEYDOWN => true,
            WM_KEYUP | WM_SYSKEYUP => false,
            _ => return pass(),
        };
        // Some keyboards report generic VK_CONTROL, not VK_RCONTROL. The LL hook carries
        // the extended bit for right Control and no extended bit for left Control.
        let vk = if info.vkCode == 0x11 {
            if info.flags.contains(LLKHF_EXTENDED) {
                0xa3
            } else {
                0xa2
            }
        } else {
            info.vkCode
        };
        let swallow = STATE.with(|state| {
            // Re-entrancy (a message pumped inside the callback) just passes the key on.
            let Ok(mut guard) = state.try_borrow_mut() else {
                return false;
            };
            let Some(state) = guard.as_mut() else {
                return false;
            };
            let classified = win_keys::classify(vk);
            let decoded = state.tracker.step(&mut state.decoder, classified, pressed);
            deliver(&*state.handler, decoded.event) && decoded.swallowable
        });
        if swallow {
            LRESULT(1)
        } else {
            pass()
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
mod platform {
    use super::{Handler, HotkeyListener, Permission};
    use crate::dictation_keys::{DictationKey, PasteChord};
    use std::sync::Arc;

    pub fn is_supported() -> bool {
        false
    }

    pub fn listen_permission() -> Permission {
        Permission::Granted
    }

    pub fn request_permission() -> bool {
        false
    }

    pub fn spawn(
        _key: DictationKey,
        _chord: PasteChord,
        _handler: Arc<Handler>,
    ) -> Result<HotkeyListener, String> {
        Err("Global key listening is not available on this operating system".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::decode::{Decoder, Physical};
    use super::mac_keys;
    use super::mod_tracker::{ModKey, ModTracker};
    use super::win_keys;
    use super::x_keys;
    use super::{validate_key, Permission};
    use crate::dictation_keys::{DictationKey, Event, Key, Modifiers, PasteChord};

    fn key(decoder: &mut Decoder, physical: Physical, pressed: bool, mods: Modifiers) -> Event {
        decoder.decode(physical, pressed, mods).event
    }

    #[test]
    fn only_supported_keys_can_start_listener() {
        for key in DictationKey::supported() {
            assert!(validate_key(*key).is_ok(), "{}", key.label());
        }
        if !cfg!(target_os = "macos") {
            assert!(validate_key(DictationKey::Fn).is_err());
            assert!(validate_key(DictationKey::RightOption).is_err());
        }
    }

    #[test]
    fn permission_query_is_a_plain_result() {
        // The enum is deliberately a query result, not a request with side effects.
        assert_ne!(Permission::Granted, Permission::Missing);
    }

    #[test]
    fn decoder_passes_bare_press_and_release_without_swallowing_modifiers() {
        let mut decoder = Decoder::new(DictationKey::RightControl, PasteChord::default());
        let pressed = decoder.decode(Physical::RightControl, true, Modifiers::CTRL);
        assert_eq!(pressed.event, Event::KeyDown(Key::Dictation));
        assert!(!pressed.swallowable);
        let released = decoder.decode(Physical::RightControl, false, Modifiers::NONE);
        assert_eq!(released.event, Event::KeyUp(Key::Dictation));
        assert!(!released.swallowable);
        assert_eq!(decoder.release_all(), [None, None]);
    }

    #[test]
    fn decoder_distinguishes_bare_right_option_fn_command_and_control() {
        let cases = [
            (
                DictationKey::RightOption,
                Physical::RightOption,
                Modifiers::ALT,
            ),
            (DictationKey::Fn, Physical::Fn, Modifiers::NONE),
            (
                DictationKey::RightCommand,
                Physical::RightCommand,
                Modifiers::META,
            ),
            (
                DictationKey::RightControl,
                Physical::RightControl,
                Modifiers::CTRL,
            ),
        ];
        for (selected, physical, mods) in cases {
            let mut decoder = Decoder::new(selected, PasteChord::default());
            assert_eq!(
                key(&mut decoder, physical, true, mods),
                Event::KeyDown(Key::Dictation)
            );
            assert_eq!(
                key(&mut decoder, physical, false, Modifiers::NONE),
                Event::KeyUp(Key::Dictation)
            );
        }
    }

    #[test]
    fn a_modifier_combo_is_other_not_dictation() {
        let mut decoder = Decoder::new(DictationKey::RightOption, PasteChord::default());
        assert_eq!(
            key(
                &mut decoder,
                Physical::RightOption,
                true,
                Modifiers::ALT | Modifiers::META
            ),
            Event::KeyDown(Key::Other)
        );
        assert_eq!(
            key(&mut decoder, Physical::RightOption, false, Modifiers::META),
            Event::KeyUp(Key::Other)
        );
        assert_eq!(decoder.release_all(), [None, None]);
        assert_eq!(
            key(&mut decoder, Physical::RightOption, true, Modifiers::ALT),
            Event::KeyDown(Key::Dictation)
        );
        assert_eq!(
            key(&mut decoder, Physical::Other, true, Modifiers::ALT),
            Event::KeyDown(Key::Other)
        );
        assert_eq!(
            key(&mut decoder, Physical::RightOption, false, Modifiers::NONE),
            Event::KeyUp(Key::Dictation)
        );
    }

    #[test]
    fn esc_is_the_only_event_that_may_be_swallowed() {
        let mut decoder = Decoder::new(DictationKey::Fn, PasteChord::default());
        for pressed in [true, false] {
            assert!(
                decoder
                    .decode(Physical::Esc, pressed, Modifiers::NONE)
                    .swallowable
            );
            assert!(
                !decoder
                    .decode(Physical::Fn, pressed, Modifiers::NONE)
                    .swallowable
            );
            assert!(
                !decoder
                    .decode(Physical::Other, pressed, Modifiers::NONE)
                    .swallowable
            );
        }
    }

    #[test]
    fn paste_chord_uses_exact_modifiers_and_pairs_its_release() {
        let chord = PasteChord::new(Modifiers::CTRL | Modifiers::ALT, 'v').unwrap();
        let mut decoder = Decoder::new(DictationKey::RightControl, chord);
        assert_eq!(
            key(&mut decoder, Physical::Char('v'), true, Modifiers::CTRL),
            Event::KeyDown(Key::Other)
        );
        assert_eq!(
            key(
                &mut decoder,
                Physical::Char('v'),
                true,
                Modifiers::CTRL | Modifiers::ALT | Modifiers::SHIFT
            ),
            Event::KeyDown(Key::Other)
        );
        assert_eq!(
            key(
                &mut decoder,
                Physical::Char('v'),
                true,
                Modifiers::CTRL | Modifiers::ALT
            ),
            Event::KeyDown(Key::PasteChord)
        );
        assert_eq!(
            key(&mut decoder, Physical::Char('v'), false, Modifiers::NONE),
            Event::KeyUp(Key::PasteChord)
        );
        assert_eq!(decoder.release_all(), [None, None]);
    }

    #[test]
    fn loss_of_tap_synthesizes_only_held_releases_once() {
        let mut decoder = Decoder::new(DictationKey::RightOption, PasteChord::default());
        assert_eq!(decoder.release_all(), [None, None]);
        key(&mut decoder, Physical::RightOption, true, Modifiers::ALT);
        assert_eq!(
            decoder.release_all(),
            [Some(Event::KeyUp(Key::Dictation)), None]
        );
        assert_eq!(decoder.release_all(), [None, None]);
        key(
            &mut decoder,
            Physical::Char('v'),
            true,
            Modifiers::CTRL | Modifiers::ALT,
        );
        assert_eq!(
            decoder.release_all(),
            [None, Some(Event::KeyUp(Key::PasteChord))]
        );
    }

    #[test]
    fn mac_right_modifier_codes_and_device_flags_are_distinct_from_left() {
        use mac_keys::*;
        assert_eq!(physical(KEY_RIGHT_OPTION), Physical::RightOption);
        assert_eq!(physical(KEY_RIGHT_COMMAND), Physical::RightCommand);
        assert_eq!(physical(KEY_RIGHT_CONTROL), Physical::RightControl);
        assert_eq!(physical(KEY_FN), Physical::Fn);
        assert_eq!(physical(KEY_LEFT_OPTION), Physical::Other);
        assert_eq!(physical(KEY_LEFT_COMMAND), Physical::Other);
        assert_eq!(physical(KEY_LEFT_CONTROL), Physical::Other);
        assert_eq!(
            modifier_pressed(KEY_RIGHT_OPTION, 0x40 | FLAG_ALTERNATE),
            Some(true)
        );
        assert_eq!(
            modifier_pressed(KEY_RIGHT_OPTION, 0x20 | FLAG_ALTERNATE),
            Some(false)
        );
        assert_eq!(
            modifier_pressed(KEY_RIGHT_COMMAND, 0x10 | FLAG_COMMAND),
            Some(true)
        );
        assert_eq!(
            modifier_pressed(KEY_RIGHT_CONTROL, 0x2000 | FLAG_CONTROL),
            Some(true)
        );
        assert_eq!(modifier_pressed(KEY_FN, FLAG_FN), Some(true));
        assert_eq!(modifier_pressed(KEY_FN, 0), Some(false));
        assert_eq!(modifier_pressed(7, 0), None);
        assert_eq!(physical(KEY_ESCAPE), Physical::Esc);
        assert_eq!(
            modifiers(FLAG_CONTROL | FLAG_ALTERNATE),
            Modifiers::CTRL | Modifiers::ALT
        );
    }

    #[test]
    fn mac_chord_position_mapping_covers_ascii_letters_and_digits() {
        let positions = [(0, 'a'), (9, 'v'), (18, '1'), (29, '0'), (45, 'n')];
        for (code, expected) in positions {
            assert_eq!(mac_keys::physical(code), Physical::Char(expected));
        }
        assert_eq!(mac_keys::physical(0xffff), Physical::Other);
    }

    #[test]
    fn modifier_tracker_preserves_left_when_right_is_released() {
        let mut tracker = ModTracker::default();
        tracker.update(ModKey::LeftCtrl, true);
        tracker.update(ModKey::RightCtrl, true);
        tracker.update(ModKey::RightCtrl, false);
        assert_eq!(tracker.modifiers(), Modifiers::CTRL);
        tracker.update(ModKey::LeftCtrl, false);
        assert_eq!(tracker.modifiers(), Modifiers::NONE);
        tracker.update(ModKey::LeftAlt, true);
        tracker.update(ModKey::RightShift, true);
        tracker.update(ModKey::LeftMeta, true);
        assert_eq!(
            tracker.modifiers(),
            Modifiers::ALT | Modifiers::SHIFT | Modifiers::META
        );
    }

    #[test]
    fn x11_parses_key_events_and_rejects_short_or_non_key_records() {
        let mut bytes = [0u8; 32];
        bytes[0] = 2;
        bytes[1] = 105;
        assert_eq!(x_keys::parse_event(&bytes).unwrap().keycode, 105);
        assert!(x_keys::parse_event(&bytes).unwrap().pressed);
        bytes[0] = 3;
        assert!(!x_keys::parse_event(&bytes).unwrap().pressed);
        bytes[0] = 0x83;
        assert!(x_keys::parse_event(&bytes).is_none());
        bytes[0] = 4;
        assert!(x_keys::parse_event(&bytes).is_none());
        assert!(x_keys::parse_event(&bytes[..31]).is_none());
    }

    #[test]
    fn x11_keysym_lookup_detects_right_control_and_esc() {
        assert_eq!(x_keys::classify(0xffe4).0, Physical::RightControl);
        assert_eq!(x_keys::classify(0xffe3).0, Physical::Other);
        assert_eq!(x_keys::classify(0xff1b).0, Physical::Esc);
        assert_eq!(x_keys::classify('V' as u64).0, Physical::Char('v'));
        assert_eq!(x_keys::classify(0xffbe).0, Physical::Other);
    }

    #[test]
    fn wayland_and_no_display_cannot_claim_x11_support() {
        assert!(!x_keys::session_supported(
            Some("wayland"),
            None,
            Some(":0")
        ));
        assert!(!x_keys::session_supported(
            None,
            Some("wayland-0"),
            Some(":0")
        ));
        assert!(!x_keys::session_supported(Some("x11"), None, None));
        assert!(x_keys::session_supported(Some("x11"), None, Some(":0")));
    }

    #[test]
    fn windows_virtual_keys_distinguish_right_from_left_ctrl() {
        assert_eq!(win_keys::classify(0xa3).0, Physical::RightControl);
        assert_eq!(win_keys::classify(0xa2).0, Physical::Other);
        assert_eq!(win_keys::classify(0x1b).0, Physical::Esc);
        assert_eq!(win_keys::classify(0x56).0, Physical::Char('v'));
    }

    #[test]
    fn tracker_feeds_chord_with_current_modifier_state() {
        let mut tracker = ModTracker::default();
        let mut decoder = Decoder::new(DictationKey::RightControl, PasteChord::default());
        assert_eq!(
            tracker
                .step(&mut decoder, win_keys::classify(0xa3), true)
                .event,
            Event::KeyDown(Key::Dictation)
        );
        tracker.step(&mut decoder, win_keys::classify(0xa4), true);
        assert_eq!(
            tracker
                .step(&mut decoder, win_keys::classify(0x56), true)
                .event,
            Event::KeyDown(Key::PasteChord)
        );
        assert_eq!(
            tracker
                .step(&mut decoder, win_keys::classify(0x56), false)
                .event,
            Event::KeyUp(Key::PasteChord)
        );
        assert_eq!(
            tracker
                .step(&mut decoder, win_keys::classify(0xa3), false)
                .event,
            Event::KeyUp(Key::Dictation)
        );
    }
}
