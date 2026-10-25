// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Phase 93: turns Adblock-syntax filter list text (the lists Core stores, see `docs/filter-lists.md`)
//! into a WebKit content rule list (`WKContentRuleList` JSON). Pure text in, text and a report out.
//!
//! This is a TRANSLATION of the subset the TypeScript `RequestBlocker` understands, not a port of its
//! matcher: WebKit evaluates the rules inside the web content process. Where WebKit's format cannot
//! say what an Adblock rule says, the rule is **skipped and counted** (never widened):
//!
//! - cosmetic/scriptlet lines, regex rules, `$important`, `$redirect`, `$csp`, `$popup`, ... as in TS;
//! - `$websocket`, `$ping`, `$other` (no portable WebKit resource type) and `$subdocument` mixed with
//!   other types;
//! - `domain=` lists that mix include and exclude entries (WebKit forbids both in one trigger) or
//!   hold a wildcard or non-ASCII entry; `@@...$document` whole-site exceptions;
//! - patterns with non-ASCII characters.
//!
//! Known approximations (all err towards blocking LESS): a trailing `^` needs one more character in
//! the URL, which is true for every host-only URL WebKit normalises but not for a URL that ends
//! exactly at the pattern; with no type option a rule covers `image`, `style-sheet`, `script`, `font`,
//! `raw` (XHR and fetch), `svg-document` and `media`, so requests WebKit files under `ping`, `other`
//! or `websocket` are not blocked.
//!
//! WebKit refuses a list of more than [`WEBKIT_RULE_LIMIT`] rules. [`convert`] keeps a deterministic
//! prefix and reports what it dropped: exceptions first (at most [`MAX_EXCEPTIONS`]), then blocking
//! rules in the order the lists were given.

use serde::Serialize;
use std::collections::HashSet;

/// Phoenix-authored starter rules (same text as `STARTER_RULES` in `blocklist.ts`, checked by a
/// test): used only while no downloaded list contributes a rule.
pub const STARTER_RULES: &str = "||doubleclick.net^\n||googlesyndication.com^\n||googleadservices.com^\n||google-analytics.com^\n||googletagmanager.com^$third-party\n||googletagservices.com^\n||adservice.google.com^\n||connect.facebook.net^$third-party\n||facebook.com/tr^$third-party\n||scorecardresearch.com^\n||quantserve.com^\n||hotjar.com^$third-party\n||amplitude.com^$third-party\n||mixpanel.com^$third-party\n||segment.io^$third-party\n||adnxs.com^\n||criteo.com^\n||taboola.com^$third-party\n||outbrain.com^$third-party\n||ads-twitter.com^\n||analytics.tiktok.com^";

/// WebKit's documented maximum number of rules in one content rule list.
pub const WEBKIT_RULE_LIMIT: usize = 150_000;
/// Exceptions kept before blocking rules are counted against the limit.
pub const MAX_EXCEPTIONS: usize = 10_000;
/// A rule line longer than this is dropped (same bound as `blocklist.ts`).
const MAX_RULE_LENGTH: usize = 16 * 1024;
/// The URL pattern itself (before `$options`).
const MAX_PATTERN_LENGTH: usize = 512;
const MAX_WILDCARDS: usize = 8;
const MAX_DOMAINS_PER_RULE: usize = 1024;

/// What a rule without a type option covers (everything but `document` and `popup`).
const DEFAULT_TYPES: [&str; 7] = [
    "image",
    "style-sheet",
    "script",
    "font",
    "raw",
    "svg-document",
    "media",
];

#[derive(Serialize)]
struct Trigger {
    #[serde(rename = "url-filter")]
    url_filter: String,
    #[serde(rename = "resource-type", skip_serializing_if = "Vec::is_empty")]
    resource_type: Vec<&'static str>,
    #[serde(rename = "load-type", skip_serializing_if = "Vec::is_empty")]
    load_type: Vec<&'static str>,
    #[serde(rename = "load-context", skip_serializing_if = "Vec::is_empty")]
    load_context: Vec<&'static str>,
    #[serde(rename = "if-domain", skip_serializing_if = "Vec::is_empty")]
    if_domain: Vec<String>,
    #[serde(rename = "unless-domain", skip_serializing_if = "Vec::is_empty")]
    unless_domain: Vec<String>,
}

