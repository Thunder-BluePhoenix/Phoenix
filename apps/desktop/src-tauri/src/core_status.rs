// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! The hotkey works only while Phoenix Core says dictation is on. The shell asks Core
//! (`GET /api/dictation/status` with the session token) just before it would start a capture, so
//! turning dictation off in Settings, or the emergency stop, takes effect on the next key press
//! without restarting the app.
//!
//! This is a deliberately tiny HTTP/1.1 client for loopback calls with the session token: Core
//! binds to 127.0.0.1 only (ADR-0015), so there is no TLS and no proxy to handle, a redirect is
//! never followed (any 3xx is just a status the caller refuses), and the shell does not need an
//! HTTP crate for it. [`call`] is the one place that opens the socket; the dictation gate, the
//! terminal jump (`terminal_jump.rs`) and the quit veto (`quit_veto.rs`) all go through it. The
//! request builder and the response parser are pure and unit-tested; `call` is tested against a
//! real loopback socket.

use serde::Deserialize;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

/// Longest response the shell reads (status documents are about 1 KB).
const MAX_RESPONSE: u64 = 256 * 1024;
/// Connect, write and (unless the caller says otherwise) read timeout.
pub const TIMEOUT: Duration = Duration::from_millis(1500);
const PATH: &str = "/api/dictation/status";

/// Why dictation cannot start right now, in words for the person.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Gate {
    Open,
    Closed(String),
}

#[derive(Deserialize)]
struct Recognizer {
    available: bool,
    #[serde(default)]
    detail: String,
}

#[derive(Deserialize)]
struct Status {
    enabled: bool,
    #[serde(default)]
    kill_switch_engaged: bool,
    recognizer: Recognizer,
}

/// Turns Core's status document into a yes/no with a reason. Starting a capture also needs a
/// working recogniser; pasting text already dictated does not (see [`fetch_paste_gate`]).
#[cfg(test)]
pub fn gate_from_status(body: &str) -> Gate {
    gate_with(body, true)
}

fn gate_with(body: &str, needs_recogniser: bool) -> Gate {
    let Ok(status) = serde_json::from_str::<Status>(body) else {
        return Gate::Closed(
            "Phoenix Core sent a dictation status this app does not understand.".into(),
        );
    };
    if !status.enabled {
        Gate::Closed("Dictation is off. Turn it on in Phoenix Settings, under Dictation.".into())
    } else if status.kill_switch_engaged {
        Gate::Closed("The emergency stop is engaged.".into())
    } else if needs_recogniser && !status.recognizer.available {
        Gate::Closed(if status.recognizer.detail.is_empty() {
            "No speech recogniser is available.".into()
        } else {
            // Core's own wording about the recogniser, shown as text only.
            status.recognizer.detail.chars().take(200).collect()
        })
    } else {
        Gate::Open
    }
}

/// The HTTP method of a call. Only these two exist: nothing else is ever sent to Core.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Method {
    Get,
    /// Sent with `Content-Length: 0`; the routes the shell posts to ignore the body.
    Post,
}

/// The request bytes. The token is validated by `connection::read_token` (URL-safe base64
/// characters only), so it cannot inject a header; a token with anything else is refused here too.
/// `path` must be an absolute path of plain URL characters (no space, CR, LF or query), so a
/// caller can never split the request line either.
pub fn request(method: Method, path: &str, port_host: &str, token: &str) -> Option<String> {
    let clean_token = !token.is_empty()
        && token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    let clean_path = path.len() <= 300
        && path.starts_with('/')
        && !path.starts_with("//")
        && path
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"/_.:%-".contains(&b));
    (clean_token && clean_path).then(|| {
        let (verb, framing) = match method {
            Method::Get => ("GET", ""),
            Method::Post => ("POST", "Content-Length: 0\r\n"),
        };
        format!(
            "{verb} {path} HTTP/1.1\r\nHost: {port_host}\r\nAuthorization: Bearer {token}\r\nAccept: application/json\r\n{framing}Connection: close\r\n\r\n"
        )
    })
}

/// Splits an HTTP/1.1 response into (status code, body). Handles `Content-Length` and chunked
/// bodies (Node uses either).
pub fn parse_response(raw: &[u8]) -> Option<(u16, String)> {
    let split = raw.windows(4).position(|w| w == b"\r\n\r\n")?;
    let head = std::str::from_utf8(&raw[..split]).ok()?;
    let body = &raw[split + 4..];
    let mut lines = head.split("\r\n");
    let code = lines.next()?.split(' ').nth(1)?.parse::<u16>().ok()?;
    let mut chunked = false;
    let mut length = None;
    for line in lines {
        let (name, value) = line.split_once(':')?;
        let (name, value) = (name.trim().to_ascii_lowercase(), value.trim());
        if name == "transfer-encoding" && value.to_ascii_lowercase().contains("chunked") {
            chunked = true;
        } else if name == "content-length" {
            length = value.parse::<usize>().ok();
        }
    }
    let bytes = if chunked {
        dechunk(body)?
    } else {
        match length {
            Some(n) if body.len() >= n => body[..n].to_vec(),
            Some(_) => return None,
            None => body.to_vec(),
        }
    };
    Some((code, String::from_utf8(bytes).ok()?))
}

