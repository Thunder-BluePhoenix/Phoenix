// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Dictation paste (`dictation_paste` Tauri command). Puts the dictated text into the focused
//! application and restores the user's previous clipboard text unless it changed meanwhile.
//!
//! The decision table lives in [`paste_with`] and is independent of any display: it only talks
//! to the [`ClipboardPlatform`] trait, so every branch is unit tested with a fake. The real
//! platform implementations (macOS pasteboard + CGEvent, Linux GTK clipboard + XTest, Windows
//! clipboard + SendInput) are the private `system` module at the bottom of this file.
//!
//! The decision table, in order:
//! 1. text must be 1..=20 000 characters with no control character except `\n` and `\t`;
//! 2. secure input active or focused target cannot be proven nonsecure: refuse, touch nothing;
//! 3. key events cannot be synthesised (no permission, Wayland): refuse, touch nothing;
//! 4. clipboard of unknown state: refuse, touch nothing;
//! 5. clipboard holds non-text (image, files, concealed secret): do NOT overwrite it, type the
//!    text with key events instead, or refuse if typing is unavailable;
//! 6. otherwise remember the clipboard text (or its emptiness), put the dictation on the
//!    clipboard, send the paste chord, wait, and restore the remembered text only if the
//!    clipboard still holds OUR write (a copy the user made meanwhile is never overwritten).
//!
//! The text is never logged. Call [`paste`] from a worker thread on macOS/Windows (it sleeps
//! for the restore delay); on Linux it must run on the GTK main thread (GTK clipboards are not
//! thread safe) and keeps servicing GTK events while it waits, which the clipboard owner needs.

use serde::Serialize;
use std::fmt;
use std::time::Duration;

/// Longest dictation accepted, in characters.
pub const MAX_TEXT_CHARS: usize = 20_000;
/// How long the dictation stays on the clipboard after the paste chord before the original
/// clipboard text is put back.
pub const RESTORE_DELAY: Duration = Duration::from_millis(350);

/// How the text reached the focused application.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PasteOutcome {
    /// Through the clipboard and paste chord. The previous clipboard text is restored if
    /// nobody copied something else during the delay.
    Pasted,
    /// The clipboard held non-text data and was left alone; the text was typed with key events.
    Typed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PasteErrorCode {
    EmptyText,
    TooLong,
    ControlCharacters,
    /// Secure input is on (a password field has focus); nothing was pasted.
    SecureInput,
    /// The focused target could not be proven nonsecure; nothing was pasted or typed.
    /// Only the Linux, Windows and unsupported-OS probes produce it (macOS has a real signal).
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    SecureInputUnknown,
    /// The clipboard could not be inspected, so it was not touched.
    ClipboardUnavailable,
    ClipboardWriteFailed,
    /// The clipboard was restored (or untouched) but the paste chord could not be sent.
    PasteUnavailable,
    /// The clipboard holds non-text data and the text cannot be typed instead.
    TypingUnavailable,
    /// The paste worked but the previous clipboard text could not be put back.
    RestoreFailed,
}

/// A typed refusal; `message` is user-facing and never contains the dictated text.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct PasteError {
    pub code: PasteErrorCode,
    pub message: &'static str,
}

impl PasteError {
    pub fn new(code: PasteErrorCode) -> Self {
        let message = match code {
            PasteErrorCode::EmptyText => "There is no dictated text to paste.",
            PasteErrorCode::TooLong => "The dictated text is longer than 20,000 characters.",
            PasteErrorCode::ControlCharacters => {
                "The dictated text contains control characters and was not pasted."
            }
            PasteErrorCode::SecureInput => {
                "A protected field has focus (secure input is on), so nothing was pasted."
            }
            PasteErrorCode::SecureInputUnknown => {
                "The focused field could not be confirmed safe for dictation, so nothing was pasted."
            }
            PasteErrorCode::ClipboardUnavailable => {
                "The clipboard could not be read safely, so nothing was pasted."
            }
            PasteErrorCode::ClipboardWriteFailed => {
                "The clipboard could not be written; the previous text was restored where possible."
            }
            PasteErrorCode::PasteUnavailable => {
                "Phoenix cannot send keyboard shortcuts here (permission missing, elevated window, or a Wayland session)."
            }
            PasteErrorCode::TypingUnavailable => {
                "The clipboard holds something that is not text and typing is not available, so nothing was pasted."
            }
            PasteErrorCode::RestoreFailed => {
                "Your previous clipboard text could not be restored."
            }
        };
        Self { code, message }
    }
}

impl fmt::Display for PasteError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message)
    }
}

impl std::error::Error for PasteError {}

/// What the clipboard holds right now, as far as a text paste is concerned.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ClipboardContent {
    Empty,
    Text(String),
    /// Images, files, concealed (password manager) items and the like: never overwritten.
    NonText,
    /// Could not be determined: never touched.
    Unknown,
}

/// The side-effecting half. Implementations must not log text.
pub trait ClipboardPlatform {
    /// Identifies OUR clipboard write (change counter, or selection owner plus text) so a
    /// later [`ClipboardPlatform::unchanged`] can tell it from a copy the user made meanwhile.
    type Receipt;

    /// Is a password field focused? Return `Ok(false)` only when the focused target is
    /// positively known to be nonsecure; an unknown status must return `SecureInputUnknown`.
    fn secure_input(&mut self) -> Result<bool, PasteError>;
    /// Can this process synthesise key events at all (permission granted, X11 session, not
    /// Wayland)? Checked before the clipboard is touched so a doomed paste changes nothing.
    fn can_send_keys(&mut self) -> Result<(), PasteError>;
    fn read_clipboard(&mut self) -> ClipboardContent;
    /// If a write fails AFTER changing the clipboard, the implementation restores the original
    /// text if the clipboard is still ours. A failed write never sends the paste shortcut.
    fn write_text(
        &mut self,
        text: &str,
        original: Option<&str>,
    ) -> Result<Self::Receipt, PasteError>;
    fn send_paste(&mut self) -> Result<(), PasteError>;
    fn type_text(&mut self, text: &str) -> Result<(), PasteError>;
    fn wait(&mut self, duration: Duration);
    fn unchanged(&mut self, receipt: &Self::Receipt) -> bool;
    /// `None` puts back an empty clipboard.
    fn restore_text(&mut self, original: Option<&str>) -> Result<(), PasteError>;
}

/// Checks the text rules (1.) of the decision table.
pub fn validate_text(text: &str) -> Result<(), PasteError> {
    if text.is_empty() {
        return Err(PasteError::new(PasteErrorCode::EmptyText));
    }
    if text.chars().nth(MAX_TEXT_CHARS).is_some() {
        return Err(PasteError::new(PasteErrorCode::TooLong));
    }
    if text
        .chars()
        .any(|c| c.is_control() && c != '\n' && c != '\t')
    {
        return Err(PasteError::new(PasteErrorCode::ControlCharacters));
    }
    Ok(())
}

/// The whole decision table over an injected platform.
pub fn paste_with<P: ClipboardPlatform>(
    platform: &mut P,
    text: &str,
) -> Result<PasteOutcome, PasteError> {
    validate_text(text)?;
    if platform.secure_input()? {
        return Err(PasteError::new(PasteErrorCode::SecureInput));
    }
    platform.can_send_keys()?;
    let original = match platform.read_clipboard() {
        ClipboardContent::Empty => None,
        ClipboardContent::Text(previous) => Some(previous),
        ClipboardContent::NonText => {
            return platform.type_text(text).map(|()| PasteOutcome::Typed);
        }
        ClipboardContent::Unknown => {
            return Err(PasteError::new(PasteErrorCode::ClipboardUnavailable));
        }
    };
    let receipt = platform.write_text(text, original.as_deref())?;
    let sent = platform.send_paste();
    platform.wait(RESTORE_DELAY);
    // A failed paste chord still restores: the dictation must not linger on the clipboard.
    let restored = if platform.unchanged(&receipt) {
        platform
            .restore_text(original.as_deref())
            .map_err(|_| PasteError::new(PasteErrorCode::RestoreFailed))
    } else {
        Ok(())
    };
    sent?;
    restored?;
    Ok(PasteOutcome::Pasted)
}

/// Pastes `text` into the focused application on the real platform.
pub fn paste(text: &str) -> Result<PasteOutcome, PasteError> {
    paste_with(&mut system::SystemPlatform, text)
}

// ---- pure helpers shared by the platform code (compiled on every OS so they are tested) ----

/// One step of typing a text with key events.
#[cfg(any(test, target_os = "macos", windows))]
#[derive(Clone, Debug, PartialEq, Eq)]
enum TypeStep {
    /// UTF-16 code units typed in one event; never splits a surrogate pair.
    Unicode(Vec<u16>),
    Return,
    Tab,
}

