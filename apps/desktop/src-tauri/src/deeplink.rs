// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! `phoenix://approvals/<id>`: a link from a chat message (or anything else) that asks the shell to
//! show one approval. macOS hands such links to the running app as `RunEvent::Opened` once
//! `Info.plist` declares the scheme (`CFBundleURLTypes`); no plugin or extra crate is involved.
//!
//! A link is untrusted text from outside the app. This module therefore answers one question: "is
//! this exactly an approvals link, and what are its (strictly shaped) parameters?". Nothing from the
//! URL is executed or fetched. The shell does NOT trust the id: it only re-checks its shape and
//! hands it to the web app as a fragment parameter (`#/approvals?id=<id>`). The web page then asks
//! Core, with the session token, whether that approval exists and is pending, and shows nothing
//! otherwise. For the Teams form the shell cannot verify the signature (it holds no secret): it
//! checks only that each of the five fields has the expected shape and forwards them as a query
//! (`#/approvals?s=…&i=…&h=…&e=…&m=…`); the web page sends that query to Core
//! (`POST /api/chat-approvals/teams/verify-link`) before it shows anything.

/// The in-app route both link forms lead to; the parameters follow in the hash.
pub const APPROVALS_ROUTE: &str = "/approvals";

/// Longest link read at all, in bytes. Teams links carry a query of about 250 bytes.
pub const MAX_LINK_BYTES: usize = 600;
/// Longest approval id (Core's ids are `apr_` plus 24 hex, or `conf_` plus a short suffix).
const MAX_ID_BYTES: usize = 64;
const SCHEME: &str = "phoenix://";
const HOST: &str = "approvals";
/// The path Teams cards use (`phoenix://approvals/open?s=…&i=…&h=…&e=…&m=…`).
const TEAMS_SEGMENT: &str = "open";
/// Hex length of a SHA-256 digest or HMAC-SHA256 (the request hash and the link signature).
const HEX_BYTES: usize = 64;
/// Digits in the expiry (epoch milliseconds).
const MAX_EXPIRY_DIGITS: usize = 16;

/// The five fields of a Teams link, each already checked for shape (not for truth: Core does that).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TeamsLink {
    /// `agent` or `confirmation`.
    pub source: &'static str,
    pub id: String,
    pub hash: String,
    pub expires: String,
    pub mac: String,
}

/// What an accepted link asked for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Link {
    /// `phoenix://approvals/<id>`.
    Approval(String),
    /// `phoenix://approvals/open?s=…&i=…&h=…&e=…&m=…`, the signed link Teams cards carry.
    TeamsOpen(TeamsLink),
}

fn id_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-'
}

fn is_id(v: &str) -> bool {
    !v.is_empty() && v.len() <= MAX_ID_BYTES && v.bytes().all(id_byte)
}

fn is_lower_hex(v: &str) -> bool {
    v.len() == HEX_BYTES && v.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// The Teams query: exactly the keys `s i h e m`, each once, in any order, each of the shape Core
/// writes. Nothing else (no extra key, empty value, escape or repeat) is accepted.
fn teams_link(query: &str) -> Option<TeamsLink> {
    let (mut s, mut i, mut h, mut e, mut m) = (None, None, None, None, None);
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=')?;
        let slot = match key {
            "s" => &mut s,
            "i" => &mut i,
            "h" => &mut h,
            "e" => &mut e,
            "m" => &mut m,
            _ => return None,
        };
        if slot.replace(value).is_some() {
            return None;
        }
    }
    let source = match s? {
        "agent" => "agent",
        "confirmation" => "confirmation",
        _ => return None,
    };
    let (id, hash, expires, mac) = (i?, h?, e?, m?);
    let expiry_ok = !expires.is_empty()
        && expires.len() <= MAX_EXPIRY_DIGITS
        && expires.bytes().all(|b| b.is_ascii_digit());
    if !is_id(id) || !is_lower_hex(hash) || !expiry_ok || !is_lower_hex(mac) {
        return None;
    }
    Some(TeamsLink {
        source,
        id: id.to_string(),
        hash: hash.to_string(),
        expires: expires.to_string(),
        mac: mac.to_string(),
    })
}

/// Strict allow-list: lowercase scheme and host exactly, one path segment of `[A-Za-z0-9_-]{1,64}`,
/// an optional single trailing slash, no userinfo, port, fragment or percent-escapes. A query is
/// accepted only on the Teams `open` form, and only in the exact shape Core writes. Anything else
/// is `None`.
pub fn parse(url: &str) -> Option<Link> {
    if url.len() > MAX_LINK_BYTES || !url.is_ascii() || url.bytes().any(|b| b.is_ascii_control()) {
        return None;
    }
    let rest = url.strip_prefix(SCHEME)?;
    let rest = rest.strip_prefix(HOST)?.strip_prefix('/')?;
    let (path, query) = match rest.split_once('?') {
        Some((path, query)) => (path, Some(query)),
        None => (rest, None),
    };
    if path.contains('#') || query.is_some_and(|q| q.contains('#')) {
        return None;
    }
    let segment = path.strip_suffix('/').unwrap_or(path);
    if !is_id(segment) {
        return None;
    }
    match (segment, query) {
        (TEAMS_SEGMENT, Some(query)) => teams_link(query).map(Link::TeamsOpen),
        (TEAMS_SEGMENT, None) | (_, Some(_)) => None,
        (id, None) => Some(Link::Approval(id.to_string())),
    }
}