fn dechunk(mut body: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    loop {
        let line_end = body.windows(2).position(|w| w == b"\r\n")?;
        let size_text = std::str::from_utf8(&body[..line_end]).ok()?;
        let size = usize::from_str_radix(size_text.split(';').next()?.trim(), 16).ok()?;
        body = &body[line_end + 2..];
        if size == 0 {
            return Some(out);
        }
        if body.len() < size + 2 {
            return None;
        }
        out.extend_from_slice(&body[..size]);
        body = &body[size + 2..];
    }
}

/// Why a loopback call did not produce an answer. Never carries the token.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CallError {
    NoToken,
    NotLocal,
    BadToken,
    BadAddress,
    Unanswered,
}

impl CallError {
    /// In words for the person.
    pub fn message(self) -> &'static str {
        match self {
            CallError::NoToken => "Phoenix Core is not running (no session token).",
            CallError::NotLocal => "Phoenix Core is not on this computer.",
            CallError::BadToken => "Phoenix Core's session token is not usable.",
            CallError::BadAddress => "Phoenix Core's address is not usable.",
            CallError::Unanswered => "Phoenix Core did not answer.",
        }
    }
}

/// One authenticated loopback call: `(status code, body)`. `read_timeout` bounds the wait for the
/// answer (a call that waits for the person, such as a confirmation, passes a longer one); the
/// body is cut at [`MAX_RESPONSE`]. The base URL must be `http://<loopback ip>:<port>`; the token
/// is sent nowhere else and is never logged.
pub fn call(
    base_url: &str,
    token: Option<&str>,
    method: Method,
    path: &str,
    read_timeout: Duration,
) -> Result<(u16, String), CallError> {
    let token = token.ok_or(CallError::NoToken)?;
    let addr = base_url
        .strip_prefix("http://")
        .ok_or(CallError::NotLocal)?;
    let request = request(method, path, addr, token).ok_or(CallError::BadToken)?;
    let socket = addr
        .parse::<SocketAddr>()
        .map_err(|_| CallError::BadAddress)?;
    if !socket.ip().is_loopback() {
        return Err(CallError::NotLocal);
    }
    let mut stream =
        TcpStream::connect_timeout(&socket, TIMEOUT).map_err(|_| CallError::Unanswered)?;
    let _ = stream.set_read_timeout(Some(read_timeout));
    let _ = stream.set_write_timeout(Some(TIMEOUT));
    stream
        .write_all(request.as_bytes())
        .map_err(|_| CallError::Unanswered)?;
    let mut raw = Vec::new();
    if stream.take(MAX_RESPONSE).read_to_end(&mut raw).is_err() && raw.is_empty() {
        return Err(CallError::Unanswered);
    }
    parse_response(&raw).ok_or(CallError::Unanswered)
}

/// Asks Core. Any failure (Core not running, no token, a refusal, garbage) is a closed gate
/// with a reason: dictation never starts on a guess.
pub fn fetch(base_url: &str, token: Option<&str>) -> Gate {
    fetch_with(base_url, token, true)
}

/// Asks Core whether an already dictated text may still be pasted (paste-again): dictation
/// enabled and the emergency stop released. Any failure is a closed gate.
pub fn fetch_paste_gate(base_url: &str, token: Option<&str>) -> Gate {
    fetch_with(base_url, token, false)
}