/// Splits `text` into key steps: `\n` is the Return key, `\t` the Tab key, everything else is
/// Unicode typed in runs of at most `max_units` UTF-16 code units (`max_units` >= 2).
#[cfg(any(test, target_os = "macos", windows))]
fn typing_plan(text: &str, max_units: usize) -> Vec<TypeStep> {
    let mut steps = Vec::new();
    let mut run: Vec<u16> = Vec::new();
    for c in text.chars() {
        if c == '\n' || c == '\t' {
            if !run.is_empty() {
                steps.push(TypeStep::Unicode(std::mem::take(&mut run)));
            }
            steps.push(if c == '\n' {
                TypeStep::Return
            } else {
                TypeStep::Tab
            });
            continue;
        }
        let mut buf = [0u16; 2];
        let units = c.encode_utf16(&mut buf);
        if run.len() + units.len() > max_units && !run.is_empty() {
            steps.push(TypeStep::Unicode(std::mem::take(&mut run)));
        }
        run.extend_from_slice(units);
    }
    if !run.is_empty() {
        steps.push(TypeStep::Unicode(run));
    }
    steps
}

/// Windows applications expect CRLF line breaks in `CF_UNICODETEXT`.
#[cfg(any(test, windows))]
fn to_crlf(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 8);
    let mut previous = '\0';
    for c in text.chars() {
        if c == '\n' && previous != '\r' {
            out.push('\r');
        }
        out.push(c);
        previous = c;
    }
    out
}

/// Only these AppKit types represent plain text and its rich-text/HTML renderings. Unknown
/// types are treated as non-text: a clipboard can offer both text and a file/image/password
/// item, and the text could just be a file name or the rendering of a secret.
#[cfg(any(test, target_os = "macos"))]
const MAC_TEXT_TYPES: [&str; 9] = [
    "public.utf8-plain-text",
    "public.utf16-plain-text",
    "NSStringPboardType",
    "public.plain-text",
    "public.text",
    "public.rtf",
    "public.rtfd",
    "public.html",
    "NeXT Rich Text Format v1.0 pasteboard type",
];

#[cfg(any(test, target_os = "macos"))]
fn classify_mac_types<S: AsRef<str>>(types: &[S]) -> ClipboardContent {
    if types.is_empty() {
        return ClipboardContent::Empty;
    }
    let has_text = types.iter().any(|t| {
        matches!(
            t.as_ref(),
            "public.utf8-plain-text" | "public.utf16-plain-text" | "NSStringPboardType"
        )
    });
    if !has_text || types.iter().any(|t| !MAC_TEXT_TYPES.contains(&t.as_ref())) {
        ClipboardContent::NonText
    } else {
        // The caller replaces this marker with the actual string.
        ClipboardContent::Text(String::new())
    }
}

/// X11/GTK selection targets that carry plain text (including rich renderings). A clipboard
/// item that advertises any other data target is non-text even if it offers a text rendering.
#[cfg(any(test, target_os = "linux"))]
const LINUX_TEXT_TARGETS: [&str; 9] = [
    "UTF8_STRING",
    "STRING",
    "TEXT",
    "COMPOUND_TEXT",
    "text/plain",
    "text/plain;charset=utf-8",
    "text/html",
    "text/rtf",
    "application/rtf",
];

/// Targets that GTK/X11 always add (not content).
#[cfg(any(test, target_os = "linux"))]
fn linux_target_is_protocol(target: &str) -> bool {
    matches!(
        target,
        "TARGETS" | "MULTIPLE" | "TIMESTAMP" | "SAVE_TARGETS" | "DELETE" | "INSERT_PROPERTY"
    )
}

#[cfg(any(test, target_os = "linux"))]
fn classify_linux_targets<S: AsRef<str>>(targets: &[S]) -> ClipboardContent {
    let content: Vec<&str> = targets
        .iter()
        .map(AsRef::as_ref)
        .filter(|t| !linux_target_is_protocol(t))
        .collect();
    if content.is_empty() {
        return ClipboardContent::Empty;
    }
    let has_text = content.iter().any(|t| {
        matches!(
            *t,
            "UTF8_STRING"
                | "STRING"
                | "TEXT"
                | "COMPOUND_TEXT"
                | "text/plain"
                | "text/plain;charset=utf-8"
        )
    });
    if !has_text || content.iter().any(|t| !LINUX_TEXT_TARGETS.contains(t)) {
        ClipboardContent::NonText
    } else {
        // The caller replaces this marker with the actual string.
        ClipboardContent::Text(String::new())
    }
}

/// X11 keysym for a character: Latin-1 maps to itself, everything else to `0x01000000 | cp`.
#[cfg(any(test, target_os = "linux"))]
fn x11_keysym(c: char) -> u32 {
    let cp = c as u32;
    match cp {
        0x20..=0x7e | 0xa0..=0xff => cp,
        _ => 0x0100_0000 | cp,
    }
}

/// One clipboard format as Windows reports it: the id and, for registered formats, the name.
#[cfg(any(test, windows))]
#[derive(Clone, Debug, PartialEq, Eq)]
struct WindowsFormat {
    id: u32,
    name: Option<String>,
}

#[cfg(any(test, windows))]
fn classify_windows_formats(formats: &[WindowsFormat]) -> ClipboardContent {
    // CF_TEXT, CF_OEMTEXT, CF_UNICODETEXT, CF_LOCALE.
    const TEXT_IDS: [u32; 4] = [1, 7, 13, 16];
    const CF_UNICODETEXT: u32 = 13;
    const FIRST_REGISTERED: u32 = 0xC000;
    if formats.is_empty() {
        return ClipboardContent::Empty;
    }
    let non_text = formats.iter().any(|f| {
        if f.id < FIRST_REGISTERED {
            return !TEXT_IDS.contains(&f.id);
        }
        // Registered formats may be richly rendered text, but an unknown format can also
        // be a file name, bitmap, or password manager's concealed marker. Fail closed.
        !matches!(
            f.name.as_deref(),
            Some("HTML Format" | "Rich Text Format" | "Text")
        )
    });
    if non_text || !formats.iter().any(|f| f.id == CF_UNICODETEXT) {
        ClipboardContent::NonText
    } else {
        // The caller replaces this marker with the actual string.
        ClipboardContent::Text(String::new())
    }
}

#[cfg(target_os = "macos")]
mod system {
    use super::*;
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation, KeyCode};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
    use objc2_foundation::NSString;

    #[link(name = "Carbon", kind = "framework")]
    unsafe extern "C" {
        fn IsSecureEventInputEnabled() -> bool;
    }

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXIsProcessTrusted() -> bool;
    }

    #[derive(Default)]
    pub struct SystemPlatform;

    fn board() -> objc2::rc::Retained<NSPasteboard> {
        NSPasteboard::generalPasteboard()
    }

    fn chord() -> Result<(), PasteError> {
        let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
            .map_err(|_| PasteError::new(PasteErrorCode::PasteUnavailable))?;
        let down = CGEvent::new_keyboard_event(source.clone(), KeyCode::ANSI_V, true)
            .map_err(|_| PasteError::new(PasteErrorCode::PasteUnavailable))?;
        let up = CGEvent::new_keyboard_event(source, KeyCode::ANSI_V, false)
            .map_err(|_| PasteError::new(PasteErrorCode::PasteUnavailable))?;
        down.set_flags(CGEventFlags::CGEventFlagCommand);
        up.set_flags(CGEventFlags::CGEventFlagCommand);
        down.post(CGEventTapLocation::HID);
        up.post(CGEventTapLocation::HID);
        Ok(())
    }

    fn key(source: &CGEventSource, code: u16, unicode: Option<&[u16]>) -> Result<(), PasteError> {
        let down = CGEvent::new_keyboard_event(source.clone(), code, true)
            .map_err(|_| PasteError::new(PasteErrorCode::TypingUnavailable))?;
        let up = CGEvent::new_keyboard_event(source.clone(), code, false)
            .map_err(|_| PasteError::new(PasteErrorCode::TypingUnavailable))?;
        if let Some(units) = unicode {
            down.set_string_from_utf16_unchecked(units);
            up.set_string_from_utf16_unchecked(units);
        }
        down.post(CGEventTapLocation::HID);
        up.post(CGEventTapLocation::HID);
        Ok(())
    }

    impl ClipboardPlatform for SystemPlatform {
        type Receipt = isize;

        fn secure_input(&mut self) -> Result<bool, PasteError> {
            // SAFETY: Carbon exports this process-global status probe; no input is read.
            Ok(unsafe { IsSecureEventInputEnabled() })
        }

        fn can_send_keys(&mut self) -> Result<(), PasteError> {
            // Quartz refuses events without Accessibility permission. This is a passive check;
            // unlike AXIsProcessTrustedWithOptions it never prompts at app launch.
            if unsafe { AXIsProcessTrusted() } {
                Ok(())
            } else {
                Err(PasteError::new(PasteErrorCode::PasteUnavailable))
            }
        }

        fn read_clipboard(&mut self) -> ClipboardContent {
            let board = board();
            let before = board.changeCount();
            let Some(types) = board.types() else {
                return ClipboardContent::Unknown;
            };
            let mut names = Vec::with_capacity(types.len());
            for index in 0..types.len() {
                names.push(types.objectAtIndex(index).to_string());
            }
            let content = match classify_mac_types(&names) {
                ClipboardContent::Text(_) => {
                    // SAFETY: NSString pasteboard type constant is an immutable AppKit symbol.
                    match board.stringForType(unsafe { NSPasteboardTypeString }) {
                        Some(text) => ClipboardContent::Text(text.to_string()),
                        None => ClipboardContent::Unknown,
                    }
                }
                other => other,
            };
            if board.changeCount() == before {
                content
            } else {
                ClipboardContent::Unknown
            }
        }

        fn write_text(
            &mut self,
            text: &str,
            original: Option<&str>,
        ) -> Result<Self::Receipt, PasteError> {
            let board = board();
            let string = NSString::from_str(text);
            board.clearContents();
            let cleared_count = board.changeCount();
            // SAFETY: the AppKit type constant is immutable and valid for the process lifetime.
            if !board.setString_forType(&string, unsafe { NSPasteboardTypeString }) {
                // Restore only if no other process copied something during the failed write.
                if board.changeCount() == cleared_count {
                    if let Some(previous) = original {
                        let previous = NSString::from_str(previous);
                        if !board.setString_forType(&previous, unsafe { NSPasteboardTypeString }) {
                            return Err(PasteError::new(PasteErrorCode::RestoreFailed));
                        }
                    }
                }
                return Err(PasteError::new(PasteErrorCode::ClipboardWriteFailed));
            }
            Ok(board.changeCount())
        }

        fn send_paste(&mut self) -> Result<(), PasteError> {
            chord()
        }

        fn type_text(&mut self, text: &str) -> Result<(), PasteError> {
            let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
                .map_err(|_| PasteError::new(PasteErrorCode::TypingUnavailable))?;
            for step in typing_plan(text, 20) {
                match step {
                    TypeStep::Unicode(units) => key(&source, 0, Some(&units))?,
                    TypeStep::Return => key(&source, KeyCode::RETURN, None)?,
                    TypeStep::Tab => key(&source, KeyCode::TAB, None)?,
                }
            }
            Ok(())
        }

        fn wait(&mut self, duration: Duration) {
            std::thread::sleep(duration);
        }

        fn unchanged(&mut self, receipt: &Self::Receipt) -> bool {
            board().changeCount() == *receipt
        }

        fn restore_text(&mut self, original: Option<&str>) -> Result<(), PasteError> {
            let board = board();
            board.clearContents();
            if let Some(text) = original {
                // SAFETY: immutable AppKit symbol.
                if !board
                    .setString_forType(&NSString::from_str(text), unsafe { NSPasteboardTypeString })
                {
                    return Err(PasteError::new(PasteErrorCode::RestoreFailed));
                }
            }
            Ok(())
        }
    }
}

