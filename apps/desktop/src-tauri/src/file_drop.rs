// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Native file drop on the floating and island Fawkes windows (Phase 62).
//!
//! Both windows keep Tauri's default drag-and-drop handler on, so the operating system's drop is
//! reported to the shell as a `DragDropEvent` and the web page never sees an HTML5 `drop` there.
//! This module is the shell's half of turning that into an attachment, and it is deliberately
//! small in what it trusts:
//!
//! * The shell never reads a file on its own initiative and never gives the page a path. A drop
//!   is checked (at most [`MAX_PATHS`] entries, absolute, no control characters, a regular file
//!   by `symlink_metadata`, at most [`MAX_FILE_BYTES`]) and every accepted file is put in a small
//!   in-memory allow-set under a fresh number. The page receives only that number, the file's
//!   name and its size.
//! * The page then asks for each number once (`read_dropped_file`). The entry is removed as soon
//!   as it is asked for, expires after [`TTL`], and can only be asked for by the window the file
//!   was dropped on. A number the shell did not just hand out reads nothing, so a compromised page
//!   cannot use the command to read an arbitrary path.
//! * The read re-validates the path and refuses a symlink, a directory and anything that is not a
//!   regular file (a FIFO, a device, a socket), compares the opened file with what was checked
//!   (a path swapped for a link in between is refused), and reads at most [`MAX_FILE_BYTES`].
//! * Nothing here logs a path or a file's content.
//!
//! The bytes then go through the web app's ordinary attachment checks and `POST /api/attachments`
//! with origin `drop`; Core never receives a path. Folders are refused here (the browser's entry
//! API that walks them does not exist for a native drop).

use parking_lot::Mutex;
use serde::Serialize;
use std::fs::{self, File, Metadata, OpenOptions};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, DragDropEvent, Emitter, Manager, Runtime};

/// Most entries of one drop that are looked at; the rest are only counted (`skipped`).
pub const MAX_PATHS: usize = 3;
/// Largest file the shell hands to the page: the web app's largest per-file limit (a 5 MiB image,
/// `DROP_LIMITS.imageBytes` in `apps/web/src/core/attachments.ts`; a test there compares the two).
/// The page applies its own, stricter per-type checks to what it receives.
pub const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
/// How long a dropped file may be asked for.
pub const TTL: Duration = Duration::from_secs(60);
/// Longest path text accepted, in bytes.
const MAX_PATH_BYTES: usize = 4096;
/// Longest file name sent to the page, in characters (the page refuses over 120 anyway).
const MAX_NAME_CHARS: usize = 256;

/// Event sent to the window that was dropped on: an [`Admitted`] document.
pub const DROP_EVENT: &str = "file-drop://drop";
/// Event sent to the window while a file drag is over it: a [`Hover`] document.
pub const HOVER_EVENT: &str = "file-drop://hover";

/// What the shell does with a drag over a Fawkes window, reduced to what this module needs
/// (Tauri's `DragDropEvent` cannot be built outside Tauri, so the tests drive this instead).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Drag {
    /// A file drag came over the window.
    Enter,
    /// The pointer moved over the window (ignored: nothing here follows the pointer).
    Over,
    /// The files were dropped.
    Drop(Vec<PathBuf>),
    /// The drag left the window or was cancelled.
    Leave,
}

impl From<&DragDropEvent> for Drag {
    fn from(event: &DragDropEvent) -> Self {
        match event {
            DragDropEvent::Enter { .. } => Drag::Enter,
            DragDropEvent::Drop { paths, .. } => Drag::Drop(paths.clone()),
            DragDropEvent::Leave => Drag::Leave,
            // `Over`, and any event a later Tauri adds.
            _ => Drag::Over,
        }
    }
}

/// Payload of [`HOVER_EVENT`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Hover {
    pub over: bool,
}

