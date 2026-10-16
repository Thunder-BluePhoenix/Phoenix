// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! The hotkey works only while Phoenix Core says dictation is on. The shell asks Core
//! (`GET /api/dictation/status` with the session token) just before it would start a capture, so
//! turning dictation off in Settings, or the emergency stop, takes effect on the next key press
//! without restarting the app.
//!
//! This is a deliberately tiny HTTP/1.1 client for one loopback GET: Core binds to 127.0.0.1
//! only (ADR-0015), so there is no TLS, no redirect and no proxy to handle, and the shell does
//! not need an HTTP crate for it. The request builder and the response parser are pure and
//! unit-tested; `fetch` is tested against a real loopback socket.

use serde::Deserialize;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

/// Longest response the shell reads (status documents are about 1 KB).
const MAX_RESPONSE: u64 = 256 * 1024;
const TIMEOUT: Duration = Duration::from_millis(1500);
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

/// The request bytes. The token is validated by `connection::read_token` (URL-safe base64
/// characters only), so it cannot inject a header; a token with anything else is refused here too.
pub fn request(port_host: &str, token: &str) -> Option<String> {
    let clean = !token.is_empty()
        && token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    clean.then(|| {
        format!(
            "GET {PATH} HTTP/1.1\r\nHost: {port_host}\r\nAuthorization: Bearer {token}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
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
    let Some(token) = token else {
        return Gate::Closed("Phoenix Core is not running (no session token).".into());
    };
    let Some(addr) = base_url.strip_prefix("http://") else {
        return Gate::Closed("Phoenix Core is not on this computer.".into());
    };
    let Some(request) = request(addr, token) else {
        return Gate::Closed("Phoenix Core's session token is not usable.".into());
    };
    let Ok(socket) = addr.parse::<SocketAddr>() else {
        return Gate::Closed("Phoenix Core's address is not usable.".into());
    };
    if !socket.ip().is_loopback() {
        return Gate::Closed("Phoenix Core is not on this computer.".into());
    }
    let closed = || Gate::Closed("Phoenix Core did not answer.".into());
    let Ok(mut stream) = TcpStream::connect_timeout(&socket, TIMEOUT) else {
        return closed();
    };
    let _ = stream.set_read_timeout(Some(TIMEOUT));
    let _ = stream.set_write_timeout(Some(TIMEOUT));
    if stream.write_all(request.as_bytes()).is_err() {
        return closed();
    }
    let mut raw = Vec::new();
    if stream.take(MAX_RESPONSE).read_to_end(&mut raw).is_err() && raw.is_empty() {
        return closed();
    }
    match parse_response(&raw) {
        Some((200, body)) => gate_with(&body, needs_recogniser),
        Some((401, _)) => Gate::Closed("Phoenix Core refused the session token.".into()),
        Some(_) => Gate::Closed("Phoenix Core refused the dictation status request.".into()),
        None => closed(),
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
        let text = request("127.0.0.1:4870", "abc-DEF_123").unwrap();
        assert!(text.starts_with("GET /api/dictation/status HTTP/1.1\r\n"));
        assert!(text.contains("Authorization: Bearer abc-DEF_123\r\n"));
        assert!(text.contains("Host: 127.0.0.1:4870\r\n"));
        assert!(text.ends_with("\r\n\r\n"));
        for bad in ["", "a b", "a\r\nX: y", "a\n", "tok;en", "\u{e9}"] {
            assert_eq!(request("127.0.0.1:1", bad), None, "{bad:?}");
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
}
