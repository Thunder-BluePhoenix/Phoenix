// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Finds Phoenix Core. Core binds to loopback only (ADR-0015) and writes a
//! per-start session token to `<dataDir>/session.token` (mode 0600); the
//! desktop shell reads it the same way `curl` users do and hands it to the page.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

pub const DEFAULT_PORT: u16 = 4870;
pub const TOKEN_FILE: &str = "session.token";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Locator {
    pub base_url: String,
    /// Places Core may keep its data, most specific first.
    pub data_dirs: Vec<PathBuf>,
}

/// What the page needs to call Core.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CoreConnection {
    pub base_url: String,
    pub token: Option<String>,
}

/// Mirrors Core's config. An explicit `PHOENIX_DATA_DIR` is the only place to look.
/// Otherwise Core's data lives in `~/.phoenix/<PHOENIX_ENV>` (env defaults to `dev`),
/// except that the repository's `config/dev.json` points a development Core at
/// `<repo>/.phoenix/dev`; `repo_dev_dir` is that directory when this is a dev build.
pub fn locate(
    get: impl Fn(&str) -> Option<String>,
    home: Option<PathBuf>,
    repo_dev_dir: Option<PathBuf>,
) -> Locator {
    let port = get("PHOENIX_PORT")
        .and_then(|p| p.trim().parse::<u16>().ok())
        .filter(|p| *p != 0)
        .unwrap_or(DEFAULT_PORT);

    let data_dirs = match get("PHOENIX_DATA_DIR").filter(|d| !d.trim().is_empty()) {
        Some(dir) => vec![PathBuf::from(dir)],
        None => {
            let env = get("PHOENIX_ENV")
                .filter(|e| matches!(e.as_str(), "dev" | "staging" | "prod"))
                .unwrap_or_else(|| "dev".to_string());
            let mut dirs = Vec::new();
            if env == "dev" {
                dirs.extend(repo_dev_dir);
            }
            dirs.push(home.unwrap_or_default().join(".phoenix").join(env));
            dirs
        }
    };

    Locator {
        base_url: format!("http://127.0.0.1:{port}"),
        data_dirs,
    }
}

/// Core only ever writes URL-safe base64; anything else is not our token.
pub fn read_token(data_dir: &Path) -> Option<(String, SystemTime)> {
    let path = data_dir.join(TOKEN_FILE);
    let raw = fs::read_to_string(&path).ok()?;
    let token = raw.trim();
    let valid = !token.is_empty()
        && token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    let written = fs::metadata(&path).and_then(|m| m.modified()).ok()?;
    valid.then(|| (token.to_string(), written))
}

/// The token of the Core that started most recently. Core removes its token when
/// it stops cleanly, but a crashed Core leaves a stale one behind, so when several
/// candidate directories hold a token the newest wins.
pub fn current_token(data_dirs: &[PathBuf]) -> Option<String> {
    data_dirs
        .iter()
        .filter_map(|dir| read_token(dir))
        .max_by_key(|(_, written)| *written)
        .map(|(token, _)| token)
}

pub fn connection(locator: &Locator) -> CoreConnection {
    CoreConnection {
        base_url: locator.base_url.clone(),
        token: current_token(&locator.data_dirs),
    }
}

