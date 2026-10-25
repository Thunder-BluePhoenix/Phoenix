// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Phase 93: the only platform code of the browser host.
//!
//! - [`pick_folder`]: a native "choose a download folder" dialog (AppKit `NSOpenPanel`, GTK
//!   `FileChooserDialog`, Win32 `SHBrowseForFolderW`). Called on the main thread from the webview's
//!   download callback, which needs its answer synchronously. (On Windows `SHBrowseForFolderW`
//!   needs COM on the calling thread; tao initialises it on the main thread. Reasoned, not run.)
//! - [`attach_rules`] (macOS only): compiles a WebKit content rule list and attaches it to a
//!   content webview's `WKUserContentController`.
//!
//! Linux (`UserContentFilterStore`) and Windows (`WebResourceRequested`) request blocking is NOT
//! built: it would need crates and APIs that could not be compiled or run here. See
//! `docs/mini-browser.md`.
//!
//! None of this was run by the author: a dialog or a webview needs a real display.

use std::path::PathBuf;

/// Asks the person for a folder. `message` says what is being downloaded and from where.
/// `None` is cancel, or "this system cannot show the dialog" (the download is then refused).
#[cfg(target_os = "macos")]
pub fn pick_folder(message: &str) -> Option<PathBuf> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSOpenPanel};
    use objc2_foundation::NSString;

    let mtm = MainThreadMarker::new()?;
    #[allow(deprecated)]
    NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
    let panel = NSOpenPanel::openPanel(mtm);
    panel.setCanChooseFiles(false);
    panel.setCanChooseDirectories(true);
    panel.setCanCreateDirectories(true);
    panel.setMessage(Some(&NSString::from_str(message)));
    panel.setPrompt(Some(&NSString::from_str("Download here")));
    // NSModalResponseOK is 1; Cancel (0) and Abort (-1001) are both "no folder".
    if panel.runModal() != 1 {
        return None;
    }
    let path = panel.URL()?.path()?.to_string();
    let path = PathBuf::from(path);
    path.is_absolute().then_some(path)
}

#[cfg(target_os = "linux")]
pub fn pick_folder(message: &str) -> Option<PathBuf> {
    use gtk::prelude::*;

    if !gtk::is_initialized_main_thread() {
        return None;
    }
    let dialog = gtk::FileChooserDialog::with_buttons(
        Some(message),
        None::<&gtk::Window>,
        gtk::FileChooserAction::SelectFolder,
        &[
            ("Cancel", gtk::ResponseType::Cancel),
            ("Download here", gtk::ResponseType::Accept),
        ],
    );
    dialog.set_local_only(true);
    dialog.set_create_folders(true);
    let answer = dialog.run();
    let path = dialog.filename();
    dialog.close();
    if answer != gtk::ResponseType::Accept {
        return None;
    }
    path.filter(|p| p.is_absolute())
}

