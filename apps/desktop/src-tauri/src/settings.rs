// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Desktop-only preferences, stored next to the app (never in Phoenix Core's
//! database: the desktop pet must work, and remember its place, when Core is down).

use crate::island_geometry::IslandDisplay;
use crate::position::Point;
use serde::{Deserialize, Serialize};
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
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            position: None,
            always_on_top: false,
            visible: true,
            mode: Mode::Floating,
            island_display: IslandDisplay::Primary,
        }
    }
}

/// Missing or unreadable settings fall back to defaults: a corrupt file must
/// never stop the pet from appearing.
pub fn load(path: &Path) -> Settings {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
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
}