/// The Phoenix web app URL for an in-app route such as `/meetings`. The page asks
/// the shell to open a route; it can never choose the host, so a compromised page
/// cannot make the shell open arbitrary URLs.
pub fn phoenix_url(base_url: &str, route: &str) -> Option<String> {
    let plain = route.len() <= 200
        && route.starts_with('/')
        && !route.starts_with("//")
        && route
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"/_.:%-".contains(&b));
    plain.then(|| format!("{base_url}/#{route}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::time::Duration;

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |k| map.get(k).cloned()
    }

    fn home() -> Option<PathBuf> {
        Some(PathBuf::from("/home/ada"))
    }

    #[test]
    fn defaults_match_core() {
        let l = locate(env(&[]), home(), None);
        assert_eq!(l.base_url, "http://127.0.0.1:4870");
        assert_eq!(l.data_dirs, vec![PathBuf::from("/home/ada/.phoenix/dev")]);
    }

    #[test]
    fn a_dev_build_also_looks_in_the_repository_where_dev_core_keeps_its_data() {
        let repo = Some(PathBuf::from("/work/phoenix/.phoenix/dev"));
        let l = locate(env(&[]), home(), repo.clone());
        assert_eq!(
            l.data_dirs,
            vec![
                PathBuf::from("/work/phoenix/.phoenix/dev"),
                PathBuf::from("/home/ada/.phoenix/dev")
            ]
        );
        // The repository's data directory only belongs to a development Core.
        let l = locate(env(&[("PHOENIX_ENV", "prod")]), home(), repo);
        assert_eq!(l.data_dirs, vec![PathBuf::from("/home/ada/.phoenix/prod")]);
    }

    #[test]
    fn explicit_data_dir_and_port_win() {
        let l = locate(
            env(&[
                ("PHOENIX_DATA_DIR", "/srv/phoenix"),
                ("PHOENIX_PORT", "5000"),
                ("PHOENIX_ENV", "prod"),
            ]),
            home(),
            Some(PathBuf::from("/work/phoenix/.phoenix/dev")),
        );
        assert_eq!(l.base_url, "http://127.0.0.1:5000");
        assert_eq!(l.data_dirs, vec![PathBuf::from("/srv/phoenix")]);
    }

    #[test]
    fn unknown_environments_fall_back_to_dev_like_core() {
        let l = locate(env(&[("PHOENIX_ENV", "qa")]), home(), None);
        assert_eq!(l.data_dirs, vec![PathBuf::from("/home/ada/.phoenix/dev")]);
    }

    #[test]
    fn the_host_is_always_loopback_and_bad_ports_fall_back() {
        for bad in ["abc", "0", "70000", "-1", ""] {
            let l = locate(env(&[("PHOENIX_PORT", bad)]), None, None);
            assert_eq!(l.base_url, "http://127.0.0.1:4870", "port {bad:?}");
        }
        // There is no way to point the shell at a non-loopback host.
        let l = locate(env(&[("PHOENIX_HOST", "evil.example")]), None, None);
        assert!(l.base_url.starts_with("http://127.0.0.1:"));
    }

    #[test]
    fn reads_a_trimmed_token() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(TOKEN_FILE), "abc_DEF-123\n").unwrap();
        assert_eq!(
            current_token(&[dir.path().to_path_buf()]),
            Some("abc_DEF-123".to_string())
        );
    }

    #[test]
    fn missing_empty_or_malformed_tokens_are_none() {
        let dir = tempfile::tempdir().unwrap();
        let dirs = [dir.path().to_path_buf()];
        assert_eq!(current_token(&dirs), None);
        for bad in ["", "\n", "has space", "quote\"inject", "a/b"] {
            fs::write(dir.path().join(TOKEN_FILE), bad).unwrap();
            assert_eq!(current_token(&dirs), None, "token {bad:?}");
        }
    }

    #[test]
    fn finds_the_token_in_whichever_directory_has_one() {
        let empty = tempfile::tempdir().unwrap();
        let repo = tempfile::tempdir().unwrap();
        fs::write(repo.path().join(TOKEN_FILE), "from-repo").unwrap();
        let dirs = [empty.path().to_path_buf(), repo.path().to_path_buf()];
        assert_eq!(current_token(&dirs), Some("from-repo".to_string()));
    }

    #[test]
    fn the_most_recently_started_core_wins_over_a_stale_token() {
        let stale = tempfile::tempdir().unwrap();
        let fresh = tempfile::tempdir().unwrap();
        let old = stale.path().join(TOKEN_FILE);
        fs::write(&old, "stale-from-a-crash").unwrap();
        fs::File::options()
            .write(true)
            .open(&old)
            .unwrap()
            .set_modified(SystemTime::now() - Duration::from_secs(3600))
            .unwrap();
        fs::write(fresh.path().join(TOKEN_FILE), "current").unwrap();

        for dirs in [
            [stale.path().to_path_buf(), fresh.path().to_path_buf()],
            [fresh.path().to_path_buf(), stale.path().to_path_buf()],
        ] {
            assert_eq!(current_token(&dirs), Some("current".to_string()));
        }
    }

    #[test]
    fn opens_routes_inside_the_phoenix_web_app() {
        let base = "http://127.0.0.1:4870";
        assert_eq!(
            phoenix_url(base, "/"),
            Some("http://127.0.0.1:4870/#/".into())
        );
        assert_eq!(
            phoenix_url(base, "/meetings/kage%3A1"),
            Some("http://127.0.0.1:4870/#/meetings/kage%3A1".into())
        );
    }

    #[test]
    fn refuses_anything_that_is_not_a_plain_route() {
        let base = "http://127.0.0.1:4870";
        let too_long = format!("/{}", "a".repeat(300));
        for bad in [
            "",
            "meetings",
            "https://evil.example",
            "//evil.example",
            "/a b",
            "/a?x=1",
            "/a#b",
            "/\"onload=",
            too_long.as_str(),
        ] {
            assert_eq!(phoenix_url(base, bad), None, "{bad:?}");
        }
    }
}