/// Why an entry of a drop was not taken.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Reason {
    /// Not absolute, has `..`, control characters or is too long.
    BadPath,
    /// A directory (a native drop does not walk folders).
    Folder,
    /// A symlink, FIFO, device, socket or anything else that is not a regular file.
    NotAFile,
    /// Over [`MAX_FILE_BYTES`].
    TooLarge,
    /// Missing or not readable.
    Unreadable,
}

/// An entry that was taken: the page asks for `id` to get the bytes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct AcceptedFile {
    pub id: u64,
    pub name: String,
    pub size: u64,
}

/// An entry that was not taken. `size` is the file's size when it was known, otherwise 0.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RefusedFile {
    pub name: String,
    pub size: u64,
    pub reason: Reason,
}

/// What a drop became: the payload of [`DROP_EVENT`]. Carries no path.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Admitted {
    pub files: Vec<AcceptedFile>,
    pub refused: Vec<RefusedFile>,
    /// Entries past [`MAX_PATHS`], not looked at.
    pub skipped: usize,
}

impl Admitted {
    pub fn is_empty(&self) -> bool {
        self.files.is_empty() && self.refused.is_empty() && self.skipped == 0
    }
}

/// What `read_dropped_file` refuses with. `code` is machine-readable, `message` is for logs of
/// the page's own making; neither contains a path.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Refusal {
    pub code: &'static str,
    pub message: &'static str,
}

pub const FORBIDDEN: Refusal = Refusal {
    code: "forbidden",
    message: "This window cannot read dropped files.",
};
pub const NOT_DROPPED: Refusal = Refusal {
    code: "not_dropped",
    message: "That file was not just dropped on this window, or it was already read.",
};
pub const UNREADABLE: Refusal = Refusal {
    code: "unreadable",
    message: "The file could not be read.",
};

impl From<Reason> for Refusal {
    fn from(reason: Reason) -> Self {
        match reason {
            Reason::BadPath => Refusal {
                code: "bad_path",
                message: "The file's path is not usable.",
            },
            Reason::Folder => Refusal {
                code: "folder",
                message: "A folder cannot be read.",
            },
            Reason::NotAFile => Refusal {
                code: "not_a_file",
                message: "Only regular files can be read.",
            },
            Reason::TooLarge => Refusal {
                code: "too_large",
                message: "The file is too large.",
            },
            Reason::Unreadable => UNREADABLE,
        }
    }
}

/// The name the page shows: the last path component, cut to [`MAX_NAME_CHARS`] characters.
fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().chars().take(MAX_NAME_CHARS).collect())
        .unwrap_or_default()
}

/// Is the path text something the shell will look at: absolute, with a file name, no `..`, no
/// control character (C0, DEL, C1) and at most [`MAX_PATH_BYTES`] bytes.
fn path_is_usable(path: &Path) -> bool {
    path.is_absolute()
        && path.file_name().is_some()
        && path.as_os_str().len() <= MAX_PATH_BYTES
        && !path.components().any(|c| matches!(c, Component::ParentDir))
        && !path.to_string_lossy().chars().any(char::is_control)
}

/// What `symlink_metadata` says: the size of a regular file within the cap, or why not.
fn classify(meta: &Metadata) -> Result<u64, (Reason, u64)> {
    let kind = meta.file_type();
    if kind.is_symlink() {
        return Err((Reason::NotAFile, 0));
    }
    if kind.is_dir() {
        return Err((Reason::Folder, 0));
    }
    if !kind.is_file() {
        return Err((Reason::NotAFile, 0));
    }
    if meta.len() > MAX_FILE_BYTES {
        return Err((Reason::TooLarge, meta.len()));
    }
    Ok(meta.len())
}

/// Checks one dropped path without opening it. `Ok` is the file's size.
fn inspect(path: &Path) -> Result<u64, (Reason, u64)> {
    if !path_is_usable(path) {
        return Err((Reason::BadPath, 0));
    }
    let meta = fs::symlink_metadata(path).map_err(|_| (Reason::Unreadable, 0))?;
    classify(&meta)
}