#[derive(Serialize)]
struct Action {
    #[serde(rename = "type")]
    kind: &'static str,
}

#[derive(Serialize)]
struct Rule {
    trigger: Trigger,
    action: Action,
}

/// How the lines of the lists were handled. Every line lands in exactly one of the first five
/// counters; `duplicates` counts converted rules identical to an earlier one.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RulesReport {
    /// Network rules converted (blocking and exceptions, before the limit and de-duplication).
    pub converted: u32,
    /// Cosmetic, scriptlet and HTML-filter lines (need page access; ignored).
    pub cosmetic: u32,
    /// Rules WebKit's format cannot express faithfully, or that are over a size bound.
    pub unsupported: u32,
    /// Comments, headers and blank lines.
    pub ignored: u32,
    pub duplicates: u32,
    /// Rules in the compiled list, blocking and exception.
    pub kept_blocking: u32,
    pub kept_exceptions: u32,
    /// Rules dropped to stay within the limit (deterministic: the tail of the given order).
    pub truncated_blocking: u32,
    pub truncated_exceptions: u32,
    /// Fixed rules (private-network block, local-page exemptions, Core port block): they count
    /// against the limit before any list rule does.
    pub fixed_rules: u32,
    /// Per-site "shields off" rules appended after the list rules.
    pub site_exemptions: u32,
    /// Off-list entries that were unusable or over [`MAX_SITE_EXEMPTIONS`].
    pub site_exemptions_dropped: u32,
    /// The limit applied.
    pub limit: u32,
}

pub struct Converted {
    pub json: String,
    pub report: RulesReport,
}

enum Line {
    Rule { exception: bool, rule: Rule },
    Cosmetic,
    Unsupported,
    Ignored,
}

/// `##`, `#@#`, `#?#`, `#$#`, `#%#`, `#@$#` and `$$` (the TypeScript `COSMETIC` pattern).
fn is_cosmetic(text: &str) -> bool {
    if text.contains("$$") || text.contains("##") {
        return true;
    }
    ["#@#", "#?#", "#$#", "#%#", "#@$#"]
        .iter()
        .any(|marker| text.contains(marker))
}

fn wk_types(option: &str) -> Option<Vec<&'static str>> {
    Some(match option {
        "document" => vec!["document"],
        "script" => vec!["script"],
        "stylesheet" => vec!["style-sheet"],
        "image" => vec!["image", "svg-document"],
        "font" => vec!["font"],
        "media" => vec!["media"],
        "xmlhttprequest" | "xhr" => vec!["raw"],
        _ => return None,
    })
}

/// Escapes one literal character for WebKit's `url-filter` regular expression subset.
fn push_literal(out: &mut String, c: char) {
    if matches!(
        c,
        '.' | '+' | '?' | '*' | '[' | ']' | '(' | ')' | '{' | '}' | '|' | '\\' | '^' | '$'
    ) {
        out.push('\\');
    }
    out.push(c);
}

