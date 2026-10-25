// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Phase 96: where a browser profile's web data lives, and how it is deleted.
//!
//! A profile id (from Phoenix Core: a UUID, or an id of the same shape adopted from another
//! device) maps to ONE directory directly under the profiles root
//! (`<app data dir>/browser-profiles/p-<encoded id>`). The mapping is injective and survives
//! case-insensitive file systems: lowercase letters, digits and `-` are kept, an uppercase letter
//! becomes `_` plus its lowercase, and `_` becomes `__`, so `Ab` and `ab` can never share a
//! directory. Nothing outside `[A-Za-z0-9_-]` is ever accepted, the reserved id `private` (the
//! incognito tab, which has no stored data at all) is refused in any case, and the directory name
//! always starts with `p-`, so Windows device names (`CON`, `NUL`) cannot occur.
//!
//! Deleting is the dangerous part. [`ProfileStore::purge`] removes a tree only after the target was
//! checked to be a real directory (not a symlink), canonicalised, and found to be a DIRECT child of
//! the canonicalised root and not the root itself. It never follows a link: `remove_dir_all` removes
//! a link inside the tree without entering it.
//!
//! macOS: wry's `data_directory` does nothing for `WKWebView`. A profile tab there uses a
//! `WKWebsiteDataStore` identified by [`store_identifier`] (macOS 14 or newer), which WebKit keeps
//! in its own location; the directory under the root is created anyway so every platform has the
//! same lifecycle, but it holds nothing there. Nothing here ran against a real webview.

use sha2::{Digest, Sha256};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// The id the chrome sends for an incognito tab. It is never a stored profile.
pub const PRIVATE: &str = "private";
/// Longest accepted profile id (a UUID is 36). Keeps the directory name and path short enough for
/// Windows' path limit.
pub const MAX_ID_LEN: usize = 64;
const DIR_PREFIX: &str = "p-";

/// `[A-Za-z0-9_-]{1,64}`, and not `private` in any case.
pub fn valid_profile_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_ID_LEN
        && !id.eq_ignore_ascii_case(PRIVATE)
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// The single path component for a profile, or `None` for an invalid id. Injective and
/// lowercase-only (see the module comment).
pub fn dir_name(id: &str) -> Option<String> {
    if !valid_profile_id(id) {
        return None;
    }
    let mut name = String::with_capacity(DIR_PREFIX.len() + id.len() * 2);
    name.push_str(DIR_PREFIX);
    for c in id.chars() {
        match c {
            'a'..='z' | '0'..='9' | '-' => name.push(c),
            'A'..='Z' => {
                name.push('_');
                name.push(c.to_ascii_lowercase());
            }
            '_' => name.push_str("__"),
            _ => return None,
        }
    }
    Some(name)
}

/// The 16 bytes of the macOS `WKWebsiteDataStore` identifier for a profile: a domain-separated
/// SHA-256 of the id, so the same id is the same store on every start and a different id never is.
pub fn store_identifier(id: &str) -> Option<[u8; 16]> {
    if !valid_profile_id(id) {
        return None;
    }
    let mut hash = Sha256::new();
    hash.update(b"phoenix.browser.profile.v1\0");
    hash.update(id.as_bytes());
    let digest = hash.finalize();
    let mut out = [0u8; 16];
    out.copy_from_slice(&digest[..16]);
    Some(out)
}

#[derive(Debug, PartialEq, Eq)]
pub enum StoreError {
    /// Not an acceptable profile id.
    InvalidId,
    /// The root or the profile directory is a symlink; nothing is created or deleted through it.
    Symlink,
    /// The root or the profile "directory" is something else (a file).
    NotDirectory,
    /// After canonicalising, the target is not a direct child of the root (or is the root).
    Escapes,
    Io(io::ErrorKind),
}

impl From<io::Error> for StoreError {
    fn from(e: io::Error) -> Self {
        StoreError::Io(e.kind())
    }
}

/// The profiles root and the operations allowed under it.
#[derive(Clone, Debug)]
pub struct ProfileStore {
    root: PathBuf,
}

