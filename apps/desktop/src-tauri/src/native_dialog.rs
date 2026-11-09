// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! The only platform code of the quit veto: one native two-button dialog, shown on the main
//! thread. `Cancel` is the default button; `true` means the person chose **Quit anyway**. It uses
//! each system's own message box (AppKit `NSAlert`, Win32 `MessageBoxW`, GTK `MessageDialog`), so
//! no dialog plugin or new crate is needed. Closing the dialog any other way (Escape, the close
//! button) counts as Cancel.
//!
//! The same dialog serves the recording-consent question of Phase 65 ([`confirm_consent`]), with
//! the same default (`Cancel`) and the same rule that closing it any other way is Cancel.
//!
//! Not run by the author: the dialog needs a real display. The text it shows and the decision to
//! show it are pure and tested in `quit_veto.rs`.

use crate::consent_dialog;
use crate::quit_veto::Prompt;

/// What a native two-button dialog shows. `Cancel`-style first button is always the default.
struct Dialog<'a> {
    title: &'a str,
    message: &'a str,
    cancel: &'a str,
    accept: &'a str,
    /// Windows only: the Yes/No question appended to the message ("Yes" is the accept button).
    #[cfg_attr(not(windows), allow(dead_code))]
    windows_question: &'a str,
}

/// Quit veto (Phase 73): `true` means **Quit anyway**.
pub fn confirm(prompt: &Prompt) -> Option<bool> {
    show(&Dialog {
        title: prompt.title,
        message: &prompt.message,
        cancel: prompt.cancel,
        accept: prompt.quit_anyway,
        windows_question: "Quit anyway? Choose No to cancel.",
    })
}

/// Recording consent (Phase 65): `true` means **Record**. Must be called on the main thread.
pub fn confirm_consent(prompt: &consent_dialog::Prompt) -> Option<bool> {
    show(&Dialog {
        title: prompt.title,
        message: &prompt.message,
        cancel: prompt.cancel,
        accept: prompt.accept,
        windows_question: "Record this call? Choose No to cancel.",
    })
}

/// Shows the dialog and waits for the answer. Must be called on the main thread; elsewhere (or
/// where the system cannot show it) it returns `None` and the caller keeps the safe default.
#[cfg(target_os = "macos")]
fn show(d: &Dialog) -> Option<bool> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSAlert, NSAlertSecondButtonReturn, NSAlertStyle, NSApplication};
    use objc2_foundation::NSString;

    let mtm = MainThreadMarker::new()?;
    // Phoenix runs as an accessory app (no Dock icon); without this the alert opens behind others.
    #[allow(deprecated)]
    NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
    let alert = NSAlert::new(mtm);
    alert.setAlertStyle(NSAlertStyle::Warning);
    alert.setMessageText(&NSString::from_str(d.title));
    alert.setInformativeText(&NSString::from_str(d.message));
    // The first button is the default one (Return): Cancel.
    alert.addButtonWithTitle(&NSString::from_str(d.cancel));
    alert.addButtonWithTitle(&NSString::from_str(d.accept));
    // Only the second button accepts; every other response counts as Cancel.
    Some(alert.runModal() == NSAlertSecondButtonReturn)
}

#[cfg(windows)]
fn show(d: &Dialog) -> Option<bool> {
    use windows::core::PCWSTR;
    use windows::Win32::UI::WindowsAndMessaging::{
        MessageBoxW, IDYES, MB_DEFBUTTON2, MB_ICONWARNING, MB_SETFOREGROUND, MB_TOPMOST, MB_YESNO,
    };

    let wide = |text: &str| -> Vec<u16> { text.encode_utf16().chain(Some(0)).collect() };
    // Yes / No: the question is put so that "Yes" accepts and the default (second) is "No".
    let text = wide(&format!("{}\n\n{}", d.message, d.windows_question));
    let title = wide(d.title);
    // SAFETY: both buffers are NUL-terminated and outlive the call; no owner window is given.
    let answer = unsafe {
        MessageBoxW(
            None,
            PCWSTR(text.as_ptr()),
            PCWSTR(title.as_ptr()),
            MB_YESNO | MB_DEFBUTTON2 | MB_ICONWARNING | MB_SETFOREGROUND | MB_TOPMOST,
        )
    };
    Some(answer == IDYES)
}

#[cfg(target_os = "linux")]
fn show(d: &Dialog) -> Option<bool> {
    use gtk::prelude::*;

    if !gtk::is_initialized_main_thread() {
        return None;
    }
    let dialog = gtk::MessageDialog::new(
        None::<&gtk::Window>,
        gtk::DialogFlags::MODAL,
        gtk::MessageType::Warning,
        gtk::ButtonsType::None,
        d.title,
    );
    dialog.set_secondary_text(Some(d.message));
    dialog.add_button(d.cancel, gtk::ResponseType::Cancel);
    dialog.add_button(d.accept, gtk::ResponseType::Accept);
    dialog.set_default_response(gtk::ResponseType::Cancel);
    let answer = dialog.run();
    dialog.close();
    Some(answer == gtk::ResponseType::Accept)
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
fn show(_d: &Dialog) -> Option<bool> {
    None
}
