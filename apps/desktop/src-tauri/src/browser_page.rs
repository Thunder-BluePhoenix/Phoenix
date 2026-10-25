// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Phase 95: the pure parts of `page_snapshot` and `page_action` (no windows, no clock, no
//! network), so each can be tested without a webview. `browser.rs` wires them to Tauri.
//!
//! The scripts that run inside a content page are FIXED text (`const &str`). The only values that
//! ever enter one are a selector and a typed text, each as one JSON-encoded string literal, after
//! the selector was checked against a strict allow-pattern here. Nothing a page returns is ever
//! evaluated or interpolated back: the reply is decoded as JSON data and mapped onto a fixed set of
//! reason strings.
//!
//! NOT verified in a real webview by the author: see `docs/mini-browser.md`.

use serde::Serialize;
use serde_json::Value;
use url::Url;

/// `document.documentElement.outerHTML` is cut at this many characters (4 MiB).
pub const MAX_HTML_CHARS: usize = 4 * 1024 * 1024;
/// A raw callback string longer than this is refused unread (`too_large`).
pub const MAX_RAW_REPLY: usize = 24 * 1024 * 1024;
pub const MAX_SELECTOR_CHARS: usize = 512;
pub const MAX_TEXT_CHARS: usize = 4096;
pub const MAX_URL_CHARS: usize = 2048;
/// Longest wait for a page to answer a script.
pub const SCRIPT_TIMEOUT_SECS: u64 = 10;

// ---------------------------------------------------------------------------------------------
// Results the chrome page receives (always RESOLVED values; a refusal is `ok: false`)
// ---------------------------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageSnapshot {
    pub ok: bool,
    pub tab_id: String,
    pub url: String,
    pub title: String,
    pub html: String,
    pub truncated: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(untagged)]
pub enum SnapshotOutcome {
    Page(PageSnapshot),
    Refused { ok: bool, reason: &'static str },
}

impl SnapshotOutcome {
    pub fn refused(reason: &'static str) -> Self {
        SnapshotOutcome::Refused { ok: false, reason }
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(untagged)]
pub enum ActionOutcome {
    Done { ok: bool, url: String },
    Refused { ok: bool, reason: &'static str },
}

impl ActionOutcome {
    pub fn done(url: String) -> Self {
        ActionOutcome::Done { ok: true, url }
    }
    pub fn refused(reason: &'static str) -> Self {
        ActionOutcome::Refused { ok: false, reason }
    }
}

/// Why a script produced no usable reply.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScriptFail {
    Timeout,
    Failed,
}

impl ScriptFail {
    pub fn reason(self) -> &'static str {
        match self {
            ScriptFail::Timeout => "timeout",
            ScriptFail::Failed => "failed",
        }
    }
}

// ---------------------------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------------------------

/// A URL string for a comparison: parsed, fragment removed. `None` when it does not parse.
pub fn strip_fragment(url: &str) -> Option<String> {
    let mut parsed = Url::parse(url).ok()?;
    parsed.set_fragment(None);
    Some(parsed.to_string())
}

/// Both URLs parse and are the same page apart from the fragment.
pub fn same_page(a: &str, b: &str) -> bool {
    match (strip_fragment(a), strip_fragment(b)) {
        (Some(a), Some(b)) => a == b,
        _ => false,
    }
}

pub fn is_web_url(url: &str) -> bool {
    Url::parse(url).is_ok_and(|u| matches!(u.scheme(), "http" | "https"))
}

fn url_arg_ok(url: &str) -> bool {
    !url.is_empty() && url.chars().count() <= MAX_URL_CHARS && !url.chars().any(char::is_control)
}

// ---------------------------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------------------------

const TAGS: [&str; 5] = ["input", "button", "form", "select", "textarea"];

fn token_ok(token: &str) -> bool {
    (1..=80).contains(&token.len())
        && token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b':' | b'.' | b'-'))
        && !token.contains(":unreported-controls")
}