impl ProfileStore {
    pub fn new(root: PathBuf) -> Self {
        ProfileStore { root }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// `root/<dir_name>` without touching the disk.
    pub fn path_for(&self, id: &str) -> Result<PathBuf, StoreError> {
        Ok(self.root.join(dir_name(id).ok_or(StoreError::InvalidId)?))
    }

    /// Makes the profile's directory (and the root, owner-only on Unix) and returns its canonical
    /// path. Called only when the person opens a tab in that profile.
    pub fn prepare(&self, id: &str) -> Result<PathBuf, StoreError> {
        let name = dir_name(id).ok_or(StoreError::InvalidId)?;
        match fs::symlink_metadata(&self.root) {
            Ok(meta) => check_directory(&meta)?,
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                fs::create_dir_all(&self.root)?;
                private_directory(&self.root);
            }
            Err(e) => return Err(e.into()),
        }
        let root = self.root.canonicalize()?;
        let target = root.join(&name);
        match fs::symlink_metadata(&target) {
            Ok(meta) => check_directory(&meta)?,
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                match fs::create_dir(&target) {
                    Ok(()) => {}
                    Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
                    Err(e) => return Err(e.into()),
                }
                private_directory(&target);
                // A racing replacement by a link is caught by the checks below.
                check_directory(&fs::symlink_metadata(&target)?)?;
            }
            Err(e) => return Err(e.into()),
        }
        let canonical = target.canonicalize()?;
        inside(&root, &canonical)?;
        Ok(canonical)
    }

    /// Deletes the profile's directory. `Ok(true)` when something was deleted, `Ok(false)` when
    /// nothing was there. Refuses a symlink (root or profile), a non-directory and anything that
    /// does not canonicalise to a direct child of the root.
    pub fn purge(&self, id: &str) -> Result<bool, StoreError> {
        let name = dir_name(id).ok_or(StoreError::InvalidId)?;
        match fs::symlink_metadata(&self.root) {
            Ok(meta) => check_directory(&meta)?,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(e) => return Err(e.into()),
        }
        let root = self.root.canonicalize()?;
        let target = root.join(&name);
        match fs::symlink_metadata(&target) {
            Ok(meta) => check_directory(&meta)?,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(e) => return Err(e.into()),
        }
        let canonical = target.canonicalize()?;
        inside(&root, &canonical)?;
        fs::remove_dir_all(&canonical)?;
        Ok(true)
    }
}

fn check_directory(meta: &fs::Metadata) -> Result<(), StoreError> {
    if meta.file_type().is_symlink() {
        Err(StoreError::Symlink)
    } else if !meta.is_dir() {
        Err(StoreError::NotDirectory)
    } else {
        Ok(())
    }
}

/// `target` is a direct child of `root` (both canonical) and not `root` itself.
fn inside(root: &Path, target: &Path) -> Result<(), StoreError> {
    if target == root || target.parent() != Some(root) {
        Err(StoreError::Escapes)
    } else {
        Ok(())
    }
}

#[cfg(unix)]
fn private_directory(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o700));
}

#[cfg(not(unix))]
fn private_directory(_path: &Path) {}

/// Whether a persistent per-profile store can be made on this system. macOS needs 14 or newer
/// (`WKWebsiteDataStore(forIdentifier:)`): on older versions wry silently falls back to the
/// DEFAULT store shared with Phoenix's own webviews, so the host refuses to open a profile tab
/// there (`profile_unsupported`) instead of letting it happen.
#[cfg(target_os = "macos")]
pub fn store_supported() -> bool {
    use objc2_foundation::{NSOperatingSystemVersion, NSProcessInfo};
    NSProcessInfo::processInfo().isOperatingSystemAtLeastVersion(NSOperatingSystemVersion {
        majorVersion: 14,
        minorVersion: 0,
        patchVersion: 0,
    })
}

/// Windows (WebView2 user data folder) and Linux (WebKitGTK `WebContext` directory) take a
/// `data_directory`.
#[cfg(not(target_os = "macos"))]
pub fn store_supported() -> bool {
    true
}