#[cfg(windows)]
pub fn pick_folder(message: &str) -> Option<PathBuf> {
    use std::os::windows::ffi::OsStringExt;
    use windows::core::PCWSTR;
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::{
        SHBrowseForFolderW, SHGetPathFromIDListW, BIF_NEWDIALOGSTYLE, BIF_RETURNONLYFSDIRS,
        BROWSEINFOW,
    };

    let title: Vec<u16> = message.encode_utf16().chain(Some(0)).collect();
    let info = BROWSEINFOW {
        lpszTitle: PCWSTR(title.as_ptr()),
        ulFlags: BIF_RETURNONLYFSDIRS | BIF_NEWDIALOGSTYLE,
        ..Default::default()
    };
    // SAFETY: `info` and `title` outlive the call; the returned item list is freed below.
    unsafe {
        let item = SHBrowseForFolderW(&info);
        if item.is_null() {
            return None;
        }
        let mut buffer = [0u16; 260];
        let ok = SHGetPathFromIDListW(item, &mut buffer).as_bool();
        CoTaskMemFree(Some(item as *const _));
        if !ok {
            return None;
        }
        let len = buffer.iter().position(|c| *c == 0).unwrap_or(buffer.len());
        let path = PathBuf::from(std::ffi::OsString::from_wide(&buffer[..len]));
        path.is_absolute().then_some(path)
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
pub fn pick_folder(_message: &str) -> Option<PathBuf> {
    None
}

/// Compiles `json` (WebKit content rule list JSON, see `browser_rules`) under `id` and makes it
/// the ONLY rule list of the webview whose `WKUserContentController` is `controller`. Must run on
/// the main thread (`Webview::with_webview` guarantees it). `done` is called once, later, on the
/// main thread, with `Ok` after the list is attached or the reason it is not.
///
/// The store lives in a per-process folder under the system temp directory, not WebKit's shared
/// cache, and the compiled file is removed again as soon as the list is attached: the rules
/// (which include the person's per-site switches) are not left on disk.
#[cfg(target_os = "macos")]
pub fn attach_rules(
    controller: *mut std::ffi::c_void,
    id: &str,
    json: &str,
    done: std::sync::Arc<dyn Fn(Result<(), String>) + Send + Sync>,
) {
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::MainThreadMarker;
    use objc2_foundation::{NSError, NSString, NSURL};
    use objc2_web_kit::{WKContentRuleList, WKContentRuleListStore, WKUserContentController};
    use std::cell::RefCell;
    use std::ptr::NonNull;

    thread_local! {
        /// The list compiled last, so a second tab with the same rules attaches it at once.
        static COMPILED: RefCell<Option<(String, Retained<WKContentRuleList>)>> =
            const { RefCell::new(None) };
    }

    let Some(mtm) = MainThreadMarker::new() else {
        done(Err("rule lists must be attached on the main thread".into()));
        return;
    };
    // SAFETY: `controller` is the live WKUserContentController of a webview that exists for the
    // duration of this call (Tauri's `PlatformWebview::controller`); retaining it keeps it alive
    // until the compile completion runs.
    let Some(controller) =
        (unsafe { Retained::retain(controller.cast::<WKUserContentController>()) })
    else {
        done(Err("the webview has no content controller".into()));
        return;
    };
    // SAFETY: plain AppKit calls on the main thread with valid objects.
    unsafe {
        controller.removeAllContentRuleLists();
        if let Some((cached_id, list)) = COMPILED.with(|c| c.borrow().clone()) {
            if cached_id == id {
                controller.addContentRuleList(&list);
                done(Ok(()));
                return;
            }
        }
    }
    let dir = std::env::temp_dir().join(format!("phoenix-shields-{}", std::process::id()));
    if std::fs::create_dir_all(&dir).is_err() {
        done(Err("could not create the rule cache folder".into()));
        return;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
    }
    let Some(url) = dir
        .to_str()
        .map(|p| NSURL::fileURLWithPath(&NSString::from_str(p)))
    else {
        done(Err("the rule cache folder is not valid text".into()));
        return;
    };
    // SAFETY: the store is created and used on the main thread.
    let Some(store) = (unsafe { WKContentRuleListStore::storeWithURL(Some(&url), mtm) }) else {
        done(Err("WebKit refused the rule cache folder".into()));
        return;
    };
    let identifier = NSString::from_str(id);
    let source = NSString::from_str(json);
    let store_again = store.clone();
    let id_again = id.to_string();
    let block = RcBlock::new(move |list: *mut WKContentRuleList, error: *mut NSError| {
        // SAFETY: WebKit passes either a valid list or a valid error (never both null).
        let list = unsafe { Retained::retain(list) };
        match list {
            Some(list) => {
                unsafe { controller.addContentRuleList(&list) };
                COMPILED.with(|c| *c.borrow_mut() = Some((id_again.clone(), list)));
                // The attached list stays in memory; the file on disk is not needed any more.
                let name = NSString::from_str(&id_again);
                let noop = RcBlock::new(|_: *mut NSError| {});
                unsafe {
                    store_again.removeContentRuleListForIdentifier_completionHandler(
                        Some(&name),
                        Some(&noop),
                    );
                }
                done(Ok(()));
            }
            None => {
                let reason = NonNull::new(error)
                    .map(|e| unsafe { e.as_ref().localizedDescription().to_string() })
                    .unwrap_or_else(|| "WebKit gave no reason".to_string());
                done(Err(reason));
            }
        }
    });
    // SAFETY: both strings and the block outlive the call; WebKit copies the block.
    unsafe {
        store.compileContentRuleListForIdentifier_encodedContentRuleList_completionHandler(
            Some(&identifier),
            Some(&source),
            Some(&block),
        );
    }
}