/// The `url-filter` for an Adblock pattern (already stripped of `@@` and `$options`), or `None`.
fn url_filter(pattern: &str) -> Option<String> {
    let mut rest = pattern;
    let mut host_anchor = false;
    let mut start_anchor = false;
    if let Some(r) = rest.strip_prefix("||") {
        host_anchor = true;
        rest = r;
    } else if let Some(r) = rest.strip_prefix('|') {
        start_anchor = true;
        rest = r;
    }
    let mut end_anchor = false;
    if let Some(r) = rest.strip_suffix('|') {
        end_anchor = true;
        rest = r;
    }
    let mut collapsed = String::with_capacity(rest.len());
    for c in rest.chars() {
        if c == '*' && collapsed.ends_with('*') {
            continue;
        }
        collapsed.push(c);
    }
    let lower = collapsed.to_lowercase();
    if lower.matches('*').count() > MAX_WILDCARDS {
        return None;
    }
    // A pattern of nothing but anchors and wildcards would match every URL.
    if lower.chars().all(|c| c == '*') {
        return None;
    }
    if !lower.is_ascii() || lower.chars().any(|c| c.is_ascii_control() || c == ' ') {
        return None;
    }
    let mut out = String::new();
    if host_anchor {
        // Start of the host, or just after a dot of it: scheme, then optional leading labels.
        out.push_str("^[^:/?#]+://+([^/?#:]+\\.)?");
    } else if start_anchor {
        out.push('^');
    }
    for c in lower.chars() {
        match c {
            '*' => out.push_str(".*"),
            '^' => out.push_str("[^a-z0-9_.%-]"),
            c => push_literal(&mut out, c),
        }
    }
    if end_anchor {
        out.push('$');
    }
    // An unanchored leading or trailing `.*` is the same as nothing, and WebKit dislikes it.
    if !host_anchor && !start_anchor {
        while let Some(r) = out.strip_prefix(".*") {
            out = r.to_string();
        }
    }
    if !end_anchor {
        while let Some(r) = out.strip_suffix(".*") {
            if r.ends_with('\\') {
                break;
            }
            out = r.to_string();
        }
    }
    (!out.is_empty() && out.len() <= 2 * MAX_PATTERN_LENGTH).then_some(out)
}

fn parse_line(raw: &str) -> Line {
    let text = raw.trim();
    if text.is_empty() || text.starts_with('!') || (text.starts_with('[') && text.ends_with(']')) {
        return Line::Ignored;
    }
    if is_cosmetic(text) {
        return Line::Cosmetic;
    }
    if text.len() > MAX_RULE_LENGTH {
        return Line::Unsupported;
    }
    let (exception, mut body) = match text.strip_prefix("@@") {
        Some(rest) => (true, rest),
        None => (false, text),
    };
    let mut options = "";
    let regex_form = body.starts_with('/') && body.ends_with('/');
    if let Some(dollar) = body.rfind('$').filter(|_| !regex_form) {
        options = &body[dollar + 1..];
        body = &body[..dollar];
    }
    if (body.starts_with('/') && body.ends_with('/') && body.len() > 1)
        || body.len() > MAX_PATTERN_LENGTH
    {
        return Line::Unsupported;
    }
    let mut third_party: Option<bool> = None;
    let mut types: Vec<&'static str> = Vec::new();
    let mut not_types: Vec<&'static str> = Vec::new();
    let mut subdocument = false;
    let mut include: Vec<String> = Vec::new();
    let mut exclude: Vec<String> = Vec::new();
    for option in options.split(',').filter(|_| !options.is_empty()) {
        let name = option.trim().to_lowercase();
        match name.as_str() {
            "third-party" | "3p" => third_party = Some(true),
            "~third-party" | "~3p" | "first-party" => third_party = Some(false),
            "match-case" | "" => {}
            "subdocument" => subdocument = true,
            "websocket" | "ping" | "other" | "~subdocument" | "~websocket" | "~ping" | "~other" => {
                return Line::Unsupported
            }
            n if n.starts_with("domain=") => {
                for domain in n["domain=".len()..].split('|').filter(|d| !d.is_empty()) {
                    let (negated, d) = match domain.strip_prefix('~') {
                        Some(d) => (true, d),
                        None => (false, domain),
                    };
                    let usable = !d.is_empty()
                        && d.is_ascii()
                        && !d.contains(['*', '/', ' '])
                        && d.chars().all(|c| !c.is_ascii_control());
                    if !usable {
                        return Line::Unsupported;
                    }
                    if negated {
                        exclude.push(format!("*{d}"));
                    } else {
                        include.push(format!("*{d}"));
                    }
                    if include.len() + exclude.len() > MAX_DOMAINS_PER_RULE {
                        return Line::Unsupported;
                    }
                }
            }
            n => {
                if let Some(t) = wk_types(n) {
                    types.extend(t);
                } else if let Some(t) = n.strip_prefix('~').and_then(wk_types) {
                    not_types.extend(t);
                } else {
                    // important, redirect, csp, removeparam, popup...: dropping it would widen the rule.
                    return Line::Unsupported;
                }
            }
        }
    }
    if !include.is_empty() && !exclude.is_empty() {
        return Line::Unsupported;
    }
    let mut load_context = Vec::new();
    if subdocument {
        // `document` with child-frame context; any other type in the same rule cannot share it.
        if !types.is_empty() || !not_types.is_empty() || exception {
            return Line::Unsupported;
        }
        types = vec!["document"];
        load_context = vec!["child-frame"];
    }
    if exception && types.contains(&"document") {
        // `@@...$document` switches blocking off for a whole site; WebKit's exception would only
        // cover the document load itself, which blocks nothing. Refuse rather than mislead.
        return Line::Unsupported;
    }
    let resource_type = if types.is_empty() {
        DEFAULT_TYPES
            .iter()
            .copied()
            .filter(|t| !not_types.contains(t))
            .collect()
    } else {
        let mut kept: Vec<&'static str> = types
            .into_iter()
            .filter(|t| !not_types.contains(t))
            .collect();
        kept.dedup();
        kept
    };
    if resource_type.is_empty() {
        return Line::Unsupported;
    }
    let Some(url_filter) = url_filter(body) else {
        return Line::Unsupported;
    };
    Line::Rule {
        exception,
        rule: Rule {
            trigger: Trigger {
                url_filter,
                resource_type,
                load_type: match third_party {
                    Some(true) => vec!["third-party"],
                    Some(false) => vec!["first-party"],
                    None => Vec::new(),
                },
                load_context,
                if_domain: include,
                unless_domain: exclude,
            },
            action: Action {
                kind: if exception {
                    "ignore-previous-rules"
                } else {
                    "block"
                },
            },
        },
    }
}

