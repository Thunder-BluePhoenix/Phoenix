// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Window and tray lifecycle, driven through Tauri's mock runtime (no real window,
//! browser or login item is touched). Runs on the main thread (`harness = false`)
//! because macOS only creates menus and tray icons there.
//!
//! Not covered here (the mock runtime does not model it): real window visibility,
//! stacking, pixels and Quit; those were checked by hand on macOS.

use phoenix_desktop::{
    builder, handle_menu, menu_snapshot, ShellOptions, SETTINGS_FILE, TRAY_ID, WINDOW_LABEL,
};
use serde_json::Value;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::test::{mock_context, noop_assets, MockRuntime};
use tauri::{App, Manager};

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
    assert_eq!(ids, ["toggle", "open", "on_top", "login", "quit"]);
    assert_eq!(item(&s.app, "toggle").0, "Hide Fawkes");
    assert_eq!(item(&s.app, "open").0, "Open Phoenix");
    assert_eq!(item(&s.app, "quit").0, "Quit Fawkes");
    // Keep-on-top is opt-in.
    assert_eq!(
        item(&s.app, "on_top"),
        ("Keep Fawkes on top".into(), Some(false))
    );
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

fn main() {
    let tests: [(&str, fn()); 7] = [
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
    ];
    for (name, test) in tests {
        test();
        println!("ok - {name}");
    }
    println!("lifecycle: {} passed", tests.len());
}