struct Entry {
    id: u64,
    window: String,
    path: PathBuf,
    expires: Instant,
}

#[derive(Default)]
struct State {
    next: u64,
    entries: Vec<Entry>,
}

/// The files the page may ask for: only those of the drop just received, each once, for [`TTL`],
/// and only by the window they were dropped on. At most [`MAX_PATHS`] per window are held.
#[derive(Default)]
pub struct Registry {
    state: Mutex<State>,
}

impl Registry {
    /// Looks at a drop on `window` and remembers the files that pass. A new drop on a window
    /// replaces what was still waiting for it. `now` is passed in so expiry is testable.
    pub fn admit(&self, window: &str, paths: &[PathBuf], now: Instant) -> Admitted {
        let mut out = Admitted {
            skipped: paths.len().saturating_sub(MAX_PATHS),
            ..Admitted::default()
        };
        let mut state = self.state.lock();
        state
            .entries
            .retain(|e| e.expires > now && e.window != window);
        for path in paths.iter().take(MAX_PATHS) {
            let name = display_name(path);
            match inspect(path) {
                Ok(size) => {
                    state.next += 1;
                    let id = state.next;
                    state.entries.push(Entry {
                        id,
                        window: window.to_string(),
                        path: path.clone(),
                        expires: now + TTL,
                    });
                    out.files.push(AcceptedFile { id, name, size });
                }
                Err((reason, size)) => out.refused.push(RefusedFile { name, size, reason }),
            }
        }
        out
    }

    /// Hands out the path of `id` and forgets it, so a second ask reads nothing. A number that was
    /// never issued, was already used, has expired or belongs to another window gives
    /// [`NOT_DROPPED`] (and an entry of another window is left alone).
    pub fn take(&self, id: u64, window: &str, now: Instant) -> Result<PathBuf, Refusal> {
        let mut state = self.state.lock();
        state.entries.retain(|e| e.expires > now);
        let index = state
            .entries
            .iter()
            .position(|e| e.id == id && e.window == window)
            .ok_or(NOT_DROPPED)?;
        Ok(state.entries.remove(index).path)
    }
}

/// Opens without following a link where the platform lets the open say so; everywhere the opened
/// file is compared with what was checked (see [`read_checked`]).
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

/// Is `opened` the very file that `checked` described (same device and inode)? Without that
/// information (non-Unix) the two are taken as the same: the open above did not follow a link.
fn same_file(checked: &Metadata, opened: &Metadata) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        checked.dev() == opened.dev() && checked.ino() == opened.ino()
    }
    #[cfg(not(unix))]
    {
        let _ = (checked, opened);
        true
    }
}

/// Reads a file that `checked` (a `symlink_metadata`) described, if it is still that file.
fn read_checked(path: &Path, checked: &Metadata) -> Result<Vec<u8>, Reason> {
    classify(checked).map_err(|(reason, _)| reason)?;
    let mut file = open_file(path).map_err(|_| Reason::Unreadable)?;
    let opened = file.metadata().map_err(|_| Reason::Unreadable)?;
    if opened.file_type().is_symlink() || !opened.is_file() || !same_file(checked, &opened) {
        return Err(Reason::NotAFile);
    }
    if opened.len() > MAX_FILE_BYTES {
        return Err(Reason::TooLarge);
    }
    let mut bytes = Vec::with_capacity(opened.len() as usize);
    // One byte past the cap tells a file that grew after it was checked from one that fits.
    (&mut file)
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Reason::Unreadable)?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(Reason::TooLarge);
    }
    Ok(bytes)
}

