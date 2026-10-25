// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Phase 93: the enforcement port of the TypeScript policy in `apps/web/src/core/browser/`
//! (`network.ts`, `navigation.ts`, `site.ts`, `permissions.ts`). Pure: no I/O, no clock.
//!
//! The TypeScript is the specification. `tests/fixtures/browser-policy-vectors.json` (in
//! `apps/web/test/fixtures/`) is read by BOTH `apps/web/test/browser-policy.test.ts` and the tests
//! at the bottom of this file, so the two implementations cannot drift apart unnoticed.
//!
//! Differences from the TypeScript, on purpose:
//! - [`Denial::DnsPrivate`] exists only here: a public name that RESOLVED to a private address.
//! - [`classify_ip`] classifies an already-parsed (resolved) address with the same tables.
//! - `registrable_domain` uses the same small built-in suffix list as `site.ts`, NOT the Public
//!   Suffix List (no PSL crate is in the lockfile; adding one was not justified for this slice).

use serde::Deserialize;
use std::net::IpAddr;
use url::Url;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PrivateReason {
    Loopback,
    PrivateRange,
    LinkLocal,
    SharedAddress,
    Unspecified,
    Multicast,
    Reserved,
    LocalName,
}

impl PrivateReason {
    pub fn as_str(self) -> &'static str {
        match self {
            PrivateReason::Loopback => "loopback",
            PrivateReason::PrivateRange => "private_range",
            PrivateReason::LinkLocal => "link_local",
            PrivateReason::SharedAddress => "shared_address",
            PrivateReason::Unspecified => "unspecified",
            PrivateReason::Multicast => "multicast",
            PrivateReason::Reserved => "reserved",
            PrivateReason::LocalName => "local_name",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostClass {
    Public,
    Private(PrivateReason),
}

use HostClass::{Private, Public};

/// Names that never resolve on the public internet. A single label (`router`) is an intranet name.
const LOCAL_SUFFIXES: [&str; 10] = [
    "localhost",
    "local",
    "internal",
    "lan",
    "home.arpa",
    "intranet",
    "corp",
    "home",
    "private",
    "localdomain",
];

/// `Ok(None)`: not an IPv4 address. `Err(())`: ends in a number but is not valid (refuse it).
fn parse_ipv4(host: &str) -> Result<Option<[u8; 4]>, ()> {
    let mut parts: Vec<&str> = host.split('.').collect();
    if parts.last() == Some(&"") {
        parts.pop();
    }
    let is_number = |p: &str| {
        let lower = p.to_ascii_lowercase();
        if let Some(hex) = lower.strip_prefix("0x") {
            hex.bytes().all(|b| b.is_ascii_hexdigit())
        } else {
            !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit())
        }
    };
    let Some(last) = parts.last() else {
        return Ok(None);
    };
    if !is_number(last) {
        return Ok(None);
    }
    if parts.len() > 4 {
        return Err(());
    }
    let mut numbers: Vec<u64> = Vec::new();
    for part in &parts {
        let lower = part.to_ascii_lowercase();
        let value = if let Some(hex) = lower.strip_prefix("0x") {
            if hex.is_empty() {
                0
            } else {
                u64::from_str_radix(hex, 16).map_err(|_| ())?
            }
        } else if part.len() > 1
            && part.starts_with('0')
            && part.bytes().all(|b| (b'0'..=b'7').contains(&b))
        {
            u64::from_str_radix(part, 8).map_err(|_| ())?
        } else if part.bytes().all(|b| b.is_ascii_digit()) && !part.is_empty() {
            part.parse::<u64>().map_err(|_| ())?
        } else {
            return Err(());
        };
        // Same bound as Number.isSafeInteger in the TypeScript.
        if value > (1u64 << 53) - 1 {
            return Err(());
        }
        numbers.push(value);
    }
    let tail = numbers.pop().ok_or(())?;
    if numbers.iter().any(|n| *n > 255) {
        return Err(());
    }
    if tail >= 256u64.pow(5 - parts.len() as u32) {
        return Err(());
    }
    let mut address = tail;
    for (i, n) in numbers.iter().enumerate() {
        address += n * 256u64.pow(3 - i as u32);
    }
    Ok(Some([
        (address >> 24) as u8,
        (address >> 16) as u8,
        (address >> 8) as u8,
        address as u8,
    ]))
}

fn classify_ipv4([a, b, c, _]: [u8; 4]) -> HostClass {
    match (a, b, c) {
        (0, _, _) => Private(PrivateReason::Unspecified),
        (127, _, _) => Private(PrivateReason::Loopback),
        (10, _, _) => Private(PrivateReason::PrivateRange),
        (172, 16..=31, _) => Private(PrivateReason::PrivateRange),
        (192, 168, _) => Private(PrivateReason::PrivateRange),
        (169, 254, _) => Private(PrivateReason::LinkLocal),
        (100, 64..=127, _) => Private(PrivateReason::SharedAddress),
        (224..=239, _, _) => Private(PrivateReason::Multicast),
        (240..=255, _, _) => Private(PrivateReason::Reserved),
        (192, 0, 0 | 2) => Private(PrivateReason::Reserved),
        (192, 88, 99) => Private(PrivateReason::Reserved),
        (198, 18 | 19, _) => Private(PrivateReason::Reserved),
        (198, 51, 100) => Private(PrivateReason::Reserved),
        (203, 0, 113) => Private(PrivateReason::Reserved),
        _ => Public,
    }
}

/// Eight 16-bit groups, or `None` when the text is not a valid IPv6 address.
fn parse_ipv6(text: &str) -> Option<[u16; 8]> {
    let mut source = text.to_string();
    // An embedded dotted IPv4 tail (::ffff:127.0.0.1) becomes two hex groups.
    if let Some(dot) = source
        .rfind(':')
        .map(|i| i + 1)
        .filter(|_| source.contains('.'))
    {
        let tail = &source[dot..];
        let octets: Vec<&str> = tail.split('.').collect();
        if octets.len() == 4
            && octets
                .iter()
                .all(|o| !o.is_empty() && o.bytes().all(|b| b.is_ascii_digit()))
        {
            let mut v = [0u32; 4];
            for (i, o) in octets.iter().enumerate() {
                v[i] = o.parse::<u32>().ok().filter(|n| *n <= 255)?;
            }
            source = format!(
                "{}{:x}:{:x}",
                &source[..dot],
                (v[0] << 8) | v[1],
                (v[2] << 8) | v[3]
            );
        } else {
            return None;
        }
    }
    let halves: Vec<&str> = source.split("::").collect();
    if halves.len() > 2 {
        return None;
    }
    let to_groups = |part: &str| -> Option<Vec<u16>> {
        if part.is_empty() {
            return Some(Vec::new());
        }
        part.split(':')
            .map(|g| {
                (!g.is_empty() && g.len() <= 4 && g.bytes().all(|b| b.is_ascii_hexdigit()))
                    .then(|| u16::from_str_radix(g, 16).ok())
                    .flatten()
            })
            .collect()
    };
    let head = to_groups(halves[0])?;
    if halves.len() == 1 {
        return <[u16; 8]>::try_from(head).ok();
    }
    let tail = to_groups(halves[1])?;
    if head.len() + tail.len() > 7 {
        return None;
    }
    let mut groups = head.clone();
    groups.extend(std::iter::repeat_n(0, 8 - head.len() - tail.len()));
    groups.extend(tail);
    <[u16; 8]>::try_from(groups).ok()
}

fn embedded_ipv4(g: &[u16; 8], hi: usize) -> [u8; 4] {
    let (x, y) = (g[hi], g[hi + 1]);
    [(x >> 8) as u8, x as u8, (y >> 8) as u8, y as u8]
}

fn classify_ipv6(g: &[u16; 8]) -> HostClass {
    let upper_zero = g[..5].iter().all(|x| *x == 0);
    if upper_zero && g[5] == 0 && g[6] == 0 && g[7] == 0 {
        return Private(PrivateReason::Unspecified);
    }
    if upper_zero && g[5] == 0 && g[6] == 0 && g[7] == 1 {
        return Private(PrivateReason::Loopback);
    }
    // ::ffff:a.b.c.d (IPv4-mapped) and ::a.b.c.d (deprecated IPv4-compatible).
    if upper_zero && (g[5] == 0xffff || g[5] == 0) {
        return classify_ipv4(embedded_ipv4(g, 6));
    }
    // NAT64 well-known prefix 64:ff9b::/96.
    if g[0] == 0x64 && g[1] == 0xff9b && g[2..6].iter().all(|x| *x == 0) {
        return classify_ipv4(embedded_ipv4(g, 6));
    }
    // 6to4 2002::/16 carries the IPv4 address in bits 16-47.
    if g[0] == 0x2002 {
        return classify_ipv4(embedded_ipv4(g, 1));
    }
    if g[0] & 0xffc0 == 0xfe80 {
        return Private(PrivateReason::LinkLocal);
    }
    if g[0] & 0xfe00 == 0xfc00 {
        return Private(PrivateReason::PrivateRange);
    }
    if g[0] & 0xff00 == 0xff00 {
        return Private(PrivateReason::Multicast);
    }
    if g[0] == 0x2001 && (g[1] == 0 || g[1] == 0xdb8) {
        return Private(PrivateReason::Reserved);
    }
    Public
}

/// Whether a host names a machine on the user's own computer or network. Pass `Url::host_str()`.
/// This sees NAMES only; DNS rebinding is handled by [`classify_ip`] on the resolved address.
pub fn classify_host(hostname: &str) -> HostClass {
    let mut host = hostname.to_lowercase();
    if host.starts_with('[') && host.ends_with(']') {
        return match parse_ipv6(&host[1..host.len() - 1]) {
            Some(groups) => classify_ipv6(&groups),
            None => Private(PrivateReason::Reserved),
        };
    }
    while host.ends_with('.') {
        host.pop();
    }
    if host.is_empty() {
        return Private(PrivateReason::Reserved);
    }
    match parse_ipv4(&host) {
        Err(()) => return Private(PrivateReason::Reserved),
        Ok(Some(v4)) => return classify_ipv4(v4),
        Ok(None) => {}
    }
    if !host.contains('.') {
        return Private(PrivateReason::LocalName);
    }
    for suffix in LOCAL_SUFFIXES {
        if host == suffix || host.ends_with(&format!(".{suffix}")) {
            return Private(PrivateReason::LocalName);
        }
    }
    Public
}

/// The same tables applied to a RESOLVED address (what the connection would really reach).
pub fn classify_ip(ip: IpAddr) -> HostClass {
    match ip {
        IpAddr::V4(v4) => classify_ipv4(v4.octets()),
        IpAddr::V6(v6) => classify_ipv6(&v6.segments()),
    }
}

/// True for 127.0.0.0/8, ::1 and the IPv4-mapped forms of them.
pub fn is_loopback_ip(ip: IpAddr) -> bool {
    matches!(classify_ip(ip), Private(PrivateReason::Loopback))
}

/// Ports a browser must not talk to (WHATWG Fetch "bad ports").
const BAD_PORTS: &[u16] = &[
    1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
    103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
    512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
    995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
    6679, 6697, 10080,
];

pub fn is_bad_port(port: u16) -> bool {
    BAD_PORTS.contains(&port)
}

// ---------------------------------------------------------------------------------------------
// site.ts
// ---------------------------------------------------------------------------------------------

/// Two-label public suffixes the registrable-domain heuristic knows about (same list as
/// `site.ts`; NOT the Public Suffix List).
const TWO_LABEL_SUFFIXES: [&str; 37] = [
    "co.uk",
    "org.uk",
    "ac.uk",
    "gov.uk",
    "me.uk",
    "com.au",
    "net.au",
    "org.au",
    "co.nz",
    "co.jp",
    "ne.jp",
    "or.jp",
    "co.in",
    "co.kr",
    "co.za",
    "com.br",
    "com.cn",
    "com.mx",
    "com.tr",
    "com.sg",
    "com.hk",
    "com.tw",
    "com.ar",
    "github.io",
    "gitlab.io",
    "vercel.app",
    "netlify.app",
    "pages.dev",
    "workers.dev",
    "herokuapp.com",
    "web.app",
    "firebaseapp.com",
    "blogspot.com",
    "azurewebsites.net",
    "appspot.com",
    "fly.dev",
    "onrender.com",
];

/// eTLD+1 for DNS names; IP literals and intranet names are their own site.
pub fn registrable_domain(hostname: &str) -> String {
    let lower = hostname.to_lowercase();
    let host = lower.strip_suffix('.').unwrap_or(&lower);
    if host.starts_with('[')
        || (!host.is_empty() && host.bytes().all(|b| b.is_ascii_digit() || b == b'.'))
        || !host.contains('.')
    {
        return host.to_string();
    }
    let labels: Vec<&str> = host.split('.').collect();
    if labels.len() <= 2 {
        return host.to_string();
    }
    let last_two = labels[labels.len() - 2..].join(".");
    if TWO_LABEL_SUFFIXES.contains(&last_two.as_str()) {
        labels[labels.len() - 3..].join(".")
    } else {
        last_two
    }
}

/// True when `host` is `site` or one of its subdomains.
pub fn host_matches_site(host: &str, site: &str) -> bool {
    let (h, s) = (host.to_lowercase(), site.to_lowercase());
    h == s || h.ends_with(&format!(".{s}"))
}

// ---------------------------------------------------------------------------------------------
// navigation.ts
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Intent {
    Typed,
    Link,
    Redirect,
    Subresource,
    NewWindow,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Denial {
    Unparseable,
    SchemeNotAllowed,
    DangerousScheme,
    FileBlocked,
    CredentialsInUrl,
    PrivateNetwork,
    BadPort,
    InsecureBlocked,
    SiteDenied,
    /// Rust only: a public NAME that resolved to a private address (DNS rebinding).
    DnsPrivate,
    /// Rust only: the name did not resolve in time (fail closed: the webview would resolve it itself).
    DnsFailed,
}

impl Denial {
    /// The id the chrome page and `navigation.ts` use.
    pub fn as_str(self) -> &'static str {
        match self {
            Denial::Unparseable => "unparseable",
            Denial::SchemeNotAllowed => "scheme_not_allowed",
            Denial::DangerousScheme => "dangerous_scheme",
            Denial::FileBlocked => "file_blocked",
            Denial::CredentialsInUrl => "credentials_in_url",
            Denial::PrivateNetwork => "private_network",
            Denial::BadPort => "bad_port",
            Denial::InsecureBlocked => "insecure_blocked",
            Denial::SiteDenied => "site_denied",
            Denial::DnsPrivate => "dns_private",
            Denial::DnsFailed => "dns_failed",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Decision {
    Allow {
        url: String,
        upgraded: bool,
    },
    Deny {
        reason: Denial,
        private_reason: Option<PrivateReason>,
    },
}

impl Decision {
    fn deny(reason: Denial) -> Self {
        Decision::Deny {
            reason,
            private_reason: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Policy {
    pub allowed_schemes: Vec<String>,
    pub upgrade_http: bool,
    pub insecure_allowed_sites: Vec<String>,
    pub denied_sites: Vec<String>,
    pub private_network_allowed_sites: Vec<String>,
}

impl Default for Policy {
    fn default() -> Self {
        Policy {
            allowed_schemes: vec!["https".into()],
            upgrade_http: true,
            insecure_allowed_sites: Vec::new(),
            denied_sites: Vec::new(),
            private_network_allowed_sites: Vec::new(),
        }
    }
}

/// Schemes that execute code or carry the document itself; never navigable, whatever the policy.
const DANGEROUS_SCHEMES: [&str; 10] = [
    "javascript",
    "data",
    "blob",
    "vbscript",
    "filesystem",
    "view-source",
    "about",
    "tauri",
    "ipc",
    "asset",
];

fn allowed_by_site(host: &str, sites: &[String]) -> bool {
    sites.iter().any(|site| host_matches_site(host, site))
}

/// Port of `decideNavigation`. Same order of checks, same reasons.
pub fn decide_navigation(input: &str, policy: &Policy, intent: Intent) -> Decision {
    let Ok(mut url) = Url::parse(input.trim()) else {
        return Decision::deny(Denial::Unparseable);
    };
    let scheme = url.scheme().to_ascii_lowercase();
    if scheme == "file" {
        return Decision::deny(Denial::FileBlocked);
    }
    if DANGEROUS_SCHEMES.contains(&scheme.as_str()) {
        return Decision::deny(Denial::DangerousScheme);
    }
    let has_credentials = !url.username().is_empty() || url.password().is_some();
    if scheme != "http" && scheme != "https" {
        if !policy.allowed_schemes.contains(&scheme) {
            return Decision::deny(Denial::SchemeNotAllowed);
        }
        if has_credentials {
            return Decision::deny(Denial::CredentialsInUrl);
        }
        return Decision::Allow {
            url: url.to_string(),
            upgraded: false,
        };
    }
    if has_credentials {
        return Decision::deny(Denial::CredentialsInUrl);
    }
    let host = match url.host_str() {
        Some(h) if !h.is_empty() => h.to_lowercase(),
        _ => return Decision::deny(Denial::Unparseable),
    };
    if allowed_by_site(&host, &policy.denied_sites) {
        return Decision::deny(Denial::SiteDenied);
    }
    let class = classify_host(&host);
    if let Private(reason) = class {
        let listed = allowed_by_site(&host, &policy.private_network_allowed_sites);
        if intent != Intent::Typed || !listed {
            return Decision::Deny {
                reason: Denial::PrivateNetwork,
                private_reason: Some(reason),
            };
        }
    }
    if url.port().is_some_and(is_bad_port) {
        return Decision::deny(Denial::BadPort);
    }
    let allows_https = policy.allowed_schemes.iter().any(|s| s == "https");
    if scheme == "https" {
        if !allows_https {
            return Decision::deny(Denial::SchemeNotAllowed);
        }
        return Decision::Allow {
            url: url.to_string(),
            upgraded: false,
        };
    }
    // Plain http. A listed dev server or a vetted private-network host has no certificate.
    if allowed_by_site(&host, &policy.insecure_allowed_sites) || matches!(class, Private(_)) {
        return Decision::Allow {
            url: url.to_string(),
            upgraded: false,
        };
    }
    if policy.upgrade_http {
        if !allows_https {
            return Decision::deny(Denial::SchemeNotAllowed);
        }
        // `Url` drops a default port (80) when parsing, so only a non-default port survives.
        if url.set_scheme("https").is_err() {
            return Decision::deny(Denial::Unparseable);
        }
        return Decision::Allow {
            url: url.to_string(),
            upgraded: true,
        };
    }
    if policy.allowed_schemes.iter().any(|s| s == "http") {
        return Decision::Allow {
            url: url.to_string(),
            upgraded: false,
        };
    }
    Decision::deny(Denial::InsecureBlocked)
}

/// The resolved addresses of a name, checked with the same tables as the name itself. `Some`
/// when ANY address is private: a name that answers with one private address among public ones
/// is refused too, because the browser may connect to whichever it likes.
pub fn first_private_address(addresses: &[IpAddr]) -> Option<(IpAddr, PrivateReason)> {
    addresses.iter().find_map(|ip| match classify_ip(*ip) {
        Private(reason) => Some((*ip, reason)),
        Public => None,
    })
}

// ---------------------------------------------------------------------------------------------
// permissions.ts
// ---------------------------------------------------------------------------------------------

/// Mirrors `tauri::webview::PermissionKind` display names (`PERMISSION_KINDS`).
pub const PERMISSION_KINDS: [&str; 16] = [
    "microphone",
    "camera",
    "geolocation",
    "notifications",
    "clipboard-read",
    "display-capture",
    "midi",
    "sensors",
    "media-key-system-access",
    "local-fonts",
    "window-management",
    "pointer-lock",
    "automatic-downloads",
    "file-system-access",
    "autoplay",
    "other",
];

const NEVER_GRANTABLE: [&str; 8] = [
    "display-capture",
    "file-system-access",
    "automatic-downloads",
    "clipboard-read",
    "local-fonts",
    "window-management",
    "media-key-system-access",
    "other",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PermissionReason {
    DefaultDeny,
    UnknownKind,
    InsecureOrigin,
    PrivateOrigin,
    CrossOriginFrame,
    NoUserGesture,
    NeverGrantable,
    Granted,
}

impl PermissionReason {
    pub fn as_str(self) -> &'static str {
        match self {
            PermissionReason::DefaultDeny => "default_deny",
            PermissionReason::UnknownKind => "unknown_kind",
            PermissionReason::InsecureOrigin => "insecure_origin",
            PermissionReason::PrivateOrigin => "private_origin",
            PermissionReason::CrossOriginFrame => "cross_origin_frame",
            PermissionReason::NoUserGesture => "no_user_gesture",
            PermissionReason::NeverGrantable => "never_grantable",
            PermissionReason::Granted => "granted",
        }
    }
}

/// `(allow, reason)`.
pub type PermissionDecision = (bool, PermissionReason);

/// Default-deny, session-only grants of one origin and one kind. Nothing is persisted.
#[derive(Default, Debug)]
pub struct SitePermissions {
    grants: std::collections::HashMap<String, std::collections::HashSet<&'static str>>,
}

fn known_kind(kind: &str) -> Option<&'static str> {
    PERMISSION_KINDS.iter().copied().find(|k| *k == kind)
}

/// `https`, public host: the origin text, or the denial.
fn secure_public_origin(origin: &str) -> Result<String, PermissionReason> {
    let url = Url::parse(origin).map_err(|_| PermissionReason::InsecureOrigin)?;
    if url.scheme() != "https" {
        return Err(PermissionReason::InsecureOrigin);
    }
    let host = url.host_str().unwrap_or("");
    if matches!(classify_host(host), Private(_)) {
        return Err(PermissionReason::PrivateOrigin);
    }
    Ok(url.origin().ascii_serialization())
}

impl SitePermissions {
    pub fn decide(&self, kind: &str, top_origin: &str, frame_origin: &str) -> PermissionDecision {
        let Some(kind) = known_kind(kind) else {
            return (false, PermissionReason::UnknownKind);
        };
        let top = match secure_public_origin(top_origin) {
            Ok(t) => t,
            Err(reason) => return (false, reason),
        };
        if frame_origin != top_origin {
            return (false, PermissionReason::CrossOriginFrame);
        }
        if NEVER_GRANTABLE.contains(&kind) {
            return (false, PermissionReason::NeverGrantable);
        }
        if self
            .grants
            .get(&top)
            .is_some_and(|kinds| kinds.contains(kind))
        {
            return (true, PermissionReason::Granted);
        }
        (false, PermissionReason::DefaultDeny)
    }

    /// Record the person's choice. Call only from Phoenix's own prompt (`user_gesture`).
    pub fn grant(&mut self, origin: &str, kind: &str, user_gesture: bool) -> PermissionDecision {
        if !user_gesture {
            return (false, PermissionReason::NoUserGesture);
        }
        let Some(kind) = known_kind(kind) else {
            return (false, PermissionReason::UnknownKind);
        };
        if NEVER_GRANTABLE.contains(&kind) {
            return (false, PermissionReason::NeverGrantable);
        }
        match secure_public_origin(origin) {
            Ok(key) => {
                self.grants.entry(key).or_default().insert(kind);
                (true, PermissionReason::Granted)
            }
            Err(reason) => (false, reason),
        }
    }

    pub fn revoke(&mut self, origin: &str, kind: Option<&str>) {
        match kind {
            None => {
                self.grants.remove(origin);
            }
            Some(kind) => {
                if let Some(kinds) = self.grants.get_mut(origin) {
                    kinds.remove(kind);
                }
            }
        }
    }

    pub fn list(&self) -> Vec<(String, &'static str)> {
        let mut out: Vec<_> = self
            .grants
            .iter()
            .flat_map(|(o, ks)| ks.iter().map(move |k| (o.clone(), *k)))
            .collect();
        out.sort();
        out
    }

    pub fn clear(&mut self) {
        self.grants.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    /// The very file `apps/web/test/browser-policy.test.ts` reads.
    const VECTORS: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../web/test/fixtures/browser-policy-vectors.json"
    ));

    fn vectors() -> Value {
        serde_json::from_str(VECTORS).expect("fixture is JSON")
    }

    fn strings(v: &Value) -> Vec<&str> {
        v.as_array()
            .unwrap()
            .iter()
            .map(|s| s.as_str().unwrap())
            .collect()
    }

    #[test]
    fn classifies_every_shared_host_vector() {
        let v = vectors();
        for host in strings(&v["classify"]["private"]) {
            assert!(matches!(classify_host(host), Private(_)), "{host}");
        }
        for host in strings(&v["classify"]["public"]) {
            assert_eq!(classify_host(host), Public, "{host}");
        }
        for (host, reason) in v["classify"]["reasons"].as_object().unwrap() {
            match classify_host(host) {
                Private(r) => assert_eq!(r.as_str(), reason.as_str().unwrap(), "{host}"),
                Public => panic!("{host} classified public"),
            }
        }
    }

    /// `Url::host_str` is what `on_navigation` feeds in: the WHATWG parser normalises obfuscated
    /// IPv4, and the port must still see through it.
    #[test]
    fn sees_through_the_url_parsers_normalisation_of_obfuscated_ipv4() {
        for url in [
            "http://2130706433/",
            "http://0x7f000001/",
            "http://017700000001/",
        ] {
            let parsed = Url::parse(url).unwrap();
            assert_eq!(
                classify_host(parsed.host_str().unwrap()),
                Private(PrivateReason::Loopback),
                "{url}"
            );
        }
    }

    #[test]
    fn decides_every_shared_navigation_vector() {
        let v = vectors();
        for case in v["navigation"].as_array().unwrap() {
            let input = case["input"].as_str().unwrap();
            let intent: Intent = case
                .get("intent")
                .map(|i| serde_json::from_value(i.clone()).unwrap())
                .unwrap_or(Intent::Link);
            let policy: Policy = case
                .get("policy")
                .map(|p| serde_json::from_value(p.clone()).unwrap())
                .unwrap_or_default();
            let got = decide_navigation(input, &policy, intent);
            let want = &case["expect"];
            match got {
                Decision::Allow { url, upgraded } => {
                    assert_eq!(
                        want["allow"], true,
                        "{input}: allowed but expected a denial"
                    );
                    assert_eq!(want["url"].as_str().unwrap(), url, "{input}");
                    assert_eq!(want["upgraded"].as_bool().unwrap(), upgraded, "{input}");
                }
                Decision::Deny {
                    reason,
                    private_reason,
                } => {
                    assert_eq!(want["allow"], false, "{input}: denied but expected allow");
                    assert_eq!(want["reason"].as_str().unwrap(), reason.as_str(), "{input}");
                    assert_eq!(
                        want.get("privateReason").and_then(Value::as_str),
                        private_reason.map(PrivateReason::as_str),
                        "{input}"
                    );
                }
            }
        }
    }

    #[test]
    fn decides_every_shared_permission_vector() {
        let v = vectors();
        for case in v["permissions"].as_array().unwrap() {
            let mut p = SitePermissions::default();
            for g in case["grants"].as_array().unwrap() {
                p.grant(
                    g["origin"].as_str().unwrap(),
                    g["kind"].as_str().unwrap(),
                    g["gesture"].as_bool().unwrap(),
                );
            }
            let ask = &case["ask"];
            let (allow, reason) = p.decide(
                ask["kind"].as_str().unwrap(),
                ask["top"].as_str().unwrap(),
                ask["frame"].as_str().unwrap(),
            );
            let want = &case["expect"];
            let name = case["name"].as_str().unwrap();
            assert_eq!(
                want["verdict"].as_str().unwrap(),
                if allow { "allow" } else { "deny" },
                "{name}"
            );
            assert_eq!(want["reason"].as_str().unwrap(), reason.as_str(), "{name}");
        }
    }

    #[test]
    fn finds_every_shared_registrable_domain() {
        let v = vectors();
        for pair in v["registrable"].as_array().unwrap() {
            let (host, site) = (pair[0].as_str().unwrap(), pair[1].as_str().unwrap());
            assert_eq!(registrable_domain(host), site, "{host}");
        }
    }

    #[test]
    fn grants_are_session_only_and_revocable() {
        let mut p = SitePermissions::default();
        assert!(p.grant("https://example.com", "microphone", true).0);
        assert_eq!(
            p.list(),
            [("https://example.com".to_string(), "microphone")]
        );
        p.revoke("https://example.com", Some("microphone"));
        assert!(
            !p.decide("microphone", "https://example.com", "https://example.com")
                .0
        );
        p.grant("https://example.com", "camera", true);
        p.clear();
        assert!(p.list().is_empty());
    }

    #[test]
    fn a_resolved_private_address_is_refused_even_beside_public_ones() {
        let public: IpAddr = "93.184.216.34".parse().unwrap();
        let loopback: IpAddr = "127.0.0.1".parse().unwrap();
        let mapped: IpAddr = "::ffff:10.0.0.1".parse().unwrap();
        let v6: IpAddr = "2606:4700::1111".parse().unwrap();
        assert_eq!(first_private_address(&[public, v6]), None);
        assert_eq!(
            first_private_address(&[public, loopback]),
            Some((loopback, PrivateReason::Loopback))
        );
        assert_eq!(
            first_private_address(&[mapped]),
            Some((mapped, PrivateReason::PrivateRange))
        );
        assert!(is_loopback_ip(loopback));
        assert!(!is_loopback_ip(public));
    }

    #[test]
    fn the_never_grantable_list_matches_the_typescript() {
        let ts = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../web/src/core/browser/permissions.ts"
        ))
        .unwrap();
        let block = ts
            .split("const NEVER_GRANTABLE")
            .nth(1)
            .and_then(|s| s.split("};").next())
            .unwrap();
        for kind in NEVER_GRANTABLE {
            let key = if kind == "other" {
                "other: true".to_string()
            } else {
                format!("\"{kind}\": true")
            };
            assert!(block.contains(&key), "{kind} missing in permissions.ts");
        }
        assert_eq!(block.matches(": true").count(), NEVER_GRANTABLE.len());
        for kind in PERMISSION_KINDS {
            assert!(ts.contains(&format!("\"{kind}\"")), "{kind}");
        }
    }
}
