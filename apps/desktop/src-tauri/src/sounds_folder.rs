// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! The user sounds folder (Phase 59): `<app data dir>/sounds/<id>.wav` replaces a built-in Fawkes
//! sound. This module is the desktop half; the web app's sound host validates the bytes
//! (`inspectWav` in pet/assets) before anything is played.
//!
//! What the single command, `sound_override`, can and cannot do:
//!
//! * It takes an event id from a fixed list of seven ([`SOUND_IDS`]), never a path. The file read
//!   is always `<app data dir>/sounds/<id>.wav`; an id outside the list is refused before any file
//!   system call, so `../x`, separators, `\`, NUL, a different case or a trailing space name nothing.
//! * It never lists the folder and never creates it (creating it is the user's job). It reads one
//!   file: a regular file by `symlink_metadata` (a symlink, a folder, a FIFO or a device is "no
//!   override"), compared with the opened file (a path swapped in between is refused), at most
//!   [`MAX_BYTES`], read with a bound one byte past the cap.
//! * Only the floating Fawkes and island windows may ask (the windows the shell already trusts
//!   with its other pet commands). The dictation pill, the browser and any other window are refused.
//! * The folder path is returned to the asking window so Settings can tell the person where to put
//!   files; the file's name is never taken from the page.
//! * Nothing here logs a path or a byte.
//!
//! The folder itself, if the user made it a symlink, is followed: only the file is checked, because
//! the folder belongs to the same person as the rest of the data directory.

use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::{Runtime, WebviewWindow};

/// The seven sound ids (`SOUND_IDS` in pet/assets/src/sounds.ts; a web test compares them).
pub const SOUND_IDS: [&str; 7] = [
    "greet", "poke", "dizzy", "recover", "jump", "waiting", "error",
];

/// Largest override file. The web side accepts up to 2 MiB; the shell is stricter because a
/// five-second mono sound is a few hundred KiB.
pub const MAX_BYTES: u64 = 1024 * 1024;

/// Name of the folder inside the app data directory.
pub const FOLDER: &str = "sounds";

/// A refusal the page can read. `code` is machine-readable; neither field contains a path.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Refusal {
    pub code: &'static str,
    pub message: &'static str,
}

pub const FORBIDDEN: Refusal = Refusal {
    code: "forbidden",
    message: "This window cannot read the sounds folder.",
};
pub const UNKNOWN_ID: Refusal = Refusal {
    code: "unknown_sound",
    message: "That is not one of Fawkes' sound ids.",
};
pub const UNREADABLE: Refusal = Refusal {
    code: "unreadable",
    message: "The sounds folder could not be read.",
};

/// What the page gets: where the folder is, and the override's bytes when `id` was asked for and a
/// usable `<id>.wav` is there.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct Answer {
    pub folder: String,
    pub wav: Option<Vec<u8>>,
}

/// The windows that may ask: the floating Fawkes and the island.
pub fn may_read(label: &str) -> bool {
    label == crate::WINDOW_LABEL || label == crate::ISLAND_LABEL
}

/// The sounds folder for an app data directory.
pub fn folder_in(data_dir: &Path) -> PathBuf {
    data_dir.join(FOLDER)
}

fn open_file(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // FILE_FLAG_OPEN_REPARSE_POINT: open a link itself instead of following it.
        options.custom_flags(0x0020_0000);
    }
    options.open(path)
}

#[cfg(unix)]
fn same_file(a: &fs::Metadata, b: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    a.dev() == b.dev() && a.ino() == b.ino()
}

#[cfg(not(unix))]
fn same_file(_: &fs::Metadata, _: &fs::Metadata) -> bool {
    // The open above did not follow a link.
    true
}

/// The bytes of `<folder>/<id>.wav`, or `None` when there is no usable override: no file, a
/// symlink, a folder or other non-regular file, an empty file, one over [`MAX_BYTES`], or one that
/// cannot be read. `Err` only for an id outside [`SOUND_IDS`]. Blocking.
pub fn read_override(folder: &Path, id: &str) -> Result<Option<Vec<u8>>, Refusal> {
    if !SOUND_IDS.contains(&id) {
        return Err(UNKNOWN_ID);
    }
    let path = folder.join(format!("{id}.wav"));
    let Ok(checked) = fs::symlink_metadata(&path) else {
        return Ok(None);
    };
    if !checked.file_type().is_file() || checked.len() == 0 || checked.len() > MAX_BYTES {
        return Ok(None);
    }
    let Ok(mut file) = open_file(&path) else {
        return Ok(None);
    };
    let Ok(opened) = file.metadata() else {
        return Ok(None);
    };
    if !opened.is_file() || !same_file(&checked, &opened) || opened.len() > MAX_BYTES {
        return Ok(None);
    }
    let mut bytes = Vec::with_capacity(opened.len() as usize);
    // One byte past the cap tells a file that grew after it was checked from one that fits.
    if (&mut file)
        .take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .is_err()
        || bytes.is_empty()
        || bytes.len() as u64 > MAX_BYTES
    {
        return Ok(None);
    }
    Ok(Some(bytes))
}

