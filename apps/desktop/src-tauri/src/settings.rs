// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Desktop-only preferences, stored next to the app (never in Phoenix Core's
//! database: the desktop pet must work, and remember its place, when Core is down).

use crate::position::Point;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::Path;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// Last window position (physical pixels).
    pub position: Option<Point>,
    /// Opt-in: float above other windows. Off unless the user turns it on.
    pub always_on_top: bool,
    /// Hiding Fawkes never disables Phoenix; this only remembers the window.
    pub visible: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            position: None,
            always_on_top: false,
            visible: true,
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
    }

    #[test]
    fn round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("desktop.json");
        let s = Settings {
            position: Some(Point { x: -40, y: 900 }),
            always_on_top: true,
            visible: false,
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
