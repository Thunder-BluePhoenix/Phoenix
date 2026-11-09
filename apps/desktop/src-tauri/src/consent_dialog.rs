// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! The shell's side of the recording consent channel (Phase 65). While managed Core runs
//! (`managed_core.rs`) the shell polls Core for a pending consent, shows a NATIVE confirmation
//! dialog and posts the person's answer. Nothing here is a Tauri command and nothing in a web page
//! can trigger, read or answer it: the only caller is the managed-Core supervisor thread.
//!
//! Authentication: the per-launch secret goes in its own header (`x-phoenix-consent-secret`),
//! never in `Authorization`; the session token is not sent at all on these two calls. The loopback
//! client sends no `Origin` and no cookie (Core refuses both on these routes).
//!
//! The dialog text is FIXED here. From Core the shell takes only the nonce and an optional title,
//! which is re-cleaned (printable, one line, at most 80 characters) and shown as quoted data. A
//! pending consent whose `what` is not exactly `notetaker.record` is ignored, not shown. `Cancel`
//! is the default button; closing the dialog any other way, a dialog that cannot be shown and every
//! error answer "denied" or nothing, never "granted". A nonce is asked at most once.
//!
//! A [`Granted`] value exists only when Core itself confirmed (HTTP 200 `{"decision":"granted"}`) an
//! answer the person gave with the **Record** button in this dialog. It is the only thing from which
//! `system_audio::ConsentGrant` can be minted.
//!
//! Not run by the author: the native dialogs need a real display and no Core was involved; the
//! API is a fake in the tests and the HTTP shapes are checked as bytes.

use crate::core_status::parse_response;
use serde::Deserialize;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::Arc;
use std::time::Duration;

pub const PENDING_PATH: &str = "/api/notetaker/consent/pending";
pub const ANSWER_PATH: &str = "/api/notetaker/consent/answer";
pub const SECRET_HEADER: &str = "x-phoenix-consent-secret";
/// The only kind of consent the shell shows.
pub const WHAT_RECORD: &str = "notetaker.record";
const MAX_RESPONSE: u64 = 16 * 1024;
const TIMEOUT: Duration = Duration::from_millis(1500);
const MAX_TITLE_CHARS: usize = 80;

/// What the dialog shows. The strings are fixed; only `title` comes (cleaned) from Core.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Prompt {
    pub title: &'static str,
    pub message: String,
    /// The default button; Enter cancels.
    pub cancel: &'static str,
    pub accept: &'static str,
}