/// Reads the override for `id` (when given) and reports the folder. An id of `None` only reports
/// the folder (Settings shows it).
pub fn answer(folder: &Path, id: Option<&str>) -> Result<Answer, Refusal> {
    let wav = match id {
        Some(id) => read_override(folder, id)?,
        None => None,
    };
    Ok(Answer {
        folder: folder.to_string_lossy().into_owned(),
        wav,
    })
}

/// Fawkes' sounds folder and, for an `id`, the user's replacement for that sound. Asked by the
/// floating and island pages only. There is no path argument.
#[tauri::command]
pub(crate) async fn sound_override<R: Runtime>(
    window: WebviewWindow<R>,
    shell: tauri::State<'_, crate::Shell<R>>,
    id: Option<String>,
) -> Result<Answer, Refusal> {
    if !may_read(window.label()) {
        return Err(FORBIDDEN);
    }
    let data_dir = shell
        .settings_path
        .parent()
        .map(Path::to_path_buf)
        .ok_or(UNREADABLE)?;
    let folder = folder_in(&data_dir);
    tauri::async_runtime::spawn_blocking(move || answer(&folder, id.as_deref()))
        .await
        .map_err(|_| UNREADABLE)?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    fn wav(folder: &Path, id: &str, bytes: &[u8]) {
        fs::create_dir_all(folder).unwrap();
        fs::write(folder.join(format!("{id}.wav")), bytes).unwrap();
    }

    #[test]
    fn the_allow_list_is_the_seven_sound_ids() {
        assert_eq!(SOUND_IDS.len(), 7);
    }

    #[test]
    fn reads_a_regular_file_for_each_id() {
        let d = dir();
        let folder = folder_in(d.path());
        for id in SOUND_IDS {
            wav(&folder, id, id.as_bytes());
            assert_eq!(
                read_override(&folder, id),
                Ok(Some(id.as_bytes().to_vec())),
                "{id}"
            );
        }
    }

    #[test]
    fn a_missing_file_or_folder_is_no_override() {
        let d = dir();
        let folder = folder_in(d.path());
        assert_eq!(read_override(&folder, "greet"), Ok(None), "no folder");
        fs::create_dir_all(&folder).unwrap();
        assert_eq!(read_override(&folder, "greet"), Ok(None), "no file");
    }

    #[test]
    fn ids_outside_the_list_are_refused_and_name_no_file() {
        let d = dir();
        let folder = folder_in(d.path());
        wav(&folder, "greet", b"RIFF");
        // A file outside the folder that a traversal would reach.
        fs::write(d.path().join("secret.wav"), b"outside").unwrap();
        for bad in [
            "",
            "../secret",
            "..",
            ".",
            "../sounds/greet",
            "greet/../greet",
            "greet.wav",
            "greet ",
            " greet",
            "GREET",
            "Greet",
            "greet\0",
            "greet\0.wav",
            "..\\secret",
            "/etc/passwd",
            "C:\\Windows\\win",
            "sub/greet",
            "gree",
            "greet\n",
            "%2e%2e%2fsecret",
        ] {
            assert_eq!(read_override(&folder, bad), Err(UNKNOWN_ID), "{bad:?}");
        }
        // Even a refused id never reaches the file system, so the answer for `None` is only the folder.
        assert_eq!(answer(&folder, Some("../secret")), Err(UNKNOWN_ID));
        assert_eq!(answer(&folder, None).unwrap().wav, None);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_is_never_followed() {
        let d = dir();
        let folder = folder_in(d.path());
        fs::create_dir_all(&folder).unwrap();
        let target = d.path().join("elsewhere.wav");
        fs::write(&target, b"target bytes").unwrap();
        std::os::unix::fs::symlink(&target, folder.join("greet.wav")).unwrap();
        assert_eq!(read_override(&folder, "greet"), Ok(None));
        // A dangling link too.
        std::os::unix::fs::symlink(d.path().join("nope.wav"), folder.join("poke.wav")).unwrap();
        assert_eq!(read_override(&folder, "poke"), Ok(None));
    }

    #[test]
    fn a_file_over_the_cap_is_no_override_and_the_cap_itself_fits() {
        let d = dir();
        let folder = folder_in(d.path());
        wav(&folder, "greet", &vec![7u8; MAX_BYTES as usize + 1]);
        assert_eq!(read_override(&folder, "greet"), Ok(None));
        wav(&folder, "greet", &vec![7u8; MAX_BYTES as usize]);
        assert_eq!(
            read_override(&folder, "greet").unwrap().map(|b| b.len()),
            Some(MAX_BYTES as usize)
        );
    }

    #[test]
    fn an_empty_file_is_no_override() {
        let d = dir();
        let folder = folder_in(d.path());
        wav(&folder, "greet", b"");
        assert_eq!(read_override(&folder, "greet"), Ok(None));
    }

    #[test]
    fn a_folder_named_like_a_sound_is_no_override() {
        let d = dir();
        let folder = folder_in(d.path());
        fs::create_dir_all(folder.join("greet.wav")).unwrap();
        assert_eq!(read_override(&folder, "greet"), Ok(None));
    }

    #[cfg(unix)]
    #[test]
    fn a_fifo_is_no_override_and_does_not_block() {
        let d = dir();
        let folder = folder_in(d.path());
        fs::create_dir_all(&folder).unwrap();
        let fifo = folder.join("greet.wav");
        let status = std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .expect("mkfifo");
        assert!(status.success());
        assert_eq!(read_override(&folder, "greet"), Ok(None));
    }

    #[test]
    fn the_answer_names_the_folder_and_only_that_folder() {
        let d = dir();
        let folder = folder_in(d.path());
        let said = answer(&folder, None).unwrap();
        assert_eq!(said.folder, folder.to_string_lossy());
        assert!(said.folder.ends_with("sounds"));
        assert!(!folder.exists(), "asking never creates the folder");
    }

    #[test]
    fn only_the_floating_and_island_windows_may_ask() {
        assert!(may_read("fawkes"));
        assert!(may_read("fawkes-island"));
        for other in [
            "phoenix-pill",
            "phoenix-browser",
            "phoenix-browser-tab-1",
            "phoenix-voice",
            "main",
            "stranger",
            "",
            "Fawkes",
        ] {
            assert!(!may_read(other), "{other:?}");
        }
    }

    /// The wiring cannot be exercised without a real shell here, so it is read from the source:
    /// the command checks the caller first, is granted to the pet windows only, and takes no path.
    #[test]
    fn the_command_is_wired_to_the_pet_windows_only() {
        let source = include_str!("sounds_folder.rs");
        let command = source
            .split("pub(crate) async fn sound_override")
            .nth(1)
            .expect("the command")
            .split("#[cfg(test)]")
            .next()
            .unwrap();
        let check = command
            .find("may_read(window.label())")
            .expect("caller check");
        let first_fs = command
            .find("spawn_blocking")
            .expect("the read runs off the event loop");
        assert!(check < first_fs, "the caller is checked before any read");
        assert!(command.contains("id: Option<String>"));
        assert!(
            !command.contains("path: ") && !command.contains("PathBuf,"),
            "no path argument"
        );

        let lib = include_str!("lib.rs");
        assert_eq!(lib.matches("sounds_folder::sound_override").count(), 1);
        let build = include_str!("../build.rs");
        assert_eq!(build.matches("\"sound_override\"").count(), 1);

        let default = include_str!("../capabilities/default.json");
        assert!(default.contains("\"allow-sound-override\""));
        for (name, text) in [
            ("pill", include_str!("../capabilities/pill.json")),
            ("browser", include_str!("../capabilities/browser.json")),
        ] {
            assert!(
                !text.contains("sound-override") && !text.contains("sound_override"),
                "{name} must not be granted the sounds folder"
            );
        }
        // Only the pet's windows are listed by the capability that grants it.
        assert!(default.contains("\"windows\": [\"fawkes\", \"fawkes-island\"]"));
    }

    #[test]
    fn the_command_never_lists_or_creates_a_folder() {
        let source = include_str!("sounds_folder.rs");
        let code = source.split("#[cfg(test)]").next().unwrap();
        for forbidden in ["read_dir", "create_dir", "remove_", "fs::write", "rename("] {
            assert!(!code.contains(forbidden), "{forbidden}");
        }
    }
}