// ---------------------------------------------------------------------------------------------
// What the shell asks Core about profiles
// ---------------------------------------------------------------------------------------------

use crate::connection::{connection, Locator};
use crate::core_status::{call_capped, Method};
use serde::Deserialize;
use std::sync::Arc;
use std::time::Duration;

type KnownProfile = Arc<dyn Fn(&str) -> Result<bool, ()> + Send + Sync>;

/// Core's answers the shell needs. Both are blocking loopback calls with the session token
/// (call them off the main thread) and both fail closed: Core unreachable means "no".
#[derive(Clone)]
pub struct CoreProfiles {
    /// Does Core currently have profile `id` (`GET /api/browser/profiles/:id`: 200 yes, 404 no)?
    /// `Err` is "could not be established" (Core down, token missing, any other status).
    pub known: KnownProfile,
    /// Profile ids whose deletion Core recorded and whose web data is still to be deleted
    /// (`GET /api/browser/profile-purges`). `Err` is "unknown".
    pub pending_purges: Arc<dyn Fn() -> Result<Vec<String>, ()> + Send + Sync>,
}

#[derive(Deserialize)]
struct Pending {
    pending: Vec<String>,
}

/// The ids in Core's answer; anything that is not a bounded list of valid ids is `Err`.
#[allow(clippy::result_unit_err)] // `Err` means one thing: Core's answer is not usable.
pub fn parse_pending(body: &str) -> Result<Vec<String>, ()> {
    let parsed: Pending = serde_json::from_str(body).map_err(|_| ())?;
    if parsed.pending.len() > 2000 || !parsed.pending.iter().all(|id| valid_profile_id(id)) {
        return Err(());
    }
    Ok(parsed.pending)
}

impl CoreProfiles {
    pub fn from_core(locator: Locator) -> Self {
        let for_known = locator.clone();
        CoreProfiles {
            known: Arc::new(move |id| {
                if !valid_profile_id(id) {
                    return Ok(false);
                }
                let conn = connection(&for_known);
                match call_capped(
                    &conn.base_url,
                    conn.token.as_deref(),
                    Method::Get,
                    &format!("/api/browser/profiles/{id}"),
                    Duration::from_secs(5),
                    1024 * 1024,
                ) {
                    Ok((200, _)) => Ok(true),
                    Ok((404, _)) => Ok(false),
                    _ => Err(()),
                }
            }),
            pending_purges: Arc::new(move || {
                let conn = connection(&locator);
                match call_capped(
                    &conn.base_url,
                    conn.token.as_deref(),
                    Method::Get,
                    "/api/browser/profile-purges",
                    Duration::from_secs(5),
                    1024 * 1024,
                ) {
                    Ok((200, body)) => parse_pending(&body),
                    _ => Err(()),
                }
            }),
        }
    }
}

impl ProfileStore {
    /// Whether a directory for the profile exists (a tab was once opened in it on this machine).
    pub fn exists(&self, id: &str) -> bool {
        self.path_for(id)
            .map(|p| fs::symlink_metadata(p).is_ok())
            .unwrap_or(false)
    }
}