/// Exactly the selector `ai/browsing/src/page-snapshot.ts` emits for a UNIQUE control:
/// `<tag>#<token>` or `<tag>[name="<token>"]`, tag one of input/button/form/select/textarea,
/// token `[A-Za-z0-9_:.-]{1,80}`. The reader's `:nth-of-type(N)` form, its `~N` duplicate suffix
/// and its `<form> :unreported-controls` marker are NOT valid CSS and not unique: refused.
pub fn selector_ok(selector: &str) -> bool {
    if selector.is_empty() || selector.len() > MAX_SELECTOR_CHARS {
        return false;
    }
    for tag in TAGS {
        let Some(rest) = selector.strip_prefix(tag) else {
            continue;
        };
        if let Some(token) = rest.strip_prefix('#') {
            return token_ok(token);
        }
        if let Some(token) = rest
            .strip_prefix("[name=\"")
            .and_then(|r| r.strip_suffix("\"]"))
        {
            return token_ok(token);
        }
        return false;
    }
    false
}

// ---------------------------------------------------------------------------------------------
// Script building: values enter a script ONLY as JSON string literals
// ---------------------------------------------------------------------------------------------

/// `value` as one JavaScript string literal: JSON encoding (quotes, backslashes, control
/// characters escaped) plus U+2028 and U+2029, which JSON allows raw but older JavaScript engines
/// treat as line terminators inside a string.
pub fn js_string_literal(value: &str) -> String {
    let json = serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string());
    json.replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
}

const SELECTOR_SLOT: &str = "__SELECTOR__";
const TEXT_SLOT: &str = "__TEXT__";

/// Fills the two slots of `template` in ONE pass over the template. A value that happens to
/// contain a slot name (`input#__TEXT__` is a valid selector) is never scanned again.
fn fill(template: &str, selector: &str, text: Option<&str>) -> String {
    let selector = js_string_literal(selector);
    let text = text.map(js_string_literal);
    let mut out = String::with_capacity(template.len() + selector.len() + 16);
    let mut rest = template;
    loop {
        let sel_at = rest.find(SELECTOR_SLOT);
        let text_at = text.as_ref().and_then(|_| rest.find(TEXT_SLOT));
        let (at, slot, value) = match (sel_at, text_at) {
            (Some(s), Some(t)) if t < s => (t, TEXT_SLOT, text.as_deref().unwrap_or("")),
            (Some(s), _) => (s, SELECTOR_SLOT, selector.as_str()),
            (None, Some(t)) => (t, TEXT_SLOT, text.as_deref().unwrap_or("")),
            (None, None) => break,
        };
        out.push_str(&rest[..at]);
        out.push_str(value);
        rest = &rest[at + slot.len()..];
    }
    out.push_str(rest);
    out
}

// ---------------------------------------------------------------------------------------------
// The fixed scripts (no value is ever spliced into them except at the two slots, see `fill`)
// ---------------------------------------------------------------------------------------------

/// Reads the page. No input at all. The page's own `location.href` travels with the markup so the
/// host can tell that the page it asked about is the page that answered. Lone surrogates (a cut
/// pair, or ones the page itself contains) become U+FFFD: `JSON.stringify` would escape them and
/// no JSON parser has to accept that.
pub const SNAPSHOT_SCRIPT: &str = r##"(function () {
  try {
    var html = String(document.documentElement.outerHTML);
    var cut = false;
    if (html.length > 4194304) {
      html = html.slice(0, 4194304);
      cut = true;
    }
    html = html.replace(/[\ud800-\udbff][\udc00-\udfff]|[\ud800-\udfff]/g, function (m) {
      return m.length === 2 ? m : "\ufffd";
    });
    return JSON.stringify({ u: String(location.href), h: html, t: cut });
  } catch (e) {
    return JSON.stringify({ ok: false, reason: "failed" });
  }
})()"##;

/// Asks the page where it is, with no input. Run right before an action script (which can take no
/// URL as an input) so an action never runs on a page other than the approved one.
pub const URL_SCRIPT: &str = r##"(function () {
  try {
    return JSON.stringify({ ok: true, u: String(location.href) });
  } catch (e) {
    return JSON.stringify({ ok: false, reason: "failed" });
  }
})()"##;

