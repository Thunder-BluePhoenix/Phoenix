// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Phase 93: the pure parts of the browser host (no windows, no network, no clock except what a
//! caller passes in), so each can be tested without a webview. `browser.rs` wires them to Tauri.

use crate::browser_policy::{classify_host, HostClass};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use url::Url;

/// Label of the chrome window: the only window allowed to call a browser command.
pub const CHROME_LABEL: &str = "phoenix-browser";
const TAB_PREFIX: &str = "phoenix-browser-tab-";
/// Longest URL any command accepts.
pub const MAX_URL_LEN: usize = 2048;
/// Open content windows at most.
pub const MAX_TABS: usize = 12;
pub const ZOOM_MIN: f64 = 0.5;
pub const ZOOM_MAX: f64 = 3.0;
/// Logical pixels the content window starts below the top of the chrome window.
pub const DEFAULT_CHROME_HEIGHT: f64 = 80.0;
pub const MAX_CHROME_HEIGHT: f64 = 400.0;

pub fn tab_label(id: u64) -> String {
    format!("{TAB_PREFIX}{id}")
}

/// The numeric id of a content window label, or `None` for any other label.
pub fn tab_of_label(label: &str) -> Option<u64> {
    parse_tab_id(label.strip_prefix(TAB_PREFIX)?)
}

/// A tab id as the chrome sends it: canonical decimal digits only (`"7"`, never `"07"`, `" 7"`,
/// `"-7"` or `"7;x"`), so an id names exactly one window label.
pub fn parse_tab_id(text: &str) -> Option<u64> {
    if text.is_empty() || text.len() > 20 || !text.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let n: u64 = text.parse().ok()?;
    (n.to_string() == text).then_some(n)
}

/// A URL the chrome sends: bounded, no control characters.
pub fn url_text_ok(url: &str) -> bool {
    !url.is_empty() && url.len() <= MAX_URL_LEN && !url.chars().any(|c| c.is_control())
}

/// Clamps a zoom factor to the supported range; NaN and infinities become 1.
pub fn clamp_zoom(factor: f64) -> f64 {
    if !factor.is_finite() {
        return 1.0;
    }
    factor.clamp(ZOOM_MIN, ZOOM_MAX)
}

/// Clamps the chrome height the content window sits below.
pub fn clamp_chrome_height(height: f64) -> f64 {
    if !height.is_finite() {
        return DEFAULT_CHROME_HEIGHT;
    }
    height.clamp(40.0, MAX_CHROME_HEIGHT)
}

// ---------------------------------------------------------------------------------------------
// History (the system webviews give no portable "can go back" API, so the host counts itself)
// ---------------------------------------------------------------------------------------------

/// What a pending back/forward is waiting for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pending {
    Back,
    Forward,
}

#[derive(Debug, Default)]
pub struct History {
    entries: Vec<String>,
    index: usize,
    pending: Option<Pending>,
}

const MAX_HISTORY: usize = 100;