#[cfg(target_os = "linux")]
mod system {
    use super::*;
    use gtk::gdk;
    use gtk::prelude::*;
    use std::ptr;
    use std::time::Instant;
    use x11_dl::{keysym, xlib, xtest};

    #[derive(Default)]
    pub struct SystemPlatform;

    /// A GTK clipboard owner can only be queried on GTK's owning (main) thread.
    fn clipboard() -> Result<gtk::Clipboard, PasteError> {
        if !gtk::is_initialized_main_thread() {
            return Err(PasteError::new(PasteErrorCode::ClipboardUnavailable));
        }
        Ok(gtk::Clipboard::get(&gdk::SELECTION_CLIPBOARD))
    }

    /// A selection owner can withdraw and re-offer exactly the same text while we wait.
    /// On X11 the GDK selection owner is our strongest available receipt; on Wayland XTest is
    /// unavailable and we fail before touching the clipboard. Equality alone is not proof.
    #[derive(Clone)]
    pub struct Receipt {
        owner: Option<gdk::Window>,
        text: String,
    }

    struct XDisplay {
        lib: xlib::Xlib,
        test: xtest::Xf86vmode,
        ptr: *mut xlib::Display,
    }

    impl Drop for XDisplay {
        fn drop(&mut self) {
            // SAFETY: `ptr` came from XOpenDisplay and is owned by this object.
            unsafe { (self.lib.XCloseDisplay)(self.ptr) };
        }
    }

    impl XDisplay {
        fn open(code: PasteErrorCode) -> Result<Self, PasteError> {
            let lib = xlib::Xlib::open().map_err(|_| PasteError::new(code))?;
            let test = xtest::Xf86vmode::open().map_err(|_| PasteError::new(code))?;
            // SAFETY: null selects DISPLAY, the same server GTK is using in an X11 session.
            let ptr = unsafe { (lib.XOpenDisplay)(ptr::null()) };
            if ptr.is_null() {
                return Err(PasteError::new(code));
            }
            let mut event_base = 0;
            let mut error_base = 0;
            let mut major = 0;
            let mut minor = 0;
            // SAFETY: pointers are valid and `ptr` is an open X11 connection.
            let available = unsafe {
                (test.XTestQueryExtension)(
                    ptr,
                    &mut event_base,
                    &mut error_base,
                    &mut major,
                    &mut minor,
                ) != 0
            };
            if !available {
                // SAFETY: `ptr` is still live and must be closed on this error path.
                unsafe { (lib.XCloseDisplay)(ptr) };
                return Err(PasteError::new(code));
            }
            Ok(Self { lib, test, ptr })
        }

        fn keycode(&self, symbol: u32, code: PasteErrorCode) -> Result<u8, PasteError> {
            // SAFETY: the display is open; XKeysymToKeycode returns 0 for an unbound symbol.
            let key = unsafe { (self.lib.XKeysymToKeycode)(self.ptr, symbol.into()) };
            if key == 0 {
                return Err(PasteError::new(code));
            }
            Ok(key)
        }

        fn send(&self, key: u8, down: bool, code: PasteErrorCode) -> Result<(), PasteError> {
            // SAFETY: `ptr` is a live X11 display and the keycode was checked.
            let ok = unsafe {
                (self.test.XTestFakeKeyEvent)(self.ptr, u32::from(key), i32::from(down), 0)
            };
            if ok == 0 {
                return Err(PasteError::new(code));
            }
            Ok(())
        }

        fn flush(&self) {
            // SAFETY: the display is live and owned by this object.
            unsafe { (self.lib.XFlush)(self.ptr) };
        }
    }