/// Shields-off entries kept in the list itself; more are dropped and reported.
pub const MAX_SITE_EXEMPTIONS: usize = 600;

/// A site whose own pages are not filtered (the per-site off-list, the music connector's hosts).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Exemption {
    pub host: String,
    /// `true`: the host and its subdomains (a registrable domain from the off-list); `false`: this
    /// exact host (the music connector policy never trusts subdomains).
    pub subdomains: bool,
}

/// What [`convert`] needs besides the list text.
#[derive(Clone, Debug)]
pub struct Options {
    pub exemptions: Vec<Exemption>,
    /// Phoenix Core's loopback port: always blocked as a subresource target, even from a local page.
    pub core_port: Option<u16>,
    pub limit: usize,
}

fn bare_rule(url_filter: &str, kind: &'static str) -> Rule {
    Rule {
        trigger: Trigger {
            url_filter: url_filter.to_string(),
            resource_type: Vec::new(),
            load_type: Vec::new(),
            load_context: Vec::new(),
            if_domain: Vec::new(),
            unless_domain: Vec::new(),
        },
        action: Action { kind },
    }
}

/// The last rule for a site: everything before it is ignored for pages of that site.
fn site_exemption(e: &Exemption) -> Option<Rule> {
    let site = e.host.trim();
    let usable = !site.is_empty()
        && site.is_ascii()
        && !site.contains(['*', '/', ' ', ':', '[', ']'])
        && site.chars().all(|c| !c.is_ascii_control());
    usable.then(|| {
        let mut rule = bare_rule(".*", "ignore-previous-rules");
        let lower = site.to_lowercase();
        rule.trigger.if_domain = vec![if e.subdomains {
            format!("*{lower}")
        } else {
            lower
        }];
        rule
    })
}