const SCRIPT_HEAD: &str = r##"(function () {
  "use strict";
  var SEL = __SELECTOR__;
"##;

const SCRIPT_TEXT_LINE: &str = "  var TXT = __TEXT__;\n";

/// Element lookup, `clean` (the reader's `cleanToken`) and the protected-control checks.
const SCRIPT_LIB: &str = r##"  var FORBID = /(?:passw(?:or)?d|passkey|(?:^|[^a-z])otp(?![a-z])|one.?time|cc-|card|credit|debit|cvc|cvv|expir|payment|security.?code|iban|bank|account|secret|token)/i;
  var REMOVED = /[\u0000-\u0008\u000e-\u001f\u007f-\u0084\u0086-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ud800-\udfff\ue000-\uf8ff\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffc\u{1d173}-\u{1d17a}\u{e0000}-\u{e0fff}\u{f0000}-\u{10ffff}]/gu;
  var SPACES = /[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g;
  function clean(v) {
    if (v === null || v === undefined) return "";
    return String(v).replace(REMOVED, "").replace(SPACES, " ").trim().slice(0, 80).replace(/[^A-Za-z0-9_:.\-]/g, "_");
  }
  function done() {
    return JSON.stringify({ ok: true, u: String(location.href) });
  }
  function fail(reason) {
    return JSON.stringify({ ok: false, reason: reason });
  }
  if (FORBID.test(SEL)) return fail("protected");
  var parts = /^(input|button|form|select|textarea)(?:#([A-Za-z0-9_:.\-]{1,80})|\[name="([A-Za-z0-9_:.\-]{1,80})"\])$/.exec(SEL);
  if (!parts) return fail("failed");
  var START = String(location.href);
  function find() {
    var list = document.getElementsByTagName(parts[1]);
    var hit = null;
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      var id = clean(el.getAttribute("id"));
      var same = parts[2] !== undefined ? id === parts[2] : id === "" && clean(el.getAttribute("name")) === parts[3];
      if (same) {
        if (hit) return "ambiguous";
        hit = el;
      }
    }
    return hit || "not_found";
  }
  function isProtected(el) {
    var type = String(el.type || "").toLowerCase();
    if (type === "password" || type === "hidden" || type === "file") return true;
    var bits = [type, el.getAttribute("autocomplete"), el.getAttribute("name"), el.getAttribute("id"), el.getAttribute("aria-label"), el.getAttribute("placeholder"), el.getAttribute("title")];
    var labels = el.labels;
    if (labels) {
      for (var i = 0; i < labels.length && i < 5; i++) bits.push(String(labels[i].textContent || "").slice(0, 200));
    }
    return FORBID.test(bits.join(" "));
  }
  function formProtected(form) {
    if (isProtected(form)) return true;
    var els = form.elements;
    for (var i = 0; i < els.length; i++) {
      if (isProtected(els[i])) return true;
    }
    return false;
  }
"##;

const BODY_CLICK: &str = r##"    var el = find();
    if (typeof el === "string") return fail(el);
    var tag = el.tagName.toLowerCase();
    if (tag !== "button" && tag !== "input") return fail("unsupported");
    if (el.disabled) return fail("unsupported");
    if (isProtected(el)) return fail("protected");
    if ((el.type === "submit" || el.type === "image") && el.form && formProtected(el.form)) return fail("protected");
    el.click();
"##;

const BODY_TYPE: &str = r##"    var el = find();
    if (typeof el === "string") return fail(el);
    var tag = el.tagName.toLowerCase();
    var type = String(el.type || "").toLowerCase();
    if (!(tag === "textarea" || (tag === "input" && /^(text|search|email|url|tel)$/.test(type)))) return fail("unsupported");
    if (el.disabled || el.readOnly) return fail("unsupported");
    if (isProtected(el)) return fail("protected");
    var proto = tag === "textarea" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (!desc || typeof desc.set !== "function") return fail("failed");
    desc.set.call(el, TXT);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
"##;

const BODY_SUBMIT: &str = r##"    var el = find();
    if (typeof el === "string") return fail(el);
    var tag = el.tagName.toLowerCase();
    var form = null;
    var submitter = null;
    if (tag === "form") {
      form = el;
    } else if ((tag === "button" || tag === "input") && (el.type === "submit" || el.type === "image")) {
      form = el.form;
      submitter = el;
    } else {
      return fail("unsupported");
    }
    if (!form || typeof form.requestSubmit !== "function") return fail("unsupported");
    if (isProtected(el) || formProtected(form)) return fail("protected");
    if (submitter) form.requestSubmit(submitter);
    else form.requestSubmit();
"##;

/// Every scripted action ends here: report the page the script STARTED on (so the host can tell
/// whether it was still the approved page) and map any exception to `failed`.
const SCRIPT_TAIL: &str = r##"    return JSON.stringify({ ok: true, u: START });
  } catch (e) {
    return fail("failed");
  }
})()"##;

