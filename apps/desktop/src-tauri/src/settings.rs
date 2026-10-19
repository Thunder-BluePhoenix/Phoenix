// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Desktop-only preferences, stored next to the app (never in Phoenix Core's
//! database: the desktop pet must work, and remember its place, when Core is down).

use crate::dictation_keys::{DictationKey, PasteChord};
use crate::island_geometry::IslandDisplay;
use crate::position::Point;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::Path;

/// Where Fawkes lives on the desktop. One pet, one state (Core's); only the place differs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    /// The draggable transparent window (Phase 14).
    #[default]
    Floating,
    /// The notch / top-edge island (Phase 60).
    Island,
    /// No desktop window: Fawkes stays in the Phoenix web app's navbar.
    Navbar,
}

impl Mode {
    pub const ALL: [Mode; 3] = [Mode::Floating, Mode::Island, Mode::Navbar];

    /// Menu id suffix and the value the page sends.
    pub fn as_str(self) -> &'static str {
        match self {
            Mode::Floating => "floating",
            Mode::Island => "island",
            Mode::Navbar => "navbar",
        }
    }

    pub fn parse(text: &str) -> Option<Mode> {
        Mode::ALL.into_iter().find(|m| m.as_str() == text)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// Last window position (physical pixels).
    pub position: Option<Point>,
    /// Opt-in: float above other windows. Off unless the user turns it on.
    pub always_on_top: bool,
    /// Hiding Fawkes never disables Phoenix; this only remembers the window.
    pub visible: bool,
    /// Floating window, island or navbar only. Switchable while running.
    pub mode: Mode,
    /// Which monitor the island uses.
    pub island_display: IslandDisplay,
    /// Phase 64: the global dictation key (hold to talk, double tap for hands-free). Off until
    /// the user turns it on; turning it on is also what asks the OS for Input Monitoring.
    pub dictation_hotkey: bool,
    /// Which key it is.
    pub dictation_key: DictationKey,
    /// Editable in desktop.json; invalid chords fail closed to the default chord.
    pub paste_again_chord: String,
    /// Keep the dictation pill on screen. Off: the pill only appears while dictating.
    pub pill: bool,
    /// Phase 70: global shortcuts. Off until the user turns them on: a global hotkey can take a
    /// key away from every other application.
    pub shortcuts_enabled: bool,
    /// The user's own accelerators by action name (`shortcuts::Action::as_str`). A missing action
    /// uses its default, an empty text unbinds it, and text that fails validation leaves the
    /// action unbound (see `shortcuts::resolve`). Anything that is not text is dropped on load.
    #[serde(deserialize_with = "lenient_shortcuts")]
    pub shortcuts: BTreeMap<String, String>,
    /// Phase 70: sounds and notification toasts are silenced. The shell only keeps and announces
    /// the flag (`shortcuts://mute`); the web app is what stays quiet.
    pub muted: bool,
}

/// One malformed shortcut entry must not reset the pet's position and every other preference
/// (a type error would make `load` fall back to all defaults): keep the text entries of known
/// actions and ignore the rest.
fn lenient_shortcuts<'de, D>(deserializer: D) -> Result<BTreeMap<String, String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    let serde_json::Value::Object(map) = value else {
        return Ok(BTreeMap::new());
    };
    Ok(map
        .into_iter()
        .filter(|(action, _)| crate::shortcuts::Action::parse(action).is_some())
        .map(|(action, text)| match text {
            serde_json::Value::String(text) => (action, text),
            // A non-text entry (null, false, a number) is a damaged binding: unbound, never
            // the default chord.
            _ => (action, String::new()),
        })
        .collect())
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            position: None,
            always_on_top: false,
            visible: true,
            mode: Mode::Floating,
            island_display: IslandDisplay::Primary,
            dictation_hotkey: false,
            dictation_key: DictationKey::default(),
            paste_again_chord: PasteChord::default().to_string(),
            pill: false,
            shortcuts_enabled: false,
            shortcuts: BTreeMap::new(),
            muted: false,
        }
    }
}

/// Missing or unreadable settings fall back to defaults: a corrupt file must
/// never stop the pet from appearing.
pub fn load(path: &Path) -> Settings {
    let Ok(text) = fs::read_to_string(path) else {
        return Settings::default();
    };
    let Ok(mut settings) = serde_json::from_str::<Settings>(&text) else {
        return Settings::default();
    };
    // An opt-in must be explicit. A missing or malformed key never silently becomes the
    // platform's default dictation key while the saved hotkey switch remains on.
    if let Ok(raw) = serde_json::from_str::<serde_json::Value>(&text) {
        if raw.get("dictation_hotkey") == Some(&serde_json::Value::Bool(true))
            && raw.get("dictation_key").is_none()
        {
            settings.dictation_hotkey = false;
        }
    }
    if !settings.dictation_key.is_supported() {
        settings.dictation_hotkey = false;
        settings.dictation_key = DictationKey::default();
    }
    if PasteChord::parse(&settings.paste_again_chord).is_none() {
        settings.paste_again_chord = PasteChord::default().to_string();
    }
    settings
}

