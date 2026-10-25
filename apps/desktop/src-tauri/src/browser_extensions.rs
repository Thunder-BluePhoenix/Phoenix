// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Phase 96: approved content scripts, injected into a profile tab after a page loaded.
//!
//! READ THIS BEFORE TRUSTING IT. A script injected here runs in the page's MAIN WORLD (wry offers
//! no isolated world), with the same rights as a script the website itself shipped:
//!
//! - it reads and changes the page's DOM, its JavaScript globals, its non-HttpOnly cookies, its
//!   `localStorage`/`IndexedDB`, and may send requests as that origin. It cannot do more than the
//!   page can;
//! - it has NO channel to Phoenix: the content window has no capability file (see
//!   `capabilities/browser.json` and the tests in `browser.rs`), so `window.__TAURI_INTERNALS__`
//!   `invoke` is refused for it exactly as for the page, and nothing in this file adds a message
//!   handler, a callback or a custom protocol;
//! - the page can see and tamper with the script: no isolation exists between them. A hostile
//!   page can replace built-ins the script uses, read what the script puts in the DOM or in
//!   globals, observe its requests, and feed it false data. A script must therefore never be
//!   given a secret, and its output must be treated as untrusted by anything that reads it.
//!
//! What this module does enforce, in the shell (never in a page): only a tab opened IN A PROFILE
//! (never a private tab); only an exact `https` origin (scheme, host and port as the tab's own URL
//! serialises them); the script list comes from Phoenix Core's session-token route
//! `GET /api/browser/profiles/:id/content-scripts/:origin`, which re-checks approval, signer trust
//! and revocation, the declared permission and origin, and asks the permission gateway at EVERY
//! call. Any failure, an unreachable Core, a malformed answer, a disabled profile: nothing is
//! injected (fail closed). Limits: at most [`MAX_SCRIPTS`] scripts, [`MAX_SCRIPT_CHARS`]
//! characters each and [`MAX_TOTAL_BYTES`] in all; a script over a limit is skipped, never cut.
//!
//! Nothing here ran against a real webview.

use crate::connection::{connection, Locator};
use crate::core_status::{call_capped, Method};
use serde::Deserialize;
use std::time::Duration;

/// Same bound as the manifest check in Core (`contentScript.length <= 100_000`).
pub const MAX_SCRIPT_CHARS: usize = 100_000;
pub const MAX_SCRIPTS: usize = 8;
pub const MAX_TOTAL_BYTES: usize = 256 * 1024;
/// Longest answer read from Core (eight scripts of 100,000 characters, escaped, plus slack).
const MAX_RESPONSE: u64 = 2 * 1024 * 1024;

/// One script Core authorized for this profile and origin just now.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContentScript {
    pub extension: String,
    pub version: String,
    pub script: String,
}

/// Asks Core which scripts may run for `(profile, origin)` now. `Err` is "do not inject".
pub type ScriptSource =
    std::sync::Arc<dyn Fn(&str, &str) -> Result<Vec<ContentScript>, ()> + Send + Sync>;

#[derive(Deserialize)]
struct Answer {
    scripts: Vec<Item>,
}

#[derive(Deserialize)]
struct Item {
    extension: String,
    version: String,
    origins: Vec<String>,
    script: String,
}

/// The origin of a page as Core spells it (`https://host` or `https://host:port`), or `None` for
/// anything that is not an https page on a named host.
pub fn origin_of(url: &url::Url) -> Option<String> {
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    let host = url.host_str()?;
    if !matches!(url.host(), Some(url::Host::Domain(_))) {
        return None;
    }
    Some(match url.port() {
        Some(port) => format!("https://{host}:{port}"),
        None => format!("https://{host}"),
    })
}