fn fetch_with(base_url: &str, token: Option<&str>, needs_recogniser: bool) -> Gate {
    match call(base_url, token, Method::Get, PATH, TIMEOUT) {
        Ok((200, body)) => gate_with(&body, needs_recogniser),
        Ok((401, _)) => Gate::Closed("Phoenix Core refused the session token.".into()),
        Ok(_) => Gate::Closed("Phoenix Core refused the dictation status request.".into()),
        Err(why) => Gate::Closed(why.message().into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    fn status(enabled: bool, kill: bool, available: bool, detail: &str) -> String {
        format!(
            r#"{{"enabled":{enabled},"kill_switch_engaged":{kill},"recognizer":{{"available":{available},"detail":"{detail}"}},"audio_on_disk":false}}"#
        )
    }

    #[test]
    fn open_only_when_enabled_not_killed_and_a_recogniser_exists() {
        assert_eq!(
            gate_from_status(&status(true, false, true, "x")),
            Gate::Open
        );
        for (e, k, a) in [
            (false, false, true),
            (true, true, true),
            (true, false, false),
            (false, true, false),
        ] {
            assert!(
                matches!(gate_from_status(&status(e, k, a, "none")), Gate::Closed(_)),
                "{e} {k} {a}"
            );
        }
    }

    #[test]
    fn the_paste_gate_ignores_the_recogniser_but_not_the_switches() {
        assert_eq!(
            gate_with(&status(true, false, false, "none"), false),
            Gate::Open
        );
        for (e, k) in [(false, false), (true, true), (false, true)] {
            assert!(
                matches!(gate_with(&status(e, k, true, "x"), false), Gate::Closed(_)),
                "{e} {k}"
            );
        }
    }

    #[test]
    fn reasons_are_specific() {
        let Gate::Closed(off) = gate_from_status(&status(false, false, true, "")) else {
            panic!()
        };
        assert!(off.contains("Dictation is off"));
        let Gate::Closed(kill) = gate_from_status(&status(true, true, true, "")) else {
            panic!()
        };
        assert!(kill.contains("emergency stop"));
        let Gate::Closed(rec) = gate_from_status(&status(true, false, false, "No model set"))
        else {
            panic!()
        };
        assert_eq!(rec, "No model set");
        let Gate::Closed(rec) = gate_from_status(&status(true, false, false, "")) else {
            panic!()
        };
        assert!(rec.contains("recogniser"));
    }

    #[test]
    fn a_bad_document_is_closed_not_open() {
        for body in ["", "{}", "null", "[]", r#"{"enabled":"yes"}"#, "{ not json"] {
            assert!(matches!(gate_from_status(body), Gate::Closed(_)), "{body}");
        }
    }

    #[test]
    fn the_request_carries_the_token_and_refuses_anything_that_could_split_a_header() {
        let text = request(Method::Get, PATH, "127.0.0.1:4870", "abc-DEF_123").unwrap();
        assert!(text.starts_with("GET /api/dictation/status HTTP/1.1\r\n"));
        assert!(text.contains("Authorization: Bearer abc-DEF_123\r\n"));
        assert!(text.contains("Host: 127.0.0.1:4870\r\n"));
        assert!(text.ends_with("\r\n\r\n"));
        for bad in ["", "a b", "a\r\nX: y", "a\n", "tok;en", "\u{e9}"] {
            assert_eq!(
                request(Method::Get, PATH, "127.0.0.1:1", bad),
                None,
                "{bad:?}"
            );
        }
    }

    #[test]
    fn a_post_says_it_has_no_body_and_a_path_can_never_split_the_request() {
        let text = request(Method::Post, "/api/x/y", "127.0.0.1:1", "tok").unwrap();
        assert!(text.starts_with("POST /api/x/y HTTP/1.1\r\n"));
        assert!(text.contains("Content-Length: 0\r\n"));
        assert!(!request(Method::Get, PATH, "h", "t")
            .unwrap()
            .contains("Content-Length"));
        let long = format!("/{}", "a".repeat(400));
        for bad in [
            "",
            "api",
            "//evil",
            "/a b",
            "/a?x=1",
            "/a#b",
            "/a\r\nX: y",
            long.as_str(),
        ] {
            assert_eq!(
                request(Method::Post, bad, "127.0.0.1:1", "tok"),
                None,
                "{bad:?}"
            );
        }
    }

    #[test]
    fn parses_content_length_and_chunked_bodies() {
        let plain = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 4\r\n\r\ntrue-extra";
        assert_eq!(parse_response(plain), Some((200, "true".into())));
        let chunked = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n4;ext=1\r\ndefg\r\n0\r\n\r\n";
        assert_eq!(parse_response(chunked), Some((200, "abcdefg".into())));
        let no_length = b"HTTP/1.1 401 Unauthorized\r\n\r\n{}";
        assert_eq!(parse_response(no_length), Some((401, "{}".into())));
    }

    #[test]
    fn rejects_truncated_or_malformed_responses() {
        for raw in [
            &b""[..],
            b"HTTP/1.1 200 OK\r\n",
            b"garbage\r\n\r\nbody",
            b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nshort",
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nab",
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nzz\r\n",
            b"HTTP/1.1 abc OK\r\n\r\n",
        ] {
            assert_eq!(
                parse_response(raw),
                None,
                "{:?}",
                String::from_utf8_lossy(raw)
            );
        }
    }

    /// One-shot loopback server answering a single request with `reply`; returns the request
    /// it saw through the join handle.
    fn serve(reply: Vec<u8>) -> (String, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut seen = Vec::new();
            let mut buf = [0u8; 512];
            while !seen.windows(4).any(|w| w == b"\r\n\r\n") {
                let n = stream.read(&mut buf).unwrap();
                if n == 0 {
                    break;
                }
                seen.extend_from_slice(&buf[..n]);
            }
            stream.write_all(&reply).unwrap();
            String::from_utf8_lossy(&seen).into_owned()
        });
        (base, handle)
    }

    fn ok(body: &str) -> Vec<u8> {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
        .into_bytes()
    }

    #[test]
    fn fetch_opens_the_gate_from_a_real_loopback_answer_and_sends_the_token() {
        let (base, server) = serve(ok(&status(true, false, true, "")));
        assert_eq!(fetch(&base, Some("tok-1")), Gate::Open);
        let seen = server.join().unwrap();
        assert!(seen.starts_with("GET /api/dictation/status HTTP/1.1"));
        assert!(seen.contains("Authorization: Bearer tok-1"));
    }

    #[test]
    fn fetch_closes_the_gate_when_core_says_off_or_refuses() {
        let (base, server) = serve(ok(&status(false, false, true, "")));
        assert!(
            matches!(fetch(&base, Some("t")), Gate::Closed(r) if r.contains("Dictation is off"))
        );
        server.join().unwrap();
        let denied = b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 2\r\n\r\n{}".to_vec();
        let (base, server) = serve(denied);
        assert!(matches!(fetch(&base, Some("t")), Gate::Closed(r) if r.contains("token")));
        server.join().unwrap();
    }

    #[test]
    fn fetch_is_closed_without_a_token_a_listener_or_a_local_address() {
        assert!(matches!(
            fetch("http://127.0.0.1:4870", None),
            Gate::Closed(_)
        ));
        // Nothing listens on a just-released port.
        let port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        assert!(matches!(
            fetch(&format!("http://127.0.0.1:{port}"), Some("t")),
            Gate::Closed(r) if r.contains("did not answer")
        ));
        // The token is never sent anywhere but loopback.
        assert!(matches!(
            fetch("http://192.0.2.1:4870", Some("t")),
            Gate::Closed(_)
        ));
        assert!(matches!(
            fetch("https://127.0.0.1:4870", Some("t")),
            Gate::Closed(_)
        ));
    }

    #[test]
    fn call_posts_with_the_token_and_returns_the_status_and_body() {
        let reply =
            b"HTTP/1.1 403 Forbidden\r\nContent-Length: 16\r\n\r\n{\"code\":\"NO\"}   ".to_vec();
        let (base, server) = serve(reply);
        let got = call(
            &base,
            Some("tok-2"),
            Method::Post,
            "/api/agent/sessions/a%3Ab/focus-terminal",
            Duration::from_secs(2),
        );
        assert_eq!(got, Ok((403, "{\"code\":\"NO\"}   ".into())));
        let seen = server.join().unwrap();
        assert!(seen.starts_with("POST /api/agent/sessions/a%3Ab/focus-terminal HTTP/1.1"));
        assert!(seen.contains("Authorization: Bearer tok-2"));
    }

    #[test]
    fn call_never_follows_a_redirect_it_just_reports_the_status() {
        let redirect =
            b"HTTP/1.1 302 Found\r\nLocation: http://evil.example/\r\nContent-Length: 0\r\n\r\n"
                .to_vec();
        let (base, server) = serve(redirect);
        assert_eq!(
            call(&base, Some("t"), Method::Get, "/x", TIMEOUT),
            Ok((302, String::new()))
        );
        server.join().unwrap();
    }

    #[test]
    fn call_reads_at_most_the_response_bound() {
        let body = "a".repeat(MAX_RESPONSE as usize + 1000);
        let reply = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        )
        .into_bytes();
        let (base, server) = serve(reply);
        // The body is cut, so the declared length is not met: refused, not half-trusted.
        assert_eq!(
            call(&base, Some("t"), Method::Get, "/x", TIMEOUT),
            Err(CallError::Unanswered)
        );
        let _ = server.join();
    }

    #[test]
    fn call_gives_up_after_the_read_timeout() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let started = std::time::Instant::now();
        let got = call(
            &base,
            Some("t"),
            Method::Get,
            "/x",
            Duration::from_millis(150),
        );
        assert_eq!(got, Err(CallError::Unanswered));
        assert!(started.elapsed() < Duration::from_secs(5));
        drop(listener);
    }

    #[test]
    fn call_errors_never_contain_the_token() {
        for why in [
            CallError::NoToken,
            CallError::NotLocal,
            CallError::BadToken,
            CallError::BadAddress,
            CallError::Unanswered,
        ] {
            assert!(!why.message().contains("Bearer"));
        }
        assert_eq!(
            call(
                "http://127.0.0.1:1",
                Some("bad token"),
                Method::Get,
                "/x",
                TIMEOUT
            ),
            Err(CallError::BadToken)
        );
    }
}