impl CoreProfiles {
    /// A Core that knows exactly `known` profiles and reports the ids currently in `pending` as
    /// waiting for deletion. For tests (unit and lifecycle) that must not open a socket.
    pub fn fixed(known: Vec<String>, pending: Arc<parking_lot::Mutex<Vec<String>>>) -> Self {
        CoreProfiles {
            known: Arc::new(move |id| Ok(known.iter().any(|k| k == id))),
            pending_purges: Arc::new(move || Ok(pending.lock().clone())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    const UUID: &str = "3f2b8c1e-5d4a-4f6b-9a7c-0123456789ab";

    fn store() -> (tempfile::TempDir, ProfileStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = ProfileStore::new(dir.path().join("browser-profiles"));
        (dir, store)
    }

    #[test]
    fn ids_are_plain_and_bounded() {
        assert!(valid_profile_id(UUID));
        assert!(valid_profile_id("a"));
        assert!(valid_profile_id("A_b-9"));
        assert!(valid_profile_id(&"a".repeat(MAX_ID_LEN)));
        assert!(!valid_profile_id(&"a".repeat(MAX_ID_LEN + 1)));
        for bad in [
            "",
            ".",
            "..",
            "../x",
            "a/b",
            "a\\b",
            "a b",
            "a.b",
            "a\0b",
            " a",
            "a ",
            "a\n",
            "~",
            "C:",
            "C:\\x",
            "/etc",
            "%2e%2e",
            "a:b",
            "a*",
            "é",
            "ａ",
            "😀",
            "a\u{202e}b",
            "\u{0}",
            "con.",
            "CON ",
        ] {
            assert!(!valid_profile_id(bad), "{bad:?}");
            assert_eq!(dir_name(bad), None, "{bad:?}");
            assert_eq!(store_identifier(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn the_private_profile_is_never_a_stored_profile_in_any_case() {
        for id in ["private", "Private", "PRIVATE", "pRiVaTe"] {
            assert!(!valid_profile_id(id), "{id}");
            assert_eq!(dir_name(id), None);
            assert_eq!(store_identifier(id), None);
            let (_dir, store) = store();
            assert_eq!(store.prepare(id), Err(StoreError::InvalidId));
            assert_eq!(store.purge(id), Err(StoreError::InvalidId));
        }
        // A longer id that merely starts with it is fine.
        assert!(valid_profile_id("private2"));
    }

    #[test]
    fn directory_names_are_one_lowercase_component_and_never_collide_when_case_folded() {
        let ids = [
            "a",
            "A",
            "ab",
            "aB",
            "Ab",
            "AB",
            "_a",
            "__a",
            "_A",
            "a_",
            "a__",
            "A_",
            "a-b",
            "a_b",
            "A-B",
            "a_B",
            "0",
            "-",
            "_",
            "__",
            "___",
            UUID,
            &UUID.to_uppercase(),
        ];
        let mut folded = HashSet::new();
        for id in ids {
            let name = dir_name(id).unwrap();
            assert!(name.starts_with("p-"), "{name}");
            assert!(
                name.bytes().all(|b| b.is_ascii_lowercase()
                    || b.is_ascii_digit()
                    || b == b'-'
                    || b == b'_'),
                "{name}"
            );
            assert!(!name.contains('/') && !name.contains('\\') && !name.contains('.'));
            assert!(name.len() <= 2 + 2 * MAX_ID_LEN);
            // Case-insensitive file systems: lowercase names are unique per id.
            assert!(folded.insert(name.to_lowercase()), "{id} collides");
        }
        assert_eq!(folded.len(), ids.len());
    }

    #[test]
    fn the_longest_id_stays_short_enough_for_windows() {
        let id = "A".repeat(MAX_ID_LEN);
        let name = dir_name(&id).unwrap();
        assert_eq!(name.len(), 2 + 2 * MAX_ID_LEN);
        let (_dir, store) = store();
        let path = store.prepare(&id).unwrap();
        assert!(path.is_dir());
        // Well under MAX_PATH (260) relative to a typical app data directory.
        assert!(name.len() < 140);
    }

    #[test]
    fn store_identifiers_are_stable_distinct_and_case_sensitive() {
        assert_eq!(store_identifier("abc"), store_identifier("abc"));
        assert_ne!(store_identifier("abc"), store_identifier("abd"));
        assert_ne!(store_identifier("abc"), store_identifier("ABC"));
        assert_eq!(store_identifier("abc").unwrap().len(), 16);
    }

    #[test]
    fn prepare_creates_only_the_profile_directory_under_the_root_and_is_idempotent() {
        let (dir, store) = store();
        assert!(!store.root().exists(), "nothing exists before a tab opens");
        assert!(!store.exists(UUID));
        let a = store.prepare(UUID).unwrap();
        let b = store.prepare(UUID).unwrap();
        assert_eq!(a, b);
        assert!(a.is_dir());
        assert_eq!(a.parent().unwrap(), store.root().canonicalize().unwrap());
        assert!(store.exists(UUID));
        // Nothing else appeared next to the root.
        let entries: Vec<_> = std::fs::read_dir(dir.path()).unwrap().collect();
        assert_eq!(entries.len(), 1);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&a).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o700);
            let root_mode = std::fs::metadata(store.root())
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(root_mode, 0o700);
        }
    }

    #[test]
    fn purge_removes_the_whole_tree_of_that_profile_only() {
        let (_dir, store) = store();
        let a = store.prepare("alpha").unwrap();
        let b = store.prepare("beta").unwrap();
        std::fs::create_dir_all(a.join("nested/deep")).unwrap();
        std::fs::write(a.join("nested/deep/cookies.sqlite"), b"x").unwrap();
        std::fs::write(b.join("keep"), b"y").unwrap();
        assert_eq!(store.purge("alpha"), Ok(true));
        assert!(!a.exists());
        assert!(b.join("keep").exists());
        assert!(store.root().exists(), "the root itself is never removed");
        assert_eq!(
            store.purge("alpha"),
            Ok(false),
            "a second purge finds nothing"
        );
        assert_eq!(store.purge("never-existed"), Ok(false));
    }

    #[test]
    fn purge_without_a_root_is_a_no_op_and_creates_nothing() {
        let (dir, store) = store();
        assert_eq!(store.purge("alpha"), Ok(false));
        assert!(!dir.path().join("browser-profiles").exists());
    }

    #[test]
    fn a_traversal_id_can_never_reach_outside_the_root() {
        let (dir, store) = store();
        let victim = dir.path().join("victim");
        std::fs::create_dir(&victim).unwrap();
        std::fs::write(victim.join("file"), b"important").unwrap();
        store.prepare("ok").unwrap();
        for id in [
            "..",
            "../victim",
            "..%2fvictim",
            "/",
            "\\..\\victim",
            "./",
            ".",
            "ok/../../victim",
        ] {
            assert_eq!(store.purge(id), Err(StoreError::InvalidId), "{id}");
            assert_eq!(store.prepare(id), Err(StoreError::InvalidId), "{id}");
            assert_eq!(store.path_for(id), Err(StoreError::InvalidId), "{id}");
        }
        assert!(victim.join("file").exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_profile_directory_is_refused_and_its_target_survives() {
        let (dir, store) = store();
        store.prepare("seed").unwrap();
        let outside = dir.path().join("outside");
        std::fs::create_dir(&outside).unwrap();
        std::fs::write(outside.join("precious"), b"data").unwrap();
        let link = store.root().join(dir_name("evil").unwrap());
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        assert_eq!(store.purge("evil"), Err(StoreError::Symlink));
        assert_eq!(store.prepare("evil"), Err(StoreError::Symlink));
        assert!(outside.join("precious").exists());
        assert!(
            std::fs::symlink_metadata(&link).is_ok(),
            "the link is left alone"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_dangling_symlink_is_refused_too() {
        let (dir, store) = store();
        store.prepare("seed").unwrap();
        let link = store.root().join(dir_name("dangling").unwrap());
        std::os::unix::fs::symlink(dir.path().join("gone"), &link).unwrap();
        assert_eq!(store.purge("dangling"), Err(StoreError::Symlink));
        assert_eq!(store.prepare("dangling"), Err(StoreError::Symlink));
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_inside_the_profile_is_removed_without_entering_its_target() {
        let (dir, store) = store();
        let profile = store.prepare("alpha").unwrap();
        let outside = dir.path().join("outside");
        std::fs::create_dir(&outside).unwrap();
        std::fs::write(outside.join("precious"), b"data").unwrap();
        std::os::unix::fs::symlink(&outside, profile.join("link-to-outside")).unwrap();
        std::os::unix::fs::symlink(outside.join("precious"), profile.join("link-to-file")).unwrap();
        assert_eq!(store.purge("alpha"), Ok(true));
        assert!(!profile.exists());
        assert!(
            outside.join("precious").exists(),
            "the target was not followed"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_root_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real-root");
        std::fs::create_dir(&real).unwrap();
        let store = ProfileStore::new(dir.path().join("linked-root"));
        std::os::unix::fs::symlink(&real, store.root()).unwrap();
        std::fs::create_dir(real.join(dir_name("alpha").unwrap())).unwrap();
        assert_eq!(store.purge("alpha"), Err(StoreError::Symlink));
        assert_eq!(store.prepare("alpha"), Err(StoreError::Symlink));
        assert!(real.join(dir_name("alpha").unwrap()).exists());
    }

    #[test]
    fn a_file_where_a_directory_should_be_is_refused() {
        let (_dir, store) = store();
        store.prepare("seed").unwrap();
        let path = store.root().join(dir_name("file").unwrap());
        std::fs::write(&path, b"not a directory").unwrap();
        assert_eq!(store.purge("file"), Err(StoreError::NotDirectory));
        assert_eq!(store.prepare("file"), Err(StoreError::NotDirectory));
        assert!(path.exists());
        // A root that is a file.
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("root-file");
        std::fs::write(&root, b"x").unwrap();
        let store = ProfileStore::new(root.clone());
        assert_eq!(store.purge("alpha"), Err(StoreError::NotDirectory));
        assert_eq!(store.prepare("alpha"), Err(StoreError::NotDirectory));
        assert!(root.exists());
    }

    #[test]
    fn the_root_itself_and_siblings_are_never_deleted() {
        let (dir, store) = store();
        store.prepare("alpha").unwrap();
        let sibling = dir.path().join("p-alpha");
        std::fs::create_dir(&sibling).unwrap();
        assert_eq!(store.purge("alpha"), Ok(true));
        assert!(store.root().exists());
        assert!(
            sibling.exists(),
            "a directory next to the root is not touched"
        );
        // `inside` is the last line of defence: root and non-children are Escapes.
        let root = store.root().canonicalize().unwrap();
        assert_eq!(inside(&root, &root), Err(StoreError::Escapes));
        assert_eq!(
            inside(&root, root.parent().unwrap()),
            Err(StoreError::Escapes)
        );
        assert_eq!(
            inside(&root, &sibling.canonicalize().unwrap()),
            Err(StoreError::Escapes)
        );
        assert_eq!(
            inside(&root, &root.join("a").join("b")),
            Err(StoreError::Escapes)
        );
        assert_eq!(inside(&root, &root.join("a")), Ok(()));
    }

    #[test]
    fn unicode_lookalikes_and_case_variants_name_different_directories() {
        let (_dir, store) = store();
        let upper = store.prepare("Profile").unwrap();
        let lower = store.prepare("profile").unwrap();
        assert_ne!(upper, lower);
        std::fs::write(lower.join("keep"), b"x").unwrap();
        assert_eq!(store.purge("Profile"), Ok(true));
        assert!(
            lower.join("keep").exists(),
            "purging Profile did not touch profile"
        );
        assert_eq!(store.purge("profile"), Ok(true));
        // Full-width and accented look-alikes are not ids at all.
        for id in ["ｐrofile", "profilé", "pr\u{0430}file"] {
            assert_eq!(store.purge(id), Err(StoreError::InvalidId));
        }
    }

    #[test]
    fn pending_answers_are_validated_strictly() {
        assert_eq!(
            parse_pending(r#"{"pending":["a","B_1"]}"#),
            Ok(vec!["a".into(), "B_1".into()])
        );
        assert_eq!(parse_pending(r#"{"pending":[]}"#), Ok(vec![]));
        for bad in [
            "",
            "[]",
            r#"{"pending":"a"}"#,
            r#"{"pending":["../x"]}"#,
            r#"{"pending":["private"]}"#,
            r#"{"pending":[1]}"#,
            r#"{"nope":[]}"#,
        ] {
            assert_eq!(parse_pending(bad), Err(()), "{bad}");
        }
        let many = format!(r#"{{"pending":[{}]}}"#, vec![r#""a""#; 2001].join(","));
        assert_eq!(parse_pending(&many), Err(()));
    }
}