// ---------------------------------------------------------------------------------------------
// What the chrome asks for
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Click,
    Type,
    Submit,
    Download,
    Navigate,
}

impl Kind {
    pub fn parse(text: &str) -> Option<Kind> {
        match text {
            "click" => Some(Kind::Click),
            "type" => Some(Kind::Type),
            "submit" => Some(Kind::Submit),
            "download" => Some(Kind::Download),
            "navigate" => Some(Kind::Navigate),
            _ => None,
        }
    }
}

/// The arguments of `page_action`, as the chrome sent them.
pub struct ActionRequest {
    pub kind: String,
    pub selector: Option<String>,
    pub text: Option<String>,
    pub destination: Option<String>,
    pub expected_url: String,
}

/// A validated request: what to do once the active tab was checked.
#[derive(PartialEq, Eq)]
pub enum Plan {
    /// A fixed script with the validated values substituted.
    Script { script: String },
    /// A navigation to vet and perform through the same path as the `navigate` command.
    Navigate { destination: String },
}

/// `Debug` names the variant only: a script carries the typed text, which is never logged.
impl std::fmt::Debug for Plan {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Plan::Script { .. } => "Plan::Script",
            Plan::Navigate { .. } => "Plan::Navigate",
        })
    }
}

/// Validates every field BEFORE any script is built or any window is touched. The error is the
/// reason the chrome receives. `text` is never put into an error.
pub fn plan(request: &ActionRequest) -> Result<Plan, &'static str> {
    let kind = Kind::parse(&request.kind).ok_or("bad_kind")?;
    if !url_arg_ok(&request.expected_url) || !is_web_url(&request.expected_url) {
        return Err("bad_url");
    }
    let selector = request.selector.as_deref();
    let text = request.text.as_deref();
    let destination = request.destination.as_deref();
    if kind == Kind::Navigate {
        if selector.is_some() {
            return Err("bad_selector");
        }
        if text.is_some() {
            return Err("bad_text");
        }
        let destination = destination.ok_or("bad_url")?;
        if !url_arg_ok(destination) {
            return Err("bad_url");
        }
        return Ok(Plan::Navigate {
            destination: destination.to_string(),
        });
    }
    if destination.is_some() {
        return Err("bad_url");
    }
    let selector = selector.ok_or("bad_selector")?;
    if !selector_ok(selector) {
        return Err("bad_selector");
    }
    match (kind, text) {
        (Kind::Type, None) => return Err("bad_text"),
        (Kind::Type, Some(t)) if t.chars().count() > MAX_TEXT_CHARS => return Err("bad_text"),
        (Kind::Type, Some(_)) => {}
        (_, Some(_)) => return Err("bad_text"),
        (_, None) => {}
    }
    let script = action_script(kind, selector, text);
    Ok(Plan::Script { script })
}

/// The fixed script of a scripted kind. Callers pass a selector that [`selector_ok`] accepted.
pub fn action_script(kind: Kind, selector: &str, text: Option<&str>) -> String {
    let body = match kind {
        Kind::Click | Kind::Download => BODY_CLICK,
        Kind::Type => BODY_TYPE,
        Kind::Submit => BODY_SUBMIT,
        Kind::Navigate => "",
    };
    let mut template = String::from(SCRIPT_HEAD);
    if kind == Kind::Type {
        template.push_str(SCRIPT_TEXT_LINE);
    }
    template.push_str(SCRIPT_LIB);
    template.push_str("  try {\n");
    template.push_str(body);
    template.push_str(SCRIPT_TAIL);
    fill(&template, selector, text)
}

