// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Window and tray lifecycle, driven through Tauri's mock runtime (no real window,
//! browser or login item is touched). Runs on the main thread (`harness = false`)
//! because macOS only creates menus and tray icons there.
//!
//! Not covered here (the mock runtime does not model it): real window visibility,
//! stacking, pixels and Quit; those were checked by hand on macOS.

use phoenix_desktop::{
    browser, builder, file_drop, handle_menu, menu_snapshot, open_links, quit_requested,
    refresh_awake_tray, run_shortcut, shortcuts, voice_window, ShellOptions, AWAKE_ITEM_ID,
    ISLAND_LABEL, SETTINGS_FILE, TRAY_ID, WINDOW_LABEL,
};
use serde_json::Value;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::test::{mock_context, noop_assets, MockRuntime};
use tauri::{App, Listener, Manager};

struct Started {
    app: App<MockRuntime>,
    opened: Arc<Mutex<Vec<String>>>,
}

fn start(settings_dir: &Path) -> Started {
    let opened = Arc::new(Mutex::new(Vec::new()));
    let sink = opened.clone();
    let options = ShellOptions {
        settings_dir: Some(settings_dir.to_path_buf()),
        open_url: Some(Box::new(move |url| {
            sink.lock().unwrap().push(url.to_string())
        })),
        // Deterministic Core discovery, independent of the machine running the test.
        env: Some(Box::new(|k| {
            (k == "PHOENIX_PORT").then(|| "4999".to_string())
        })),
        confirm_quit: None,
        skip_native_window_styling: true,
        browser_hooks: None,
    };
    let mut app = builder::<MockRuntime>(options)
        .build(mock_context(noop_assets()))
        .expect("app builds");
    // One iteration runs `setup` (window, tray, menu). Not a loop, so it does not busy-wait.
    #[allow(deprecated)]
    app.run_iteration(|_, _| {});
    Started { app, opened }
}

fn saved(dir: &Path) -> Value {
    let text = std::fs::read_to_string(dir.join(SETTINGS_FILE)).expect("settings written");
    serde_json::from_str(&text).unwrap()
}

fn item(app: &App<MockRuntime>, id: &str) -> (String, Option<bool>) {
    menu_snapshot(app.handle())
        .into_iter()
        .find(|(i, _, _)| i == id)
        .map(|(_, text, checked)| (text, checked))
        .unwrap_or_else(|| panic!("menu item {id} missing"))
}

fn starts_with_window_tray_and_full_menu() {
    let dir = tempfile::tempdir().unwrap();
    let s = start(dir.path());
    assert!(
        s.app.get_webview_window(WINDOW_LABEL).is_some(),
        "Fawkes window"
    );
    assert!(s.app.tray_by_id(TRAY_ID).is_some(), "tray icon");
    let ids: Vec<String> = menu_snapshot(s.app.handle())
        .into_iter()
        .map(|(i, _, _)| i)
        .collect();
    assert_eq!(
        ids,
        [
            "toggle",
            "open",
            "wardrobe",
            "mode_floating",
            "mode_island",
            "mode_navbar",
            "island_display",
            "dictation_hotkey",
            "dictation_key",
            "dictation_pill",
            "voice_open",
            "voice_stop",
            "shortcuts_enabled",
            "mute",
            "on_top",
            "login",
            "quit"
        ]
    );
    // A fresh install keeps the floating Fawkes; the island is opt-in.
    assert_eq!(item(&s.app, "mode_floating").1, Some(true));
    assert_eq!(item(&s.app, "mode_island").1, Some(false));
    assert_eq!(item(&s.app, "toggle").0, "Hide Fawkes");
    assert_eq!(item(&s.app, "open").0, "Open Phoenix");
    assert_eq!(item(&s.app, "quit").0, "Quit Fawkes");
    // Keep-on-top is opt-in.
    assert_eq!(
        item(&s.app, "on_top"),
        ("Keep Fawkes on top".into(), Some(false))
    );
    assert_eq!(item(&s.app, "dictation_hotkey").1, Some(false));
    assert_eq!(item(&s.app, "dictation_pill").1, Some(false));
    // Global shortcuts and mute are opt-in too.
    assert_eq!(item(&s.app, "shortcuts_enabled").1, Some(false));
    assert_eq!(item(&s.app, "mute").1, Some(false));
    assert_eq!(item(&s.app, "wardrobe").0, "Wardrobe");
    // Nothing is written until the user changes something.
    assert!(!dir.path().join(SETTINGS_FILE).exists());
}

fn hide_and_show_are_remembered() {
    let dir = tempfile::tempdir().unwrap();
    let s = start(dir.path());
    handle_menu(s.app.handle(), "toggle");
    assert_eq!(saved(dir.path())["visible"], false);
    assert_eq!(item(&s.app, "toggle").0, "Show Fawkes");
    handle_menu(s.app.handle(), "toggle");
    assert_eq!(saved(dir.path())["visible"], true);
    assert_eq!(item(&s.app, "toggle").0, "Hide Fawkes");
}

fn keep_on_top_toggles_and_is_remembered() {
    let dir = tempfile::tempdir().unwrap();
    let s = start(dir.path());
    handle_menu(s.app.handle(), "on_top");
    assert_eq!(saved(dir.path())["always_on_top"], true);
    assert_eq!(item(&s.app, "on_top").1, Some(true));
    handle_menu(s.app.handle(), "on_top");
    assert_eq!(saved(dir.path())["always_on_top"], false);
    assert_eq!(item(&s.app, "on_top").1, Some(false));
}

fn open_phoenix_opens_the_local_core() {
    let dir = tempfile::tempdir().unwrap();
    let s = start(dir.path());
    handle_menu(s.app.handle(), "open");
    assert_eq!(*s.opened.lock().unwrap(), ["http://127.0.0.1:4999"]);
}

fn settings_survive_a_restart() {
    let dir = tempfile::tempdir().unwrap();
    {
        let s = start(dir.path());
        handle_menu(s.app.handle(), "toggle");
        handle_menu(s.app.handle(), "on_top");
    }
    let s = start(dir.path());
    assert_eq!(
        item(&s.app, "toggle").0,
        "Show Fawkes",
        "still hidden after restart"
    );
    assert_eq!(
        item(&s.app, "on_top").1,
        Some(true),
        "still on top after restart"
    );
}

fn corrupt_settings_still_start() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join(SETTINGS_FILE), "{ not json").unwrap();
    let s = start(dir.path());
    assert!(s.app.get_webview_window(WINDOW_LABEL).is_some());
    assert_eq!(item(&s.app, "toggle").0, "Hide Fawkes", "defaults apply");
}

fn unknown_menu_ids_are_ignored() {
    let dir = tempfile::tempdir().unwrap();
    let s = start(dir.path());
    handle_menu(s.app.handle(), "rm -rf /");
    assert!(s.opened.lock().unwrap().is_empty());
    assert!(!dir.path().join(SETTINGS_FILE).exists());
}

fn modes_switch_live_and_are_remembered() {
    let dir = tempfile::tempdir().unwrap();
    let s = start(dir.path());
    let checked = |app: &App<MockRuntime>| {
        ["mode_floating", "mode_island", "mode_navbar"].map(|id| item(app, id).1 == Some(true))
    };
    handle_menu(s.app.handle(), "mode_island");
    assert_eq!(saved(dir.path())["mode"], "island");
    assert_eq!(checked(&s.app), [false, true, false]);
    assert!(
        s.app.get_webview_window(ISLAND_LABEL).is_some(),
        "island window is created on first use"
    );
    handle_menu(s.app.handle(), "mode_navbar");
    assert_eq!(saved(dir.path())["mode"], "navbar");
    assert_eq!(checked(&s.app), [false, false, true]);
    handle_menu(s.app.handle(), "mode_floating");
    assert_eq!(saved(dir.path())["mode"], "floating");
    assert_eq!(checked(&s.app), [true, false, false]);
    // One pet: the floating window was never torn down by switching modes.
    assert!(s.app.get_webview_window(WINDOW_LABEL).is_some());
}