/// Writes atomically (temp file + rename) so a crash cannot leave half a file.
pub fn save(path: &Path, settings: &Settings) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(settings)?)?;
    fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_opt_in() {
        let s = Settings::default();
        assert!(!s.always_on_top);
        assert!(s.visible);
        assert_eq!(s.position, None);
        // The island is opt-in: a fresh install keeps the floating Fawkes.
        assert_eq!(s.mode, Mode::Floating);
        assert_eq!(s.island_display, IslandDisplay::Primary);
    }

    #[test]
    fn dictation_is_off_by_default_and_a_file_without_it_stays_off() {
        let s = Settings::default();
        assert!(!s.dictation_hotkey);
        assert!(!s.pill);
        assert_eq!(s.dictation_key, DictationKey::default());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("desktop.json");
        fs::write(&path, r#"{"mode":"island","always_on_top":true}"#).unwrap();
        let loaded = load(&path);
        assert!(!loaded.dictation_hotkey && !loaded.pill);
    }

    #[test]
    fn the_dictation_choices_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("desktop.json");
        let s = Settings {
            dictation_hotkey: true,
            dictation_key: DictationKey::RightControl,
            paste_again_chord: "ctrl+shift+9".into(),
            pill: true,
            ..Settings::default()
        };
        save(&path, &s).unwrap();
        assert!(fs::read_to_string(&path)
            .unwrap()
            .contains("\"right_control\""));
        assert_eq!(load(&path), s);
        assert_eq!(
            PasteChord::parse(&load(&path).paste_again_chord)
                .unwrap()
                .to_string(),
            "ctrl+shift+9"
        );
    }

    #[test]
    fn invalid_paste_chord_is_not_accepted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("desktop.json");
        fs::write(&path, r#"{"paste_again_chord":"v"}"#).unwrap();
        assert_eq!(
            load(&path).paste_again_chord,
            PasteChord::default().to_string()
        );
    }

    #[test]
    fn an_unknown_dictation_key_falls_back_to_defaults_with_dictation_off() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("desktop.json");
        fs::write(
            &path,
            r#"{"dictation_hotkey":true,"dictation_key":"caps_lock"}"#,
        )
        .unwrap();
        let loaded = load(&path);
        assert!(!loaded.dictation_hotkey);
    }

    #[test]
    fn a_phase_14_settings_file_still_loads_as_floating() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("desktop.json");
        fs::write(
            &path,
            r#"{"position":{"x":3,"y":4},"always_on_top":false,"visible":true}"#,
        )
        .unwrap();
        let s = load(&path);
        assert_eq!(s.mode, Mode::Floating);
        assert_eq!(s.position, Some(Point { x: 3, y: 4 }));
    }

    #[test]
    fn an_unknown_mode_falls_back_to_defaults_rather_than_hiding_fawkes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("desktop.json");
        fs::write(&path, r#"{"mode":"hologram","always_on_top":true}"#).unwrap();
        assert_eq!(load(&path), Settings::default());
    }

    #[test]
    fn modes_round_trip_through_their_names() {
        for mode in Mode::ALL {
            assert_eq!(Mode::parse(mode.as_str()), Some(mode));
        }
        assert_eq!(Mode::parse("Island"), None);
        assert_eq!(Mode::parse(""), None);
        assert_eq!(serde_json::to_string(&Mode::Island).unwrap(), "\"island\"");
    }

    #[test]
    fn round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("desktop.json");
        let s = Settings {
            position: Some(Point { x: -40, y: 900 }),
            always_on_top: true,
            visible: false,
            mode: Mode::Island,
            island_display: IslandDisplay::Named("Studio".into()),
            dictation_hotkey: true,
            dictation_key: DictationKey::RightControl,
            paste_again_chord: PasteChord::default().to_string(),
            pill: true,
            shortcuts_enabled: true,
            shortcuts: BTreeMap::from([("mute".to_string(), "Ctrl+Alt+Shift+9".to_string())]),
            muted: true,
        };
        save(&path, &s).unwrap();
        assert_eq!(load(&path), s);
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn missing_file_gives_defaults() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load(&dir.path().join("none.json")), Settings::default());
    }

    #[test]
    fn corrupt_file_gives_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("desktop.json");
        fs::write(&path, "{ not json").unwrap();
        assert_eq!(load(&path), Settings::default());
    }

    #[test]
    fn unknown_or_missing_fields_are_tolerated() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("desktop.json");
        fs::write(&path, r#"{"always_on_top": true, "future": 1}"#).unwrap();
        let s = load(&path);
        assert!(s.always_on_top);
        assert!(s.visible);
    }

    #[test]
    fn shortcuts_and_mute_are_off_by_default_and_a_file_without_them_stays_off() {
        let s = Settings::default();
        assert!(!s.shortcuts_enabled && !s.muted && s.shortcuts.is_empty());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("desktop.json");
        fs::write(&path, r#"{"mode":"island"}"#).unwrap();
        let loaded = load(&path);
        assert!(!loaded.shortcuts_enabled && !loaded.muted);
    }

    #[test]
    fn a_malformed_shortcut_entry_does_not_reset_the_other_preferences() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("desktop.json");
        fs::write(
            &path,
            r#"{"always_on_top":true,"shortcuts":{"mute":5,"open_chat":"Ctrl+Alt+Shift+K","bogus":"x"}}"#,
        )
        .unwrap();
        let loaded = load(&path);
        assert!(loaded.always_on_top);
        // The damaged `mute` entry is kept as an empty binding (unbound), not dropped: a dropped
        // entry would resolve to the default chord. Unknown actions are ignored.
        assert_eq!(
            loaded.shortcuts,
            BTreeMap::from([
                ("mute".to_string(), String::new()),
                ("open_chat".to_string(), "Ctrl+Alt+Shift+K".to_string()),
            ])
        );
        fs::write(&path, r#"{"always_on_top":true,"shortcuts":[1]}"#).unwrap();
        let loaded = load(&path);
        assert!(loaded.always_on_top && loaded.shortcuts.is_empty());
    }
}
