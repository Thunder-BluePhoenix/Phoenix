// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! The desktop host of the « OK Fawkes » voice assistant (Phase 66).
//!
//! The assistant itself is the web page `<Core>/voice.html` (the same `VoiceAssistant` the browser
//! runs: it captures with `getUserMedia`, streams 16 kHz PCM to Core's single-use same-origin
//! socket, and Core does the recognition). This module only hosts that page in a small window and
//! enforces four things from the shell side, without the page being trusted to do any of them:
//!
//! * **No Tauri command for the page.** The window `phoenix-voice` is named by NO capability file
//!   and NO runtime `add_capability`, so the page (remote content: a page of Core's origin) can
//!   invoke nothing and listen to nothing. It talks to the shell only through two things the web
//!   engine already exposes: a microphone permission request and its document title.
//! * **Microphone only for this page.** [`permission_decision`] allows the microphone request of
//!   exactly this window, on exactly Core's `/voice.html`, and denies every other kind and every
//!   other window or page. It never answers `Default`, so no other window or page falls back to the
//!   platform's own prompt-or-allow behaviour. Navigation away from the page and new windows are
//!   refused as well.
//! * **A visible LISTENING indicator the page cannot omit.** Allowing the microphone is what turns
//!   the indicator on, in the shell, before the stream can open: the window title and the tray
//!   tooltip say LISTENING. The page's own claim (its document title, [`CLAIM_ACTIVE`] /
//!   [`CLAIM_IDLE`]) can also turn it on, and can turn it off only after it said it was active
//!   (a stale "idle" from before the request is ignored). A page load, a navigation, the window
//!   closing or the kill switch turn it off.
//! * **A kill switch from the shell.** [`kill`] (tray menu "Stop voice listening") destroys the
//!   window and with it the web engine: the capture stream, the audio thread and the WebSocket to
//!   Core go with it, whatever the page is doing. Core ends the session when its socket closes.
//!
//! What this cannot see: whether a page that claims "idle" really released its microphone (the
//! shell does not read the web engine's capture state), and whether the platform asks again on a
//! second request (a platform that remembers an earlier grant could skip [`permission_decision`]
//! the second time; the page's "active" claim covers that case, a lying page does not). Nothing here
//! was run against a real microphone, permission prompt or packaged app.