/// Hosts a page must not reach as a subresource or frame: loopback, private ranges, link-local,
/// CGNAT and intranet names. WebKit has no alternation, so each range is its own rule. This
/// matches the URL text WebKit holds (it has already normalised `2130706433` to `127.0.0.1`);
/// a public NAME that resolves to one of these is NOT caught here (see `docs/mini-browser.md`).
const PRIVATE_HOST_FILTERS: &[&str] = &[
    "localhost",
    "[^/?#:]*\\.localhost",
    "\\[::1\\]",
    "0\\.0\\.0\\.0",
    "127\\.[0-9]+\\.[0-9]+\\.[0-9]+",
    "\\[::\\]",
    "\\[::ffff:7f[0-9a-f][0-9a-f]:",
    "\\[fe[89ab][0-9a-f]:",
    "\\[f[cd][0-9a-f][0-9a-f]:",
    "10\\.[0-9]+\\.[0-9]+\\.[0-9]+",
    "192\\.168\\.[0-9]+\\.[0-9]+",
    "169\\.254\\.[0-9]+\\.[0-9]+",
    "172\\.1[6-9]\\.[0-9]+\\.[0-9]+",
    "172\\.2[0-9]\\.[0-9]+\\.[0-9]+",
    "172\\.3[01]\\.[0-9]+\\.[0-9]+",
    "100\\.6[4-9]\\.[0-9]+\\.[0-9]+",
    "100\\.[7-9][0-9]\\.[0-9]+\\.[0-9]+",
    "100\\.1[01][0-9]\\.[0-9]+\\.[0-9]+",
    "100\\.12[0-7]\\.[0-9]+\\.[0-9]+",
    "[^/?#:]*\\.local",
    "[^/?#:]*\\.internal",
    "[^/?#:]*\\.lan",
    "[^/?#:]*\\.home\\.arpa",
    "[^/?#:@.]+",
];

/// The first [`LOOPBACK_FILTERS`] entries of the table above name this computer itself. A page
/// that is itself served from `localhost` or `127.0.0.1` (a dev server opened from the port radar)
/// may use those; every other page may not, and nothing may use the other entries.
const LOOPBACK_FILTERS: usize = 7;

/// The private-network block, last in the list so no exception or per-site exemption lifts it.
fn private_network_rules() -> Vec<Rule> {
    let mut rules = Vec::new();
    for (i, host) in PRIVATE_HOST_FILTERS.iter().enumerate() {
        let url_filter = format!("^[^:/?#]+://+{host}[:/?#]");
        let unless: Vec<String> = if i < LOOPBACK_FILTERS {
            vec!["localhost".to_string(), "127.0.0.1".to_string()]
        } else {
            Vec::new()
        };
        let mut r = bare_rule(&url_filter, "block");
        r.trigger.resource_type = DEFAULT_TYPES.to_vec();
        r.trigger.unless_domain = unless.clone();
        rules.push(r);
        // The same hosts as frames (an iframe is a `document` load in a child frame).
        let mut f = bare_rule(&url_filter, "block");
        f.trigger.resource_type = vec!["document"];
        f.trigger.load_context = vec!["child-frame"];
        f.trigger.unless_domain = unless;
        rules.push(f);
    }
    rules
}

/// Phoenix Core's port is never reachable from a page, whatever its origin.
fn core_port_rules(port: u16) -> Vec<Rule> {
    ["localhost", "127\\.0\\.0\\.1", "\\[::1\\]"]
        .iter()
        .map(|h| bare_rule(&format!("^[^:/?#]+://+{h}:{port}[/?#]"), "block"))
        .collect()
}