// ---------------------------------------------------------------------------------------------
// Replies
// ---------------------------------------------------------------------------------------------

/// The callback gets the script's result serialised as JSON: a script that returned a string
/// arrives as a JSON string holding JSON. Both that and a plain object are accepted; anything
/// else (null, a number, text) is no reply.
pub fn decode_reply(raw: &str) -> Option<serde_json::Map<String, Value>> {
    let mut value: Value = serde_json::from_str(raw).ok()?;
    if let Value::String(inner) = value {
        value = serde_json::from_str(&inner).ok()?;
    }
    match value {
        Value::Object(map) => Some(map),
        _ => None,
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct ScriptSnapshot {
    /// The page's own `location.href` when the script ran.
    pub href: String,
    pub html: String,
    pub truncated: bool,
}

/// A snapshot reply, or the reason it is unusable: `too_large` (raw string over 24 MiB) or
/// `failed`.
pub fn parse_snapshot(raw: &str) -> Result<ScriptSnapshot, &'static str> {
    if raw.len() > MAX_RAW_REPLY {
        return Err("too_large");
    }
    let map = decode_reply(raw).ok_or("failed")?;
    let (Some(Value::String(href)), Some(Value::String(html))) = (map.get("u"), map.get("h"))
    else {
        return Err("failed");
    };
    let truncated = matches!(map.get("t"), Some(Value::Bool(true)));
    Ok(ScriptSnapshot {
        href: href.clone(),
        html: html.clone(),
        truncated,
    })
}

/// Cuts `html` at [`MAX_HTML_CHARS`] characters. The flag is true when this cut anything.
pub fn cap_html(mut html: String) -> (String, bool) {
    match html.char_indices().nth(MAX_HTML_CHARS) {
        Some((at, _)) => {
            html.truncate(at);
            (html, true)
        }
        None => (html, false),
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum ActionReply {
    /// The script did it; the page's own `location.href` at that moment.
    Done {
        href: String,
    },
    Refused(&'static str),
}

/// An action reply. The page's `reason` is mapped onto a FIXED set; anything else is `failed`.
pub fn parse_action(raw: &str) -> ActionReply {
    if raw.len() > MAX_RAW_REPLY {
        return ActionReply::Refused("failed");
    }
    let Some(map) = decode_reply(raw) else {
        return ActionReply::Refused("failed");
    };
    match map.get("ok") {
        Some(Value::Bool(true)) => match map.get("u") {
            Some(Value::String(href)) => ActionReply::Done { href: href.clone() },
            _ => ActionReply::Refused("failed"),
        },
        Some(Value::Bool(false)) => ActionReply::Refused(match map.get("reason") {
            Some(Value::String(r)) => match r.as_str() {
                "not_found" => "not_found",
                "ambiguous" => "ambiguous",
                "protected" => "protected",
                "unsupported" => "unsupported",
                _ => "failed",
            },
            _ => "failed",
        }),
        _ => ActionReply::Refused("failed"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(kind: &str, selector: Option<&str>, text: Option<&str>) -> ActionRequest {
        ActionRequest {
            kind: kind.into(),
            selector: selector.map(str::to_string),
            text: text.map(str::to_string),
            destination: None,
            expected_url: "https://example.com/a#frag".into(),
        }
    }

    #[test]
    fn the_selectors_the_reader_emits_for_a_unique_control_are_accepted() {
        for ok in [
            "input#q",
            "button[name=\"go\"]",
            "form#f",
            "select#country",
            "textarea[name=\"msg\"]",
            "input#a_b:c.d-e",
            &format!("input#{}", "a".repeat(80)),
        ] {
            assert!(selector_ok(ok), "{ok}");
        }
    }

    #[test]
    fn every_other_selector_is_refused() {
        let long = format!("input#{}", "a".repeat(81));
        let huge = format!("input#{}", "a".repeat(600));
        for bad in [
            "",
            "input:nth-of-type(2)",
            "input#q~1",
            "input[name=\"q\"]~2",
            "form#f :unreported-controls",
            "form :unreported-controls",
            "input#q:unreported-controls",
            "input#q\"",
            "input#q'",
            "input#q\\",
            "input#<q>",
            "input#a b",
            "input#a\nb",
            "input#a\tb",
            "input#é",
            "input#q;",
            "input#q,button#x",
            "input#q > a",
            "input#",
            "input[name=\"\"]",
            "input[name=\"a b\"]",
            "input[name='q']",
            "input[name=\"q\"",
            "input[name=q]",
            "input[name=\"q\"]x",
            "input#q[name=\"x\"]",
            "a#q",
            "div#q",
            "script#q",
            "INPUT#q",
            "iframe#q",
            "inputs#q",
            "#q",
            "*",
            "input",
            long.as_str(),
            huge.as_str(),
        ] {
            assert!(!selector_ok(bad), "{bad:?}");
        }
    }

    #[test]
    fn a_hostile_text_enters_the_script_only_as_one_json_string_literal() {
        let hostile =
            "a\"b'c\\d</script><!--\u{2028}\u{2029}${x}`\n\r\t\u{0}\u{7f}é😀 __SELECTOR__ __TEXT__";
        let script = action_script(Kind::Type, "input#q", Some(hostile));
        // The text appears exactly once (as a literal), nowhere raw.
        let literal = js_string_literal(hostile);
        assert_eq!(script.matches(&literal).count(), 1);
        assert!(!script.contains('\u{2028}') && !script.contains('\u{2029}'));
        assert!(!script.contains("\n\r\t"));
        // The literal parses back to the exact text, as JSON.
        let parsed: String = serde_json::from_str(&literal).unwrap();
        assert_eq!(parsed, hostile);
        // The line that declares it holds the literal and nothing after it but the semicolon.
        let line = script
            .lines()
            .find(|l| l.trim_start().starts_with("var TXT = "))
            .expect("declaration line");
        let rhs = line.trim_start().strip_prefix("var TXT = ").unwrap();
        let rhs = rhs.strip_suffix(';').expect("one statement");
        assert_eq!(serde_json::from_str::<String>(rhs).unwrap(), hostile);
        // A slot name inside a value is not substituted again.
        assert_eq!(script.matches("var SEL = \"input#q\";").count(), 1);
        assert_eq!(
            action_script(Kind::Click, "input#__TEXT__", None)
                .matches("input#__TEXT__")
                .count(),
            1
        );
        // The fixed text of the other kinds never mentions the typed text.
        assert!(!action_script(Kind::Click, "input#q", None).contains("var TXT"));
    }

    #[test]
    fn the_fixed_scripts_take_no_other_input_and_never_use_query_selector_or_eval() {
        for kind in [Kind::Click, Kind::Download, Kind::Type, Kind::Submit] {
            let script = action_script(kind, "input#q", Some("x"));
            assert!(!script.contains("__SELECTOR__") && !script.contains("__TEXT__"));
            for forbidden in [
                "querySelector",
                "eval(",
                "Function(",
                "innerHTML",
                "document.write",
            ] {
                assert!(!script.contains(forbidden), "{kind:?} {forbidden}");
            }
            assert!(script.contains("getElementsByTagName"));
        }
        assert!(!SNAPSHOT_SCRIPT.contains("__"));
        assert!(!URL_SCRIPT.contains("__"));
    }

    #[test]
    fn js_string_literals_escape_line_separators_and_round_trip() {
        assert_eq!(
            js_string_literal("a\u{2028}b\u{2029}"),
            "\"a\\u2028b\\u2029\""
        );
        assert_eq!(js_string_literal("\"\\"), "\"\\\"\\\\\"");
        let s = "x\u{0}\u{1f}\u{2028}";
        assert_eq!(
            serde_json::from_str::<String>(&js_string_literal(s)).unwrap(),
            s
        );
    }

    #[test]
    fn plan_validates_every_field_before_building_a_script() {
        let ok = |r: &ActionRequest| plan(r).map(|p| matches!(p, Plan::Script { .. }));
        assert_eq!(ok(&request("click", Some("button#go"), None)), Ok(true));
        assert_eq!(ok(&request("download", Some("button#go"), None)), Ok(true));
        assert_eq!(ok(&request("submit", Some("form#f"), None)), Ok(true));
        assert_eq!(ok(&request("type", Some("input#q"), Some("hi"))), Ok(true));
        assert_eq!(ok(&request("type", Some("input#q"), Some(""))), Ok(true));
        for (kind, selector, text, reason) in [
            ("tap", Some("input#q"), None, "bad_kind"),
            ("", Some("input#q"), None, "bad_kind"),
            ("Click", Some("input#q"), None, "bad_kind"),
            ("click", None, None, "bad_selector"),
            ("click", Some("input:nth-of-type(1)"), None, "bad_selector"),
            ("click", Some("input#q~1"), None, "bad_selector"),
            ("click", Some("div#q"), None, "bad_selector"),
            (
                "submit",
                Some("form#f :unreported-controls"),
                None,
                "bad_selector",
            ),
            ("type", Some("input#q"), None, "bad_text"),
            ("click", Some("input#q"), Some("x"), "bad_text"),
            ("submit", Some("form#f"), Some("x"), "bad_text"),
            ("download", Some("button#d"), Some("x"), "bad_text"),
        ] {
            assert_eq!(
                ok(&request(kind, selector, text)),
                Err(reason),
                "{kind} {selector:?}"
            );
        }
        let long = "x".repeat(MAX_TEXT_CHARS + 1);
        assert_eq!(
            ok(&request("type", Some("input#q"), Some(&long))),
            Err("bad_text")
        );
        let max = "é".repeat(MAX_TEXT_CHARS);
        assert_eq!(ok(&request("type", Some("input#q"), Some(&max))), Ok(true));
        // A selector is bounded by its own pattern, long before 512.
        let mut r = request("click", Some("input#q"), None);
        r.selector = Some(format!("input#{}", "a".repeat(600)));
        assert_eq!(ok(&r), Err("bad_selector"));
        // expectedUrl: bounded, no control characters, an http(s) URL.
        for bad in [
            "".to_string(),
            "not a url".into(),
            "file:///etc/passwd".into(),
            "about:blank".into(),
            "https://example.com/\n".into(),
            format!("https://example.com/{}", "a".repeat(2100)),
        ] {
            let mut r = request("click", Some("input#q"), None);
            r.expected_url = bad.clone();
            assert_eq!(ok(&r), Err("bad_url"), "{bad:?}");
        }
    }

    #[test]
    fn navigate_needs_a_bounded_destination_and_nothing_else() {
        let nav = |destination: Option<&str>, selector: Option<&str>, text: Option<&str>| {
            let mut r = request("navigate", selector, text);
            r.destination = destination.map(str::to_string);
            plan(&r)
        };
        assert_eq!(
            nav(Some("https://example.org/x"), None, None),
            Ok(Plan::Navigate {
                destination: "https://example.org/x".into()
            })
        );
        assert_eq!(nav(None, None, None), Err("bad_url"));
        assert_eq!(nav(Some(""), None, None), Err("bad_url"));
        assert_eq!(
            nav(Some("https://a.test/\u{7}"), None, None),
            Err("bad_url")
        );
        let long = format!("https://a.test/{}", "a".repeat(2100));
        assert_eq!(nav(Some(&long), None, None), Err("bad_url"));
        assert_eq!(
            nav(Some("https://a.test/"), Some("input#q"), None),
            Err("bad_selector")
        );
        assert_eq!(
            nav(Some("https://a.test/"), None, Some("t")),
            Err("bad_text")
        );
        // A scripted kind never takes a destination.
        let mut r = request("click", Some("input#q"), None);
        r.destination = Some("https://a.test/".into());
        assert_eq!(plan(&r), Err("bad_url"));
    }

    #[test]
    fn a_plan_never_prints_the_typed_text() {
        let planned = plan(&request("type", Some("input#q"), Some("hunter-two-secret"))).unwrap();
        assert!(!format!("{planned:?}").contains("hunter"));
    }

    #[test]
    fn urls_compare_without_their_fragment_as_parsed_strings() {
        assert!(same_page(
            "https://example.com/a#x",
            "https://example.com/a#y"
        ));
        assert!(same_page("https://example.com", "https://example.com/"));
        assert!(!same_page("https://example.com/a", "https://example.com/b"));
        assert!(!same_page(
            "https://example.com/a?q=1",
            "https://example.com/a?q=2"
        ));
        assert!(!same_page("not a url", "not a url"));
        assert!(is_web_url("http://a.test/") && is_web_url("https://a.test/"));
        assert!(!is_web_url("about:blank") && !is_web_url("file:///x") && !is_web_url("x"));
    }

    #[test]
    fn replies_decode_from_a_json_string_of_json_or_an_object() {
        let inner = r#"{"ok":true,"u":"https://example.com/a"}"#;
        let as_string = serde_json::to_string(inner).unwrap();
        let expected = ActionReply::Done {
            href: "https://example.com/a".into(),
        };
        assert_eq!(parse_action(&as_string), expected);
        assert_eq!(parse_action(inner), expected);
        for junk in ["", "null", "42", "\"text\"", "[]", "{", "\"{\"", "true"] {
            assert_eq!(parse_action(junk), ActionReply::Refused("failed"), "{junk}");
        }
        assert_eq!(
            parse_action(r#"{"ok":true}"#),
            ActionReply::Refused("failed")
        );
    }

    #[test]
    fn the_pages_reason_is_mapped_onto_a_fixed_set() {
        for known in [
            "not_found",
            "ambiguous",
            "protected",
            "unsupported",
            "failed",
        ] {
            let raw = format!("{{\"ok\":false,\"reason\":\"{known}\"}}");
            assert_eq!(parse_action(&raw), ActionReply::Refused(known));
        }
        for unknown in [
            r#"{"ok":false,"reason":"Error: the secret hunter2"}"#,
            r#"{"ok":false,"reason":7}"#,
            r#"{"ok":false}"#,
            r#"{"ok":"no"}"#,
        ] {
            assert_eq!(
                parse_action(unknown),
                ActionReply::Refused("failed"),
                "{unknown}"
            );
        }
    }

    #[test]
    fn a_snapshot_reply_is_parsed_capped_and_size_limited() {
        let inner = serde_json::json!({"u": "https://example.com/a", "h": "<p>x</p>", "t": false})
            .to_string();
        let wrapped = serde_json::to_string(&inner).unwrap();
        let expected = ScriptSnapshot {
            href: "https://example.com/a".into(),
            html: "<p>x</p>".into(),
            truncated: false,
        };
        assert_eq!(parse_snapshot(&wrapped), Ok(expected));
        assert!(
            parse_snapshot(r#"{"u":"https://e.test/","h":"x","t":true}"#)
                .unwrap()
                .truncated
        );
        for junk in [
            "",
            "null",
            "{}",
            r#"{"u":"x"}"#,
            r#"{"u":1,"h":"x"}"#,
            "\"{\"",
        ] {
            assert_eq!(parse_snapshot(junk), Err("failed"), "{junk}");
        }
        assert_eq!(
            parse_snapshot(r#"{"ok":false,"reason":"failed"}"#),
            Err("failed")
        );
        let big = "x".repeat(MAX_RAW_REPLY + 1);
        assert_eq!(parse_snapshot(&big), Err("too_large"));
        let (kept, cut) = cap_html("a".repeat(MAX_HTML_CHARS));
        assert_eq!((kept.chars().count(), cut), (MAX_HTML_CHARS, false));
        let (kept, cut) = cap_html("é".repeat(MAX_HTML_CHARS + 5));
        assert_eq!((kept.chars().count(), cut), (MAX_HTML_CHARS, true));
    }
}
