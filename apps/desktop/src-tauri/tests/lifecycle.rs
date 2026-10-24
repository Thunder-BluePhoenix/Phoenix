// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Window and tray lifecycle, driven through Tauri's mock runtime (no real window,
//! browser or login item is touched). Runs on the main thread (`harness = false`)
//! because macOS only creates menus and tray icons there.
//!
//! Not covered here (the mock runtime does not model it): real window visibility,
//! stacking, pixels and Quit; those were checked by hand on macOS.

use phoenix_desktop::{
    builder, file_drop, handle_menu, menu_snapshot, quit_requested, refresh_awake_tray,
    run_shortcut, shortcuts, ShellOptions, AWAKE_ITEM_ID, ISLAND_LABEL, SETTINGS_FILE, TRAY_ID,
    WINDOW_LABEL,
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

fn main() {
    // Tauri's Linux runtime builds GTK menus, which need GTK initialised (and a display; CI
    // runs this under xvfb). Without this the mock runtime panics in gtk::Menu::new.
    #[cfg(target_os = "linux")]
    gtk::init().expect("GTK failed to initialise: is a display available (xvfb-run)?");

    let tests: [(&str, fn()); 20] = [
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
    ];
    for (name, test) in tests {
        test();
        println!("ok - {name}");
    }
    println!("lifecycle: {} passed", tests.len());
}