/// Proof that a person chose **Record** in the dialog AND Core accepted that answer. Cannot be
/// built outside this module.
#[derive(Debug)]
pub struct Granted {
    _private: (),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApiError {
    /// Core did not answer, or answered something that is not an answer.
    Unreachable,
    /// Core said no (wrong secret, unknown or expired nonce, rate limit, not managed).
    Refused,
}

/// The two calls the shell makes. The real one is [`HttpApi`]; tests fake it.
pub trait ConsentApi: Send + Sync {
    /// Body of `GET /api/notetaker/consent/pending`.
    fn list(&self, secret: &str) -> Result<String, ApiError>;
    /// Posts the answer. `Ok(true)` only when Core confirmed `granted`.
    fn answer(&self, secret: &str, nonce: &str, granted: bool) -> Result<bool, ApiError>;
}

/// Shows the prompt and returns `Some(true)` only for **Record**. `None`: it could not be shown.
pub type Ask = Arc<dyn Fn(&Prompt) -> Option<bool> + Send + Sync>;

#[derive(Debug)]
pub enum Step {
    /// Nothing was waiting.
    Idle,
    /// Core did not answer or refused the secret.
    Unavailable,
    /// Something was pending but not something this shell shows (or it was already asked).
    Ignored,
    /// The person said no, or the dialog could not be shown, and Core was told so (if reachable).
    Denied,
    Granted(Granted),
}

#[derive(Deserialize)]
struct PendingList {
    pending: Vec<PendingItem>,
}

#[derive(Deserialize)]
struct PendingItem {
    nonce: String,
    what: String,
    #[serde(default)]
    title: Option<String>,
}

fn nonce_is_plain(nonce: &str) -> bool {
    !nonce.is_empty()
        && nonce.len() <= 64
        && nonce
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Printable, one line, at most 80 characters. Control, bidi and zero-width characters are dropped.
pub fn clean_title(title: &str) -> Option<String> {
    let cleaned: String = title
        .chars()
        .filter(|c| {
            let cp = *c as u32;
            cp >= 0x20
                && cp != 0x7f
                && !(0x80..=0x9f).contains(&cp)
                && !(0x200b..=0x200f).contains(&cp)
                && !(0x202a..=0x202e).contains(&cp)
                && !(0x2066..=0x2069).contains(&cp)
                && cp != 0xfeff
        })
        .take(MAX_TITLE_CHARS)
        .collect();
    let cleaned = cleaned.trim().to_string();
    (!cleaned.is_empty()).then_some(cleaned)
}

/// The fixed dialog.
pub fn prompt(title: Option<&str>) -> Prompt {
    let mut message = String::from(
        "A program on this computer asked Phoenix to start recording a call (microphone, and system audio where this app supports it). \
Phoenix transcribes it on this device and does not keep the audio.\n\n\
Recording without the consent of everyone on the call can be illegal where you or they live. \
Choose Record only if you are the person at this computer and everyone on the call has been told.",
    );
    if let Some(t) = title.and_then(clean_title) {
        message.push_str(&format!(
            "\n\nTitle given by the request: \u{201c}{t}\u{201d}"
        ));
    }
    Prompt {
        title: "Record this call?",
        message,
        cancel: "Cancel",
        accept: "Record",
    }
}

/// One poll: ask Core, show the dialog for a new pending consent, post the answer.
/// `last_answered` collapses duplicates: a nonce already shown is never shown again.
pub fn step(
    api: &dyn ConsentApi,
    secret: &str,
    ask: &(dyn Fn(&Prompt) -> Option<bool> + Send + Sync),
    last_answered: &mut Option<String>,
) -> Step {
    let Ok(body) = api.list(secret) else {
        return Step::Unavailable;
    };
    let Ok(list) = serde_json::from_str::<PendingList>(&body) else {
        return Step::Unavailable;
    };
    let Some(item) = list.pending.into_iter().next() else {
        return Step::Idle;
    };
    if item.what != WHAT_RECORD
        || !nonce_is_plain(&item.nonce)
        || last_answered.as_deref() == Some(item.nonce.as_str())
    {
        return Step::Ignored;
    }
    *last_answered = Some(item.nonce.clone());
    // Fail closed: only an explicit Record is a yes; "could not be shown" is a no.
    let chose_record = ask(&prompt(item.title.as_deref())) == Some(true);
    match api.answer(secret, &item.nonce, chose_record) {
        Ok(true) if chose_record => Step::Granted(Granted { _private: () }),
        Ok(_) => Step::Denied,
        Err(ApiError::Refused) => Step::Denied,
        Err(ApiError::Unreachable) => Step::Unavailable,
    }
}

// ── The real client ────────────────────────────────────────────────────────

fn secret_is_plain(secret: &str) -> bool {
    secret.len() == 64
        && secret
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// The request bytes. `None` when the secret, nonce or host could split a header or body.
pub fn request_bytes(path: &str, host: &str, secret: &str, body: Option<&str>) -> Option<String> {
    let host_ok = host
        .bytes()
        .all(|b| b.is_ascii_digit() || b == b'.' || b == b':' || b == b'[' || b == b']');
    if !secret_is_plain(secret) || !host_ok || host.is_empty() {
        return None;
    }
    Some(match body {
        None => format!(
            "GET {path} HTTP/1.1\r\nHost: {host}\r\n{SECRET_HEADER}: {secret}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
        ),
        Some(body) => format!(
            "POST {path} HTTP/1.1\r\nHost: {host}\r\n{SECRET_HEADER}: {secret}\r\nAccept: application/json\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        ),
    })
}

pub fn answer_body(nonce: &str, granted: bool) -> Option<String> {
    nonce_is_plain(nonce).then(|| {
        format!(
            r#"{{"nonce":"{nonce}","decision":"{}"}}"#,
            if granted { "granted" } else { "denied" }
        )
    })
}

/// Loopback HTTP to Core. The base URL must be `http://<loopback ip>:<port>`.
pub struct HttpApi {
    pub base_url: String,
}

impl HttpApi {
    fn send(&self, request: String) -> Result<(u16, String), ApiError> {
        let addr = self
            .base_url
            .strip_prefix("http://")
            .ok_or(ApiError::Unreachable)?;
        let socket: SocketAddr = addr.parse().map_err(|_| ApiError::Unreachable)?;
        if !socket.ip().is_loopback() {
            return Err(ApiError::Unreachable);
        }
        let mut stream =
            TcpStream::connect_timeout(&socket, TIMEOUT).map_err(|_| ApiError::Unreachable)?;
        let _ = stream.set_read_timeout(Some(TIMEOUT));
        let _ = stream.set_write_timeout(Some(TIMEOUT));
        stream
            .write_all(request.as_bytes())
            .map_err(|_| ApiError::Unreachable)?;
        let mut raw = Vec::new();
        if stream.take(MAX_RESPONSE).read_to_end(&mut raw).is_err() && raw.is_empty() {
            return Err(ApiError::Unreachable);
        }
        parse_response(&raw).ok_or(ApiError::Unreachable)
    }

    fn host(&self) -> &str {
        self.base_url.strip_prefix("http://").unwrap_or("")
    }
}

impl ConsentApi for HttpApi {
    fn list(&self, secret: &str) -> Result<String, ApiError> {
        let request =
            request_bytes(PENDING_PATH, self.host(), secret, None).ok_or(ApiError::Refused)?;
        match self.send(request)? {
            (200, body) => Ok(body),
            _ => Err(ApiError::Refused),
        }
    }

    fn answer(&self, secret: &str, nonce: &str, granted: bool) -> Result<bool, ApiError> {
        let body = answer_body(nonce, granted).ok_or(ApiError::Refused)?;
        let request = request_bytes(ANSWER_PATH, self.host(), secret, Some(&body))
            .ok_or(ApiError::Refused)?;
        match self.send(request)? {
            (200, reply) => {
                #[derive(Deserialize)]
                struct Reply {
                    decision: String,
                }
                let reply: Reply =
                    serde_json::from_str(&reply).map_err(|_| ApiError::Unreachable)?;
                Ok(reply.decision == "granted")
            }
            _ => Err(ApiError::Refused),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    const SECRET: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    struct Fake {
        list: Result<String, ApiError>,
        reply: Result<bool, ApiError>,
        answers: Mutex<Vec<(String, String, bool)>>,
    }

    impl Fake {
        fn new(list: Result<String, ApiError>, reply: Result<bool, ApiError>) -> Self {
            Self {
                list,
                reply,
                answers: Mutex::default(),
            }
        }
    }

    impl ConsentApi for Fake {
        fn list(&self, _: &str) -> Result<String, ApiError> {
            self.list.clone()
        }
        fn answer(&self, secret: &str, nonce: &str, granted: bool) -> Result<bool, ApiError> {
            self.answers
                .lock()
                .unwrap()
                .push((secret.into(), nonce.into(), granted));
            self.reply
        }
    }

    fn pending(what: &str, nonce: &str, title: &str) -> String {
        format!(
            r#"{{"pending":[{{"nonce":"{nonce}","what":"{what}","requested_by":"x","title":"{title}","expires_at":"z"}}]}}"#
        )
    }

    fn run(api: &Fake, answer: Option<bool>) -> (Step, Vec<Prompt>) {
        let shown = Mutex::new(Vec::new());
        let ask = |p: &Prompt| {
            shown.lock().unwrap().push(p.clone());
            answer
        };
        let step = step(api, SECRET, &ask, &mut None);
        (step, shown.into_inner().unwrap())
    }

    #[test]
    fn record_is_the_only_yes_and_core_must_confirm_it() {
        let api = Fake::new(Ok(pending(WHAT_RECORD, "n1", "Board call")), Ok(true));
        let (step, shown) = run(&api, Some(true));
        assert!(matches!(step, Step::Granted(_)));
        assert_eq!(shown.len(), 1);
        assert_eq!(
            api.answers.lock().unwrap()[0],
            (SECRET.to_string(), "n1".to_string(), true)
        );
        // Core did not confirm the grant: no Granted.
        let api = Fake::new(Ok(pending(WHAT_RECORD, "n1", "")), Ok(false));
        assert!(matches!(run(&api, Some(true)).0, Step::Denied));
    }

    #[test]
    fn cancel_closing_and_an_undisplayable_dialog_all_answer_denied() {
        for answer in [Some(false), None] {
            let api = Fake::new(Ok(pending(WHAT_RECORD, "n1", "")), Ok(false));
            assert!(matches!(run(&api, answer).0, Step::Denied));
            let sent = api.answers.lock().unwrap();
            assert_eq!(sent.len(), 1);
            assert!(!sent[0].2, "{answer:?}");
        }
    }

    #[test]
    fn a_granted_reply_to_a_denied_answer_is_not_a_grant() {
        let api = Fake::new(Ok(pending(WHAT_RECORD, "n1", "")), Ok(true));
        assert!(matches!(run(&api, Some(false)).0, Step::Denied));
    }

    #[test]
    fn unknown_kinds_and_odd_nonces_are_ignored_without_a_dialog() {
        for (what, nonce) in [
            ("filesystem.delete", "n1"),
            (WHAT_RECORD, ""),
            (WHAT_RECORD, "has space"),
            (WHAT_RECORD, "a/b"),
        ] {
            let api = Fake::new(Ok(pending(what, nonce, "")), Ok(true));
            let (step, shown) = run(&api, Some(true));
            assert!(matches!(step, Step::Ignored), "{what} {nonce}");
            assert!(shown.is_empty());
            assert!(api.answers.lock().unwrap().is_empty());
        }
    }

    #[test]
    fn a_nonce_is_asked_once() {
        let api = Fake::new(Ok(pending(WHAT_RECORD, "n1", "")), Ok(false));
        let mut last = None;
        let count = Mutex::new(0);
        let ask = |_: &Prompt| {
            *count.lock().unwrap() += 1;
            Some(false)
        };
        assert!(matches!(step(&api, SECRET, &ask, &mut last), Step::Denied));
        assert!(matches!(step(&api, SECRET, &ask, &mut last), Step::Ignored));
        assert_eq!(*count.lock().unwrap(), 1);
    }

    #[test]
    fn errors_and_garbage_show_nothing() {
        for list in [
            Err(ApiError::Unreachable),
            Err(ApiError::Refused),
            Ok("not json".to_string()),
            Ok(r#"{"pending":"x"}"#.to_string()),
        ] {
            let api = Fake::new(list, Ok(true));
            let (step, shown) = run(&api, Some(true));
            assert!(matches!(step, Step::Unavailable));
            assert!(shown.is_empty());
        }
        let api = Fake::new(Ok(r#"{"pending":[]}"#.to_string()), Ok(true));
        assert!(matches!(run(&api, Some(true)).0, Step::Idle));
        let api = Fake::new(
            Ok(pending(WHAT_RECORD, "n1", "")),
            Err(ApiError::Unreachable),
        );
        assert!(matches!(run(&api, Some(true)).0, Step::Unavailable));
    }

    #[test]
    fn the_text_is_fixed_and_the_title_is_cleaned_quoted_data() {
        let p = prompt(None);
        assert_eq!(p.cancel, "Cancel");
        assert_eq!(p.accept, "Record");
        assert!(p.message.contains("consent"));
        assert!(!p.message.contains("Title given"));
        let dirty = format!("Call\u{202e}\n\u{0}\u{200b}with Ana{}", "x".repeat(200));
        let shown = prompt(Some(&dirty)).message;
        assert!(shown.contains("Title given by the request: \u{201c}Callwith Ana"));
        assert!(!shown.contains('\u{202e}'));
        assert!(!shown.contains('\u{200b}'));
        assert!(shown.matches('x').count() <= MAX_TITLE_CHARS);
        assert_eq!(clean_title("  \n "), None);
        assert_eq!(clean_title("ok").as_deref(), Some("ok"));
    }

    #[test]
    fn requests_carry_the_secret_in_its_own_header_and_nothing_else() {
        let get = request_bytes(PENDING_PATH, "127.0.0.1:4870", SECRET, None).unwrap();
        assert!(get.starts_with("GET /api/notetaker/consent/pending HTTP/1.1\r\n"));
        assert!(get.contains(&format!("{SECRET_HEADER}: {SECRET}\r\n")));
        let lower = get.to_ascii_lowercase();
        for forbidden in ["authorization", "origin:", "cookie"] {
            assert!(!lower.contains(forbidden), "{forbidden}");
        }
        let body = answer_body("n_1-x", true).unwrap();
        assert_eq!(body, r#"{"nonce":"n_1-x","decision":"granted"}"#);
        let post = request_bytes(ANSWER_PATH, "127.0.0.1:4870", SECRET, Some(&body)).unwrap();
        assert!(post.contains(&format!("Content-Length: {}\r\n", body.len())));
        assert!(post.ends_with(&body));
    }

    #[test]
    fn nothing_that_could_split_a_header_or_the_body_is_sent() {
        for bad in [
            "",
            "short",
            "xyz",
            &SECRET.to_uppercase(),
            &format!("{SECRET}\r\nX: y"),
        ] {
            assert!(
                request_bytes(PENDING_PATH, "127.0.0.1:1", bad, None).is_none(),
                "{bad:?}"
            );
        }
        assert!(request_bytes(PENDING_PATH, "127.0.0.1:1\r\nX: y", SECRET, None).is_none());
        assert!(request_bytes(PENDING_PATH, "", SECRET, None).is_none());
        assert!(answer_body("a\"b", true).is_none());
        assert!(answer_body("", true).is_none());
        assert!(answer_body(&"a".repeat(65), true).is_none());
    }

    #[test]
    fn the_http_client_only_talks_to_loopback() {
        let api = HttpApi {
            base_url: "http://8.8.8.8:4870".into(),
        };
        assert_eq!(api.list(SECRET), Err(ApiError::Unreachable));
        let api = HttpApi {
            base_url: "https://127.0.0.1:4870".into(),
        };
        assert!(api.list(SECRET).is_err());
    }

    #[test]
    fn the_http_client_round_trips_against_a_loopback_socket() {
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let mut seen = Vec::new();
            for reply in [
                r#"{"pending":[{"nonce":"n1","what":"notetaker.record","title":null}]}"#,
                r#"{"decision":"granted"}"#,
            ] {
                let (mut s, _) = listener.accept().unwrap();
                s.set_read_timeout(Some(Duration::from_millis(300))).ok();
                let mut buf = [0u8; 2048];
                let n = s.read(&mut buf).unwrap_or(0);
                seen.push(String::from_utf8_lossy(&buf[..n]).into_owned());
                let _ = write!(
                    s,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}",
                    reply.len()
                );
            }
            seen
        });
        let api = HttpApi {
            base_url: format!("http://127.0.0.1:{port}"),
        };
        let body = api.list(SECRET).unwrap();
        assert!(body.contains("n1"));
        assert_eq!(api.answer(SECRET, "n1", true), Ok(true));
        let seen = server.join().unwrap();
        assert!(seen[0].starts_with("GET /api/notetaker/consent/pending"));
        assert!(seen[1].starts_with("POST /api/notetaker/consent/answer"));
        assert!(seen[1].contains(r#""decision":"granted""#));
    }
}