    /// XGetKeyboardMapping returns a full keyboard map in one X11 request. Keep it alive for
    /// one typing operation rather than fetching it separately for each dictated character.
    struct KeyboardMap<'a> {
        x: &'a XDisplay,
        ptr: *mut std::os::raw::c_ulong,
        lo: i32,
        hi: i32,
        per_keycode: i32,
    }

    impl Drop for KeyboardMap<'_> {
        fn drop(&mut self) {
            // SAFETY: `ptr` came from XGetKeyboardMapping for the live XDisplay.
            unsafe { (self.x.lib.XFree)(self.ptr.cast()) };
        }
    }

    impl XDisplay {
        fn keyboard_map(&self) -> Result<KeyboardMap<'_>, PasteError> {
            let mut lo = 0;
            let mut hi = 0;
            // SAFETY: output pointers and the display are valid.
            unsafe { (self.lib.XDisplayKeycodes)(self.ptr, &mut lo, &mut hi) };
            if lo > hi || lo < 0 || hi > 255 {
                return Err(PasteError::new(PasteErrorCode::TypingUnavailable));
            }
            let mut per_keycode = 0;
            // SAFETY: the returned mapping is Xlib-owned and freed by KeyboardMap::drop.
            let ptr = unsafe {
                (self.lib.XGetKeyboardMapping)(self.ptr, lo as u8, hi - lo + 1, &mut per_keycode)
            };
            if ptr.is_null() || per_keycode <= 0 {
                return Err(PasteError::new(PasteErrorCode::TypingUnavailable));
            }
            Ok(KeyboardMap {
                x: self,
                ptr,
                lo,
                hi,
                per_keycode,
            })
        }
    }

    impl KeyboardMap<'_> {
        fn key(&self, symbol: u32) -> Option<(u8, bool)> {
            for key in self.lo..=self.hi {
                for level in 0..self.per_keycode.min(2) {
                    // SAFETY: `ptr` contains (hi-lo+1)*per_keycode keysyms.
                    let mapped = unsafe {
                        *self
                            .ptr
                            .add(((key - self.lo) * self.per_keycode + level) as usize)
                    };
                    if mapped == u64::from(symbol) {
                        return Some((key as u8, level == 1));
                    }
                }
            }
            None
        }
    }

    impl ClipboardPlatform for SystemPlatform {
        type Receipt = Receipt;

        fn secure_input(&mut self) -> Result<bool, PasteError> {
            // X11/GTK cannot determine whether another application's focused field is secure.
            // Refuse before either clipboard access or synthetic key events.
            Err(PasteError::new(PasteErrorCode::SecureInputUnknown))
        }

        fn can_send_keys(&mut self) -> Result<(), PasteError> {
            // Wayland intentionally forbids global key injection. Do not silently paste into
            // the clipboard and claim success when XTest cannot inject events.
            if !gtk::is_initialized_main_thread() {
                return Err(PasteError::new(PasteErrorCode::PasteUnavailable));
            }
            if gdk::Display::default().is_none_or(|display| !display.type_().name().contains("X11"))
            {
                return Err(PasteError::new(PasteErrorCode::PasteUnavailable));
            }
            let _display = XDisplay::open(PasteErrorCode::PasteUnavailable)?;
            Ok(())
        }

        fn read_clipboard(&mut self) -> ClipboardContent {
            let Ok(clipboard) = clipboard() else {
                return ClipboardContent::Unknown;
            };
            let before = gdk::selection_owner_get(&gdk::SELECTION_CLIPBOARD);
            let Some(targets) = clipboard.wait_for_targets() else {
                return ClipboardContent::Unknown;
            };
            let names: Vec<_> = targets
                .into_iter()
                .map(|atom| atom.name().to_string())
                .collect();
            let content = match classify_linux_targets(&names) {
                ClipboardContent::Text(_) => clipboard
                    .wait_for_text()
                    .map(|text| ClipboardContent::Text(text.to_string()))
                    .unwrap_or(ClipboardContent::Unknown),
                other => other,
            };
            if gdk::selection_owner_get(&gdk::SELECTION_CLIPBOARD) == before {
                content
            } else {
                ClipboardContent::Unknown
            }
        }

        fn write_text(
            &mut self,
            text: &str,
            original: Option<&str>,
        ) -> Result<Self::Receipt, PasteError> {
            let clipboard =
                clipboard().map_err(|_| PasteError::new(PasteErrorCode::ClipboardWriteFailed))?;
            clipboard.set_text(text);
            // GTK's set_text does not return a status. Verify ownership before sending keys;
            // otherwise another process's copy could be pasted into the focused application.
            let owner = gdk::selection_owner_get(&gdk::SELECTION_CLIPBOARD);
            let written = clipboard.wait_for_text().as_deref() == Some(text);
            let still_ours =
                owner.is_some() && owner == gdk::selection_owner_get(&gdk::SELECTION_CLIPBOARD);
            if !written || !still_ours {
                // If we still own the clipboard but the write failed, put the old text back.
                if still_ours {
                    if let Some(previous) = original {
                        clipboard.set_text(previous);
                    } else {
                        clipboard.clear();
                    }
                }
                return Err(PasteError::new(PasteErrorCode::ClipboardWriteFailed));
            }
            Ok(Receipt {
                owner,
                text: text.to_owned(),
            })
        }

        fn send_paste(&mut self) -> Result<(), PasteError> {
            let x = XDisplay::open(PasteErrorCode::PasteUnavailable)?;
            let ctrl = x.keycode(keysym::XK_Control_L, PasteErrorCode::PasteUnavailable)?;
            let v = x.keycode(keysym::XK_v, PasteErrorCode::PasteUnavailable)?;
            x.send(ctrl, true, PasteErrorCode::PasteUnavailable)?;
            let pressed = x.send(v, true, PasteErrorCode::PasteUnavailable);
            let released = x.send(v, false, PasteErrorCode::PasteUnavailable);
            let ctrl_released = x.send(ctrl, false, PasteErrorCode::PasteUnavailable);
            x.flush();
            pressed?;
            released?;
            ctrl_released
        }

        fn type_text(&mut self, text: &str) -> Result<(), PasteError> {
            let x = XDisplay::open(PasteErrorCode::TypingUnavailable)?;
            let shift = x.keycode(keysym::XK_Shift_L, PasteErrorCode::TypingUnavailable)?;
            let map = x.keyboard_map()?;
            let mut keys = Vec::with_capacity(text.len());
            // Resolve EVERY keysym before sending ANY key. If the current keyboard layout
            // cannot type one character, refuse without partially typing the dictation.
            for c in text.chars() {
                let symbol = match c {
                    '\n' => keysym::XK_Return,
                    '\t' => keysym::XK_Tab,
                    _ => x11_keysym(c),
                };
                let Some(key) = map.key(symbol) else {
                    return Err(PasteError::new(PasteErrorCode::TypingUnavailable));
                };
                keys.push(key);
            }
            for (key, shifted) in keys {
                if shifted {
                    x.send(shift, true, PasteErrorCode::TypingUnavailable)?;
                }
                x.send(key, true, PasteErrorCode::TypingUnavailable)?;
                x.send(key, false, PasteErrorCode::TypingUnavailable)?;
                if shifted {
                    x.send(shift, false, PasteErrorCode::TypingUnavailable)?;
                }
            }
            x.flush();
            Ok(())
        }

        fn wait(&mut self, duration: Duration) {
            let deadline = Instant::now() + duration;
            // GTK clipboard ownership needs GTK to keep serving selection requests. A blocking
            // sleep on the GTK thread would return the selection to the caller too late.
            while Instant::now() < deadline {
                while gtk::events_pending() {
                    gtk::main_iteration_do(false);
                }
                std::thread::sleep(Duration::from_millis(5));
            }
        }

        fn unchanged(&mut self, receipt: &Self::Receipt) -> bool {
            let Ok(clipboard) = clipboard() else {
                return false;
            };
            let owner = gdk::selection_owner_get(&gdk::SELECTION_CLIPBOARD);
            owner.is_some()
                && owner == receipt.owner
                && clipboard.wait_for_text().as_deref() == Some(receipt.text.as_str())
        }

        fn restore_text(&mut self, original: Option<&str>) -> Result<(), PasteError> {
            let clipboard =
                clipboard().map_err(|_| PasteError::new(PasteErrorCode::RestoreFailed))?;
            if let Some(text) = original {
                clipboard.set_text(text);
            } else {
                clipboard.clear();
            }
            Ok(())
        }
    }
}

