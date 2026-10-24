// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! `phoenix://approvals/<id>`: a link from a chat message (or anything else) that asks the shell to
//! show the pending approvals. macOS hands such links to the running app as `RunEvent::Opened`
//! once `Info.plist` declares the scheme (`CFBundleURLTypes`); no plugin or extra crate is involved.
//!
//! A link is untrusted text from outside the app. This module therefore only ever answers one
//! question: "is this exactly an approvals link?". It never executes, fetches or forwards anything
//! from the URL: the id is validated and then dropped, and the shell opens a FIXED in-app route (the
//! overview panel, where every pending approval is listed). The link does not decide anything, and
//! the shell does not check a Teams link's signature: Core does that and the person still decides
//! inside Phoenix.

/// Where every approval link leads: the Pet Panel's overview, which lists pending approvals.
pub const APPROVALS_ROUTE: &str = "/panel/overview";

/// Longest link read at all, in bytes. Teams links carry a query of about 250 bytes.
pub const MAX_LINK_BYTES: usize = 600;
/// Longest approval id (Core's ids are `apr_` plus 24 hex, or `conf_` plus a short suffix).
const MAX_ID_BYTES: usize = 64;
const SCHEME: &str = "phoenix://";
const HOST: &str = "approvals";
/// The path Teams cards use (`phoenix://approvals/open?s=…&i=…&h=…&e=…&m=…`).
const TEAMS_SEGMENT: &str = "open";

/// What an accepted link asked for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Link {
    /// `phoenix://approvals/<id>`.
    Approval(String),
    /// `phoenix://approvals/open?…`, the signed link Teams cards carry. The query is not read.
    TeamsOpen,
}

fn id_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-'
}

/// Strict allow-list: lowercase scheme and host exactly, one path segment of `[A-Za-z0-9_-]{1,64}`,
/// an optional single trailing slash, no userinfo, port, fragment or percent-escapes. A query is
/// accepted only on the Teams `open` form, and is never interpreted. Anything else is `None`.
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
    if segment.is_empty() || segment.len() > MAX_ID_BYTES || !segment.bytes().all(id_byte) {
        return None;
    }
    match (segment, query) {
        (TEAMS_SEGMENT, _) => Some(Link::TeamsOpen),
        (id, None) => Some(Link::Approval(id.to_string())),
        (_, Some(_)) => None,
    }
}

/// The in-app route for the first acceptable link among `urls`, or `None`. Only the first URL of an
/// event is considered, so one open event can never trigger more than one navigation.
pub fn route_for<S: AsRef<str>>(urls: &[S]) -> Option<&'static str> {
    parse(urls.first()?.as_ref()).map(|_| APPROVALS_ROUTE)
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

    #[test]
    fn accepts_the_teams_link_without_reading_its_query() {
        assert_eq!(
            parse("phoenix://approvals/open?s=agent&i=apr_1&h=ab&e=1&m=cd"),
            Some(Link::TeamsOpen)
        );
        assert_eq!(parse("phoenix://approvals/open"), Some(Link::TeamsOpen));
        // Garbage in the query changes nothing: it is never looked at.
        assert_eq!(
            parse("phoenix://approvals/open?s=../../x&i=;rm"),
            Some(Link::TeamsOpen)
        );
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

    #[test]
    fn every_accepted_link_leads_to_the_same_fixed_route() {
        assert_eq!(
            route_for(&["phoenix://approvals/apr_1"]),
            Some(APPROVALS_ROUTE)
        );
        assert_eq!(
            route_for(&["phoenix://approvals/open?s=agent"]),
            Some(APPROVALS_ROUTE)
        );
        // The id never reaches the route.
        assert_eq!(
            route_for(&["phoenix://approvals/apr_2"]),
            route_for(&["phoenix://approvals/apr_1"])
        );
    }

    #[test]
    fn only_the_first_url_of_an_event_counts() {
        assert_eq!(
            route_for(&["https://evil.example/", "phoenix://approvals/apr_1"]),
            None
        );
        assert_eq!(
            route_for(&["phoenix://approvals/apr_1", "https://evil.example/"]),
            Some(APPROVALS_ROUTE)
        );
        assert_eq!(route_for::<&str>(&[]), None);
    }

    #[test]
    fn the_route_is_one_the_shell_will_open() {
        assert!(crate::connection::phoenix_url("http://127.0.0.1:4870", APPROVALS_ROUTE).is_some());
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