/// Percent-encodes the origin as one path segment (only unreserved characters stay).
pub fn encode_segment(text: &str) -> String {
    let mut out = String::with_capacity(text.len() * 2);
    for b in text.bytes() {
        if b.is_ascii_alphanumeric() || b == b'-' || b == b'.' || b == b'_' {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// The route for one profile and origin; `None` when the profile id is not a plain id.
pub fn route(profile_id: &str, origin: &str) -> Option<String> {
    crate::browser_profiles::valid_profile_id(profile_id).then(|| {
        format!(
            "/api/browser/profiles/{profile_id}/content-scripts/{}",
            encode_segment(origin)
        )
    })
}

/// Parses and validates Core's answer. Anything unexpected is `Err` (no partial list): wrong
/// shape, too many scripts, an item whose declared origins do not include `origin`, a script over
/// the limits, or an empty one.
#[allow(clippy::result_unit_err)] // `Err` means one thing: do not inject.
pub fn parse_answer(body: &str, origin: &str) -> Result<Vec<ContentScript>, ()> {
    let answer: Answer = serde_json::from_str(body).map_err(|_| ())?;
    if answer.scripts.len() > MAX_SCRIPTS {
        return Err(());
    }
    let mut total = 0usize;
    let mut out = Vec::with_capacity(answer.scripts.len());
    for item in answer.scripts {
        let ok = !item.script.is_empty()
            && item.script.chars().count() <= MAX_SCRIPT_CHARS
            && item.origins.iter().any(|o| o == origin)
            && !item.extension.is_empty()
            && item.extension.len() <= 80
            && item.version.len() <= 64;
        if !ok {
            return Err(());
        }
        total += item.script.len();
        if total > MAX_TOTAL_BYTES {
            return Err(());
        }
        out.push(ContentScript {
            extension: item.extension,
            version: item.version,
            script: item.script,
        });
    }
    Ok(out)
}

/// The real source: Core over loopback with the session token. Blocking; call off the main thread.
pub fn core_source(locator: Locator) -> ScriptSource {
    std::sync::Arc::new(move |profile, origin| {
        let path = route(profile, origin).ok_or(())?;
        let conn = connection(&locator);
        match call_capped(
            &conn.base_url,
            conn.token.as_deref(),
            Method::Get,
            &path,
            Duration::from_secs(5),
            MAX_RESPONSE,
        ) {
            Ok((200, body)) => parse_answer(&body, origin),
            _ => Err(()),
        }
    })
}

/// The program handed to the page: one function per script, each guarded by the origin, each in
/// its own `try` so one failing script does not stop the next. `origin` is a JSON string literal
/// built here (serde), never concatenated from page data. The script text is the signed text.
pub fn program(origin: &str, scripts: &[ContentScript]) -> Option<String> {
    if scripts.is_empty() {
        return None;
    }
    let origin_literal = serde_json::to_string(origin).ok()?;
    let mut out = String::new();
    for script in scripts {
        out.push_str("(function(){'use strict';if(location.origin!==");
        out.push_str(&origin_literal);
        out.push_str("){return;}try{\n");
        out.push_str(&script.script);
        out.push_str("\n}catch(e){}})();\n");
    }
    Some(out)
}

/// Decides what, if anything, to evaluate in a tab whose page just finished loading. Pure apart
/// from the two callbacks. Fails closed at every step:
///
/// - the tab must belong to a stored profile (`profile`), never a private tab;
/// - `loaded` must be an https page on a named host, and the window must STILL be on that origin
///   (`current` is asked before AND after the Core call, which may take seconds, so a navigation
///   in between injects nothing);
/// - Core must answer with an authorized list; any error is "nothing".
///
/// The returned program also checks `location.origin` inside the page.
pub fn plan(
    profile: Option<&str>,
    loaded: &url::Url,
    current: &dyn Fn() -> Option<url::Url>,
    source: &ScriptSource,
) -> Option<String> {
    let profile = profile?;
    let origin = origin_of(loaded)?;
    let same = || current().and_then(|u| origin_of(&u)).as_deref() == Some(origin.as_str());
    if !same() {
        return None;
    }
    let scripts = source(profile, &origin).ok()?;
    if !same() {
        return None;
    }
    program(&origin, &scripts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use url::Url;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn origin_is_exact_https_on_a_named_host() {
        assert_eq!(
            origin_of(&u("https://example.com/a?b#c")).as_deref(),
            Some("https://example.com")
        );
        assert_eq!(
            origin_of(&u("https://example.com:443/")).as_deref(),
            Some("https://example.com")
        );
        assert_eq!(
            origin_of(&u("https://example.com:8443/")).as_deref(),
            Some("https://example.com:8443")
        );
        assert_eq!(
            origin_of(&u("https://EXAMPLE.com/")).as_deref(),
            Some("https://example.com")
        );
        for refused in [
            "http://example.com/",
            "https://127.0.0.1/",
            "https://[::1]/",
            "https://user@example.com/",
            "https://u:p@example.com/",
            "about:blank",
            "file:///etc/passwd",
            "data:text/html,x",
        ] {
            assert_eq!(origin_of(&u(refused)), None, "{refused}");
        }
    }

    #[test]
    fn the_origin_is_one_encoded_segment() {
        let encoded = encode_segment("https://example.com:8443");
        assert_eq!(encoded, "https%3A%2F%2Fexample.com%3A8443");
        assert!(!encoded.contains('/'));
        assert_eq!(
            route("abc-1_2", "https://example.com").as_deref(),
            Some("/api/browser/profiles/abc-1_2/content-scripts/https%3A%2F%2Fexample.com")
        );
        assert_eq!(route("private", "https://example.com"), None);
        assert_eq!(route("../x", "https://example.com"), None);
        // The request builder in core_status accepts the path.
        assert!(crate::core_status::request(
            Method::Get,
            &route("abc", "https://example.com:8443").unwrap(),
            "127.0.0.1:1",
            "tok-en_1"
        )
        .is_some());
    }

    fn body(script: &str, origins: &str) -> String {
        format!(
            r#"{{"scripts":[{{"extension":"ex","version":"1.0.0","origins":{origins},"script":{}}}]}}"#,
            serde_json::to_string(script).unwrap()
        )
    }

    #[test]
    fn a_good_answer_parses_and_everything_else_is_refused_whole() {
        let ok = parse_answer(&body("1+1", r#"["https://a.test"]"#), "https://a.test").unwrap();
        assert_eq!(ok.len(), 1);
        assert_eq!(ok[0].script, "1+1");
        assert_eq!(
            parse_answer(r#"{"scripts":[]}"#, "https://a.test").unwrap(),
            vec![]
        );
        // Not for this origin, empty script, junk, wrong shape, extra nesting.
        assert!(parse_answer(&body("1", r#"["https://b.test"]"#), "https://a.test").is_err());
        assert!(parse_answer(&body("", r#"["https://a.test"]"#), "https://a.test").is_err());
        assert!(parse_answer("not json", "https://a.test").is_err());
        assert!(parse_answer(r#"{"scripts":"x"}"#, "https://a.test").is_err());
        assert!(parse_answer(r#"[]"#, "https://a.test").is_err());
        assert!(parse_answer("", "https://a.test").is_err());
    }

    #[test]
    fn size_and_count_limits_refuse_the_whole_answer() {
        let origin = "https://a.test";
        let big = "x".repeat(MAX_SCRIPT_CHARS + 1);
        assert!(parse_answer(&body(&big, r#"["https://a.test"]"#), origin).is_err());
        let edge = "x".repeat(MAX_SCRIPT_CHARS);
        assert!(parse_answer(&body(&edge, r#"["https://a.test"]"#), origin).is_ok());
        let one = r#"{"extension":"e","version":"1","origins":["https://a.test"],"script":"1"}"#;
        let nine = format!(r#"{{"scripts":[{}]}}"#, [one; MAX_SCRIPTS + 1].join(","));
        assert!(parse_answer(&nine, origin).is_err());
        let eight = format!(r#"{{"scripts":[{}]}}"#, [one; MAX_SCRIPTS].join(","));
        assert_eq!(parse_answer(&eight, origin).unwrap().len(), MAX_SCRIPTS);
        // Characters are counted, not bytes, for the per-script limit; bytes bound the total.
        let wide = "é".repeat(60_000); // 120,000 bytes each: two fit in 256 KiB, three do not
        let three = format!(
            r#"{{"scripts":[{}]}}"#,
            vec![
                format!(
                    r#"{{"extension":"e","version":"1","origins":["https://a.test"],"script":"{wide}"}}"#
                );
                2
            ]
            .join(",")
        );
        assert!(parse_answer(&three, origin).is_ok());
        let heavy = format!(
            r#"{{"scripts":[{}]}}"#,
            vec![
                format!(
                    r#"{{"extension":"e","version":"1","origins":["https://a.test"],"script":"{wide}"}}"#
                );
                3
            ]
            .join(",")
        );
        assert!(parse_answer(&heavy, origin).is_err());
    }

    #[test]
    fn the_program_guards_each_script_by_origin_and_isolates_failures() {
        assert_eq!(program("https://a.test", &[]), None);
        let scripts = vec![
            ContentScript {
                extension: "a".into(),
                version: "1".into(),
                script: "document.title='x'".into(),
            },
            ContentScript {
                extension: "b".into(),
                version: "1".into(),
                script: "throw 1".into(),
            },
        ];
        let text = program("https://a.test", &scripts).unwrap();
        assert_eq!(
            text.matches("location.origin!==\"https://a.test\"").count(),
            2
        );
        assert_eq!(text.matches("}catch(e){}})();").count(), 2);
        assert!(text.contains("document.title='x'") && text.contains("throw 1"));
        // The origin literal is JSON, so a hostile-looking value cannot close the string.
        let odd = program("https://a.test\"+alert(1)+\"", &scripts).unwrap();
        assert!(odd.contains("\\\"+alert(1)+\\\""));
    }

    #[test]
    fn plan_injects_only_for_a_profile_tab_on_the_same_https_origin_when_core_allows() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;
        let calls = Arc::new(AtomicUsize::new(0));
        let seen = calls.clone();
        let allow: ScriptSource = Arc::new(move |profile, origin| {
            seen.fetch_add(1, Ordering::SeqCst);
            assert_eq!(profile, "prof-1");
            assert_eq!(origin, "https://a.test");
            Ok(vec![ContentScript {
                extension: "e".into(),
                version: "1".into(),
                script: "1".into(),
            }])
        });
        let page = u("https://a.test/x");
        let here = || Some(u("https://a.test/y"));
        assert!(plan(Some("prof-1"), &page, &here, &allow).is_some());
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        // A private tab never asks Core at all.
        assert_eq!(plan(None, &page, &here, &allow), None);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        // Not https / not a named host: Core is not asked.
        let http = u("http://a.test/");
        assert_eq!(
            plan(Some("prof-1"), &http, &|| Some(http.clone()), &allow),
            None
        );
        let blank = u("about:blank");
        assert_eq!(
            plan(Some("prof-1"), &blank, &|| Some(blank.clone()), &allow),
            None
        );
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        // The window moved to another origin (or is gone) before Core was asked.
        assert_eq!(
            plan(
                Some("prof-1"),
                &page,
                &|| Some(u("https://b.test/")),
                &allow
            ),
            None
        );
        assert_eq!(plan(Some("prof-1"), &page, &|| None, &allow), None);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn plan_fails_closed_when_core_refuses_or_the_page_moves_during_the_call() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;
        let page = u("https://a.test/");
        let deny: ScriptSource = Arc::new(|_, _| Err(()));
        assert_eq!(plan(Some("p"), &page, &|| Some(page.clone()), &deny), None);
        let none: ScriptSource = Arc::new(|_, _| Ok(vec![]));
        assert_eq!(plan(Some("p"), &page, &|| Some(page.clone()), &none), None);
        // The page navigates while Core is answering.
        let moved = Arc::new(AtomicBool::new(false));
        let flag = moved.clone();
        let slow: ScriptSource = Arc::new(move |_, _| {
            flag.store(true, Ordering::SeqCst);
            Ok(vec![ContentScript {
                extension: "e".into(),
                version: "1".into(),
                script: "1".into(),
            }])
        });
        let probe = moved.clone();
        let current = move || {
            Some(if probe.load(Ordering::SeqCst) {
                u("https://evil.test/")
            } else {
                u("https://a.test/")
            })
        };
        assert_eq!(plan(Some("p"), &page, &current, &slow), None);
    }
}
