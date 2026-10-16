// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! The guard in front of `dictation_paste`. The command is reachable from the pill page, and a
//! compromised page could call it at any time with any text. Two conservative rules limit what
//! such a call can do:
//!
//! 1. The text must not contain a line break or a tab. Typing those would press Return or Tab
//!    in the target (submit a form, move focus), so they are refused instead of translated.
//! 2. The application and field that had keyboard focus when the dictation STARTED (captured by
//!    the shell on the hotkey, never by the page) must still have it when the paste happens.
//!    A captured target is single use: it is taken by the paste attempt, successful or not.
//!
//! The OS lookup is the [`FocusSource`] seam, so every decision here is unit tested with a fake.
//! The system sources identify the focus as: macOS the Accessibility focused element, Windows
//! the foreground window plus its focused control, X11 the input-focus window. Anything the OS
//! will not tell us (no Accessibility permission, Wayland) is "unknown" and refuses the paste.

use parking_lot::Mutex;
use std::sync::Arc;

/// Where keyboard focus is. `None` means the OS could not say, which never counts as a match.
pub trait FocusSource {
    /// An opaque identity of the focused field; equal values mean the same target.
    type Target: PartialEq;

    fn current(&self) -> Option<Self::Target>;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GuardCode {
    /// The text contains a line break or a tab.
    LineBreaks,
    /// No focus target was captured when the dictation started.
    NoTarget,
    /// The focused target cannot be determined now.
    FocusUnknown,
    /// Another application or field has focus than when the dictation started.
    FocusChanged,
}

/// A typed refusal; `message` is user-facing and never contains the dictated text.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GuardRefusal {
    pub code: GuardCode,
    pub message: &'static str,
}

impl GuardRefusal {
    fn new(code: GuardCode) -> Self {
        let message = match code {
            GuardCode::LineBreaks => {
                "The dictated text contains a line break or tab and was not pasted."
            }
            GuardCode::NoTarget => {
                "Phoenix did not record where you were typing when dictation started, so nothing was pasted."
            }
            GuardCode::FocusUnknown => {
                "Phoenix cannot tell which field has focus, so nothing was pasted."
            }
            GuardCode::FocusChanged => {
                "The focus moved to another field since dictation started, so nothing was pasted."
            }
        };
        Self { code, message }
    }
}

/// Refuses the characters that would press Return or Tab in the target.
pub fn check_text(text: &str) -> Result<(), GuardRefusal> {
    // U+2028/U+2029 are line and paragraph breaks that some text fields also treat as Return.
    if text
        .chars()
        .any(|c| matches!(c, '\n' | '\r' | '\t' | '\u{2028}' | '\u{2029}'))
    {
        return Err(GuardRefusal::new(GuardCode::LineBreaks));
    }
    Ok(())
}

/// The focus captured at dictation start, shared between the hotkey worker (capture) and the
/// paste command (check). Cloning shares the same slot.
pub struct FocusGuard<S: FocusSource> {
    source: Arc<S>,
    captured: Arc<Mutex<Option<S::Target>>>,
}

impl<S: FocusSource> Clone for FocusGuard<S> {
    fn clone(&self) -> Self {
        Self {
            source: Arc::clone(&self.source),
            captured: Arc::clone(&self.captured),
        }
    }
}

impl<S: FocusSource> FocusGuard<S> {
    pub fn new(source: S) -> Self {
        Self {
            source: Arc::new(source),
            captured: Arc::new(Mutex::new(None)),
        }
    }

    /// Records the focus right now, replacing any earlier capture. An unreadable focus records
    /// nothing, so a later paste is refused rather than matched against a stale target. May
    /// block on the OS: call it from a worker thread.
    pub fn capture(&self) {
        let current = self.source.current();
        *self.captured.lock() = current;
    }

    pub fn clear(&self) {
        self.captured.lock().take();
    }

    /// Runs `paste` only if the text is single-line and the focus is still on the captured
    /// target. The capture is consumed whatever the outcome. `paste` is never called on refusal.
    pub fn run<T>(&self, text: &str, paste: impl FnOnce() -> T) -> Result<T, GuardRefusal> {
        check_text(text)?;
        let Some(captured) = self.captured.lock().take() else {
            return Err(GuardRefusal::new(GuardCode::NoTarget));
        };
        match self.source.current() {
            None => Err(GuardRefusal::new(GuardCode::FocusUnknown)),
            Some(now) if now != captured => Err(GuardRefusal::new(GuardCode::FocusChanged)),
            Some(_) => Ok(paste()),
        }
    }
}

/// The real focus lookup of this OS.
pub struct SystemFocus;

impl FocusSource for SystemFocus {
    type Target = system::Raw;

    fn current(&self) -> Option<Self::Target> {
        system::current()
    }
}