use crate::Shell;
use parking_lot::Mutex;
use tauri::webview::{NewWindowResponse, PageLoadEvent, PermissionKind, PermissionResponse};
use tauri::{AppHandle, Manager, Runtime, Url, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "phoenix-voice";
/// The only page this window ever shows, served by Core next to `index.html`.
pub const PAGE_PATH: &str = "/voice.html";
/// Window title while the microphone is off.
pub const TITLE_OFF: &str = "Phoenix Voice - microphone off";
/// Window title while the microphone is on (the indicator the shell enforces).
pub const TITLE_LISTENING: &str = "Phoenix Voice - LISTENING (microphone on)";
/// Appended to the tray tooltip while the microphone is on.
pub const TOOLTIP_SUFFIX: &str = " - LISTENING (voice microphone on)";
/// The page's document titles, the only message it can send the shell. Same strings as
/// `apps/web/src/voice/shell.ts` (a web test compares them).
pub const CLAIM_ACTIVE: &str = "phoenix-voice:active";
pub const CLAIM_IDLE: &str = "phoenix-voice:idle";
const WINDOW_SIZE: (f64, f64) = (440.0, 660.0);

/// Core's voice page for `base_url` (`http://127.0.0.1:<port>`), or `None` if the base is not the
/// loopback http origin. Fixed by the shell, never supplied by a page.
pub fn page_url(base_url: &str) -> Option<Url> {
    let url = Url::parse(&format!("{base_url}{PAGE_PATH}")).ok()?;
    (url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.path() == PAGE_PATH)
        .then_some(url)
}

/// True when `url` is Core's voice page: same origin as `expected`, exactly `/voice.html`, no
/// query (a fragment is harmless and ignored).
pub fn is_voice_page(url: &Url, expected: &Url) -> bool {
    url.origin() == expected.origin() && url.path() == PAGE_PATH && url.query().is_none()
}

/// The one decision about a web-engine permission request in the voice window. Microphone, for the
/// voice window, on the voice page: `Allow`. Everything else: `Deny`. Never `Default`.
pub fn permission_decision(
    kind: PermissionKind,
    label: &str,
    page: Option<&Url>,
    expected: Option<&Url>,
) -> PermissionResponse {
    let on_voice_page = match (page, expected) {
        (Some(page), Some(expected)) => is_voice_page(page, expected),
        _ => false,
    };
    if kind == PermissionKind::Microphone && label == LABEL && on_voice_page {
        PermissionResponse::Allow
    } else {
        PermissionResponse::Deny
    }
}

/// The tray tooltip: `base` (the keep-awake text or "Fawkes"), plus the LISTENING suffix.
pub fn tooltip_text(base: &str, listening: bool) -> String {
    if listening {
        format!("{base}{TOOLTIP_SUFFIX}")
    } else {
        base.to_string()
    }
}

#[derive(Default)]
struct State {
    /// The URL the window is on, as last reported by a page load.
    page: Option<Url>,
    listening: bool,
    /// The page said "active" and has not said "idle" since: only then is an "idle" believed.
    claimed_active: bool,
    /// The tray tooltip without the indicator (Phase 72 writes the keep-awake text here).
    base_tooltip: Option<String>,
}

/// What the shell shows right now. Public for the lifecycle tests.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Snapshot {
    pub window_open: bool,
    pub listening: bool,
    pub title: &'static str,
    pub tooltip: String,
}

#[derive(Default)]
pub struct Host {
    state: Mutex<State>,
}

impl Host {
    /// A page load began (`started`) or finished. A new load forgets the old page's indicator: the
    /// microphone of a page that is gone is gone with it.
    fn page_load(&self, url: &Url, started: bool) {
        let mut state = self.state.lock();
        state.page = Some(url.clone());
        if started {
            state.listening = false;
            state.claimed_active = false;
        }
    }

    /// The permission request of the voice window. An `Allow` turns the indicator on here, before
    /// the stream can open: the shell does not wait for the page to say so.
    fn permission(
        &self,
        kind: PermissionKind,
        label: &str,
        expected: Option<&Url>,
    ) -> PermissionResponse {
        let mut state = self.state.lock();
        let response = permission_decision(kind, label, state.page.as_ref(), expected);
        if response == PermissionResponse::Allow {
            state.listening = true;
        }
        response
    }

    /// The page's document title changed. Returns whether the indicator changed.
    fn claim(&self, title: &str) -> bool {
        let mut state = self.state.lock();
        let before = state.listening;
        match title {
            // "Active" comes before the microphone is requested, so it can only over-report.
            CLAIM_ACTIVE => {
                state.claimed_active = true;
                state.listening = true;
            }
            CLAIM_IDLE if state.claimed_active => {
                state.claimed_active = false;
                state.listening = false;
            }
            _ => {}
        }
        state.listening != before
    }

    fn reset(&self) {
        let mut state = self.state.lock();
        state.page = None;
        state.listening = false;
        state.claimed_active = false;
    }

    pub fn listening(&self) -> bool {
        self.state.lock().listening
    }

    fn title(&self) -> &'static str {
        if self.listening() {
            TITLE_LISTENING
        } else {
            TITLE_OFF
        }
    }

    /// Phase 72 owns the tray tooltip's base text; the indicator is added on top of it.
    pub fn set_base_tooltip(&self, text: String) {
        self.state.lock().base_tooltip = Some(text);
    }

    pub fn tooltip(&self) -> String {
        let state = self.state.lock();
        tooltip_text(
            state.base_tooltip.as_deref().unwrap_or("Fawkes"),
            state.listening,
        )
    }
}

