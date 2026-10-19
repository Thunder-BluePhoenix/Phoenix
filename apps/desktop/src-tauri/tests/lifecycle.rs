// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Window and tray lifecycle, driven through Tauri's mock runtime (no real window,
//! browser or login item is touched). Runs on the main thread (`harness = false`)
//! because macOS only creates menus and tray icons there.
//!
//! Not covered here (the mock runtime does not model it): real window visibility,
//! stacking, pixels and Quit; those were checked by hand on macOS.

use phoenix_desktop::{
    builder, handle_menu, menu_snapshot, ShellOptions, ISLAND_LABEL, SETTINGS_FILE, TRAY_ID,
    WINDOW_LABEL,
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

fn main() {
    // Tauri's Linux runtime builds GTK menus, which need GTK initialised (and a display; CI
    // runs this under xvfb). Without this the mock runtime panics in gtk::Menu::new.
    #[cfg(target_os = "linux")]
    gtk::init().expect("GTK failed to initialise: is a display available (xvfb-run)?");

    let tests: [(&str, fn()); 14] = [
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
    ];
    for (name, test) in tests {
        test();
        println!("ok - {name}");
    }
    println!("lifecycle: {} passed", tests.len());
}