fn island_mode_survives_a_restart_without_creating_the_floating_pet_twice() {
    let dir = tempfile::tempdir().unwrap();
    {
        let s = start(dir.path());
        handle_menu(s.app.handle(), "mode_island");
    }
    let s = start(dir.path());
    assert_eq!(item(&s.app, "mode_island").1, Some(true));
    assert!(s.app.get_webview_window(ISLAND_LABEL).is_some());
}

fn hide_applies_to_whichever_mode_is_active() {
    let dir = tempfile::tempdir().unwrap();
    let s = start(dir.path());
    handle_menu(s.app.handle(), "mode_island");
    handle_menu(s.app.handle(), "toggle");
    assert_eq!(saved(dir.path())["visible"], false);
    assert_eq!(saved(dir.path())["mode"], "island");
    handle_menu(s.app.handle(), "toggle");
    assert_eq!(saved(dir.path())["visible"], true);
}

fn unknown_mode_ids_are_ignored() {
    let dir = tempfile::tempdir().unwrap();
    let s = start(dir.path());
    handle_menu(s.app.handle(), "mode_hologram");
    assert!(!dir.path().join(SETTINGS_FILE).exists());
}

fn wardrobe_opens_the_pet_panel_wardrobe_tab() {
    let dir = tempfile::tempdir().unwrap();
    let s = start(dir.path());
    handle_menu(s.app.handle(), "wardrobe");
    assert_eq!(
        *s.opened.lock().unwrap(),
        ["http://127.0.0.1:4999/#/panel/wardrobe"]
    );
    assert!(!dir.path().join(SETTINGS_FILE).exists());
}

fn a_phoenix_approvals_link_opens_the_approvals_panel_and_nothing_else_does() {
    let dir = tempfile::tempdir().unwrap();
    let s = start(dir.path());
    open_links(
        s.app.handle(),
        &["phoenix://approvals/apr_0123456789abcdef01234567"],
    );
    open_links(
        s.app.handle(),
        &["phoenix://approvals/open?s=agent&i=apr_1&h=ab&e=1&m=cd"],
    );
    assert_eq!(
        *s.opened.lock().unwrap(),
        [
            "http://127.0.0.1:4999/#/panel/overview",
            "http://127.0.0.1:4999/#/panel/overview"
        ]
    );
    s.opened.lock().unwrap().clear();
    for bad in [
        "phoenix://settings/apr_1",
        "phoenix://approvals/apr_1/../x",
        "phoenix://approvals/apr_1?cmd=rm",
        "https://example.org/",
        "file:///etc/passwd",
        "phoenix://approvals/ap\u{202e}r",
        "",
    ] {
        open_links(s.app.handle(), &[bad]);
    }
    open_links(
        s.app.handle(),
        &["https://example.org/", "phoenix://approvals/apr_1"],
    );
    let none: [&str; 0] = [];
    open_links(s.app.handle(), &none);
    assert!(
        s.opened.lock().unwrap().is_empty(),
        "nothing else opens anything"
    );
    assert!(!dir.path().join(SETTINGS_FILE).exists());
}

fn shortcuts_stay_off_and_registration_failure_never_stops_startup() {
    let dir = tempfile::tempdir().unwrap();
    // Saved as on, with one valid default, one duplicate pair and one bare letter: the mock
    // runtime has no hotkey API, so every registration is refused, and the app still starts.
    std::fs::write(
        dir.path().join(SETTINGS_FILE),
        r#"{"shortcuts_enabled":true,"shortcuts":{"mute":"m","open_chat":"ctrl+alt+shift+k","wardrobe":"ctrl+alt+shift+k"}}"#,
    )
    .unwrap();
    let s = start(dir.path());
    assert!(s.app.get_webview_window(WINDOW_LABEL).is_some());
    assert_eq!(
        item(&s.app, "shortcuts_enabled"),
        ("Global shortcuts (7 not active)".into(), Some(true))
    );
    // Turning them off is remembered and relabels the entry.
    handle_menu(s.app.handle(), "shortcuts_enabled");
    assert_eq!(saved(dir.path())["shortcuts_enabled"], false);
    assert_eq!(
        item(&s.app, "shortcuts_enabled"),
        ("Enable global shortcuts".into(), Some(false))
    );
    // The user's own accelerators were not rewritten by the failed registrations.
    assert_eq!(saved(dir.path())["shortcuts"]["mute"], "m");
}

fn mute_toggles_and_is_remembered() {
    let dir = tempfile::tempdir().unwrap();
    {
        let s = start(dir.path());
        handle_menu(s.app.handle(), "mute");
        assert_eq!(saved(dir.path())["muted"], true);
        assert_eq!(item(&s.app, "mute").1, Some(true));
    }
    let s = start(dir.path());
    assert_eq!(
        item(&s.app, "mute").1,
        Some(true),
        "still muted after restart"
    );
    handle_menu(s.app.handle(), "mute");
    assert_eq!(saved(dir.path())["muted"], false);
}

/// A shell wired to a fake Core on a loopback port, with its token in `data_dir` and a fake
/// dialog that records what it was asked and answers `answer`.
fn start_with_fake_core(
    settings_dir: &Path,
    port: u16,
    data_dir: &Path,
    asked: Arc<Mutex<Vec<String>>>,
    answer: Option<bool>,
    opened: Arc<Mutex<Vec<String>>>,
) -> App<MockRuntime> {
    let (port, data_dir) = (port.to_string(), data_dir.to_string_lossy().into_owned());
    let options = ShellOptions {
        settings_dir: Some(settings_dir.to_path_buf()),
        open_url: Some(Box::new(move |url| {
            opened.lock().unwrap().push(url.to_string())
        })),
        env: Some(Box::new(move |k| match k {
            "PHOENIX_PORT" => Some(port.clone()),
            "PHOENIX_DATA_DIR" => Some(data_dir.clone()),
            _ => None,
        })),
        confirm_quit: Some(Box::new(move |prompt| {
            asked.lock().unwrap().push(prompt.message.clone());
            answer
        })),
        skip_native_window_styling: true,
        browser_hooks: None,
    };
    let mut app = builder::<MockRuntime>(options)
        .build(mock_context(noop_assets()))
        .expect("app builds");
    #[allow(deprecated)]
    app.run_iteration(|_, _| {});
    app
}

/// Serves `body` to every request on a free loopback port until the test process ends; returns
/// the port and the request lines seen so far (the line and the `Authorization` header).
fn fake_core(body: &'static str) -> (u16, Arc<Mutex<Vec<String>>>) {
    let (port, seen, _) = fake_core_switchable(body);
    (port, seen)
}

type Seen = Arc<Mutex<Vec<String>>>;
type Body = Arc<Mutex<&'static str>>;

/// Like [`fake_core`], and the body it serves can be changed while it runs.
fn fake_core_switchable(body: &'static str) -> (u16, Seen, Body) {
    use std::io::{Read, Write};
    let body = Arc::new(Mutex::new(body));
    let serving = body.clone();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = seen.clone();
    std::thread::spawn(move || {
        while let Ok((mut stream, _)) = listener.accept() {
            let mut raw = Vec::new();
            let mut buf = [0u8; 512];
            while !raw.windows(4).any(|w| w == b"\r\n\r\n") {
                let n = stream.read(&mut buf).unwrap();
                if n == 0 {
                    break;
                }
                raw.extend_from_slice(&buf[..n]);
            }
            let text = String::from_utf8_lossy(&raw).into_owned();
            let auth = text.lines().find(|l| l.starts_with("Authorization:"));
            log.lock().unwrap().push(format!(
                "{} | {}",
                text.lines().next().unwrap_or(""),
                auth.unwrap_or("")
            ));
            let body = *serving.lock().unwrap();
            let reply = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(reply.as_bytes());
        }
    });
    (port, seen, body)
}