/// Puts the indicator on the window title and the tray tooltip. Safe from any thread.
fn apply<R: Runtime>(app: &AppHandle<R>) {
    let main = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(shell) = main.try_state::<Shell<R>>() else {
            return;
        };
        if let Some(window) = main.get_webview_window(LABEL) {
            let _ = window.set_title(shell.voice.title());
        }
        if let Some(tray) = main.tray_by_id(crate::TRAY_ID) {
            let _ = tray.set_tooltip(Some(shell.voice.tooltip()));
        }
    });
}

fn decide<R: Runtime>(app: &AppHandle<R>, label: &str, kind: PermissionKind) -> PermissionResponse {
    let Some(shell) = app.try_state::<Shell<R>>() else {
        return PermissionResponse::Deny;
    };
    let expected = page_url(&shell.locator.base_url);
    let response = shell.voice.permission(kind, label, expected.as_ref());
    if response == PermissionResponse::Allow {
        apply(app);
    }
    response
}

fn create_window<R: Runtime>(
    app: &AppHandle<R>,
    expected: Url,
) -> tauri::Result<tauri::WebviewWindow<R>> {
    let allowed = expected.clone();
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(expected))
        .title(TITLE_OFF)
        .inner_size(WINDOW_SIZE.0, WINDOW_SIZE.1)
        .resizable(true)
        .maximizable(false)
        // A listening assistant must not be tucked away: not minimisable, above other windows.
        .minimizable(false)
        .always_on_top(true)
        .visible(true)
        .focused(true)
        .on_navigation(move |url| is_voice_page(url, &allowed))
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_page_load(|window, payload| {
            let started = matches!(payload.event(), PageLoadEvent::Started);
            let app = window.app_handle();
            if let Some(shell) = app.try_state::<Shell<R>>() {
                shell.voice.page_load(payload.url(), started);
            }
            if started {
                apply(app);
            }
        })
        .on_document_title_changed(|window, title| {
            let app = window.app_handle();
            let changed = app
                .try_state::<Shell<R>>()
                .is_some_and(|shell| shell.voice.claim(&title));
            if changed {
                apply(app);
            }
        })
        .on_permission_request(|webview, kind| decide(webview.app_handle(), webview.label(), kind))
        .build()?;
    Ok(window)
}

/// Opens the voice window (or brings it forward). Never at startup: only the tray menu calls it.
pub fn show<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    let shell = app.state::<Shell<R>>();
    let Some(url) = page_url(&shell.locator.base_url) else {
        return Err(tauri::Error::AssetNotFound(
            "The voice page must be served by loopback Core".into(),
        ));
    };
    create_window(app, url)?;
    apply(app);
    Ok(())
}

/// The shell-side emergency stop. Destroys the window, so the web engine and its microphone
/// stream, audio thread and Core socket go with it whatever the page is doing, then clears the
/// indicator. Idempotent; always available. Returns whether a window was there and its destruction
/// was requested.
pub fn kill<R: Runtime>(app: &AppHandle<R>) -> bool {
    if let Some(shell) = app.try_state::<Shell<R>>() {
        shell.voice.reset();
    }
    let destroyed = app
        .get_webview_window(LABEL)
        .is_some_and(|window| window.destroy().is_ok());
    apply(app);
    destroyed
}

/// The window is gone by any route (closed by the person, destroyed by `kill`).
pub fn window_event<R: Runtime>(window: &tauri::Window<R>, event: &tauri::WindowEvent) {
    if window.label() == LABEL && matches!(event, tauri::WindowEvent::Destroyed) {
        if let Some(shell) = window.app_handle().try_state::<Shell<R>>() {
            shell.voice.reset();
        }
        apply(window.app_handle());
    }
}

/// What the shell shows now. For the lifecycle tests.
#[doc(hidden)]
pub fn snapshot<R: Runtime>(app: &AppHandle<R>) -> Snapshot {
    let shell = app.state::<Shell<R>>();
    Snapshot {
        window_open: app.get_webview_window(LABEL).is_some(),
        listening: shell.voice.listening(),
        title: shell.voice.title(),
        tooltip: shell.voice.tooltip(),
    }
}