/// Re-validates `path` (the same rules as the drop) and reads it: a regular file, never a link,
/// at most [`MAX_FILE_BYTES`] bytes. Blocking; call it off the main thread.
pub fn read_regular_file(path: &Path) -> Result<Vec<u8>, Reason> {
    if !path_is_usable(path) {
        return Err(Reason::BadPath);
    }
    let checked = fs::symlink_metadata(path).map_err(|_| Reason::Unreadable)?;
    read_checked(path, &checked)
}

/// The windows a file may be dropped on: the floating Fawkes and the island. The dictation pill
/// (a remote page) and every other window are never given a drop.
pub fn is_drop_target(label: &str) -> bool {
    label == crate::WINDOW_LABEL || label == crate::ISLAND_LABEL
}

/// The shell's reaction to a drag over `label`: the hover is forwarded as it is, and a drop is
/// checked (off the event loop: it touches the file system) and announced to that window only.
pub fn on_drag<R: Runtime>(app: &AppHandle<R>, label: &str, drag: Drag) {
    if !is_drop_target(label) {
        return;
    }
    match drag {
        Drag::Enter => {
            let _ = app.emit_to(label, HOVER_EVENT, Hover { over: true });
        }
        Drag::Over => {}
        Drag::Leave => {
            let _ = app.emit_to(label, HOVER_EVENT, Hover { over: false });
        }
        Drag::Drop(paths) => {
            let _ = app.emit_to(label, HOVER_EVENT, Hover { over: false });
            let app = app.clone();
            let label = label.to_string();
            tauri::async_runtime::spawn_blocking(move || {
                let Some(shell) = app.try_state::<crate::Shell<R>>() else {
                    return;
                };
                let admitted = shell.file_drop.admit(&label, &paths, Instant::now());
                if !admitted.is_empty() {
                    let _ = app.emit_to(label.as_str(), DROP_EVENT, admitted);
                }
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn file(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
        let path = dir.join(name);
        File::create(&path).unwrap().write_all(bytes).unwrap();
        path
    }

    fn refused(admitted: &Admitted) -> Vec<Reason> {
        admitted.refused.iter().map(|r| r.reason).collect()
    }

    #[test]
    fn a_regular_file_is_accepted_with_its_name_and_size_and_no_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = file(dir.path(), "notes.txt", b"hello");
        let registry = Registry::default();
        let admitted = registry.admit("fawkes", std::slice::from_ref(&path), Instant::now());
        assert_eq!(admitted.files.len(), 1);
        assert_eq!(admitted.files[0].name, "notes.txt");
        assert_eq!(admitted.files[0].size, 5);
        assert!(admitted.refused.is_empty() && admitted.skipped == 0);
        // What the page receives never mentions the directory.
        let json = serde_json::to_string(&admitted).unwrap();
        assert!(!json.contains(dir.path().to_str().unwrap()), "{json}");
    }

    #[test]
    fn path_validation_table() {
        let dir = tempfile::tempdir().unwrap();
        let good = file(dir.path(), "a.txt", b"x");
        let sub = dir.path().join("sub");
        fs::create_dir(&sub).unwrap();
        // Refused on the text of the path alone: no file of that name needs to exist.
        let control = dir.path().join("bad\u{7}name.txt");
        let c1 = dir.path().join("c1\u{85}.txt");
        let newline = dir.path().join("line\nbreak.txt");
        let big = file(
            dir.path(),
            "big.bin",
            &vec![0u8; MAX_FILE_BYTES as usize + 1],
        );
        let at_cap = file(dir.path(), "cap.bin", &vec![0u8; MAX_FILE_BYTES as usize]);
        let parent = dir.path().join("sub").join("..").join("a.txt");
        let table: Vec<(PathBuf, Result<(), Reason>)> = vec![
            (good, Ok(())),
            (at_cap, Ok(())),
            (PathBuf::from("relative/a.txt"), Err(Reason::BadPath)),
            (PathBuf::from("a.txt"), Err(Reason::BadPath)),
            (PathBuf::new(), Err(Reason::BadPath)),
            (PathBuf::from("/"), Err(Reason::BadPath)),
            (control, Err(Reason::BadPath)),
            (c1, Err(Reason::BadPath)),
            (newline, Err(Reason::BadPath)),
            (parent, Err(Reason::BadPath)),
            (
                dir.path().join("x".repeat(MAX_PATH_BYTES)),
                Err(Reason::BadPath),
            ),
            (sub, Err(Reason::Folder)),
            (big, Err(Reason::TooLarge)),
            (dir.path().join("missing.txt"), Err(Reason::Unreadable)),
        ];
        for (path, want) in table {
            let got = inspect(&path).map(|_| ()).map_err(|(reason, _)| reason);
            assert_eq!(got, want, "{path:?}");
        }
        // An oversize file reports its size so the page can word the refusal.
        assert_eq!(
            inspect(&dir.path().join("big.bin")),
            Err((Reason::TooLarge, MAX_FILE_BYTES + 1))
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_is_refused_even_to_a_regular_file() {
        let dir = tempfile::tempdir().unwrap();
        let target = file(dir.path(), "real.txt", b"secret");
        let link = dir.path().join("link.txt");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        let dangling = dir.path().join("dangling.txt");
        std::os::unix::fs::symlink(dir.path().join("nowhere"), &dangling).unwrap();
        let registry = Registry::default();
        let admitted = registry.admit("fawkes", &[link.clone(), dangling.clone()], Instant::now());
        assert!(admitted.files.is_empty());
        assert_eq!(refused(&admitted), [Reason::NotAFile, Reason::NotAFile]);
        assert_eq!(read_regular_file(&link), Err(Reason::NotAFile));
    }

    #[cfg(unix)]
    #[test]
    fn a_fifo_is_refused_without_being_opened() {
        let dir = tempfile::tempdir().unwrap();
        let fifo = dir.path().join("pipe");
        let status = std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .expect("mkfifo runs");
        assert!(status.success());
        // Opening a FIFO for reading would block forever; reaching the assertion proves it was not.
        assert_eq!(inspect(&fifo), Err((Reason::NotAFile, 0)));
        assert_eq!(read_regular_file(&fifo), Err(Reason::NotAFile));
    }

    #[cfg(unix)]
    #[test]
    fn a_device_is_refused() {
        assert_eq!(inspect(Path::new("/dev/null")), Err((Reason::NotAFile, 0)));
        assert_eq!(
            read_regular_file(Path::new("/dev/null")),
            Err(Reason::NotAFile)
        );
    }

    #[test]
    fn at_most_three_entries_are_looked_at_and_the_rest_are_counted() {
        let dir = tempfile::tempdir().unwrap();
        let paths: Vec<PathBuf> = (0..5)
            .map(|i| file(dir.path(), &format!("f{i}.txt"), b"x"))
            .collect();
        let registry = Registry::default();
        let admitted = registry.admit("fawkes", &paths, Instant::now());
        let names: Vec<&str> = admitted.files.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, ["f0.txt", "f1.txt", "f2.txt"]);
        assert_eq!(admitted.skipped, 2);
        // The fourth and fifth were never put in the allow-set: no number reads them.
        let now = Instant::now();
        assert!(registry.state.lock().entries.len() == MAX_PATHS);
        for id in admitted.files.iter().map(|f| f.id) {
            assert!(registry.take(id, "fawkes", now).is_ok());
        }
        assert!(registry.take(4, "fawkes", now).is_err());
    }

    #[test]
    fn refused_entries_are_reported_beside_the_accepted_ones() {
        let dir = tempfile::tempdir().unwrap();
        let ok = file(dir.path(), "ok.txt", b"x");
        let sub = dir.path().join("folder");
        fs::create_dir(&sub).unwrap();
        let registry = Registry::default();
        let admitted = registry.admit("fawkes", &[sub, ok], Instant::now());
        assert_eq!(admitted.files.len(), 1);
        assert_eq!(admitted.refused.len(), 1);
        assert_eq!(admitted.refused[0].name, "folder");
        assert_eq!(admitted.refused[0].reason, Reason::Folder);
        assert!(!admitted.is_empty());
        assert!(Admitted::default().is_empty());
    }

    #[test]
    fn a_number_is_read_once_and_then_forgotten() {
        let dir = tempfile::tempdir().unwrap();
        let path = file(dir.path(), "once.txt", b"x");
        let registry = Registry::default();
        let now = Instant::now();
        let id = registry
            .admit("fawkes", std::slice::from_ref(&path), now)
            .files[0]
            .id;
        assert_eq!(registry.take(id, "fawkes", now), Ok(path));
        assert_eq!(registry.take(id, "fawkes", now), Err(NOT_DROPPED));
    }

    #[test]
    fn a_number_expires_after_the_ttl_and_is_valid_just_before() {
        let dir = tempfile::tempdir().unwrap();
        let path = file(dir.path(), "ttl.txt", b"x");
        let registry = Registry::default();
        let start = Instant::now();
        let id = registry
            .admit("fawkes", std::slice::from_ref(&path), start)
            .files[0]
            .id;
        let just_before = start + TTL - Duration::from_millis(1);
        assert_eq!(registry.take(id, "fawkes", just_before), Ok(path.clone()));
        let id = registry.admit("fawkes", &[path], start).files[0].id;
        assert_eq!(registry.take(id, "fawkes", start + TTL), Err(NOT_DROPPED));
        // Expired entries are dropped, not kept around.
        assert!(registry.state.lock().entries.is_empty());
    }

    #[test]
    fn only_the_window_that_was_dropped_on_may_ask_and_a_wrong_ask_keeps_the_entry() {
        let dir = tempfile::tempdir().unwrap();
        let path = file(dir.path(), "own.txt", b"x");
        let registry = Registry::default();
        let now = Instant::now();
        let id = registry
            .admit("fawkes", std::slice::from_ref(&path), now)
            .files[0]
            .id;
        assert_eq!(registry.take(id, "fawkes-island", now), Err(NOT_DROPPED));
        assert_eq!(registry.take(id, "stranger", now), Err(NOT_DROPPED));
        assert_eq!(registry.take(id, "fawkes", now), Ok(path));
    }

    #[test]
    fn numbers_that_were_never_issued_read_nothing() {
        let registry = Registry::default();
        for id in [0, 1, 2, u64::MAX] {
            assert_eq!(
                registry.take(id, "fawkes", Instant::now()),
                Err(NOT_DROPPED)
            );
        }
    }

    #[test]
    fn a_new_drop_replaces_what_was_waiting_for_that_window_only() {
        let dir = tempfile::tempdir().unwrap();
        let a = file(dir.path(), "a.txt", b"x");
        let b = file(dir.path(), "b.txt", b"x");
        let c = file(dir.path(), "c.txt", b"x");
        let registry = Registry::default();
        let now = Instant::now();
        let first = registry.admit("fawkes", &[a], now).files[0].id;
        let island = registry.admit("fawkes-island", &[b], now).files[0].id;
        let second = registry
            .admit("fawkes", std::slice::from_ref(&c), now)
            .files[0]
            .id;
        assert_eq!(registry.take(first, "fawkes", now), Err(NOT_DROPPED));
        assert!(registry.take(island, "fawkes-island", now).is_ok());
        assert_eq!(registry.take(second, "fawkes", now), Ok(c));
        assert_ne!(first, second, "numbers are never reused");
    }

    #[test]
    fn reading_returns_the_bytes_and_stops_at_the_cap() {
        let dir = tempfile::tempdir().unwrap();
        let small = file(dir.path(), "small.bin", b"\x00\x01binary\xff");
        assert_eq!(read_regular_file(&small).unwrap(), b"\x00\x01binary\xff");
        let at_cap = file(dir.path(), "cap.bin", &vec![7u8; MAX_FILE_BYTES as usize]);
        assert_eq!(
            read_regular_file(&at_cap).unwrap().len() as u64,
            MAX_FILE_BYTES
        );
        let over = file(
            dir.path(),
            "over.bin",
            &vec![7u8; MAX_FILE_BYTES as usize + 1],
        );
        assert_eq!(read_regular_file(&over), Err(Reason::TooLarge));
    }

    #[test]
    fn the_read_revalidates_the_path_and_the_file_type() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            read_regular_file(Path::new("relative.txt")),
            Err(Reason::BadPath)
        );
        assert_eq!(
            read_regular_file(&dir.path().join("a\u{1b}b.txt")),
            Err(Reason::BadPath)
        );
        assert_eq!(read_regular_file(dir.path()), Err(Reason::Folder));
        assert_eq!(
            read_regular_file(&dir.path().join("gone.txt")),
            Err(Reason::Unreadable)
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_path_swapped_for_another_file_after_the_check_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let checked = file(dir.path(), "checked.txt", b"what the page was told about");
        let other = file(dir.path(), "other.txt", b"something else");
        let before = fs::symlink_metadata(&checked).unwrap();
        // The check described `checked.txt`, but the path now leads to a different file.
        assert_eq!(read_checked(&other, &before), Err(Reason::NotAFile));
        assert_eq!(
            read_checked(&checked, &before).unwrap(),
            b"what the page was told about"
        );
        // A link put in the file's place is followed by the open, but it is a different file.
        let swapped = dir.path().join("swapped.txt");
        let first = file(dir.path(), "first.txt", b"first");
        let before = fs::symlink_metadata(&first).unwrap();
        std::os::unix::fs::symlink(&other, &swapped).unwrap();
        assert_eq!(read_checked(&swapped, &before), Err(Reason::NotAFile));
    }

    #[test]
    fn tauri_drag_events_map_to_the_four_drags() {
        let at = tauri::PhysicalPosition::new(1.0, 2.0);
        let paths = vec![PathBuf::from("/tmp/a.txt")];
        assert_eq!(
            Drag::from(&DragDropEvent::Enter {
                paths: paths.clone(),
                position: at
            }),
            Drag::Enter
        );
        assert_eq!(
            Drag::from(&DragDropEvent::Over { position: at }),
            Drag::Over
        );
        assert_eq!(
            Drag::from(&DragDropEvent::Drop {
                paths: paths.clone(),
                position: at
            }),
            Drag::Drop(paths)
        );
        assert_eq!(Drag::from(&DragDropEvent::Leave), Drag::Leave);
    }

    #[test]
    fn only_the_floating_and_island_windows_take_drops() {
        assert!(is_drop_target("fawkes"));
        assert!(is_drop_target("fawkes-island"));
        for other in ["phoenix-pill", "main", "stranger", "", "Fawkes"] {
            assert!(!is_drop_target(other), "{other:?}");
        }
    }

    #[test]
    fn names_are_cut_and_never_carry_the_directory() {
        let long = format!("/tmp/{}", "n".repeat(400));
        assert_eq!(
            display_name(Path::new(&long)).chars().count(),
            MAX_NAME_CHARS
        );
        assert_eq!(display_name(Path::new("/a/b/c.txt")), "c.txt");
        assert_eq!(display_name(Path::new("/")), "");
    }

    #[test]
    fn refusals_carry_codes_and_no_path() {
        for reason in [
            Reason::BadPath,
            Reason::Folder,
            Reason::NotAFile,
            Reason::TooLarge,
            Reason::Unreadable,
        ] {
            let refusal = Refusal::from(reason);
            assert!(!refusal.code.is_empty() && !refusal.message.contains('/'));
        }
        assert_eq!(
            serde_json::to_value(Reason::NotAFile).unwrap(),
            serde_json::json!("not_a_file")
        );
    }
}