/// Converts the lists (in the order given) to one content rule list of at most `options.limit`
/// rules: list blocks, list exceptions, per-site exemptions, then the fixed private-network block and
/// Core port block (last, so nothing earlier can lift them).
pub fn convert(lists: &[&str], options: &Options) -> Converted {
    let limit = options.limit;
    let head = private_network_rules();
    let mut exemptions: Vec<Rule> = Vec::new();
    for e in &options.exemptions {
        if let Some(rule) = site_exemption(e) {
            if exemptions.len() < MAX_SITE_EXEMPTIONS {
                exemptions.push(rule);
            }
        }
    }
    let dropped = options.exemptions.len() - exemptions.len();
    let mut tail = options.core_port.map(core_port_rules).unwrap_or_default();
    let fixed = head.len() + exemptions.len() + tail.len();
    let list_limit = limit.saturating_sub(fixed);
    let mut report = RulesReport {
        limit: limit as u32,
        fixed_rules: fixed as u32,
        site_exemptions: exemptions.len() as u32,
        site_exemptions_dropped: dropped as u32,
        ..RulesReport::default()
    };
    let mut seen: HashSet<String> = HashSet::new();
    let mut blocking: Vec<Rule> = Vec::new();
    let mut exceptions: Vec<Rule> = Vec::new();
    for list in lists {
        for line in list.lines() {
            match parse_line(line) {
                Line::Ignored => report.ignored += 1,
                Line::Cosmetic => report.cosmetic += 1,
                Line::Unsupported => report.unsupported += 1,
                Line::Rule { exception, rule } => {
                    report.converted += 1;
                    let key = serde_json::to_string(&rule).unwrap_or_default();
                    if !seen.insert(key) {
                        report.duplicates += 1;
                    } else if exception {
                        exceptions.push(rule);
                    } else {
                        blocking.push(rule);
                    }
                }
            }
        }
    }
    let keep_exceptions = exceptions.len().min(MAX_EXCEPTIONS).min(list_limit);
    let keep_blocking = blocking.len().min(list_limit - keep_exceptions);
    report.truncated_exceptions = (exceptions.len() - keep_exceptions) as u32;
    report.truncated_blocking = (blocking.len() - keep_blocking) as u32;
    report.kept_exceptions = keep_exceptions as u32;
    report.kept_blocking = keep_blocking as u32;
    exceptions.truncate(keep_exceptions);
    blocking.truncate(keep_blocking);
    let mut all = blocking;
    all.extend(exceptions);
    all.extend(exemptions);
    all.extend(head);
    all.append(&mut tail);
    let blocking = all;
    let json = serde_json::to_string(&blocking).unwrap_or_else(|_| "[]".to_string());
    Converted { json, report }
}