#[cfg(target_os = "macos")]
mod system {
    use core_foundation::base::{CFType, CFTypeRef, TCFType};
    use core_foundation::string::{CFString, CFStringRef};
    use std::ptr;

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXUIElementCreateSystemWide() -> CFTypeRef;
        fn AXUIElementCopyAttributeValue(
            element: CFTypeRef,
            attribute: CFStringRef,
            value: *mut CFTypeRef,
        ) -> i32;
        fn AXUIElementGetPid(element: CFTypeRef, pid: *mut i32) -> i32;
    }

    /// The Accessibility element that has keyboard focus, and the process that owns it.
    pub struct Raw {
        pid: i32,
        element: CFType,
    }

    // SAFETY: a retained CF object is only retained, released and compared (CFEqual); Core
    // Foundation permits that from any thread, and nothing else is done with the element.
    unsafe impl Send for Raw {}
    unsafe impl Sync for Raw {}

    impl PartialEq for Raw {
        fn eq(&self, other: &Self) -> bool {
            self.pid == other.pid && self.element == other.element
        }
    }

    pub fn current() -> Option<Raw> {
        // Without Accessibility permission the focused element is not readable. Passive check:
        // it never prompts.
        // SAFETY: plain status probe.
        if !unsafe { AXIsProcessTrusted() } {
            return None;
        }
        // SAFETY: returns a +1 reference (Create rule), released when `system` drops.
        let system = unsafe { AXUIElementCreateSystemWide() };
        if system.is_null() {
            return None;
        }
        // SAFETY: `system` is non-null and owned by us.
        let system = unsafe { CFType::wrap_under_create_rule(system) };
        let attribute = CFString::from_static_string("AXFocusedUIElement");
        let mut value: CFTypeRef = ptr::null();
        // SAFETY: valid element and attribute; `value` receives a +1 reference on success.
        let status = unsafe {
            AXUIElementCopyAttributeValue(
                system.as_CFTypeRef(),
                attribute.as_concrete_TypeRef(),
                &mut value,
            )
        };
        if status != 0 || value.is_null() {
            return None;
        }
        // SAFETY: `value` is a non-null +1 reference (Copy rule).
        let element = unsafe { CFType::wrap_under_create_rule(value) };
        let mut pid = 0;
        // SAFETY: valid element; `pid` is a live out pointer.
        let status = unsafe { AXUIElementGetPid(element.as_CFTypeRef(), &mut pid) };
        (status == 0 && pid > 0).then_some(Raw { pid, element })
    }
}

#[cfg(target_os = "linux")]
mod system {
    use std::ptr;
    use x11_dl::xlib;

    /// The X11 window that has input focus.
    pub type Raw = u64;

    pub fn current() -> Option<Raw> {
        let lib = xlib::Xlib::open().ok()?;
        // SAFETY: null selects DISPLAY. Without an X server (Wayland-only) this is null.
        let display = unsafe { (lib.XOpenDisplay)(ptr::null()) };
        if display.is_null() {
            return None;
        }
        let mut window = 0;
        let mut revert_to = 0;
        // SAFETY: `display` is open and the out pointers are live.
        unsafe { (lib.XGetInputFocus)(display, &mut window, &mut revert_to) };
        // SAFETY: `display` came from XOpenDisplay above and is not used afterwards.
        unsafe { (lib.XCloseDisplay)(display) };
        // 0 is `None` and 1 is `PointerRoot`: focus follows the pointer, so no fixed target.
        (window > 1).then_some(window)
    }
}