/// Drives the same path as a page load event. For the lifecycle tests (the mock runtime fires none).
#[doc(hidden)]
pub fn test_page_load<R: Runtime>(app: &AppHandle<R>, url: &str, started: bool) {
    if let (Ok(url), Some(shell)) = (Url::parse(url), app.try_state::<Shell<R>>()) {
        shell.voice.page_load(&url, started);
    }
}

/// Drives the same path as the page changing its document title. For the lifecycle tests.
#[doc(hidden)]
pub fn test_title_claim<R: Runtime>(app: &AppHandle<R>, title: &str) {
    if let Some(shell) = app.try_state::<Shell<R>>() {
        if shell.voice.claim(title) {
            apply(app);
        }
    }
}

/// Drives the same path as a web-engine permission request. For the lifecycle tests.
#[doc(hidden)]
pub fn test_permission<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    kind: PermissionKind,
) -> PermissionResponse {
    decide(app, label, kind)
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASE: &str = "http://127.0.0.1:4870";

    fn url(text: &str) -> Url {
        Url::parse(text).unwrap()
    }

    fn expected() -> Url {
        page_url(BASE).unwrap()
    }

    const OTHER_KINDS: [PermissionKind; 15] = [
        PermissionKind::Camera,
        PermissionKind::Geolocation,
        PermissionKind::Notifications,
        PermissionKind::ClipboardRead,
        PermissionKind::DisplayCapture,
        PermissionKind::Midi,
        PermissionKind::Sensors,
        PermissionKind::MediaKeySystemAccess,
        PermissionKind::LocalFonts,
        PermissionKind::WindowManagement,
        PermissionKind::PointerLock,
        PermissionKind::AutomaticDownloads,
        PermissionKind::FileSystemAccess,
        PermissionKind::Autoplay,
        PermissionKind::Other,
    ];

    fn decide_at(kind: PermissionKind, label: &str, page: &str) -> PermissionResponse {
        permission_decision(kind, label, Some(&url(page)), Some(&expected()))
    }

    #[test]
    fn the_microphone_is_allowed_only_for_the_voice_window_on_its_own_page() {
        assert_eq!(
            decide_at(
                PermissionKind::Microphone,
                LABEL,
                "http://127.0.0.1:4870/voice.html"
            ),
            PermissionResponse::Allow
        );
        // A fragment does not change the page.
        assert_eq!(
            decide_at(
                PermissionKind::Microphone,
                LABEL,
                "http://127.0.0.1:4870/voice.html#/x"
            ),
            PermissionResponse::Allow
        );
    }

    #[test]
    fn every_other_kind_is_denied_even_in_the_voice_window_and_none_is_default() {
        for kind in OTHER_KINDS {
            assert_eq!(
                decide_at(kind, LABEL, "http://127.0.0.1:4870/voice.html"),
                PermissionResponse::Deny,
                "{kind:?}"
            );
            assert_eq!(
                decide_at(kind, "fawkes", "http://127.0.0.1:4870/voice.html"),
                PermissionResponse::Deny
            );
        }
    }

    #[test]
    fn the_microphone_is_denied_for_any_other_window_origin_or_page_and_never_default() {
        let mic = PermissionKind::Microphone;
        // Other windows, including the dictation pill, the pet windows and browser tabs.
        for label in [
            "phoenix-pill",
            "fawkes",
            "fawkes-island",
            "phoenix-browser",
            "phoenix-browser-tab-1",
            "phoenix-voice-2",
            "Phoenix-Voice",
            "",
        ] {
            assert_eq!(
                decide_at(mic, label, "http://127.0.0.1:4870/voice.html"),
                PermissionResponse::Deny,
                "{label}"
            );
        }
        // Other origins and pages for the right window.
        for page in [
            "http://127.0.0.1:4871/voice.html",
            "https://127.0.0.1:4870/voice.html",
            "http://localhost:4870/voice.html",
            "http://127.0.0.1.evil.example:4870/voice.html",
            "https://example.com/voice.html",
            "http://127.0.0.1:4870/pill.html",
            "http://127.0.0.1:4870/",
            "http://127.0.0.1:4870/index.html",
            "http://127.0.0.1:4870/voice.html/extra",
            "http://127.0.0.1:4870/voice.html?x=1",
            "tauri://localhost/voice.html",
            "about:blank",
        ] {
            assert_eq!(
                decide_at(mic, LABEL, page),
                PermissionResponse::Deny,
                "{page}"
            );
        }
        // No known page yet, or no valid Core address: denied, not "default".
        assert_eq!(
            permission_decision(mic, LABEL, None, Some(&expected())),
            PermissionResponse::Deny
        );
        assert_eq!(
            permission_decision(mic, LABEL, Some(&expected()), None),
            PermissionResponse::Deny
        );
    }

    #[test]
    fn the_page_address_is_the_loopback_voice_page_only() {
        assert_eq!(
            page_url(BASE).unwrap().as_str(),
            "http://127.0.0.1:4870/voice.html"
        );
        for base in [
            "http://192.0.2.1:4870",
            "https://127.0.0.1:4870",
            "http://localhost:4870",
            "not a url",
            "",
        ] {
            assert!(page_url(base).is_none(), "{base}");
        }
    }

    #[test]
    fn navigation_is_refused_off_the_voice_page() {
        let expected = expected();
        assert!(is_voice_page(&expected, &expected));
        assert!(is_voice_page(
            &url("http://127.0.0.1:4870/voice.html#top"),
            &expected
        ));
        for off in [
            "https://example.com/",
            "http://127.0.0.1:4870/",
            "http://127.0.0.1:4870/pill.html",
            "http://127.0.0.1:4871/voice.html",
            "http://127.0.0.1:4870/voice.html?next=1",
        ] {
            assert!(!is_voice_page(&url(off), &expected), "{off}");
        }
    }

    fn host_on_page() -> Host {
        let host = Host::default();
        host.page_load(&expected(), true);
        host
    }

    #[test]
    fn allowing_the_microphone_turns_the_indicator_on_in_the_shell() {
        let host = host_on_page();
        assert!(!host.listening());
        assert_eq!(host.title(), TITLE_OFF);
        let response = host.permission(PermissionKind::Microphone, LABEL, Some(&expected()));
        assert_eq!(response, PermissionResponse::Allow);
        assert!(host.listening());
        assert_eq!(host.title(), TITLE_LISTENING);
        assert_eq!(host.tooltip(), "Fawkes - LISTENING (voice microphone on)");
    }

    #[test]
    fn a_denied_request_never_turns_the_indicator_on() {
        let host = host_on_page();
        for kind in OTHER_KINDS {
            host.permission(kind, LABEL, Some(&expected()));
        }
        host.permission(
            PermissionKind::Microphone,
            "phoenix-pill",
            Some(&expected()),
        );
        assert!(!host.listening());
        // A page the window is not supposed to be on.
        let other = Host::default();
        other.page_load(&url("https://example.com/"), true);
        assert_eq!(
            other.permission(PermissionKind::Microphone, LABEL, Some(&expected())),
            PermissionResponse::Deny
        );
        assert!(!other.listening());
    }

    #[test]
    fn the_page_cannot_clear_the_indicator_before_it_said_it_was_active() {
        let host = host_on_page();
        host.permission(PermissionKind::Microphone, LABEL, Some(&expected()));
        // A stale "idle" (from before the request) and unknown titles change nothing.
        assert!(!host.claim(CLAIM_IDLE));
        assert!(!host.claim("anything else"));
        assert!(!host.claim(""));
        assert!(host.listening());
        // After "active", "idle" is believed once.
        assert!(!host.claim(CLAIM_ACTIVE));
        assert!(host.claim(CLAIM_IDLE));
        assert!(!host.listening());
        assert!(!host.claim(CLAIM_IDLE));
    }

    #[test]
    fn an_active_claim_alone_turns_the_indicator_on() {
        let host = host_on_page();
        assert!(host.claim(CLAIM_ACTIVE));
        assert!(host.listening());
    }

    #[test]
    fn a_new_page_load_and_a_reset_clear_the_indicator() {
        let host = host_on_page();
        host.permission(PermissionKind::Microphone, LABEL, Some(&expected()));
        host.page_load(&expected(), false);
        assert!(host.listening(), "a finished load is not a new page");
        host.page_load(&expected(), true);
        assert!(!host.listening());
        host.permission(PermissionKind::Microphone, LABEL, Some(&expected()));
        host.reset();
        assert!(!host.listening());
        // With no known page the request is denied again.
        assert_eq!(
            host.permission(PermissionKind::Microphone, LABEL, Some(&expected())),
            PermissionResponse::Deny
        );
    }

    #[test]
    fn the_tooltip_keeps_the_keep_awake_text_and_adds_the_indicator() {
        let host = Host::default();
        assert_eq!(host.tooltip(), "Fawkes");
        host.set_base_tooltip("Fawkes - Keep awake: 1 h 05 min left".into());
        assert_eq!(host.tooltip(), "Fawkes - Keep awake: 1 h 05 min left");
        host.claim(CLAIM_ACTIVE);
        assert_eq!(
            host.tooltip(),
            "Fawkes - Keep awake: 1 h 05 min left - LISTENING (voice microphone on)"
        );
        assert_eq!(tooltip_text("Fawkes", false), "Fawkes");
    }

    /// The microphone-usage wording of the bundle. The key is one string in `Info.plist`.
    fn microphone_usage(plist: &str) -> Option<&str> {
        let after = plist
            .split("<key>NSMicrophoneUsageDescription</key>")
            .nth(1)?;
        let start = after.find("<string>")? + "<string>".len();
        let end = after.find("</string>")?;
        (start <= end).then(|| &after[start..end])
    }

    #[test]
    fn the_plist_states_what_the_voice_assistant_does_with_the_microphone() {
        let plist = include_str!("../Info.plist");
        assert_eq!(
            plist
                .matches("<key>NSMicrophoneUsageDescription</key>")
                .count(),
            1
        );
        let text = microphone_usage(plist).expect("microphone usage string");
        for needle in [
            // Dictation is still covered (one key serves the whole app).
            "dictat",
            // The voice assistant: opt-in, listens for the wake phrase, locally.
            "OK Fawkes",
            "wake phrase",
            "switch it on",
            "on this device",
            "never stored",
            // Nothing leaves before a command is understood, and what can leave is approved first.
            "nothing is sent anywhere until a command is understood",
            "web search you approve",
            // The indicator and the stop.
            "LISTENING",
            "Stop voice listening",
        ] {
            assert!(text.contains(needle), "missing {needle:?} in {text:?}");
        }
        assert!(text.len() < 900, "keep the prompt readable");
    }

    #[test]
    fn no_capability_names_the_voice_window_or_its_page() {
        // Remote content gets no command: the voice window appears in no capability file.
        for (name, text) in [
            ("default", include_str!("../capabilities/default.json")),
            ("pill", include_str!("../capabilities/pill.json")),
            ("browser", include_str!("../capabilities/browser.json")),
        ] {
            assert!(!text.contains(LABEL), "{name} grants the voice window");
            assert!(!text.contains("voice.html"), "{name} grants the voice page");
        }
        // No runtime capability and no command is added for it either.
        let lib = include_str!("lib.rs");
        assert_eq!(lib.matches("add_capability(").count(), 1, "only the pill's");
        assert!(!lib.contains(".window(voice_window::LABEL)"));
        assert!(!lib.contains("allow-voice"));
        assert!(!include_str!("../build.rs").contains("voice"));
    }
}