fn jump_to_terminal_asks_core_with_the_token_then_opens_the_agents_page_when_there_is_no_session() {
    let dir = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    std::fs::write(data.path().join("session.token"), "life-token_3").unwrap();
    let (port, seen) = fake_core(r#"{"sessions":[]}"#);
    let opened = Arc::new(Mutex::new(Vec::new()));
    let app = start_with_fake_core(
        dir.path(),
        port,
        data.path(),
        Arc::default(),
        None,
        opened.clone(),
    );
    run_shortcut(app.handle(), shortcuts::Action::JumpToTerminal);
    wait_until(|| !opened.lock().unwrap().is_empty());
    assert_eq!(
        *opened.lock().unwrap(),
        [format!("http://127.0.0.1:{port}/#/agents")]
    );
    // Core was asked for the sessions, with the session token, and nothing else was sent.
    assert_eq!(
        *seen.lock().unwrap(),
        ["GET /api/agent/sessions HTTP/1.1 | Authorization: Bearer life-token_3"]
    );
}

/// Phase 66: the voice window is opened only from the tray menu, allows the microphone for itself
/// alone, shows LISTENING from the shell's own decision, keeps the Keep-awake tooltip text, and the
/// tray's "Stop voice listening" requests the window's destruction and clears the indicator. The mock runtime has no web engine, so this
/// proves the shell's decisions and bookkeeping, not a real prompt, microphone or window title.
fn the_voice_window_allows_only_its_own_microphone_shows_listening_and_stops_from_the_tray() {
    use tauri::webview::{PermissionKind, PermissionResponse};
    let dir = tempfile::tempdir().unwrap();
    let s = start(dir.path());
    let app = s.app.handle().clone();

    // Nothing opens at startup: no window, microphone off, no capability for the label.
    let before = voice_window::snapshot(&app);
    assert!(!before.window_open && !before.listening);
    assert_eq!(before.title, voice_window::TITLE_OFF);

    // Opening it (twice) makes one window on Core's own voice page; the microphone is still off.
    handle_menu(&app, "voice_open");
    handle_menu(&app, "voice_open");
    assert_eq!(
        app.webview_windows()
            .keys()
            .filter(|label| label.as_str() == voice_window::LABEL)
            .count(),
        1
    );
    assert!(voice_window::snapshot(&app).window_open);
    assert!(!voice_window::snapshot(&app).listening);

    // Before the page is known to be Core's voice page, even the microphone is denied.
    let mic = PermissionKind::Microphone;
    assert_eq!(
        voice_window::test_permission(&app, voice_window::LABEL, mic),
        PermissionResponse::Deny
    );
    voice_window::test_page_load(&app, "http://127.0.0.1:4999/voice.html", true);

    // Every other kind, and the microphone for any other window, is denied and shows nothing.
    for kind in [
        PermissionKind::Camera,
        PermissionKind::DisplayCapture,
        PermissionKind::Geolocation,
        PermissionKind::Other,
    ] {
        assert_eq!(
            voice_window::test_permission(&app, voice_window::LABEL, kind),
            PermissionResponse::Deny
        );
    }
    for label in [
        "phoenix-pill",
        WINDOW_LABEL,
        ISLAND_LABEL,
        "phoenix-browser-tab-1",
    ] {
        assert_eq!(
            voice_window::test_permission(&app, label, mic),
            PermissionResponse::Deny,
            "{label}"
        );
    }
    assert!(!voice_window::snapshot(&app).listening);

    // The microphone for the voice window on its page: allowed, and the shell's indicator is on
    // before the page has said anything.
    assert_eq!(
        voice_window::test_permission(&app, voice_window::LABEL, mic),
        PermissionResponse::Allow
    );
    let on = voice_window::snapshot(&app);
    assert!(on.listening);
    assert_eq!(on.title, voice_window::TITLE_LISTENING);
    assert!(on.tooltip.ends_with(voice_window::TOOLTIP_SUFFIX));

    // A page claiming "idle" before it said "active" does not clear it; after "active" it does.
    voice_window::test_title_claim(&app, voice_window::CLAIM_IDLE);
    assert!(voice_window::snapshot(&app).listening);
    voice_window::test_title_claim(&app, voice_window::CLAIM_ACTIVE);
    voice_window::test_title_claim(&app, voice_window::CLAIM_IDLE);
    assert!(!voice_window::snapshot(&app).listening);

    // A reload clears the indicator (the old page's stream is gone with it).
    voice_window::test_permission(&app, voice_window::LABEL, mic);
    assert!(voice_window::snapshot(&app).listening);
    voice_window::test_page_load(&app, "http://127.0.0.1:4999/voice.html", true);
    assert!(!voice_window::snapshot(&app).listening);

    // The shell-side stop: always available, destroys the window and clears the indicator, and
    // asking again is harmless.
    voice_window::test_permission(&app, voice_window::LABEL, mic);
    // The tray entry runs the same path as `kill`. The mock runtime accepts the destroy request but
    // never fires the window's Destroyed event, so only the shell's own state is observable here.
    assert!(voice_window::kill(&app), "a destroy was requested");
    handle_menu(&app, "voice_stop");
    let after = voice_window::snapshot(&app);
    assert!(!after.listening);
    assert_eq!(after.title, voice_window::TITLE_OFF);
    assert!(!after.tooltip.contains("LISTENING"));
    // With the window gone nothing is allowed any more.
    assert_eq!(
        voice_window::test_permission(&app, voice_window::LABEL, mic),
        PermissionResponse::Deny
    );
}

fn wait_until(mut done: impl FnMut() -> bool) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while !done() && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    assert!(done(), "timed out");
}

fn quit_with_a_pending_change_is_held_and_asks_the_person_who_cancels() {
    let dir = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    std::fs::write(data.path().join("session.token"), "life-token_1").unwrap();
    let (port, seen) = fake_core(
        r#"{"available":true,"can_quit":false,"count":1,"pending":[{"kind":"pmset.disablesleep","at":1}]}"#,
    );
    let asked = Arc::new(Mutex::new(Vec::new()));
    let app = start_with_fake_core(
        dir.path(),
        port,
        data.path(),
        asked.clone(),
        Some(false),
        Arc::default(),
    );

    // The exit is held; Core is asked with the session token; the dialog names the change.
    assert!(quit_requested(app.handle()));
    wait_until(|| asked.lock().unwrap().len() == 1);
    assert!(asked.lock().unwrap()[0].contains("sleep is switched off for a closed lid"));
    // Cancel keeps Phoenix running and the next Quit asks again (it is not silently approved).
    // A request while the first dialog is still open is held without a second dialog; once Cancel
    // has been answered, a request asks again.
    wait_until(|| {
        assert!(
            quit_requested(app.handle()),
            "a pending change never lets Quit through"
        );
        asked.lock().unwrap().len() == 2
    });
    let seen = seen.lock().unwrap().clone();
    assert!(seen.len() >= 2);
    for line in seen {
        assert_eq!(
            line,
            "GET /api/awake/quit-check HTTP/1.1 | Authorization: Bearer life-token_1"
        );
    }
}