/// The Phoenix web app URL for the first acceptable link among `urls`, or `None`. Only the first
/// URL of an event is considered, so one open event can never trigger more than one navigation.
/// Every character written after `base_url` is from the validated id/hex/digit/word sets, so no
/// escaping is needed and nothing can add a host, path segment or extra parameter.
pub fn url_for<S: AsRef<str>>(base_url: &str, urls: &[S]) -> Option<String> {
    let route = match parse(urls.first()?.as_ref())? {
        Link::Approval(id) => format!("{APPROVALS_ROUTE}?id={id}"),
        Link::TeamsOpen(t) => format!(
            "{APPROVALS_ROUTE}?s={}&i={}&h={}&e={}&m={}",
            t.source, t.id, t.hash, t.expires, t.mac
        ),
    };
    Some(format!("{base_url}/#{route}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_an_approval_id() {
        assert_eq!(
            parse("phoenix://approvals/apr_0123456789abcdef01234567"),
            Some(Link::Approval("apr_0123456789abcdef01234567".into()))
        );
        assert_eq!(
            parse("phoenix://approvals/conf_mk3-ab/"),
            Some(Link::Approval("conf_mk3-ab".into()))
        );
    }

    const H: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const M: &str = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

    fn teams_url(s: &str, i: &str, h: &str, e: &str, m: &str) -> String {
        format!("phoenix://approvals/open?s={s}&i={i}&h={h}&e={e}&m={m}")
    }

    #[test]
    fn accepts_the_teams_link_in_the_shape_core_writes() {
        // URLSearchParams order, as `signDeepLink` writes it.
        assert_eq!(
            parse(&teams_url(
                "agent",
                "apr_0123456789abcdef01234567",
                H,
                "1790000000000",
                M
            )),
            Some(Link::TeamsOpen(TeamsLink {
                source: "agent",
                id: "apr_0123456789abcdef01234567".into(),
                hash: H.into(),
                expires: "1790000000000".into(),
                mac: M.into(),
            }))
        );
        assert!(matches!(
            parse(&teams_url("confirmation", "conf_mk3-ab", H, "1", M)),
            Some(Link::TeamsOpen(_))
        ));
        // Any key order is the same link.
        let shuffled = format!("phoenix://approvals/open?m={M}&e=5&h={H}&i=apr_1&s=agent");
        assert_eq!(
            parse(&shuffled),
            parse(&teams_url("agent", "apr_1", H, "5", M))
        );
    }

    #[test]
    fn refuses_a_teams_link_whose_query_is_not_exactly_the_five_fields() {
        let dup = format!("{}&i=apr_2", teams_url("agent", "apr_1", H, "1", M));
        let extra = format!("{}&x=1", teams_url("agent", "apr_1", H, "1", M));
        let missing = format!("phoenix://approvals/open?s=agent&i=apr_1&h={H}&e=1");
        let upper_hex = H.to_uppercase();
        let long_id = "a".repeat(65);
        for bad in [
            "phoenix://approvals/open".to_string(),
            "phoenix://approvals/open?".to_string(),
            "phoenix://approvals/open?s=agent&i=apr_1&h=ab&e=1&m=cd".to_string(),
            "phoenix://approvals/open?s=../../x&i=;rm".to_string(),
            teams_url("other", "apr_1", H, "1", M),
            teams_url("Agent", "apr_1", H, "1", M),
            teams_url("agent", "", H, "1", M),
            teams_url("agent", &long_id, H, "1", M),
            teams_url("agent", "apr%5F1", H, "1", M),
            teams_url("agent", "apr_1;rm", H, "1", M),
            teams_url("agent", "apr_1", &upper_hex, "1", M),
            teams_url("agent", "apr_1", &H[..63], "1", M),
            teams_url("agent", "apr_1", H, "", M),
            teams_url("agent", "apr_1", H, "-1", M),
            teams_url("agent", "apr_1", H, "1e9", M),
            teams_url("agent", "apr_1", H, "12345678901234567", M),
            teams_url("agent", "apr_1", H, "1", &M[..63]),
            teams_url("agent", "apr_1", H, "1", &format!("{M}0")),
            dup,
            extra,
            missing,
        ] {
            assert_eq!(parse(&bad), None, "{bad:?}");
        }
    }

    #[test]
    fn refuses_everything_that_is_not_exactly_an_approvals_link() {
        let long_id = format!("phoenix://approvals/{}", "a".repeat(65));
        let long_query = format!("phoenix://approvals/open?{}", "a".repeat(600));
        for bad in [
            "",
            "phoenix://",
            "phoenix://approvals",
            "phoenix://approvals/",
            "phoenix:approvals/apr_1",
            "phoenix:///approvals/apr_1",
            "Phoenix://approvals/apr_1",
            "PHOENIX://approvals/apr_1",
            "phoenix://Approvals/apr_1",
            "phoenix://approvals.evil/apr_1",
            "phoenix://approvals@evil/apr_1",
            "phoenix://approvals:80/apr_1",
            "phoenix://user@approvals/apr_1",
            "phoenix://settings/apr_1",
            "phoenix://approvals/../settings",
            "phoenix://approvals/apr_1/extra",
            "phoenix://approvals//apr_1",
            "phoenix://approvals/apr_1?x=1",
            "phoenix://approvals/apr_1#frag",
            "phoenix://approvals/open#frag",
            "phoenix://approvals/open?x=1#frag",
            "phoenix://approvals/open?x=1",
            "phoenix://approvals/apr%5F1",
            "phoenix://approvals/apr 1",
            "phoenix://approvals/apr_1\n",
            "phoenix://approvals/apr_1\u{0}",
            "phoenix://approvals/ap\u{202e}r",
            "phoenix://approvals/ap\u{e9}",
            "http://approvals/apr_1",
            "https://approvals/apr_1",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "mailto:a@example.org",
            "phoenix://approvals/apr_1;rm -rf /",
            "phoenix://approvals/$(id)",
            "phoenix://approvals/`id`",
            "phoenix://approvals/apr_1&x",
            &long_id,
            &long_query,
        ] {
            assert_eq!(parse(bad), None, "{bad:?}");
        }
    }

    const BASE: &str = "http://127.0.0.1:4870";

    #[test]
    fn an_approval_link_opens_the_approvals_page_with_the_id_as_a_parameter() {
        assert_eq!(
            url_for(BASE, &["phoenix://approvals/apr_0123456789abcdef01234567"]).as_deref(),
            Some("http://127.0.0.1:4870/#/approvals?id=apr_0123456789abcdef01234567")
        );
        assert_eq!(
            url_for(BASE, &["phoenix://approvals/conf_mk3-ab/"]).as_deref(),
            Some("http://127.0.0.1:4870/#/approvals?id=conf_mk3-ab")
        );
    }

    #[test]
    fn a_teams_link_is_forwarded_field_by_field_for_core_to_verify() {
        let link = teams_url("confirmation", "conf_1", H, "1790000000000", M);
        assert_eq!(
            url_for(BASE, &[link]).as_deref(),
            Some(
                format!(
                    "http://127.0.0.1:4870/#/approvals?s=confirmation&i=conf_1&h={H}&e=1790000000000&m={M}"
                )
                .as_str()
            )
        );
        // Order in the incoming link does not matter; the forwarded one is canonical.
        let shuffled = format!("phoenix://approvals/open?m={M}&e=5&h={H}&i=apr_1&s=agent");
        assert_eq!(
            url_for(BASE, &[shuffled]),
            url_for(BASE, &[teams_url("agent", "apr_1", H, "5", M)])
        );
    }

    #[test]
    fn nothing_but_validated_characters_reach_the_url() {
        for url in ["phoenix://approvals/apr_1", "phoenix://approvals/ab-CD_09"] {
            let out = url_for(BASE, &[url]).unwrap();
            let tail = out
                .strip_prefix("http://127.0.0.1:4870/#/approvals?id=")
                .unwrap();
            assert!(tail.bytes().all(id_byte), "{tail:?}");
        }
        assert_eq!(url_for(BASE, &["phoenix://approvals/a&id=b"]), None);
        assert_eq!(url_for(BASE, &["phoenix://approvals/a%26b"]), None);
    }

    #[test]
    fn only_the_first_url_of_an_event_counts() {
        assert_eq!(
            url_for(
                BASE,
                &["https://evil.example/", "phoenix://approvals/apr_1"]
            ),
            None
        );
        assert!(url_for(
            BASE,
            &["phoenix://approvals/apr_1", "https://evil.example/"]
        )
        .is_some());
        assert_eq!(url_for::<&str>(BASE, &[]), None);
    }

    #[test]
    fn the_bundle_declares_the_scheme_and_nothing_else() {
        let plist = include_str!("../Info.plist");
        assert!(plist.contains("<key>CFBundleURLTypes</key>"));
        assert!(plist.contains("<string>phoenix</string>"));
        assert_eq!(plist.matches("<key>CFBundleURLSchemes</key>").count(), 1);
        assert_eq!(plist.matches("<string>phoenix</string>").count(), 1);
    }
}