#[cfg(windows)]
mod system {
    use std::mem;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetGUIThreadInfo, GetWindowThreadProcessId, GUITHREADINFO,
    };

    /// The foreground window, the control inside it that has focus, and their owner.
    #[derive(PartialEq, Eq)]
    pub struct Raw {
        foreground: isize,
        focus: isize,
        process: u32,
        thread: u32,
    }

    pub fn current() -> Option<Raw> {
        // SAFETY: plain queries; every handle is checked before use.
        let foreground = unsafe { GetForegroundWindow() };
        if foreground.is_invalid() {
            return None;
        }
        let mut process = 0;
        let thread = unsafe { GetWindowThreadProcessId(foreground, Some(&raw mut process)) };
        if thread == 0 {
            return None;
        }
        let mut info = GUITHREADINFO {
            cbSize: mem::size_of::<GUITHREADINFO>() as u32,
            ..Default::default()
        };
        unsafe { GetGUIThreadInfo(thread, &mut info) }.ok()?;
        if info.hwndFocus.is_invalid() {
            return None;
        }
        Some(Raw {
            foreground: foreground.0 as isize,
            focus: info.hwndFocus.0 as isize,
            process,
            thread,
        })
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
mod system {
    /// No focus lookup on this OS: every paste is refused.
    #[derive(PartialEq, Eq)]
    pub struct Raw;

    pub fn current() -> Option<Raw> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    /// A focus source whose current target the test sets.
    struct Fake {
        now: Cell<Option<u32>>,
    }

    impl Fake {
        fn at(target: Option<u32>) -> FocusGuard<Fake> {
            FocusGuard::new(Fake {
                now: Cell::new(target),
            })
        }
    }

    impl FocusSource for Fake {
        type Target = u32;
        fn current(&self) -> Option<u32> {
            self.now.get()
        }
    }

    fn move_focus(guard: &FocusGuard<Fake>, to: Option<u32>) {
        guard.source.now.set(to);
    }

    #[test]
    fn pastes_when_the_captured_target_still_has_focus() {
        let guard = Fake::at(Some(7));
        guard.capture();
        assert_eq!(guard.run("hello world", || "done"), Ok("done"));
    }

    #[test]
    fn refuses_when_focus_moved_to_another_target() {
        let guard = Fake::at(Some(7));
        guard.capture();
        move_focus(&guard, Some(8));
        let mut called = false;
        let result = guard.run("hello", || called = true);
        assert_eq!(result.unwrap_err().code, GuardCode::FocusChanged);
        assert!(!called);
    }

    #[test]
    fn refuses_when_focus_cannot_be_read_at_paste_time() {
        let guard = Fake::at(Some(7));
        guard.capture();
        move_focus(&guard, None);
        let mut called = false;
        let result = guard.run("hello", || called = true);
        assert_eq!(result.unwrap_err().code, GuardCode::FocusUnknown);
        assert!(!called);
    }

    #[test]
    fn refuses_without_a_capture_even_if_focus_is_readable() {
        let guard = Fake::at(Some(7));
        let mut called = false;
        let result = guard.run("hello", || called = true);
        assert_eq!(result.unwrap_err().code, GuardCode::NoTarget);
        assert!(!called);
    }

    #[test]
    fn an_unreadable_focus_at_start_is_not_replaced_by_a_stale_capture() {
        let guard = Fake::at(Some(7));
        guard.capture();
        move_focus(&guard, None);
        guard.capture();
        move_focus(&guard, Some(7));
        assert_eq!(
            guard.run("hello", || ()).unwrap_err().code,
            GuardCode::NoTarget
        );
    }

    #[test]
    fn a_later_capture_replaces_the_earlier_one() {
        let guard = Fake::at(Some(7));
        guard.capture();
        move_focus(&guard, Some(9));
        guard.capture();
        assert_eq!(guard.run("hello", || 1), Ok(1));
    }

    #[test]
    fn the_capture_is_single_use_for_every_outcome() {
        let guard = Fake::at(Some(7));
        guard.capture();
        assert!(guard.run("hello", || ()).is_ok());
        assert_eq!(
            guard.run("hello", || ()).unwrap_err().code,
            GuardCode::NoTarget
        );
        guard.capture();
        move_focus(&guard, Some(8));
        assert_eq!(
            guard.run("hello", || ()).unwrap_err().code,
            GuardCode::FocusChanged
        );
        move_focus(&guard, Some(7));
        assert_eq!(
            guard.run("hello", || ()).unwrap_err().code,
            GuardCode::NoTarget
        );
    }

    #[test]
    fn clear_forgets_the_capture() {
        let guard = Fake::at(Some(7));
        guard.capture();
        guard.clear();
        assert_eq!(
            guard.run("hello", || ()).unwrap_err().code,
            GuardCode::NoTarget
        );
    }

    #[test]
    fn newline_return_and_tab_are_refused_without_consuming_the_capture() {
        let guard = Fake::at(Some(7));
        guard.capture();
        for text in [
            "a\nb",
            "a\r\nb",
            "a\tb",
            "\n",
            "\t",
            "a\u{2028}b",
            "a\u{2029}b",
        ] {
            let mut called = false;
            let result = guard.run(text, || called = true);
            assert_eq!(result.unwrap_err().code, GuardCode::LineBreaks, "{text:?}");
            assert!(!called);
        }
        assert!(guard.run("one line", || ()).is_ok());
    }

    #[test]
    fn text_is_checked_before_the_focus_is_read() {
        // A bad text must not depend on (or reveal anything about) the OS focus state.
        let guard = Fake::at(None);
        assert_eq!(
            guard.run("a\nb", || ()).unwrap_err().code,
            GuardCode::LineBreaks
        );
    }

    #[test]
    fn clones_share_the_same_capture() {
        let guard = Fake::at(Some(7));
        let worker = guard.clone();
        worker.capture();
        assert!(guard.run("hello", || ()).is_ok());
    }

    #[test]
    fn refusals_carry_a_message_that_never_contains_the_text() {
        for code in [
            GuardCode::LineBreaks,
            GuardCode::NoTarget,
            GuardCode::FocusUnknown,
            GuardCode::FocusChanged,
        ] {
            assert!(!GuardRefusal::new(code).message.is_empty());
        }
    }
}
