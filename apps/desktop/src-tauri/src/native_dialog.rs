// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! The only platform code of the quit veto: one native two-button dialog, shown on the main
//! thread. `Cancel` is the default button; `true` means the person chose **Quit anyway**. It uses
//! each system's own message box (AppKit `NSAlert`, Win32 `MessageBoxW`, GTK `MessageDialog`), so
//! no dialog plugin or new crate is needed. Closing the dialog any other way (Escape, the close
//! button) counts as Cancel.
//!
//! Not run by the author: the dialog needs a real display. The text it shows and the decision to
//! show it are pure and tested in `quit_veto.rs`.

use crate::quit_veto::Prompt;

/// Shows the dialog and waits for the answer. Must be called on the main thread; elsewhere (or
/// where the system cannot show it) it returns `None` and the caller keeps Phoenix running.
#[cfg(target_os = "macos")]
pub fn confirm(prompt: &Prompt) -> Option<bool> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSAlert, NSAlertSecondButtonReturn, NSAlertStyle, NSApplication};
    use objc2_foundation::NSString;

    let mtm = MainThreadMarker::new()?;
    // Phoenix runs as an accessory app (no Dock icon); without this the alert opens behind others.
    #[allow(deprecated)]
    NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
    let alert = NSAlert::new(mtm);
    alert.setAlertStyle(NSAlertStyle::Warning);
    alert.setMessageText(&NSString::from_str(prompt.title));
    alert.setInformativeText(&NSString::from_str(&prompt.message));
    // The first button is the default one (Return): Cancel.
    alert.addButtonWithTitle(&NSString::from_str(prompt.cancel));
    alert.addButtonWithTitle(&NSString::from_str(prompt.quit_anyway));
    // Only the second button is "Quit anyway"; every other response counts as Cancel.
    Some(alert.runModal() == NSAlertSecondButtonReturn)
}

#[cfg(windows)]
pub fn confirm(prompt: &Prompt) -> Option<bool> {
    use windows::core::PCWSTR;
    use windows::Win32::UI::WindowsAndMessaging::{
        MessageBoxW, IDYES, MB_DEFBUTTON2, MB_ICONWARNING, MB_SETFOREGROUND, MB_TOPMOST, MB_YESNO,
    };

    let wide = |text: &str| -> Vec<u16> { text.encode_utf16().chain(Some(0)).collect() };
    // Yes / No: the question is put so that "Yes" is quitting and the default (second) is "No".
    let text = wide(&format!(
        "{}\n\nQuit anyway? Choose No to cancel.",
        prompt.message
    ));
    let title = wide(prompt.title);
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
pub fn confirm(prompt: &Prompt) -> Option<bool> {
    use gtk::prelude::*;

    if !gtk::is_initialized_main_thread() {
        return None;
    }
    let dialog = gtk::MessageDialog::new(
        None::<&gtk::Window>,
        gtk::DialogFlags::MODAL,
        gtk::MessageType::Warning,
        gtk::ButtonsType::None,
        prompt.title,
    );
    dialog.set_secondary_text(Some(&prompt.message));
    dialog.add_button(prompt.cancel, gtk::ResponseType::Cancel);
    dialog.add_button(prompt.quit_anyway, gtk::ResponseType::Accept);
    dialog.set_default_response(gtk::ResponseType::Cancel);
    let answer = dialog.run();
    dialog.close();
    Some(answer == gtk::ResponseType::Accept)
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
pub fn confirm(_prompt: &Prompt) -> Option<bool> {
    None
}