fn a_dialog_that_cannot_be_shown_keeps_phoenix_running() {
    let dir = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    std::fs::write(data.path().join("session.token"), "life-token_2").unwrap();
    let (port, seen) = fake_core(r#"{"available":true,"can_quit":false}"#);
    let asked = Arc::new(Mutex::new(Vec::new()));
    let app = start_with_fake_core(
        dir.path(),
        port,
        data.path(),
        asked.clone(),
        None,
        Arc::default(),
    );
    assert!(quit_requested(app.handle()));
    wait_until(|| asked.lock().unwrap().len() == 1);
    assert!(!seen.lock().unwrap().is_empty());
}

fn the_tray_shows_the_keep_awake_countdown_only_while_core_says_a_session_runs() {
    const RUNNING: &str =
        r#"{"available":true,"active":true,"mode":"timed","remaining_seconds":3900}"#;
    const ENDED: &str = r#"{"available":true,"active":false}"#;
    let dir = tempfile::tempdir().unwrap();
    let data = tempfile::tempdir().unwrap();
    std::fs::write(data.path().join("session.token"), "life-token_4").unwrap();
    let (port, seen, serving) = fake_core_switchable(ENDED);
    let app = start_with_fake_core(
        dir.path(),
        port,
        data.path(),
        Arc::default(),
        None,
        Arc::default(),
    );
    let awake_item = |app: &App<MockRuntime>| {
        menu_snapshot(app.handle())
            .into_iter()
            .find(|(id, _, _)| id == AWAKE_ITEM_ID)
            .map(|(_, text, _)| text)
    };
    let first_id = |app: &App<MockRuntime>| menu_snapshot(app.handle())[0].0.clone();

    // Nothing runs: no entry, the tooltip is plain, and the menu is the ordinary one.
    refresh_awake_tray(app.handle());
    assert_eq!(awake_item(&app), None);
    assert_eq!(first_id(&app), "toggle");

    // A session runs: a disabled entry on top says how long is left, in the tray tooltip too.
    *serving.lock().unwrap() = RUNNING;
    let next = refresh_awake_tray(app.handle());
    assert_eq!(
        awake_item(&app).as_deref(),
        Some("Keep awake: 1 h 05 min left")
    );
    assert_eq!(first_id(&app), AWAKE_ITEM_ID);
    assert_eq!(
        next,
        std::time::Duration::from_secs(20),
        "bounded refresh while it runs"
    );
    // Asking again does not add a second entry.
    refresh_awake_tray(app.handle());
    let entries = menu_snapshot(app.handle())
        .iter()
        .filter(|(id, _, _)| id == AWAKE_ITEM_ID)
        .count();
    assert_eq!(entries, 1);

    // The menu entry does nothing when chosen.
    handle_menu(app.handle(), AWAKE_ITEM_ID);
    assert!(!dir.path().join(SETTINGS_FILE).exists());

    // The session ends: the entry goes away and the slow idle probe takes over.
    *serving.lock().unwrap() = ENDED;
    let next = refresh_awake_tray(app.handle());
    assert_eq!(awake_item(&app), None);
    assert_eq!(first_id(&app), "toggle");
    assert_eq!(next, std::time::Duration::from_secs(60));

    // Every request was one authenticated GET of the status route.
    let seen = seen.lock().unwrap().clone();
    assert_eq!(seen.len(), 4, "one request per refresh");
    for line in seen {
        assert_eq!(
            line,
            "GET /api/awake/status HTTP/1.1 | Authorization: Bearer life-token_4"
        );
    }

    // A garbled answer hides the entry rather than showing something made up.
    *serving.lock().unwrap() = RUNNING;
    refresh_awake_tray(app.handle());
    assert!(awake_item(&app).is_some());
    *serving.lock().unwrap() = "{ not json";
    refresh_awake_tray(app.handle());
    assert_eq!(awake_item(&app), None);
}

/// Calls a Tauri command on `webview` the way a page would (with the app's own invoke key).
fn invoke(
    invoke_key: &str,
    webview: &tauri::WebviewWindow<MockRuntime>,
    cmd: &str,
    args: serde_json::Value,
) -> Result<Value, Value> {
    invoke_raw(invoke_key, webview, cmd, args).map(|body| body.deserialize::<Value>().unwrap())
}

/// Like [`invoke`], but hands back the response body untouched (a command that answers with bytes).
fn invoke_raw(
    invoke_key: &str,
    webview: &tauri::WebviewWindow<MockRuntime>,
    cmd: &str,
    args: serde_json::Value,
) -> Result<tauri::ipc::InvokeResponseBody, Value> {
    let request = tauri::webview::InvokeRequest {
        cmd: cmd.into(),
        callback: tauri::ipc::CallbackFn(0),
        error: tauri::ipc::CallbackFn(1),
        url: if cfg!(any(windows, target_os = "android")) {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        }
        .parse()
        .unwrap(),
        body: tauri::ipc::InvokeBody::Json(args),
        headers: Default::default(),
        invoke_key: invoke_key.to_string(),
    };
    tauri::test::get_ipc_response(webview, request)
}

fn shortcut_commands_work_from_the_pet_window_and_refuse_any_other() {
    let dir = tempfile::tempdir().unwrap();
    let s = start(dir.path());
    let pet = s.app.get_webview_window(WINDOW_LABEL).expect("pet window");
    let key = s.app.invoke_key().to_string();

    let report = invoke(&key, &pet, "shortcuts_list", serde_json::json!({})).expect("list");
    assert_eq!(report["enabled"], false);
    assert_eq!(report["muted"], false);
    assert_eq!(report["shortcuts"].as_array().map(Vec::len), Some(7));

    let report = invoke(
        &key,
        &pet,
        "shortcuts_set_muted",
        serde_json::json!({"muted": true}),
    )
    .expect("mute");
    assert_eq!(report["muted"], true);
    assert_eq!(saved(dir.path())["muted"], true);
    assert_eq!(
        item(&s.app, "mute").1,
        Some(true),
        "the menu follows the page"
    );

    let report = invoke(
        &key,
        &pet,
        "shortcuts_set_enabled",
        serde_json::json!({"enabled": true}),
    )
    .expect("enable");
    assert_eq!(report["enabled"], true);
    assert_eq!(saved(dir.path())["shortcuts_enabled"], true);
    // Nothing is registered with the OS under the mock runtime: every action reports why.
    assert!(report["shortcuts"]
        .as_array()
        .unwrap()
        .iter()
        .all(|a| a["state"] != "active"));

    // A window that is not one of the shell's own pages is refused and changes nothing.
    let other = tauri::WebviewWindowBuilder::new(
        &s.app,
        "stranger",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .build()
    .expect("other window");
    let refused = invoke(
        &key,
        &other,
        "shortcuts_set_enabled",
        serde_json::json!({"enabled": false}),
    )
    .expect_err("refused");
    assert_eq!(refused["code"], "forbidden");
    assert_eq!(saved(dir.path())["shortcuts_enabled"], true);
    assert!(invoke(
        &key,
        &other,
        "shortcuts_set_muted",
        serde_json::json!({"muted": false})
    )
    .is_err());
    assert_eq!(saved(dir.path())["muted"], true);
}

/// Phase 62: a drop on the pet window is announced with numbers and names (no path), and only
/// those numbers read a file, once, by the window that was dropped on.
fn a_dropped_file_is_announced_without_its_path_and_read_once_by_its_window_only() {
    let dir = tempfile::tempdir().unwrap();
    let s = start(dir.path());
    let pet = s.app.get_webview_window(WINDOW_LABEL).expect("pet window");
    let key = s.app.invoke_key().to_string();
    let dropped = dir.path().join("dropped.txt");
    std::fs::write(&dropped, b"dropped bytes").unwrap();

    let announced = Arc::new(Mutex::new(Vec::<String>::new()));
    let sink = announced.clone();
    pet.listen(file_drop::DROP_EVENT, move |event| {
        sink.lock().unwrap().push(event.payload().to_string());
    });
    file_drop::on_drag(
        s.app.handle(),
        WINDOW_LABEL,
        file_drop::Drag::Drop(vec![dropped.clone()]),
    );
    wait_until(|| !announced.lock().unwrap().is_empty());
    let payload: Value = serde_json::from_str(&announced.lock().unwrap()[0]).unwrap();
    assert_eq!(payload["files"][0]["name"], "dropped.txt");
    assert_eq!(payload["files"][0]["size"], 13);
    assert!(
        !payload.to_string().contains(dir.path().to_str().unwrap()),
        "the page is never told a path"
    );
    let id = payload["files"][0]["id"].as_u64().unwrap();

    // Another window cannot use the number; a window that is not a drop target is refused outright.
    let island = tauri::WebviewWindowBuilder::new(
        &s.app,
        ISLAND_LABEL,
        tauri::WebviewUrl::App("island.html".into()),
    )
    .build()
    .expect("island window");
    let wrong_window = invoke(
        &key,
        &island,
        "read_dropped_file",
        serde_json::json!({"id": id}),
    )
    .expect_err("the island did not receive that drop");
    assert_eq!(wrong_window["code"], "not_dropped");
    let other = tauri::WebviewWindowBuilder::new(
        &s.app,
        "stranger",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .build()
    .expect("other window");
    let forbidden = invoke(
        &key,
        &other,
        "read_dropped_file",
        serde_json::json!({"id": id}),
    )
    .expect_err("not a drop target");
    assert_eq!(forbidden["code"], "forbidden");

    // The window it was dropped on reads it once; a second ask and an invented number read nothing.
    let body = invoke_raw(
        &key,
        &pet,
        "read_dropped_file",
        serde_json::json!({"id": id}),
    )
    .expect("read");
    let tauri::ipc::InvokeResponseBody::Raw(bytes) = body else {
        panic!("the file comes back as bytes");
    };
    assert_eq!(bytes, b"dropped bytes");
    for again in [id, id + 1000] {
        let refused = invoke_raw(
            &key,
            &pet,
            "read_dropped_file",
            serde_json::json!({"id": again}),
        )
        .expect_err("refused");
        assert_eq!(refused["code"], "not_dropped");
    }
    // A drop on a window that is not a target announces nothing and registers nothing.
    file_drop::on_drag(
        s.app.handle(),
        "phoenix-pill",
        file_drop::Drag::Drop(vec![dropped]),
    );
    assert_eq!(announced.lock().unwrap().len(), 1);
}

/// Phase 93: a start with fake DNS, a fake folder dialog and fake shields, and the browser's chrome
/// window open. The mock runtime has no webview engine, so what it proves is the command surface
/// (caller checks, validation, tab bookkeeping, events), not rendering or blocking.
fn start_browser(dir: &Path, dns: &[(&str, &str)]) -> (App<MockRuntime>, Arc<Mutex<Vec<String>>>) {
    start_browser_with(dir, dns, None)
}

/// [`start_browser`] with the Phase 95 script-runner fake (answers `page_snapshot`/`page_action`).
fn start_browser_with(
    dir: &Path,
    dns: &[(&str, &str)],
    script_runner: Option<browser::ScriptRunner>,
) -> (App<MockRuntime>, Arc<Mutex<Vec<String>>>) {
    use std::collections::HashMap;
    let table: HashMap<String, std::net::IpAddr> = dns
        .iter()
        .map(|(n, ip)| (n.to_string(), ip.parse().unwrap()))
        .collect();
    let dialogs = Arc::new(Mutex::new(Vec::<String>::new()));
    let seen = dialogs.clone();
    let hooks = browser::Hooks {
        resolve: Arc::new(move |name| table.get(name).map(|ip| vec![*ip]).ok_or(())),
        pick_folder: Arc::new(move |message| {
            seen.lock().unwrap().push(message.to_string());
            None
        }),
        shields: Arc::new(browser::ShieldsInput::default),
        profiles: browser::ProfileStore::new(dir.join("browser-profiles")),
        core_profiles: browser::CoreProfiles::fixed(vec![], Arc::default()),
        scripts: Arc::new(|_, _| Err(())),
        script_runner,
    };
    let options = ShellOptions {
        settings_dir: Some(dir.to_path_buf()),
        open_url: Some(Box::new(|_| {})),
        env: Some(Box::new(|k| {
            (k == "PHOENIX_PORT").then(|| "4999".to_string())
        })),
        confirm_quit: None,
        skip_native_window_styling: true,
        browser_hooks: Some(hooks),
    };
    let mut app = builder::<MockRuntime>(options)
        .build(mock_context(noop_assets()))
        .expect("app builds");
    #[allow(deprecated)]
    app.run_iteration(|_, _| {});
    browser::show(app.handle()).expect("chrome window");
    (app, dialogs)
}

fn browser_commands_run_for_the_chrome_window_only_and_validate_everything() {
    let dir = tempfile::tempdir().unwrap();
    let (app, dialogs) = start_browser(
        dir.path(),
        &[
            ("example.com", "93.184.216.34"),
            ("rebind.test", "127.0.0.1"),
        ],
    );
    let key = app.invoke_key().to_string();
    let chrome = app
        .get_webview_window(browser::CHROME_WINDOW_LABEL)
        .expect("chrome window");
    let pet = app.get_webview_window(WINDOW_LABEL).expect("pet window");
    let events = Arc::new(Mutex::new(Vec::<(String, Value)>::new()));
    for name in [browser::TAB_EVENT, browser::TAB_CLOSED_EVENT] {
        let sink = events.clone();
        chrome.listen(name, move |e| {
            sink.lock()
                .unwrap()
                .push((name.to_string(), serde_json::from_str(e.payload()).unwrap()));
        });
    }

    // The chrome opens a tab; the page gets a TabInfo.
    let opened = invoke(
        &key,
        &chrome,
        "open_tab",
        serde_json::json!({"url": "https://example.com/a", "intent": "typed"}),
    )
    .expect("open");
    assert_eq!(opened["ok"], true, "{opened}");
    let tab = &opened["tab"];
    assert_eq!(tab["tabId"], "1");
    assert_eq!(tab["url"], "https://example.com/a");
    assert_eq!(tab["zoom"], 1.0);
    assert_eq!(tab["blocked"], 0);
    let label = "phoenix-browser-tab-1";
    assert!(
        app.get_webview_window(label).is_some(),
        "content window exists"
    );

    // Policy refusals RESOLVE with a reason (never reject), and open nothing.
    for (url, reason) in [
        ("http://localhost:3000/", "private_network"),
        ("https://127.0.0.1/", "private_network"),
        ("file:///etc/passwd", "file_blocked"),
        ("javascript:alert(1)", "dangerous_scheme"),
        ("https://user:pw@example.com/", "credentials_in_url"),
        ("https://example.com:22/", "bad_port"),
        ("https://rebind.test/", "dns_private"),
        ("https://does-not-resolve.test/", "dns_failed"),
        ("ftp://example.com/", "scheme_not_allowed"),
        ("", "unparseable"),
    ] {
        let denied = invoke(
            &key,
            &chrome,
            "open_tab",
            serde_json::json!({"url": url, "intent": "typed"}),
        )
        .expect(url);
        assert_eq!(
            denied,
            serde_json::json!({"ok": false, "reason": reason}),
            "{url}"
        );
    }
    let long = format!("https://example.com/{}", "a".repeat(3000));
    assert_eq!(
        invoke(
            &key,
            &chrome,
            "open_tab",
            serde_json::json!({"url": long, "intent": "typed"})
        )
        .unwrap()["reason"],
        "unparseable"
    );
    assert!(
        app.get_webview_window("phoenix-browser-tab-2").is_none(),
        "no refusal opened a window"
    );

    // A port-radar open that Phoenix never asked for is refused; so is Core's own port.
    let radar = |url: &str| {
        invoke(
            &key,
            &chrome,
            "open_tab",
            serde_json::json!({"url": url, "intent": "port_radar"}),
        )
        .unwrap()
    };
    assert_eq!(radar("http://localhost:3000/")["reason"], "not_requested");
    assert_eq!(radar("http://localhost:4999/")["reason"], "private_network");
    assert_eq!(
        radar("http://example.com:3000/")["reason"],
        "private_network"
    );

    // Tab ids are validated; an unknown or malformed one is an error, not a tab.
    for bad in ["", "7", "01", "1;x", "-1", "phoenix-browser-tab-1"] {
        let err =
            invoke(&key, &chrome, "reload", serde_json::json!({"tabId": bad})).expect_err(bad);
        assert_eq!(err["code"], "bad_tab", "{bad}");
    }
    let tab_again =
        invoke(&key, &chrome, "reload", serde_json::json!({"tabId": "1"})).expect("reload");
    assert_eq!(tab_again["tabId"], "1");
    assert_eq!(
        invoke(
            &key,
            &chrome,
            "zoom",
            serde_json::json!({"tabId": "1", "factor": 99.0})
        )
        .unwrap(),
        3.0
    );
    assert_eq!(
        invoke(
            &key,
            &chrome,
            "zoom",
            serde_json::json!({"tabId": "1", "factor": 0.0})
        )
        .unwrap(),
        0.5
    );
    let back = invoke(&key, &chrome, "back", serde_json::json!({"tabId": "1"})).expect("back");
    assert_eq!(back["canGoBack"], false);
    // Navigation re-validates the typed address (and only a typed one).
    let nav = invoke(
        &key,
        &chrome,
        "navigate",
        serde_json::json!({"tabId": "1", "url": "http://localhost/", "intent": "typed"}),
    )
    .unwrap();
    assert_eq!(nav["reason"], "private_network");
    assert!(invoke(
        &key,
        &chrome,
        "navigate",
        serde_json::json!({"tabId": "1", "url": "https://example.com/b", "intent": "port_radar"})
    )
    .is_err());
    let nav = invoke(
        &key,
        &chrome,
        "navigate",
        serde_json::json!({"tabId": "1", "url": "https://example.com/b", "intent": "typed"}),
    )
    .unwrap();
    assert_eq!(nav["ok"], true);
    assert!(invoke(
        &key,
        &chrome,
        "set_site_shields",
        serde_json::json!({"site": "https://x.test/", "blocking": false})
    )
    .is_err());
    assert!(invoke(
        &key,
        &chrome,
        "set_site_shields",
        serde_json::json!({"site": "example.com", "blocking": false})
    )
    .is_ok());
    assert!(invoke(
        &key,
        &chrome,
        "set_chrome_height",
        serde_json::json!({"height": 220.0})
    )
    .is_ok());
    assert_eq!(
        invoke(&key, &chrome, "shields_status", serde_json::json!({})).unwrap()["platformBlocking"],
        false
    );
    assert!(invoke(
        &key,
        &chrome,
        "activate_tab",
        serde_json::json!({"tabId": "1"})
    )
    .is_ok());

    // EVERY command refuses every window but the chrome: the pet, a content window, a stranger.
    let content = app.get_webview_window(label).expect("content window");
    let stranger = tauri::WebviewWindowBuilder::new(
        &app,
        "stranger",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .build()
    .expect("stranger");
    let calls: [(&str, Value); 14] = [
        (
            "open_tab",
            serde_json::json!({"url": "https://example.com/", "intent": "typed"}),
        ),
        ("close_tab", serde_json::json!({"tabId": "1"})),
        ("activate_tab", serde_json::json!({"tabId": "1"})),
        (
            "navigate",
            serde_json::json!({"tabId": "1", "url": "https://example.com/", "intent": "typed"}),
        ),
        ("back", serde_json::json!({"tabId": "1"})),
        ("forward", serde_json::json!({"tabId": "1"})),
        ("reload", serde_json::json!({"tabId": "1"})),
        ("zoom", serde_json::json!({"tabId": "1", "factor": 2.0})),
        ("set_chrome_height", serde_json::json!({"height": 100.0})),
        (
            "set_site_shields",
            serde_json::json!({"site": "example.com", "blocking": true}),
        ),
        ("shields_status", serde_json::json!({})),
        (
            "purge_profile_data",
            serde_json::json!({"profileId": "prof-1"}),
        ),
        ("page_snapshot", serde_json::json!({})),
        (
            "page_action",
            serde_json::json!({"kind": "click", "selector": "button#go", "expectedUrl": "https://example.com/b"}),
        ),
    ];
    for caller in [&pet, &content, &stranger] {
        for (cmd, args) in &calls {
            let refused = invoke(&key, caller, cmd, args.clone()).expect_err(cmd);
            assert_eq!(
                refused["code"],
                "forbidden",
                "{} from {}",
                cmd,
                caller.label()
            );
        }
    }
    assert!(
        app.get_webview_window(label).is_some(),
        "refused commands closed nothing"
    );
    assert_eq!(
        invoke(
            &key,
            &chrome,
            "zoom",
            serde_json::json!({"tabId": "1", "factor": 1.0})
        )
        .unwrap(),
        1.0
    );

    // Closing: the state and the chrome's event follow the window's destruction.
    events.lock().unwrap().clear();
    invoke(
        &key,
        &chrome,
        "close_tab",
        serde_json::json!({"tabId": "1"}),
    )
    .expect("close");
    wait_until(|| {
        events
            .lock()
            .unwrap()
            .iter()
            .any(|(n, _)| n == browser::TAB_CLOSED_EVENT)
    });
    let closed = events
        .lock()
        .unwrap()
        .iter()
        .find(|(n, _)| n == browser::TAB_CLOSED_EVENT)
        .cloned()
        .unwrap();
    assert_eq!(closed.1, serde_json::json!({"tabId": "1"}));
    assert!(
        invoke(&key, &chrome, "reload", serde_json::json!({"tabId": "1"})).is_err(),
        "gone"
    );
    assert!(
        dialogs.lock().unwrap().is_empty(),
        "no dialog without a download"
    );
}

/// Phase 95: `page_snapshot` / `page_action` through the IPC layer with the script-runner fake:
/// the chrome gets RESOLVED values, a content window gets `forbidden` and no script runs for it.
fn page_snapshot_and_page_action_answer_the_chrome_and_refuse_every_other_window() {
    let dir = tempfile::tempdir().unwrap();
    let scripts = Arc::new(Mutex::new(Vec::<(String, String)>::new()));
    let log = scripts.clone();
    let runner: browser::ScriptRunner = Arc::new(move |label, script| {
        log.lock()
            .unwrap()
            .push((label.to_string(), script.to_string()));
        let inner = if script.contains("outerHTML") {
            serde_json::json!({"u": "https://example.com/a#x", "h": "<p>hello</p>", "t": false})
        } else {
            serde_json::json!({"ok": true, "u": "https://example.com/a"})
        };
        Some(serde_json::to_string(&inner.to_string()).unwrap())
    });
    let (app, _) = start_browser_with(
        dir.path(),
        &[("example.com", "93.184.216.34")],
        Some(runner),
    );
    let key = app.invoke_key().to_string();
    let chrome = app
        .get_webview_window(browser::CHROME_WINDOW_LABEL)
        .expect("chrome window");
    let pet = app.get_webview_window(WINDOW_LABEL).expect("pet window");
    let snapshot = |w: &tauri::WebviewWindow<MockRuntime>| {
        invoke(&key, w, "page_snapshot", serde_json::json!({}))
    };
    let action =
        |w: &tauri::WebviewWindow<MockRuntime>, args: Value| invoke(&key, w, "page_action", args);
    let click = serde_json::json!({
        "kind": "click", "selector": "button#go", "expectedUrl": "https://example.com/a"
    });

    // No tab yet: resolved refusals, no script.
    assert_eq!(
        snapshot(&chrome).unwrap(),
        serde_json::json!({"ok": false, "reason": "no_active_tab"})
    );
    assert_eq!(
        action(&chrome, click.clone()).unwrap(),
        serde_json::json!({"ok": false, "reason": "no_active_tab"})
    );

    let opened = invoke(
        &key,
        &chrome,
        "open_tab",
        serde_json::json!({"url": "https://example.com/a", "intent": "typed"}),
    )
    .expect("open");
    assert_eq!(opened["ok"], true, "{opened}");
    let content = app
        .get_webview_window("phoenix-browser-tab-1")
        .expect("content window");

    let snap = snapshot(&chrome).expect("snapshot");
    assert_eq!(snap["ok"], true, "{snap}");
    assert_eq!(snap["tabId"], "1");
    assert_eq!(snap["url"], "https://example.com/a");
    assert_eq!(snap["html"], "<p>hello</p>");
    assert_eq!(snap["truncated"], false);

    assert_eq!(
        action(&chrome, click.clone()).unwrap(),
        serde_json::json!({"ok": true, "url": "https://example.com/a"})
    );
    // Wrong page, bad selector, bad kind: resolved refusals.
    let wrong = serde_json::json!({
        "kind": "click", "selector": "button#go", "expectedUrl": "https://example.com/b"
    });
    assert_eq!(action(&chrome, wrong).unwrap()["reason"], "page_changed");
    let nth = serde_json::json!({
        "kind": "click", "selector": "button:nth-of-type(2)", "expectedUrl": "https://example.com/a"
    });
    assert_eq!(action(&chrome, nth).unwrap()["reason"], "bad_selector");
    let navigate = serde_json::json!({
        "kind": "navigate", "destination": "http://localhost:3000/", "expectedUrl": "https://example.com/a"
    });
    assert_eq!(
        action(&chrome, navigate).unwrap(),
        serde_json::json!({"ok": false, "reason": "private_network"})
    );
    let ran = scripts.lock().unwrap().len();

    // Every other window is refused, and nothing ran for it.
    let stranger = tauri::WebviewWindowBuilder::new(
        &app,
        "stranger",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .build()
    .expect("stranger");
    for caller in [&pet, &content, &stranger] {
        let refused = snapshot(caller).expect_err("snapshot");
        assert_eq!(refused["code"], "forbidden", "{}", caller.label());
        let refused = action(caller, click.clone()).expect_err("action");
        assert_eq!(refused["code"], "forbidden", "{}", caller.label());
    }
    assert_eq!(
        scripts.lock().unwrap().len(),
        ran,
        "no script for a refused caller"
    );
}

/// Phase 80: the port radar only ASKS; nothing opens until the chrome confirms, and only once.
fn a_port_radar_request_opens_a_tab_only_after_the_chromes_confirmation_and_only_once() {
    let dir = tempfile::tempdir().unwrap();
    let (app, _) = start_browser(dir.path(), &[("localhost", "127.0.0.1")]);
    let key = app.invoke_key().to_string();
    let chrome = app
        .get_webview_window(browser::CHROME_WINDOW_LABEL)
        .expect("chrome window");
    let asked = Arc::new(Mutex::new(Vec::<Value>::new()));
    let sink = asked.clone();
    chrome.listen(browser::OPEN_REQUEST_EVENT, move |e| {
        sink.lock()
            .unwrap()
            .push(serde_json::from_str(e.payload()).unwrap());
    });

    // Not a loopback dev server, Core's own port (4999 here), or a link of the wrong shape: refused.
    let link = |url: &str| {
        format!(
            "phoenix://browser/open?url={}",
            url.replace(':', "%3A").replace('/', "%2F")
        )
    };
    for bad in [
        "http://example.com:3000/",
        "http://localhost:4999/",
        "file:///etc/passwd",
        "http://192.168.0.2:3000/",
    ] {
        open_links(app.handle(), &[link(bad)]);
    }
    open_links(
        app.handle(),
        &["phoenix://browser/open?url=http%3A%2F%2Flocalhost%3A3000%2F&x=1"],
    );
    std::thread::sleep(std::time::Duration::from_millis(50));
    assert!(
        asked.lock().unwrap().is_empty(),
        "nothing was even announced"
    );
    assert!(app.get_webview_window("phoenix-browser-tab-1").is_none());

    open_links(app.handle(), &[link("http://localhost:3000/app")]);
    wait_until(|| !asked.lock().unwrap().is_empty());
    assert_eq!(
        asked.lock().unwrap()[0],
        serde_json::json!({"url": "http://localhost:3000/app", "source": "port_radar"})
    );
    assert!(
        app.get_webview_window("phoenix-browser-tab-1").is_none(),
        "asking opens nothing"
    );

    // A different URL than the one asked for is refused; the asked one opens once.
    let open = |url: &str| {
        invoke(
            &key,
            &chrome,
            "open_tab",
            serde_json::json!({"url": url, "intent": "port_radar"}),
        )
        .unwrap()
    };
    assert_eq!(open("http://localhost:3001/")["reason"], "not_requested");
    let opened = open("http://localhost:3000/app");
    assert_eq!(opened["ok"], true, "{opened}");
    assert_eq!(
        opened["tab"]["url"], "http://localhost:3000/app",
        "no https upgrade for the dev server"
    );
    assert_eq!(
        open("http://localhost:3000/app")["reason"],
        "not_requested",
        "once"
    );
}

/// Phase 96: a start whose Core knows exactly `known` profiles and whose pending-deletion list is
/// the shared `pending`. Profile data lives under `dir/browser-profiles`.
fn start_profile_browser(
    dir: &Path,
    known: &[&str],
    pending: Arc<parking_lot::Mutex<Vec<String>>>,
) -> App<MockRuntime> {
    use std::collections::HashMap;
    let table: HashMap<String, std::net::IpAddr> =
        HashMap::from([("example.com".to_string(), "93.184.216.34".parse().unwrap())]);
    let hooks = browser::Hooks {
        resolve: Arc::new(move |name| table.get(name).map(|ip| vec![*ip]).ok_or(())),
        pick_folder: Arc::new(|_| None),
        shields: Arc::new(browser::ShieldsInput::default),
        profiles: browser::ProfileStore::new(dir.join("browser-profiles")),
        core_profiles: browser::CoreProfiles::fixed(
            known.iter().map(|k| k.to_string()).collect(),
            pending,
        ),
        scripts: Arc::new(|_, _| Err(())),
        script_runner: None,
    };
    let options = ShellOptions {
        settings_dir: Some(dir.to_path_buf()),
        open_url: Some(Box::new(|_| {})),
        env: Some(Box::new(|k| {
            (k == "PHOENIX_PORT").then(|| "4999".to_string())
        })),
        confirm_quit: None,
        skip_native_window_styling: true,
        browser_hooks: Some(hooks),
    };
    let mut app = builder::<MockRuntime>(options)
        .build(mock_context(noop_assets()))
        .expect("app builds");
    #[allow(deprecated)]
    app.run_iteration(|_, _| {});
    browser::show(app.handle()).expect("chrome window");
    app
}

fn open_in(key: &str, chrome: &tauri::WebviewWindow<MockRuntime>, profile: Option<&str>) -> Value {
    let mut args = serde_json::json!({"url": "https://example.com/", "intent": "typed"});
    if let Some(p) = profile {
        args["profileId"] = p.into();
    }
    invoke(key, chrome, "open_tab", args).expect("open_tab resolves")
}

/// Phase 96 lifecycle through the mock runtime: a profile tab gets its directory only when opened,
/// a private tab never does, a removed profile cannot be opened, and `purge_profile_data` (chrome
/// only, only for a deletion Core lists as pending) closes the profile's tabs and deletes exactly
/// its directory. The mock runtime has no webview engine, so nothing here proves WebKit/WebView2
/// behaviour.
fn profile_tabs_get_their_own_directory_and_a_pending_purge_deletes_it() {
    let dir = tempfile::tempdir().unwrap();
    let pending = Arc::new(parking_lot::Mutex::new(Vec::<String>::new()));
    let app = start_profile_browser(dir.path(), &["prof-1", "prof-2"], pending.clone());
    let key = app.invoke_key().to_string();
    let chrome = app
        .get_webview_window(browser::CHROME_WINDOW_LABEL)
        .expect("chrome");
    let root = dir.path().join("browser-profiles");

    // A private tab (no profile, or "private" in any case) leaves no directory and has no profile.
    for p in [None, Some("private"), Some("PRIVATE")] {
        let opened = open_in(&key, &chrome, p);
        assert_eq!(opened["ok"], true, "{opened}");
        assert_eq!(opened["tab"]["profileId"], Value::Null);
    }
    assert!(!root.exists(), "no profile directory without a profile tab");

    // Bad ids are refused before anything is created.
    for bad in ["../x", "a/b", "", "a b", &"a".repeat(65), "é"] {
        let denied = open_in(&key, &chrome, Some(bad));
        assert_eq!(denied["ok"], false, "{bad}");
        assert_eq!(denied["reason"], "profile_invalid", "{bad}");
    }
    // A well-formed id Core does not have is refused too.
    let unknown = open_in(&key, &chrome, Some("not-a-profile"));
    assert_eq!(unknown["reason"], "profile_invalid");
    assert!(!root.exists());

    // A profile tab is created and keeps its profile.
    let one = open_in(&key, &chrome, Some("prof-1"));
    assert_eq!(one["ok"], true, "{one}");
    assert_eq!(one["tab"]["profileId"], "prof-1");
    let two = open_in(&key, &chrome, Some("prof-2"));
    assert_eq!(two["ok"], true, "{two}");
    let dir1 = root.join("p-prof-1");
    let dir2 = root.join("p-prof-2");
    assert!(dir1.is_dir() && dir2.is_dir());
    std::fs::write(dir1.join("cookies"), b"x").unwrap();
    std::fs::write(dir2.join("cookies"), b"y").unwrap();
    let tab1 = one["tab"]["tabId"].as_str().unwrap().to_string();
    let tab2 = two["tab"]["tabId"].as_str().unwrap().to_string();
    assert!(app
        .get_webview_window(&format!("phoenix-browser-tab-{tab1}"))
        .is_some());

    // Not pending in Core: the purge refuses and deletes nothing (a live profile is safe).
    let refused = invoke(
        &key,
        &chrome,
        "purge_profile_data",
        serde_json::json!({"profileId": "prof-1"}),
    )
    .expect_err("not pending");
    assert_eq!(refused["code"], "bad_profile");
    assert!(dir1.join("cookies").exists());

    // Invalid ids are refused by the command itself.
    for bad in ["../prof-1", "private", "", "a/b"] {
        let refused = invoke(
            &key,
            &chrome,
            "purge_profile_data",
            serde_json::json!({"profileId": bad}),
        )
        .expect_err(bad);
        assert_eq!(refused["code"], "bad_profile", "{bad}");
    }
    assert!(dir1.join("cookies").exists() && dir2.join("cookies").exists());

    // Core removed prof-1: its deletion is pending. New tabs in it are refused; the purge closes
    // its tab and deletes ITS directory only.
    pending.lock().push("prof-1".into());
    let busy = open_in(&key, &chrome, Some("prof-1"));
    assert_eq!(busy["reason"], "profile_busy", "{busy}");
    let report = invoke(
        &key,
        &chrome,
        "purge_profile_data",
        serde_json::json!({"profileId": "prof-1"}),
    )
    .expect("purge");
    assert_eq!(report["closedTabs"], 1);
    assert_eq!(report["dataRemoved"], true);
    assert!(!dir1.exists());
    assert!(
        dir2.join("cookies").exists(),
        "another profile is untouched"
    );
    assert!(root.exists());
    // The mock runtime keeps the window object after `destroy`; the host's tab state is what
    // proves the tab was closed (the chrome gets `browser://tab-closed` from it).
    assert!(
        invoke(&key, &chrome, "reload", serde_json::json!({"tabId": tab1})).is_err(),
        "the profile's tab is gone"
    );
    assert!(
        invoke(&key, &chrome, "reload", serde_json::json!({"tabId": tab2})).is_ok(),
        "the other profile's tab is not"
    );
    assert!(app
        .get_webview_window(&format!("phoenix-browser-tab-{tab2}"))
        .is_some());

    // The purge is idempotent while Core still lists it.
    let again = invoke(
        &key,
        &chrome,
        "purge_profile_data",
        serde_json::json!({"profileId": "prof-1"}),
    )
    .expect("second purge");
    assert_eq!(again["closedTabs"], 0);
    assert_eq!(again["dataRemoved"], false);

    // Still pending in Core, so it cannot be reopened even though Core "knows" the id here.
    assert_eq!(
        open_in(&key, &chrome, Some("prof-1"))["reason"],
        "profile_busy"
    );
    // Once Core acknowledged the purge (and, in real life, no longer has the profile) nothing is
    // pending; prof-2 stays usable throughout.
    pending.lock().clear();
    assert_eq!(open_in(&key, &chrome, Some("prof-2"))["ok"], true);

    // A symlinked profile directory is refused and its target survives.
    #[cfg(unix)]
    {
        let outside = dir.path().join("outside");
        std::fs::create_dir(&outside).unwrap();
        std::fs::write(outside.join("precious"), b"z").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("p-prof-2-link")).unwrap();
        std::fs::remove_dir_all(&dir2).unwrap();
        std::os::unix::fs::symlink(&outside, &dir2).unwrap();
        pending.lock().push("prof-2".into());
        let refused = invoke(
            &key,
            &chrome,
            "purge_profile_data",
            serde_json::json!({"profileId": "prof-2"}),
        )
        .expect_err("symlink");
        assert_eq!(refused["code"], "purge_failed");
        assert!(outside.join("precious").exists());
    }

    // The data of a profile that never had a tab: nothing to delete, no error.
    pending.lock().clear();
    pending.lock().push("prof-9".into());
    let none = invoke(
        &key,
        &chrome,
        "purge_profile_data",
        serde_json::json!({"profileId": "prof-9"}),
    )
    .expect("nothing to delete");
    assert_eq!(none["dataRemoved"], false);
}

fn main() {
    // Tauri's Linux runtime builds GTK menus, which need GTK initialised (and a display; CI
    // runs this under xvfb). Without this the mock runtime panics in gtk::Menu::new.
    #[cfg(target_os = "linux")]
    gtk::init().expect("GTK failed to initialise: is a display available (xvfb-run)?");

    let tests: [(&str, fn()); 26] = [
        (
            "starts with window, tray and full menu",
            starts_with_window_tray_and_full_menu,
        ),
        ("hide and show are remembered", hide_and_show_are_remembered),
        (
            "keep-on-top toggles and is remembered",
            keep_on_top_toggles_and_is_remembered,
        ),
        (
            "Open Phoenix opens the local Core",
            open_phoenix_opens_the_local_core,
        ),
        ("settings survive a restart", settings_survive_a_restart),
        ("corrupt settings still start", corrupt_settings_still_start),
        ("unknown menu ids are ignored", unknown_menu_ids_are_ignored),
        (
            "modes switch live and are remembered",
            modes_switch_live_and_are_remembered,
        ),
        (
            "island mode survives a restart",
            island_mode_survives_a_restart_without_creating_the_floating_pet_twice,
        ),
        (
            "hide applies to the active mode",
            hide_applies_to_whichever_mode_is_active,
        ),
        ("unknown mode ids are ignored", unknown_mode_ids_are_ignored),
        (
            "Wardrobe opens the pet panel tab",
            wardrobe_opens_the_pet_panel_wardrobe_tab,
        ),
        (
            "a phoenix://approvals link opens the approvals panel and nothing else does",
            a_phoenix_approvals_link_opens_the_approvals_panel_and_nothing_else_does,
        ),
        (
            "shortcut registration failure never stops startup",
            shortcuts_stay_off_and_registration_failure_never_stops_startup,
        ),
        (
            "mute toggles and is remembered",
            mute_toggles_and_is_remembered,
        ),
        (
            "shortcut commands work from the pet window and refuse any other",
            shortcut_commands_work_from_the_pet_window_and_refuse_any_other,
        ),
        (
            "jump to terminal asks Core, then falls back to the agents page",
            jump_to_terminal_asks_core_with_the_token_then_opens_the_agents_page_when_there_is_no_session,
        ),
        (
            "quit with a pending change is held and cancel keeps running",
            quit_with_a_pending_change_is_held_and_asks_the_person_who_cancels,
        ),
        (
            "a dialog that cannot be shown keeps Phoenix running",
            a_dialog_that_cannot_be_shown_keeps_phoenix_running,
        ),
        (
            "the tray shows the Keep-awake countdown only while a session runs",
            the_tray_shows_the_keep_awake_countdown_only_while_core_says_a_session_runs,
        ),
        (
            "a dropped file is announced without its path and read once by its window only",
            a_dropped_file_is_announced_without_its_path_and_read_once_by_its_window_only,
        ),
        (
            "browser commands run for the chrome window only and validate everything",
            browser_commands_run_for_the_chrome_window_only_and_validate_everything,
        ),
        (
            "page_snapshot and page_action answer the chrome and refuse every other window",
            page_snapshot_and_page_action_answer_the_chrome_and_refuse_every_other_window,
        ),
        (
            "a port radar request opens a tab only after the chrome confirms, once",
            a_port_radar_request_opens_a_tab_only_after_the_chromes_confirmation_and_only_once,
        ),
        (
            "profile tabs get their own directory and a pending purge deletes it",
            profile_tabs_get_their_own_directory_and_a_pending_purge_deletes_it,
        ),
        (
            "the voice window allows only its own microphone, shows LISTENING and stops from the tray",
            the_voice_window_allows_only_its_own_microphone_shows_listening_and_stops_from_the_tray,
        ),
    ];
    for (name, test) in tests {
        test();
        println!("ok - {name}");
    }
    println!("lifecycle: {} passed", tests.len());
}