impl History {
    pub fn current(&self) -> Option<&str> {
        self.entries.get(self.index).map(String::as_str)
    }
    pub fn can_go_back(&self) -> bool {
        self.index > 0
    }
    pub fn can_go_forward(&self) -> bool {
        self.index + 1 < self.entries.len()
    }
    /// The host asked the page to go back; the next committed URL is the previous entry.
    pub fn request_back(&mut self) -> bool {
        let ok = self.can_go_back();
        if ok {
            self.pending = Some(Pending::Back);
        }
        ok
    }
    pub fn request_forward(&mut self) -> bool {
        let ok = self.can_go_forward();
        if ok {
            self.pending = Some(Pending::Forward);
        }
        ok
    }
    /// A page committed `url` (page load started). A pending back/forward moves the index; the same
    /// URL as the current entry (reload, redirect to itself) changes nothing; anything else is a
    /// new entry that discards the forward ones.
    pub fn committed(&mut self, url: &str) {
        match self.pending.take() {
            Some(Pending::Back) if self.index > 0 => self.index -= 1,
            Some(Pending::Forward) if self.index + 1 < self.entries.len() => self.index += 1,
            _ => {
                if self.current() == Some(url) {
                    return;
                }
                self.entries
                    .truncate(self.index + usize::from(!self.entries.is_empty()));
                self.entries.push(url.to_string());
                if self.entries.len() > MAX_HISTORY {
                    self.entries.remove(0);
                }
                self.index = self.entries.len() - 1;
            }
        }
        if let Some(slot) = self.entries.get_mut(self.index) {
            *slot = url.to_string();
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Popups
// ---------------------------------------------------------------------------------------------

/// At most `max` events in any `window`. A page that opens windows in a loop gets a few and then
/// none, instead of twelve windows at once.
#[derive(Debug)]
pub struct RateLimit {
    max: usize,
    window: Duration,
    seen: VecDeque<Instant>,
}

impl RateLimit {
    pub fn new(max: usize, window: Duration) -> Self {
        Self {
            max,
            window,
            seen: VecDeque::new(),
        }
    }
    pub fn allow(&mut self, now: Instant) -> bool {
        while self
            .seen
            .front()
            .is_some_and(|t| now.duration_since(*t) > self.window)
        {
            self.seen.pop_front();
        }
        if self.seen.len() >= self.max {
            return false;
        }
        self.seen.push_back(now);
        true
    }
}

// ---------------------------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------------------------

/// The file name a download may use: the last path component of what the server suggested, with
/// separators, control characters and a leading dot removed; never empty.
pub fn safe_file_name(suggested: &str) -> String {
    let last = suggested
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .trim();
    let mut name: String = last
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    name = name.trim_start_matches('.').trim().to_string();
    if name.chars().count() > 120 {
        name = name.chars().take(120).collect();
    }
    if name.is_empty() {
        "download".to_string()
    } else {
        name
    }
}

/// `folder/name`, or `folder/name (n)` when that exists. `None` when the folder is not an absolute
/// path. `exists` is a parameter so the choice is testable.
pub fn download_destination(
    folder: &Path,
    suggested: &str,
    exists: impl Fn(&Path) -> bool,
) -> Option<PathBuf> {
    if !folder.is_absolute() {
        return None;
    }
    let name = safe_file_name(suggested);
    let direct = folder.join(&name);
    if !exists(&direct) {
        return Some(direct);
    }
    let (stem, ext) = match name.rfind('.') {
        Some(dot) if dot > 0 => (&name[..dot], &name[dot..]),
        _ => (name.as_str(), ""),
    };
    (2..1000)
        .map(|n| folder.join(format!("{stem} ({n}){ext}")))
        .find(|p| !exists(p))
}

// ---------------------------------------------------------------------------------------------
// Port radar (Phase 80)
// ---------------------------------------------------------------------------------------------

/// `host:port` of a loopback dev-server URL the port radar may ask to open: `http` or `https`,
/// host exactly `127.0.0.1`, `localhost` or `[::1]`, an explicit port that is not Phoenix Core's,
/// no credentials. Everything else is `None` (the radar lists only wildcard and loopback binds).
pub fn port_radar_origin(url: &str, core_port: u16) -> Option<(String, u16)> {
    if !url_text_ok(url) {
        return None;
    }
    let parsed = Url::parse(url.trim()).ok()?;
    if !matches!(parsed.scheme(), "http" | "https")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return None;
    }
    let host = parsed.host_str()?.to_lowercase();
    if !matches!(host.as_str(), "127.0.0.1" | "localhost" | "[::1]") {
        return None;
    }
    if !matches!(classify_host(&host), HostClass::Private(_)) {
        return None;
    }
    let port = parsed.port().filter(|p| *p != 0 && *p != core_port)?;
    Some((host, port))
}

/// `phoenix://browser/open?url=<percent-encoded loopback dev-server URL>` (the link the port radar
/// page offers): the inner URL when the link is exactly that shape and the inner URL passes
/// [`port_radar_origin`]'s syntax rules; Core's own port is checked again by the host.
pub fn radar_link(link: &str) -> Option<String> {
    if link.len() > MAX_URL_LEN + 64 || !link.is_ascii() || link.chars().any(|c| c.is_control()) {
        return None;
    }
    let parsed = Url::parse(link).ok()?;
    if parsed.scheme() != "phoenix"
        || parsed.host_str() != Some("browser")
        || parsed.path() != "/open"
        || parsed.fragment().is_some()
    {
        return None;
    }
    let mut pairs = parsed.query_pairs();
    let (key, value) = pairs.next()?;
    if key != "url" || pairs.next().is_some() {
        return None;
    }
    // Any port but 0 here; the host compares with Core's real port before it records anything.
    port_radar_origin(&value, u16::MAX)?;
    Some(value.into_owned())
}

/// Same origin (scheme-agnostic host and port) as a tab opened from the port radar.
pub fn same_radar_origin(url: &Url, origin: &(String, u16)) -> bool {
    url.host_str().map(str::to_lowercase).as_deref() == Some(origin.0.as_str())
        && url.port_or_known_default() == Some(origin.1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tab_ids_are_canonical_numbers_and_name_one_label() {
        assert_eq!(parse_tab_id("7"), Some(7));
        for bad in [
            "",
            "07",
            " 7",
            "-7",
            "7;x",
            "7 ",
            "1e3",
            "٣",
            "18446744073709551616",
        ] {
            assert_eq!(parse_tab_id(bad), None, "{bad:?}");
        }
        assert_eq!(tab_label(7), "phoenix-browser-tab-7");
        assert_eq!(tab_of_label("phoenix-browser-tab-7"), Some(7));
        assert_eq!(tab_of_label("phoenix-browser"), None);
        assert_eq!(tab_of_label("phoenix-browser-tab-07"), None);
        assert_eq!(tab_of_label("fawkes"), None);
    }

    #[test]
    fn url_text_and_zoom_are_bounded() {
        assert!(url_text_ok("https://example.com/"));
        assert!(!url_text_ok(""));
        assert!(!url_text_ok(&format!(
            "https://e.com/{}",
            "a".repeat(MAX_URL_LEN)
        )));
        assert!(!url_text_ok("https://e.com/\n"));
        assert_eq!(clamp_zoom(f64::NAN), 1.0);
        assert_eq!(clamp_zoom(f64::INFINITY), 1.0);
        assert_eq!(clamp_zoom(0.1), ZOOM_MIN);
        assert_eq!(clamp_zoom(99.0), ZOOM_MAX);
        assert_eq!(clamp_zoom(1.25), 1.25);
        assert_eq!(clamp_chrome_height(f64::NAN), DEFAULT_CHROME_HEIGHT);
        assert_eq!(clamp_chrome_height(1e9), MAX_CHROME_HEIGHT);
        assert_eq!(clamp_chrome_height(-5.0), 40.0);
    }

    #[test]
    fn history_follows_links_back_forward_and_reload() {
        let mut h = History::default();
        assert!(!h.can_go_back() && !h.can_go_forward());
        h.committed("https://a.test/");
        h.committed("https://b.test/");
        h.committed("https://b.test/");
        assert!(h.can_go_back() && !h.can_go_forward());
        assert!(h.request_back());
        h.committed("https://a.test/");
        assert_eq!(h.current(), Some("https://a.test/"));
        assert!(!h.can_go_back() && h.can_go_forward());
        assert!(h.request_forward());
        h.committed("https://b.test/");
        assert_eq!(h.current(), Some("https://b.test/"));
        // A new page after going back drops the forward entries.
        assert!(h.request_back());
        h.committed("https://a.test/");
        h.committed("https://c.test/");
        assert!(!h.can_go_forward());
        assert_eq!(h.current(), Some("https://c.test/"));
        assert!(!History::default().request_back());
    }

    #[test]
    fn history_is_bounded() {
        let mut h = History::default();
        for i in 0..250 {
            h.committed(&format!("https://h{i}.test/"));
        }
        assert_eq!(h.current(), Some("https://h249.test/"));
        assert!(h.entries.len() <= MAX_HISTORY);
    }

    #[test]
    fn popups_are_rate_limited() {
        let mut r = RateLimit::new(3, Duration::from_secs(10));
        let t0 = Instant::now();
        assert!(r.allow(t0) && r.allow(t0) && r.allow(t0));
        assert!(!r.allow(t0 + Duration::from_secs(1)));
        assert!(r.allow(t0 + Duration::from_secs(11)));
    }

    #[test]
    fn download_names_are_safe_and_unique() {
        assert_eq!(safe_file_name("../../etc/passwd"), "passwd");
        assert_eq!(safe_file_name("C:\\Windows\\evil.exe"), "evil.exe");
        assert_eq!(safe_file_name(".bashrc"), "bashrc");
        assert_eq!(safe_file_name("a\u{0}b:c.txt"), "abc.txt");
        assert_eq!(safe_file_name("   "), "download");
        assert_eq!(safe_file_name("/"), "download");
        assert_eq!(safe_file_name(&"x".repeat(500)).chars().count(), 120);
        let folder = Path::new(if cfg!(windows) { "C:\\dl" } else { "/dl" });
        let taken = |p: &Path| p.ends_with("a.zip") || p.ends_with("a (2).zip");
        assert_eq!(
            download_destination(folder, "a.zip", taken),
            Some(folder.join("a (3).zip"))
        );
        assert_eq!(
            download_destination(folder, "../b.zip", |_| false),
            Some(folder.join("b.zip"))
        );
        assert_eq!(download_destination(Path::new("rel"), "a", |_| false), None);
    }

    #[test]
    fn the_radar_link_has_one_exact_shape() {
        let good = "phoenix://browser/open?url=http%3A%2F%2Flocalhost%3A3000%2Fapp";
        assert_eq!(
            radar_link(good).as_deref(),
            Some("http://localhost:3000/app")
        );
        for bad in [
            "phoenix://browser/open?url=http%3A%2F%2Fexample.com%3A3000%2F",
            "phoenix://browser/open?url=file%3A%2F%2F%2Fetc%2Fpasswd",
            "phoenix://browser/open?url=http%3A%2F%2Flocalhost%3A3000%2F&x=1",
            "phoenix://browser/open?x=http%3A%2F%2Flocalhost%3A3000%2F",
            "phoenix://browser/open#http://localhost:3000/",
            "phoenix://browser/other?url=http%3A%2F%2Flocalhost%3A3000%2F",
            "phoenix://approvals/open?url=http%3A%2F%2Flocalhost%3A3000%2F",
            "https://browser/open?url=http%3A%2F%2Flocalhost%3A3000%2F",
            "phoenix://browser/open",
        ] {
            assert_eq!(radar_link(bad), None, "{bad}");
        }
    }

    #[test]
    fn the_port_radar_opens_only_loopback_dev_servers_never_core() {
        let ok = |u: &str| port_radar_origin(u, 4870);
        assert_eq!(
            ok("http://127.0.0.1:3000/"),
            Some(("127.0.0.1".into(), 3000))
        );
        assert_eq!(
            ok("http://localhost:5173/x?y=1"),
            Some(("localhost".into(), 5173))
        );
        assert_eq!(ok("https://[::1]:8443/"), Some(("[::1]".into(), 8443)));
        // The URL parser normalises obfuscated IPv4, so this is exactly 127.0.0.1:3000.
        assert_eq!(
            ok("http://2130706433:3000/"),
            Some(("127.0.0.1".into(), 3000))
        );
        for bad in [
            "http://127.0.0.1:4870/",
            "http://127.0.0.1/",
            "http://127.0.0.1:0/",
            "http://192.168.1.5:3000/",
            "http://0.0.0.0:3000/",
            "http://example.com:3000/",
            "http://127.0.0.1.evil.test:3000/",
            "http://user:pw@127.0.0.1:3000/",
            "ftp://127.0.0.1:3000/",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "",
        ] {
            assert_eq!(ok(bad), None, "{bad}");
        }
        let origin = ("localhost".to_string(), 3000);
        assert!(same_radar_origin(
            &Url::parse("http://localhost:3000/a").unwrap(),
            &origin
        ));
        assert!(!same_radar_origin(
            &Url::parse("http://localhost:3001/").unwrap(),
            &origin
        ));
        assert!(!same_radar_origin(
            &Url::parse("http://127.0.0.1:3000/").unwrap(),
            &origin
        ));
    }
}