/// A stable name for a compiled list, so an unchanged list is not compiled twice (FNV-1a, 64 bit).
pub fn fingerprint(json: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in json.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("phoenix-shield-{hash:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn options(limit: usize) -> Options {
        Options {
            exemptions: Vec::new(),
            core_port: None,
            limit,
        }
    }

    fn fixed() -> usize {
        convert(&[], &options(1000)).report.fixed_rules as usize
    }

    /// The list rules only: the fixed private-network block at the tail is cut off.
    fn one(line: &str) -> Value {
        let c = convert(&[line], &options(1000));
        let mut v: Vec<Value> = serde_json::from_str(&c.json).unwrap();
        v.truncate(v.len() - fixed());
        Value::Array(v)
    }

    fn report(lines: &str) -> RulesReport {
        convert(&[lines], &options(1000)).report
    }

    #[test]
    fn a_host_rule_becomes_a_block_with_default_types() {
        let v = one("||doubleclick.net^");
        let rule = &v[0];
        assert_eq!(rule["action"]["type"], "block");
        assert_eq!(
            rule["trigger"]["url-filter"],
            "^[^:/?#]+://+([^/?#:]+\\.)?doubleclick\\.net[^a-z0-9_.%-]"
        );
        let types: Vec<&str> = rule["trigger"]["resource-type"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t.as_str().unwrap())
            .collect();
        assert_eq!(types, DEFAULT_TYPES);
        assert!(rule["trigger"].get("load-type").is_none());
    }

    #[test]
    fn options_map_to_webkit_triggers() {
        let v = one("||x.test/ads/*$third-party,script,domain=a.test|b.test");
        let t = &v[0]["trigger"];
        assert_eq!(t["load-type"], serde_json::json!(["third-party"]));
        assert_eq!(t["resource-type"], serde_json::json!(["script"]));
        assert_eq!(t["if-domain"], serde_json::json!(["*a.test", "*b.test"]));
        let v = one("/banner/*$~third-party,~image,domain=~ok.test");
        let t = &v[0]["trigger"];
        assert_eq!(t["load-type"], serde_json::json!(["first-party"]));
        assert_eq!(t["unless-domain"], serde_json::json!(["*ok.test"]));
        assert!(!t["resource-type"]
            .as_array()
            .unwrap()
            .iter()
            .any(|x| x == "image"));
        // Unanchored text has no leading `.*`.
        assert_eq!(t["url-filter"], "/banner/");
    }

    #[test]
    fn exceptions_follow_blocks_and_ignore_previous_rules() {
        let c = convert(&["@@||ok.test^$script\n||ok.test^"], &options(1000));
        let mut v: Vec<Value> = serde_json::from_str(&c.json).unwrap();
        v.truncate(v.len() - fixed());
        assert_eq!(v[0]["action"]["type"], "block");
        assert_eq!(v[1]["action"]["type"], "ignore-previous-rules");
        assert_eq!(
            v[1]["trigger"]["resource-type"],
            serde_json::json!(["script"])
        );
    }

    #[test]
    fn what_webkit_cannot_say_is_counted_and_skipped_not_widened() {
        let r = report(
            "! comment\n[Adblock Plus 2.0]\n\nexample.com##.ad\n#@#.x\n||a.test^$important\n||b.test^$redirect=x\n\
             ||c.test^$websocket\n/regex.*/\n||d.test^$domain=a.test|~b.test\n@@||e.test^$document\n||f.test^$popup\n\
             ||ünï.test^\n||g.test^$subdocument,script\n*\n||ok.test^",
        );
        assert_eq!(r.converted, 1, "{r:?}");
        assert_eq!(r.ignored, 3);
        assert_eq!(r.cosmetic, 2);
        assert_eq!(r.unsupported, 10, "{r:?}");
        assert_eq!(r.kept_blocking, 1);
    }

    #[test]
    fn a_subdocument_rule_is_a_child_frame_document_rule() {
        let v = one("||frame.test^$subdocument");
        assert_eq!(
            v[0]["trigger"]["resource-type"],
            serde_json::json!(["document"])
        );
        assert_eq!(
            v[0]["trigger"]["load-context"],
            serde_json::json!(["child-frame"])
        );
    }

    #[test]
    fn anchors_wildcards_and_separators_translate() {
        assert_eq!(
            one("|https://x.test/a*b|")[0]["trigger"]["url-filter"],
            "^https://x\\.test/a.*b$"
        );
        assert_eq!(one("ads*.js")[0]["trigger"]["url-filter"], "ads.*\\.js");
        // Nine wildcards and a pattern of only wildcards are refused.
        assert_eq!(report("a*a*a*a*a*a*a*a*a*b").unsupported, 1);
        assert_eq!(report("**").unsupported, 1);
        assert_eq!(report(&format!("||{}^", "a".repeat(600))).unsupported, 1);
    }

    #[test]
    fn the_limit_truncates_deterministically_and_says_so() {
        let mut list = String::new();
        for i in 0..50 {
            list.push_str(&format!("||block{i}.test^\n"));
        }
        for i in 0..5 {
            list.push_str(&format!("@@||allow{i}.test^\n"));
        }
        let extra = fixed();
        let opts = Options {
            exemptions: vec![Exemption {
                host: "shield.test".into(),
                subdomains: true,
            }],
            core_port: None,
            limit: 21 + extra,
        };
        let first = convert(&[&list], &opts);
        let again = convert(&[&list], &opts);
        assert_eq!(first.json, again.json, "deterministic");
        let r = &first.report;
        assert_eq!(r.limit as usize, 21 + extra);
        assert_eq!(r.site_exemptions, 1);
        assert_eq!(r.kept_exceptions, 5);
        assert_eq!(r.kept_blocking, 15);
        assert_eq!(r.truncated_blocking, 35);
        assert_eq!(
            r.fixed_rules as usize,
            extra + 1,
            "the site exemption counts as fixed"
        );
        assert_eq!(r.truncated_exceptions, 0);
        let v: Vec<Value> = serde_json::from_str(&first.json).unwrap();
        assert_eq!(v.len(), 21 + extra);
        // The first blocking rules in list order survive; the last rule is the site exemption.
        assert!(v[13]["trigger"]["url-filter"]
            .as_str()
            .unwrap()
            .contains("block13"));
        assert_eq!(
            v[20]["trigger"]["if-domain"],
            serde_json::json!(["*shield.test"])
        );
        assert_eq!(v[20]["trigger"]["url-filter"], ".*");
        // The private-network block is last: nothing before it can lift it.
        assert_eq!(v.last().unwrap()["action"]["type"], "block");
    }

    #[test]
    fn the_real_webkit_limit_is_applied_and_reported() {
        let mut list = String::new();
        for i in 0..(WEBKIT_RULE_LIMIT + 123) {
            list.push_str(&format!("||h{i}.test^\n"));
        }
        let c = convert(&[&list], &options(WEBKIT_RULE_LIMIT));
        let r = &c.report;
        assert_eq!(
            r.kept_blocking as usize,
            WEBKIT_RULE_LIMIT - r.fixed_rules as usize
        );
        assert_eq!(r.truncated_blocking, 123 + r.fixed_rules);
        let all: Vec<Value> = serde_json::from_str(&c.json).unwrap();
        assert_eq!(all.len(), WEBKIT_RULE_LIMIT);
    }

    #[test]
    fn duplicates_are_dropped_and_counted() {
        let r = report("||a.test^\n||a.test^\n||A.test^");
        assert_eq!(r.converted, 3);
        assert_eq!(r.duplicates, 2);
        assert_eq!(r.kept_blocking, 1);
    }

    #[test]
    fn unusable_site_exemptions_are_not_emitted() {
        let exemptions = ["ok.test", "bad site", "", "*.x", "http://x", "[::1]"]
            .map(|h| Exemption {
                host: h.to_string(),
                subdomains: false,
            })
            .to_vec();
        let c = convert(
            &[],
            &Options {
                exemptions,
                core_port: None,
                limit: 1000,
            },
        );
        assert_eq!(c.report.site_exemptions, 1);
        assert_eq!(c.report.site_exemptions_dropped, 5);
    }

    #[test]
    fn the_fixed_rules_block_private_hosts_and_the_core_port_for_every_page_but_local_ones() {
        let c = convert(
            &[],
            &Options {
                exemptions: vec![Exemption {
                    host: "youtube.com".into(),
                    subdomains: false,
                }],
                core_port: Some(4870),
                limit: 1000,
            },
        );
        let v: Vec<Value> = serde_json::from_str(&c.json).unwrap();
        let filters: Vec<&str> = v
            .iter()
            .map(|r| r["trigger"]["url-filter"].as_str().unwrap())
            .collect();
        assert!(filters.contains(&"^[^:/?#]+://+192\\.168\\.[0-9]+\\.[0-9]+[:/?#]"));
        assert!(filters.contains(&"^[^:/?#]+://+localhost:4870[/?#]"));
        assert!(filters.contains(&"^[^:/?#]+://+[^/?#:@.]+[:/?#]"));
        // Loopback targets are blocked unless the page itself is loopback; LAN ones always.
        let loop_rule = v
            .iter()
            .find(|r| r["trigger"]["url-filter"] == "^[^:/?#]+://+localhost[:/?#]")
            .unwrap();
        assert_eq!(
            loop_rule["trigger"]["unless-domain"],
            serde_json::json!(["localhost", "127.0.0.1"])
        );
        let lan = v
            .iter()
            .find(|r| r["trigger"]["url-filter"].as_str().unwrap().contains("192"))
            .unwrap();
        assert!(lan["trigger"].get("unless-domain").is_none());
        // An exact-host exemption has no `*`, a registrable one does.
        let ex = v
            .iter()
            .find(|r| r["action"]["type"] == "ignore-previous-rules")
            .unwrap();
        assert_eq!(
            ex["trigger"]["if-domain"],
            serde_json::json!(["youtube.com"])
        );
        // The Core port block is the very last rule, after the private-network block.
        assert!(filters.last().unwrap().contains("4870"));
    }

    #[test]
    fn the_fingerprint_changes_with_the_rules() {
        assert_eq!(fingerprint("[]"), fingerprint("[]"));
        assert_ne!(fingerprint("[]"), fingerprint("[{}]"));
        assert!(fingerprint("x").starts_with("phoenix-shield-"));
    }

    #[test]
    fn the_starter_rules_match_the_typescript_text() {
        let ts = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../web/src/core/browser/blocklist.ts"
        ))
        .unwrap();
        let block = ts
            .split("export const STARTER_RULES = [")
            .nth(1)
            .and_then(|s| s.split("].join").next())
            .unwrap();
        let ts_rules: Vec<&str> = block
            .lines()
            .filter_map(|l| l.trim().strip_prefix('"')?.strip_suffix("\","))
            .collect();
        assert_eq!(ts_rules.join("\n"), STARTER_RULES);
    }
}