#[cfg(windows)]
mod system {
    use super::*;
    use std::mem;
    use windows::core::w;
    use windows::Win32::Foundation::{
        GetLastError, GlobalFree, SetLastError, HANDLE, HGLOBAL, WIN32_ERROR,
    };
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, EnumClipboardFormats, GetClipboardData,
        GetClipboardFormatNameW, GetClipboardSequenceNumber, OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE,
        VIRTUAL_KEY, VK_CONTROL, VK_RETURN, VK_TAB, VK_V,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, GetClassNameW, GetForegroundWindow, GetGUIThreadInfo,
        GetWindowLongPtrW, GetWindowThreadProcessId, ES_PASSWORD, GUITHREADINFO, GWL_STYLE,
        HWND_MESSAGE, WINDOW_EX_STYLE, WS_OVERLAPPED,
    };

    const CF_UNICODETEXT: u32 = 13;

    #[derive(Default)]
    pub struct SystemPlatform;

    /// A private clipboard owner is needed: EmptyClipboard with a null owner produces a
    /// clipboard for which SetClipboardData can fail. A message-only window is invisible and
    /// cannot steal focus from the application receiving the paste.
    struct ClipboardOwner(windows::Win32::Foundation::HWND);

    impl ClipboardOwner {
        fn new() -> Result<Self, PasteError> {
            // SAFETY: STATIC is an OS window class; the message-only parent makes it invisible.
            let handle = unsafe {
                CreateWindowExW(
                    WINDOW_EX_STYLE(0),
                    w!("STATIC"),
                    w!("Phoenix dictation clipboard"),
                    WS_OVERLAPPED,
                    0,
                    0,
                    0,
                    0,
                    Some(HWND_MESSAGE),
                    None,
                    None,
                    None,
                )
            }
            .map_err(|_| PasteError::new(PasteErrorCode::ClipboardWriteFailed))?;
            Ok(Self(handle))
        }
    }

    impl Drop for ClipboardOwner {
        fn drop(&mut self) {
            // SAFETY: created in ClipboardOwner::new on the current thread.
            let _ = unsafe { DestroyWindow(self.0) };
        }
    }

    struct OpenedClipboard;
    impl OpenedClipboard {
        fn open(owner: Option<windows::Win32::Foundation::HWND>) -> Result<Self, PasteError> {
            // SAFETY: Win32 clipboard is process-global; the guard always closes it.
            unsafe { OpenClipboard(owner) }
                .map_err(|_| PasteError::new(PasteErrorCode::ClipboardUnavailable))?;
            Ok(Self)
        }
    }

    impl Drop for OpenedClipboard {
        fn drop(&mut self) {
            // SAFETY: matched to a successful OpenClipboard in this thread.
            let _ = unsafe { CloseClipboard() };
        }
    }

    fn formats() -> Result<Vec<WindowsFormat>, PasteError> {
        let mut result = Vec::new();
        let mut last = 0;
        loop {
            // SAFETY: clipboard is open; 0 means end or error.
            let id = unsafe { EnumClipboardFormats(last) };
            if id == 0 {
                // A zero return is the normal end. If the clipboard owns formats and the
                // first call returned zero, CountClipboardFormats below catches it.
                break;
            }
            let name = if id >= 0xC000 {
                let mut buf = [0u16; 260];
                // SAFETY: registered clipboard format name fits within 255 UTF-16 units.
                let length = unsafe { GetClipboardFormatNameW(id, &mut buf) };
                if length <= 0 {
                    return Err(PasteError::new(PasteErrorCode::ClipboardUnavailable));
                }
                Some(String::from_utf16_lossy(&buf[..length as usize]))
            } else {
                None
            };
            result.push(WindowsFormat { id, name });
            last = id;
        }
        // SAFETY: clipboard is still open. Distinguish an empty clipboard from an enumeration
        // failure or a clipboard that changed while enumerating.
        if unsafe { windows::Win32::System::DataExchange::CountClipboardFormats() }
            != result.len() as i32
        {
            return Err(PasteError::new(PasteErrorCode::ClipboardUnavailable));
        }
        Ok(result)
    }

    fn read_text() -> Result<String, PasteError> {
        // SAFETY: clipboard is open and the format has already been classified as text.
        let data = unsafe { GetClipboardData(CF_UNICODETEXT) }
            .map_err(|_| PasteError::new(PasteErrorCode::ClipboardUnavailable))?;
        let global = HGLOBAL(data.0);
        let size = unsafe { GlobalSize(global) };
        if size < 2 || size % 2 != 0 || size > 100_000_000 {
            return Err(PasteError::new(PasteErrorCode::ClipboardUnavailable));
        }
        // SAFETY: the HGLOBAL came from GetClipboardData while the clipboard is open.
        let ptr = unsafe { GlobalLock(global) };
        if ptr.is_null() {
            return Err(PasteError::new(PasteErrorCode::ClipboardUnavailable));
        }
        // SAFETY: GlobalSize bounds the slice; the clipboard stays open until after the copy.
        let units = unsafe { std::slice::from_raw_parts(ptr.cast::<u16>(), size / 2) };
        let end = units.iter().position(|&unit| unit == 0);
        let result = end
            .and_then(|len| String::from_utf16(&units[..len]).ok())
            .ok_or_else(|| PasteError::new(PasteErrorCode::ClipboardUnavailable));
        // A successful unlock can return zero when the global memory has lock count zero; the
        // data is no longer used here. Do not confuse that with a clipboard read error.
        let _ = unsafe { GlobalUnlock(global) };
        result
    }

    fn write_text(
        text: &str,
        owner: &ClipboardOwner,
        original: Option<&str>,
    ) -> Result<u32, PasteError> {
        let _clipboard = OpenedClipboard::open(Some(owner.0))
            .map_err(|_| PasteError::new(PasteErrorCode::ClipboardWriteFailed))?;
        let data = to_crlf(text);
        let units: Vec<u16> = data.encode_utf16().chain(std::iter::once(0)).collect();
        let bytes = units.len() * mem::size_of::<u16>();
        // SAFETY: GMEM_MOVEABLE is mandatory for clipboard ownership transfer.
        let memory = unsafe { GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, bytes) }
            .map_err(|_| PasteError::new(PasteErrorCode::ClipboardWriteFailed))?;
        let ptr = unsafe { GlobalLock(memory) };
        if ptr.is_null() {
            let _ = unsafe { GlobalFree(Some(memory)) };
            return Err(PasteError::new(PasteErrorCode::ClipboardWriteFailed));
        }
        // SAFETY: allocation is exactly `bytes` and `units` contains that many bytes.
        unsafe {
            ptr.cast::<u16>()
                .copy_from_nonoverlapping(units.as_ptr(), units.len())
        };
        let _ = unsafe { GlobalUnlock(memory) };
        // SAFETY: clipboard is open; after SetClipboardData succeeds Windows owns `memory`.
        if unsafe { EmptyClipboard() }.is_err() {
            let _ = unsafe { GlobalFree(Some(memory)) };
            return Err(PasteError::new(PasteErrorCode::ClipboardWriteFailed));
        }
        let cleared_sequence = unsafe { GetClipboardSequenceNumber() };
        if unsafe { SetClipboardData(CF_UNICODETEXT, Some(HANDLE(memory.0))) }.is_err() {
            let _ = unsafe { GlobalFree(Some(memory)) };
            // Win32's EmptyClipboard succeeded before SetClipboardData failed. Restore the
            // original text while our selection is still open, unless another copy intervened.
            if unsafe { GetClipboardSequenceNumber() } == cleared_sequence {
                if let Some(previous) = original {
                    let previous_units: Vec<u16> = to_crlf(previous)
                        .encode_utf16()
                        .chain(std::iter::once(0))
                        .collect();
                    let previous_bytes = previous_units.len() * mem::size_of::<u16>();
                    let backup =
                        unsafe { GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, previous_bytes) }
                            .map_err(|_| PasteError::new(PasteErrorCode::RestoreFailed))?;
                    let backup_ptr = unsafe { GlobalLock(backup) };
                    if backup_ptr.is_null() {
                        let _ = unsafe { GlobalFree(Some(backup)) };
                        return Err(PasteError::new(PasteErrorCode::RestoreFailed));
                    }
                    // SAFETY: backup allocation holds the entire UTF-16 string.
                    unsafe {
                        backup_ptr
                            .cast::<u16>()
                            .copy_from_nonoverlapping(previous_units.as_ptr(), previous_units.len())
                    };
                    let _ = unsafe { GlobalUnlock(backup) };
                    if unsafe { SetClipboardData(CF_UNICODETEXT, Some(HANDLE(backup.0))) }.is_err()
                    {
                        let _ = unsafe { GlobalFree(Some(backup)) };
                        return Err(PasteError::new(PasteErrorCode::RestoreFailed));
                    }
                }
            }
            return Err(PasteError::new(PasteErrorCode::ClipboardWriteFailed));
        }
        Ok(unsafe { GetClipboardSequenceNumber() })
    }

    fn input(key: VIRTUAL_KEY, scan: u16, unicode: bool, up: bool) -> INPUT {
        let mut flags = if unicode {
            KEYEVENTF_UNICODE
        } else {
            Default::default()
        };
        if up {
            flags |= KEYEVENTF_KEYUP;
        }
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: key,
                    wScan: scan,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    fn send(inputs: &[INPUT], error: PasteErrorCode) -> Result<(), PasteError> {
        // SAFETY: INPUT is repr(C), the size matches Win32, and SendInput copies the slice.
        let count = unsafe { SendInput(inputs, mem::size_of::<INPUT>() as i32) };
        if count != inputs.len() as u32 {
            return Err(PasteError::new(error));
        }
        Ok(())
    }

    impl ClipboardPlatform for SystemPlatform {
        type Receipt = u32;

        fn secure_input(&mut self) -> Result<bool, PasteError> {
            // Only a standard EDIT control exposes a password style we can inspect. Browser,
            // custom, and otherwise unidentifiable controls cannot be assumed nonsecure.
            let unknown = || PasteError::new(PasteErrorCode::SecureInputUnknown);
            let foreground = unsafe { GetForegroundWindow() };
            if foreground.is_invalid() {
                return Err(unknown());
            }
            let thread = unsafe { GetWindowThreadProcessId(foreground, None) };
            if thread == 0 {
                return Err(unknown());
            }
            let mut info = GUITHREADINFO {
                cbSize: mem::size_of::<GUITHREADINFO>() as u32,
                ..Default::default()
            };
            unsafe { GetGUIThreadInfo(thread, &mut info) }.map_err(|_| unknown())?;
            let focus = info.hwndFocus;
            if focus.is_invalid() {
                return Err(unknown());
            }
            let mut name = [0u16; 32];
            let length = unsafe { GetClassNameW(focus, &mut name) };
            if length <= 0
                || !String::from_utf16_lossy(&name[..length as usize]).eq_ignore_ascii_case("Edit")
            {
                return Err(unknown());
            }
            // A zero style can be valid, so clear last error before the ambiguous Win32 call.
            unsafe { SetLastError(WIN32_ERROR(0)) };
            let style = unsafe { GetWindowLongPtrW(focus, GWL_STYLE) };
            if style == 0 && unsafe { GetLastError() }.0 != 0 {
                return Err(unknown());
            }
            Ok((style & ES_PASSWORD as isize) != 0)
        }

        fn can_send_keys(&mut self) -> Result<(), PasteError> {
            if unsafe { GetForegroundWindow() }.is_invalid() {
                return Err(PasteError::new(PasteErrorCode::PasteUnavailable));
            }
            Ok(())
        }

        fn read_clipboard(&mut self) -> ClipboardContent {
            let Ok(_opened) = OpenedClipboard::open(None) else {
                return ClipboardContent::Unknown;
            };
            let before = unsafe { GetClipboardSequenceNumber() };
            let Ok(formats) = formats() else {
                return ClipboardContent::Unknown;
            };
            let content = match classify_windows_formats(&formats) {
                ClipboardContent::Text(_) => read_text()
                    .map(ClipboardContent::Text)
                    .unwrap_or(ClipboardContent::Unknown),
                other => other,
            };
            if before != 0 && unsafe { GetClipboardSequenceNumber() } == before {
                content
            } else {
                ClipboardContent::Unknown
            }
        }

        fn write_text(
            &mut self,
            text: &str,
            original: Option<&str>,
        ) -> Result<Self::Receipt, PasteError> {
            let owner = ClipboardOwner::new()?;
            write_text(text, &owner, original)
        }

        fn send_paste(&mut self) -> Result<(), PasteError> {
            send(
                &[
                    input(VK_CONTROL, 0, false, false),
                    input(VK_V, 0, false, false),
                    input(VK_V, 0, false, true),
                    input(VK_CONTROL, 0, false, true),
                ],
                PasteErrorCode::PasteUnavailable,
            )
        }

        fn type_text(&mut self, text: &str) -> Result<(), PasteError> {
            // SendInput KEYEVENTF_UNICODE delivers UTF-16 WM_CHAR messages irrespective of the
            // user's keyboard layout. Use real Return/Tab keys for those two control characters.
            for step in typing_plan(text, 128) {
                match step {
                    TypeStep::Unicode(units) => {
                        let mut events = Vec::with_capacity(units.len() * 2);
                        for unit in units {
                            events.push(input(VIRTUAL_KEY(0), unit, true, false));
                            events.push(input(VIRTUAL_KEY(0), unit, true, true));
                        }
                        send(&events, PasteErrorCode::TypingUnavailable)?;
                    }
                    TypeStep::Return => send(
                        &[
                            input(VK_RETURN, 0, false, false),
                            input(VK_RETURN, 0, false, true),
                        ],
                        PasteErrorCode::TypingUnavailable,
                    )?,
                    TypeStep::Tab => send(
                        &[
                            input(VK_TAB, 0, false, false),
                            input(VK_TAB, 0, false, true),
                        ],
                        PasteErrorCode::TypingUnavailable,
                    )?,
                }
            }
            Ok(())
        }

        fn wait(&mut self, duration: Duration) {
            std::thread::sleep(duration);
        }

        fn unchanged(&mut self, receipt: &Self::Receipt) -> bool {
            let sequence = unsafe { GetClipboardSequenceNumber() };
            sequence != 0 && sequence == *receipt
        }

        fn restore_text(&mut self, original: Option<&str>) -> Result<(), PasteError> {
            if let Some(original) = original {
                let owner = ClipboardOwner::new()
                    .map_err(|_| PasteError::new(PasteErrorCode::RestoreFailed))?;
                write_text(original, &owner, None)
                    .map(|_| ())
                    .map_err(|_| PasteError::new(PasteErrorCode::RestoreFailed))
            } else {
                let owner = ClipboardOwner::new()
                    .map_err(|_| PasteError::new(PasteErrorCode::RestoreFailed))?;
                let _opened = OpenedClipboard::open(Some(owner.0))
                    .map_err(|_| PasteError::new(PasteErrorCode::RestoreFailed))?;
                unsafe { EmptyClipboard() }
                    .map_err(|_| PasteError::new(PasteErrorCode::RestoreFailed))
            }
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
mod system {
    use super::*;
    #[derive(Default)]
    pub struct SystemPlatform;
    impl ClipboardPlatform for SystemPlatform {
        type Receipt = ();
        fn secure_input(&mut self) -> Result<bool, PasteError> {
            Err(PasteError::new(PasteErrorCode::SecureInputUnknown))
        }
        fn can_send_keys(&mut self) -> Result<(), PasteError> {
            Err(PasteError::new(PasteErrorCode::PasteUnavailable))
        }
        fn read_clipboard(&mut self) -> ClipboardContent {
            ClipboardContent::Unknown
        }
        fn write_text(&mut self, _: &str, _: Option<&str>) -> Result<(), PasteError> {
            Err(PasteError::new(PasteErrorCode::ClipboardWriteFailed))
        }
        fn send_paste(&mut self) -> Result<(), PasteError> {
            Err(PasteError::new(PasteErrorCode::PasteUnavailable))
        }
        fn type_text(&mut self, _: &str) -> Result<(), PasteError> {
            Err(PasteError::new(PasteErrorCode::TypingUnavailable))
        }
        fn wait(&mut self, _: Duration) {}
        fn unchanged(&mut self, _: &()) -> bool {
            false
        }
        fn restore_text(&mut self, _: Option<&str>) -> Result<(), PasteError> {
            Err(PasteError::new(PasteErrorCode::RestoreFailed))
        }
    }
}

// PLATFORM-MODULES

#[cfg(test)]
mod tests {
    use super::*;

    /// Everything the fake platform was asked to do, in order.
    #[derive(Clone, Debug, PartialEq, Eq)]
    enum Call {
        SecureInput,
        Keys,
        Read,
        Write(String),
        Paste,
        Type(String),
        Wait(Duration),
        Unchanged,
        Restore(Option<String>),
    }

    struct Fake {
        calls: Vec<Call>,
        secure: Result<bool, PasteError>,
        keys: Result<(), PasteError>,
        clipboard: ClipboardContent,
        write: Result<(), PasteError>,
        paste: Result<(), PasteError>,
        typing: Result<(), PasteError>,
        unchanged: bool,
        restore: Result<(), PasteError>,
    }

    impl Fake {
        fn with_clipboard(clipboard: ClipboardContent) -> Self {
            Self {
                calls: Vec::new(),
                secure: Ok(false),
                keys: Ok(()),
                clipboard,
                write: Ok(()),
                paste: Ok(()),
                typing: Ok(()),
                unchanged: true,
                restore: Ok(()),
            }
        }
        fn text(previous: &str) -> Self {
            Self::with_clipboard(ClipboardContent::Text(previous.to_string()))
        }
    }

    impl ClipboardPlatform for Fake {
        type Receipt = ();
        fn secure_input(&mut self) -> Result<bool, PasteError> {
            self.calls.push(Call::SecureInput);
            self.secure.clone()
        }
        fn can_send_keys(&mut self) -> Result<(), PasteError> {
            self.calls.push(Call::Keys);
            self.keys.clone()
        }
        fn read_clipboard(&mut self) -> ClipboardContent {
            self.calls.push(Call::Read);
            self.clipboard.clone()
        }
        fn write_text(&mut self, text: &str, _: Option<&str>) -> Result<(), PasteError> {
            self.calls.push(Call::Write(text.to_string()));
            self.write.clone()
        }
        fn send_paste(&mut self) -> Result<(), PasteError> {
            self.calls.push(Call::Paste);
            self.paste.clone()
        }
        fn type_text(&mut self, text: &str) -> Result<(), PasteError> {
            self.calls.push(Call::Type(text.to_string()));
            self.typing.clone()
        }
        fn wait(&mut self, duration: Duration) {
            self.calls.push(Call::Wait(duration));
        }
        fn unchanged(&mut self, _: &()) -> bool {
            self.calls.push(Call::Unchanged);
            self.unchanged
        }
        fn restore_text(&mut self, original: Option<&str>) -> Result<(), PasteError> {
            self.calls.push(Call::Restore(original.map(str::to_string)));
            self.restore.clone()
        }
    }

    fn code(result: Result<PasteOutcome, PasteError>) -> PasteErrorCode {
        result.expect_err("expected a refusal").code
    }

    // ---- text validation ----------------------------------------------------------------

    #[test]
    fn empty_text_is_refused_before_the_platform_is_touched() {
        let mut fake = Fake::text("keep");
        assert_eq!(code(paste_with(&mut fake, "")), PasteErrorCode::EmptyText);
        assert!(fake.calls.is_empty());
    }

    #[test]
    fn text_of_exactly_the_limit_is_accepted_and_one_more_is_refused() {
        assert!(validate_text(&"a".repeat(MAX_TEXT_CHARS)).is_ok());
        assert_eq!(
            validate_text(&"a".repeat(MAX_TEXT_CHARS + 1))
                .unwrap_err()
                .code,
            PasteErrorCode::TooLong
        );
    }

    #[test]
    fn the_limit_counts_characters_not_bytes() {
        assert!(validate_text(&"é".repeat(MAX_TEXT_CHARS)).is_ok());
        assert!(validate_text(&"😀".repeat(MAX_TEXT_CHARS)).is_ok());
        assert_eq!(
            validate_text(&"😀".repeat(MAX_TEXT_CHARS + 1))
                .unwrap_err()
                .code,
            PasteErrorCode::TooLong
        );
    }

    #[test]
    fn newline_and_tab_are_allowed() {
        assert!(validate_text("one\ntwo\tthree").is_ok());
    }

    #[test]
    fn other_control_characters_are_refused() {
        for bad in [
            "a\u{0}b", "a\u{7}b", "a\u{8}b", "a\rb", "a\u{b}b", "a\u{c}b", "a\u{1b}b", "a\u{7f}b",
            "a\u{85}b", "a\u{9b}b",
        ] {
            assert_eq!(
                validate_text(bad).unwrap_err().code,
                PasteErrorCode::ControlCharacters,
                "{bad:?}"
            );
        }
    }

    #[test]
    fn control_characters_are_refused_before_the_platform_is_touched() {
        let mut fake = Fake::text("keep");
        assert_eq!(
            code(paste_with(&mut fake, "bad\u{1b}[31m")),
            PasteErrorCode::ControlCharacters
        );
        assert!(fake.calls.is_empty());
    }

    // ---- secure input -------------------------------------------------------------------

    #[test]
    fn secure_input_refuses_and_leaves_the_clipboard_alone() {
        let mut fake = Fake::text("keep");
        fake.secure = Ok(true);
        assert_eq!(
            code(paste_with(&mut fake, "hello")),
            PasteErrorCode::SecureInput
        );
        assert_eq!(fake.calls, vec![Call::SecureInput]);
    }

    #[test]
    fn secure_input_also_refuses_when_the_clipboard_holds_non_text() {
        // Typing into a password field is exactly what secure input exists to stop.
        let mut fake = Fake::with_clipboard(ClipboardContent::NonText);
        fake.secure = Ok(true);
        assert_eq!(
            code(paste_with(&mut fake, "hello")),
            PasteErrorCode::SecureInput
        );
        assert_eq!(fake.calls, vec![Call::SecureInput]);
    }

    #[test]
    fn unknown_secure_status_refuses_before_clipboard_or_typing() {
        for clipboard in [
            ClipboardContent::Text("keep".into()),
            ClipboardContent::NonText,
        ] {
            let mut fake = Fake::with_clipboard(clipboard);
            fake.secure = Err(PasteError::new(PasteErrorCode::SecureInputUnknown));
            assert_eq!(
                code(paste_with(&mut fake, "hello")),
                PasteErrorCode::SecureInputUnknown
            );
            assert_eq!(fake.calls, vec![Call::SecureInput]);
        }
    }

    #[test]
    fn keys_that_cannot_be_sent_refuse_before_the_clipboard_is_touched() {
        for clipboard in [ClipboardContent::Empty, ClipboardContent::NonText] {
            let mut fake = Fake::with_clipboard(clipboard);
            fake.keys = Err(PasteError::new(PasteErrorCode::PasteUnavailable));
            assert_eq!(
                code(paste_with(&mut fake, "hello")),
                PasteErrorCode::PasteUnavailable
            );
            assert_eq!(fake.calls, vec![Call::SecureInput, Call::Keys]);
        }
    }

    // ---- the text clipboard path --------------------------------------------------------

    #[test]
    fn pastes_then_restores_the_original_text_after_the_delay() {
        let mut fake = Fake::text("before");
        assert_eq!(paste_with(&mut fake, "hello"), Ok(PasteOutcome::Pasted));
        assert_eq!(
            fake.calls,
            vec![
                Call::SecureInput,
                Call::Keys,
                Call::Read,
                Call::Write("hello".into()),
                Call::Paste,
                Call::Wait(RESTORE_DELAY),
                Call::Unchanged,
                Call::Restore(Some("before".into())),
            ]
        );
    }

    #[test]
    fn multiline_text_is_written_verbatim() {
        let mut fake = Fake::text("before");
        paste_with(&mut fake, "a\n\tb").unwrap();
        assert!(fake.calls.contains(&Call::Write("a\n\tb".into())));
    }

    #[test]
    fn an_empty_clipboard_is_restored_to_empty() {
        let mut fake = Fake::with_clipboard(ClipboardContent::Empty);
        assert_eq!(paste_with(&mut fake, "hello"), Ok(PasteOutcome::Pasted));
        assert_eq!(fake.calls.last(), Some(&Call::Restore(None)));
    }

    #[test]
    fn the_clipboard_is_not_restored_when_the_user_copied_something_meanwhile() {
        let mut fake = Fake::text("before");
        fake.unchanged = false;
        assert_eq!(paste_with(&mut fake, "hello"), Ok(PasteOutcome::Pasted));
        assert!(!fake.calls.iter().any(|c| matches!(c, Call::Restore(_))));
        assert_eq!(fake.calls.last(), Some(&Call::Unchanged));
    }

    #[test]
    fn the_restore_waits_for_the_delay_after_the_paste_chord() {
        let mut fake = Fake::text("before");
        paste_with(&mut fake, "hello").unwrap();
        let position = |wanted: &Call| fake.calls.iter().position(|c| c == wanted).unwrap();
        assert!(position(&Call::Paste) < position(&Call::Wait(RESTORE_DELAY)));
        assert!(position(&Call::Wait(RESTORE_DELAY)) < position(&Call::Unchanged));
        assert!(RESTORE_DELAY >= Duration::from_millis(100));
        assert!(RESTORE_DELAY <= Duration::from_secs(1));
    }

    #[test]
    fn a_failed_paste_chord_still_restores_and_reports_the_failure() {
        let mut fake = Fake::text("before");
        fake.paste = Err(PasteError::new(PasteErrorCode::PasteUnavailable));
        assert_eq!(
            code(paste_with(&mut fake, "hello")),
            PasteErrorCode::PasteUnavailable
        );
        assert_eq!(
            fake.calls.last(),
            Some(&Call::Restore(Some("before".into())))
        );
    }

    #[test]
    fn a_failed_restore_is_reported_after_a_successful_paste() {
        let mut fake = Fake::text("before");
        fake.restore = Err(PasteError::new(PasteErrorCode::ClipboardWriteFailed));
        assert_eq!(
            code(paste_with(&mut fake, "hello")),
            PasteErrorCode::RestoreFailed
        );
    }

    #[test]
    fn the_paste_failure_wins_over_a_restore_failure() {
        let mut fake = Fake::text("before");
        fake.paste = Err(PasteError::new(PasteErrorCode::PasteUnavailable));
        fake.restore = Err(PasteError::new(PasteErrorCode::ClipboardWriteFailed));
        assert_eq!(
            code(paste_with(&mut fake, "hello")),
            PasteErrorCode::PasteUnavailable
        );
    }

    #[test]
    fn a_failed_clipboard_write_sends_no_chord_and_does_not_retry_restoration() {
        let mut fake = Fake::text("before");
        fake.write = Err(PasteError::new(PasteErrorCode::ClipboardWriteFailed));
        assert_eq!(
            code(paste_with(&mut fake, "hello")),
            PasteErrorCode::ClipboardWriteFailed
        );
        assert_eq!(
            fake.calls,
            vec![
                Call::SecureInput,
                Call::Keys,
                Call::Read,
                Call::Write("hello".into())
            ]
        );
    }

    // ---- non-text clipboard -------------------------------------------------------------

    #[test]
    fn a_non_text_clipboard_is_never_overwritten_and_the_text_is_typed() {
        let mut fake = Fake::with_clipboard(ClipboardContent::NonText);
        assert_eq!(paste_with(&mut fake, "hello"), Ok(PasteOutcome::Typed));
        assert_eq!(
            fake.calls,
            vec![
                Call::SecureInput,
                Call::Keys,
                Call::Read,
                Call::Type("hello".into())
            ]
        );
    }

    #[test]
    fn a_non_text_clipboard_with_unavailable_typing_is_refused_untouched() {
        let mut fake = Fake::with_clipboard(ClipboardContent::NonText);
        fake.typing = Err(PasteError::new(PasteErrorCode::TypingUnavailable));
        assert_eq!(
            code(paste_with(&mut fake, "hello")),
            PasteErrorCode::TypingUnavailable
        );
        assert!(!fake
            .calls
            .iter()
            .any(|c| matches!(c, Call::Write(_) | Call::Restore(_))));
    }

    #[test]
    fn an_unreadable_clipboard_is_refused_untouched() {
        let mut fake = Fake::with_clipboard(ClipboardContent::Unknown);
        assert_eq!(
            code(paste_with(&mut fake, "hello")),
            PasteErrorCode::ClipboardUnavailable
        );
        assert_eq!(fake.calls, vec![Call::SecureInput, Call::Keys, Call::Read]);
    }

    // ---- serialisation ------------------------------------------------------------------

    #[test]
    fn outcomes_serialise_as_snake_case_strings() {
        assert_eq!(
            serde_json::to_string(&PasteOutcome::Pasted).unwrap(),
            "\"pasted\""
        );
        assert_eq!(
            serde_json::to_string(&PasteOutcome::Typed).unwrap(),
            "\"typed\""
        );
    }

    #[test]
    fn errors_serialise_with_a_code_and_a_message() {
        let json = serde_json::to_value(PasteError::new(PasteErrorCode::SecureInput)).unwrap();
        assert_eq!(json["code"], "secure_input");
        assert!(json["message"].as_str().unwrap().contains("protected"));
        assert_eq!(json.as_object().unwrap().len(), 2);
    }

    #[test]
    fn every_error_code_has_a_distinct_snake_case_code_and_message() {
        let all = [
            PasteErrorCode::EmptyText,
            PasteErrorCode::TooLong,
            PasteErrorCode::ControlCharacters,
            PasteErrorCode::SecureInput,
            PasteErrorCode::SecureInputUnknown,
            PasteErrorCode::ClipboardUnavailable,
            PasteErrorCode::ClipboardWriteFailed,
            PasteErrorCode::PasteUnavailable,
            PasteErrorCode::TypingUnavailable,
            PasteErrorCode::RestoreFailed,
        ];
        let mut codes = Vec::new();
        let mut messages = Vec::new();
        for code in all {
            let error = PasteError::new(code);
            assert!(!error.message.is_empty());
            codes.push(
                serde_json::to_value(code)
                    .unwrap()
                    .as_str()
                    .unwrap()
                    .to_string(),
            );
            messages.push(error.message);
            assert_eq!(error.to_string(), error.message);
        }
        for code in &codes {
            assert!(
                code.chars().all(|c| c.is_ascii_lowercase() || c == '_'),
                "{code}"
            );
        }
        codes.sort();
        codes.dedup();
        messages.sort_unstable();
        messages.dedup();
        assert_eq!(codes.len(), all.len());
        assert_eq!(messages.len(), all.len());
    }

    #[test]
    fn error_messages_never_contain_the_dictated_text() {
        let mut fake = Fake::text("before");
        fake.paste = Err(PasteError::new(PasteErrorCode::PasteUnavailable));
        let error = paste_with(&mut fake, "very private sentence").unwrap_err();
        assert!(!error.message.contains("private"));
    }

    // ---- typing plan --------------------------------------------------------------------

    fn units(s: &str) -> Vec<u16> {
        s.encode_utf16().collect()
    }

    #[test]
    fn typing_plan_turns_newlines_and_tabs_into_key_presses() {
        assert_eq!(
            typing_plan("ab\n\tc", 20),
            vec![
                TypeStep::Unicode(units("ab")),
                TypeStep::Return,
                TypeStep::Tab,
                TypeStep::Unicode(units("c")),
            ]
        );
        assert_eq!(
            typing_plan("\n\n", 20),
            vec![TypeStep::Return, TypeStep::Return]
        );
        assert!(typing_plan("", 20).is_empty());
    }

    #[test]
    fn typing_plan_chunks_to_the_limit_without_splitting_surrogate_pairs() {
        let plan = typing_plan("abc😀def", 4);
        assert_eq!(
            plan,
            vec![
                TypeStep::Unicode(units("abc")),
                TypeStep::Unicode(units("😀de")),
                TypeStep::Unicode(units("f")),
            ]
        );
        for step in typing_plan(&"😀".repeat(50), 20) {
            let TypeStep::Unicode(run) = step else {
                panic!("unexpected key")
            };
            assert!(run.len() <= 20);
            assert!(String::from_utf16(&run).is_ok());
        }
    }

    #[test]
    fn typing_plan_round_trips_the_text() {
        let text = "héllo wörld 😀\n\tこんにちは\n";
        let mut rebuilt = String::new();
        for step in typing_plan(text, 20) {
            match step {
                TypeStep::Unicode(run) => rebuilt.push_str(&String::from_utf16(&run).unwrap()),
                TypeStep::Return => rebuilt.push('\n'),
                TypeStep::Tab => rebuilt.push('\t'),
            }
        }
        assert_eq!(rebuilt, text);
    }

    // ---- per-platform helpers -----------------------------------------------------------

    #[test]
    fn crlf_conversion_only_touches_bare_newlines() {
        assert_eq!(to_crlf("a\nb"), "a\r\nb");
        assert_eq!(to_crlf("a\r\nb"), "a\r\nb");
        assert_eq!(to_crlf("\n\n"), "\r\n\r\n");
        assert_eq!(to_crlf("plain"), "plain");
    }

    #[test]
    fn mac_types_classification() {
        let none: [&str; 0] = [];
        assert_eq!(classify_mac_types(&none), ClipboardContent::Empty);
        assert_eq!(
            classify_mac_types(&["public.utf8-plain-text"]),
            ClipboardContent::Text(String::new())
        );
        // Rich text copied from an editor still counts as text.
        assert_eq!(
            classify_mac_types(&["public.rtf", "public.html", "public.utf8-plain-text"]),
            ClipboardContent::Text(String::new())
        );
        assert_eq!(
            classify_mac_types(&["public.png"]),
            ClipboardContent::NonText
        );
        assert_eq!(
            classify_mac_types(&["public.rtf"]),
            ClipboardContent::NonText
        );
        // Finder: file URL plus the file name as a string.
        assert_eq!(
            classify_mac_types(&["public.file-url", "public.utf8-plain-text"]),
            ClipboardContent::NonText
        );
        // Password manager: text, but marked concealed.
        assert_eq!(
            classify_mac_types(&["public.utf8-plain-text", "org.nspasteboard.ConcealedType"]),
            ClipboardContent::NonText
        );
        assert_eq!(
            classify_mac_types(&["public.tiff", "public.utf8-plain-text"]),
            ClipboardContent::NonText
        );
        // Unknown payload coexisting with a string is still non-text.
        assert_eq!(
            classify_mac_types(&["public.utf8-plain-text", "com.example.unknown-binary"]),
            ClipboardContent::NonText
        );
    }

    #[test]
    fn linux_target_classification() {
        let none: [&str; 0] = [];
        assert_eq!(classify_linux_targets(&none), ClipboardContent::Empty);
        assert_eq!(
            classify_linux_targets(&["TARGETS", "TIMESTAMP"]),
            ClipboardContent::Empty
        );
        assert_eq!(
            classify_linux_targets(&["TARGETS", "UTF8_STRING", "STRING", "text/plain"]),
            ClipboardContent::Text(String::new())
        );
        assert_eq!(
            classify_linux_targets(&["text/html", "UTF8_STRING"]),
            ClipboardContent::Text(String::new())
        );
        assert_eq!(
            classify_linux_targets(&["image/png"]),
            ClipboardContent::NonText
        );
        assert_eq!(
            classify_linux_targets(&["text/html"]),
            ClipboardContent::NonText
        );
        assert_eq!(
            classify_linux_targets(&["text/uri-list", "UTF8_STRING"]),
            ClipboardContent::NonText
        );
        assert_eq!(
            classify_linux_targets(&["UTF8_STRING", "x-kde-passwordManagerHint"]),
            ClipboardContent::NonText
        );
        assert_eq!(
            classify_linux_targets(&["x-special/gnome-copied-files", "UTF8_STRING"]),
            ClipboardContent::NonText
        );
        assert_eq!(
            classify_linux_targets(&["UTF8_STRING", "application/x-unknown-binary"]),
            ClipboardContent::NonText
        );
    }

    #[test]
    fn x11_keysyms() {
        assert_eq!(x11_keysym('a'), 0x61);
        assert_eq!(x11_keysym(' '), 0x20);
        assert_eq!(x11_keysym('é'), 0xe9);
        assert_eq!(x11_keysym('€'), 0x0100_20ac);
        assert_eq!(x11_keysym('😀'), 0x0101_f600);
        // 0x7f..0x9f are not printable Latin-1.
        assert_eq!(x11_keysym('\u{a0}'), 0xa0);
        assert_eq!(x11_keysym('\u{100}'), 0x0100_0100);
    }

    fn format(id: u32, name: Option<&str>) -> WindowsFormat {
        WindowsFormat {
            id,
            name: name.map(str::to_string),
        }
    }

    #[test]
    fn windows_format_classification() {
        assert_eq!(classify_windows_formats(&[]), ClipboardContent::Empty);
        let text = ClipboardContent::Text(String::new());
        assert_eq!(classify_windows_formats(&[format(13, None)]), text);
        // Windows synthesises CF_TEXT, CF_OEMTEXT and CF_LOCALE next to CF_UNICODETEXT.
        assert_eq!(
            classify_windows_formats(&[
                format(13, None),
                format(1, None),
                format(7, None),
                format(16, None)
            ]),
            text
        );
        assert_eq!(
            classify_windows_formats(&[
                format(13, None),
                format(0xC0A1, Some("HTML Format")),
                format(0xC0A2, Some("Rich Text Format")),
            ]),
            text
        );
        // Bitmap (CF_BITMAP, CF_DIB) or file drop (CF_HDROP).
        assert_eq!(
            classify_windows_formats(&[format(2, None), format(8, None)]),
            ClipboardContent::NonText
        );
        assert_eq!(
            classify_windows_formats(&[format(15, None), format(13, None)]),
            ClipboardContent::NonText
        );
        assert_eq!(
            classify_windows_formats(&[format(0xC0A1, Some("PNG"))]),
            ClipboardContent::NonText
        );
        assert_eq!(
            classify_windows_formats(&[format(0xC0A1, Some("HTML Format"))]),
            ClipboardContent::NonText
        );
        assert_eq!(
            classify_windows_formats(&[
                format(13, None),
                format(0xC0B0, Some("ExcludeClipboardContentFromMonitorProcessing")),
            ]),
            ClipboardContent::NonText
        );
        // An unnamed registered format cannot be judged, so it is not overwritten.
        assert_eq!(
            classify_windows_formats(&[format(13, None), format(0xC0B1, None)]),
            ClipboardContent::NonText
        );
        assert_eq!(
            classify_windows_formats(&[format(13, None), format(0xC0B2, Some("Vendor Binary"))]),
            ClipboardContent::NonText
        );
    }
}
