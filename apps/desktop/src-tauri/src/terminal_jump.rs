// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! The "jump to terminal" shortcut. The shell asks Core to bring the terminal of the newest
//! active agent session to the front, using the same session token and loopback client as every
//! other Core call (`core_status::call`):
//!
//! 1. `GET /api/agent/sessions` lists the live sessions; the newest one that is active and has a
//!    known terminal is chosen. Core's answer is data, not instructions: the agent and session id
//!    must match Core's own patterns before they are put into a path.
//! 2. `POST /api/agent/sessions/<agent>%3A<id>/focus-terminal` asks Core to focus it. Core asks the
//!    person to confirm first (it starts a process) and audits the outcome, so this call waits for
//!    that answer; the shell never decides to run anything itself.
//!
//! When there is nothing to focus, the call fails, or Core answers anything unexpected, the
//! shortcut opens `/agents` (the page that lists the sessions) as before. A person who declined
//! the confirmation, or the emergency stop, is a refusal and opens nothing. The decisions here
//! are pure and unit-tested; `jump` takes the HTTP call as a parameter so a fake Core drives it.

use crate::core_status::{CallError, Method, TIMEOUT};
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// Longest the shell waits for Core to list sessions.
pub const LIST_TIMEOUT: Duration = TIMEOUT;
/// Longest the shell waits for the focus call. Core waits for the person to confirm in the
/// approval prompt, so this is longer than a status read; after it the shell opens `/agents`
/// (the prompt stays pending in Core and may still be answered there).
pub const FOCUS_TIMEOUT: Duration = Duration::from_secs(30);

const LIST_PATH: &str = "/api/agent/sessions";

/// What the shortcut does in the end.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    /// Core confirmed that it brought a terminal window to the front.
    Focused,
    /// The person declined, or the emergency stop is engaged: nothing is opened.
    Refused,
    /// Open the agents page instead.
    OpenAgents,
}

#[derive(Deserialize)]
struct Listing {
    sessions: Vec<Session>,
}

#[derive(Deserialize)]
struct Session {
    id: String,
    agent: String,
    #[serde(default)]
    last_seen: String,
    #[serde(default)]
    active: bool,
    #[serde(default)]
    has_terminal: bool,
}

/// Core's own pattern for an agent name (`LIVE_AGENT_PATTERN`).
fn agent_is_plain(agent: &str) -> bool {
    (1..=24).contains(&agent.len())
        && agent
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// Core's own pattern for a live session id (`LIVE_ID`).
fn session_id_is_plain(id: &str) -> bool {
    let mut bytes = id.bytes();
    (1..=100).contains(&id.len())
        && bytes.next().is_some_and(|b| b.is_ascii_alphanumeric())
        && bytes.all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
}

/// The focus route for one session, addressed as `<agent>:<id>` (the board's key, because two
/// agents may use the same session id). `None` when either part is not plain text.
pub fn focus_path(agent: &str, id: &str) -> Option<String> {
    (agent_is_plain(agent) && session_id_is_plain(id)).then(|| {
        format!(
            "/api/agent/sessions/{agent}%3A{}/focus-terminal",
            id.replace(':', "%3A")
        )
    })
}

/// The focus route of the newest session that is active and has a known terminal, from Core's
/// session list. A document that does not parse, or a session that is not plain text, gives
/// `None` (the shortcut then opens the agents page).
pub fn pick_focus_path(listing_json: &str) -> Option<String> {
    let listing: Listing = serde_json::from_str(listing_json).ok()?;
    listing
        .sessions
        .iter()
        .filter(|s| s.active && s.has_terminal)
        // Core sorts newest first; do not rely on it. ISO timestamps compare as text, and the
        // earliest of equal ones wins.
        .fold(None::<&Session>, |best, s| match best {
            Some(b) if b.last_seen >= s.last_seen => Some(b),
            _ => Some(s),
        })
        .and_then(|s| focus_path(&s.agent, &s.id))
}

#[derive(Deserialize)]
struct Focused {
    focused: bool,
}

#[derive(Deserialize)]
struct CoreError {
    code: String,
}

/// What Core's answer to the focus call means.
pub fn classify(status: u16, body: &str) -> Outcome {
    match status {
        200 => match serde_json::from_str::<Focused>(body) {
            Ok(Focused { focused: true }) => Outcome::Focused,
            _ => Outcome::OpenAgents,
        },
        403 => match serde_json::from_str::<CoreError>(body) {
            Ok(e)
                if matches!(
                    e.code.as_str(),
                    "PERMISSION_DENIED" | "SECURITY_POLICY_BLOCKED"
                ) =>
            {
                Outcome::Refused
            }
            _ => Outcome::OpenAgents,
        },
        _ => Outcome::OpenAgents,
    }
}

/// The HTTP call the shortcut makes: method, path, read timeout.
pub type Call<'a> = &'a dyn Fn(Method, &str, Duration) -> Result<(u16, String), CallError>;

/// Runs the whole shortcut against `call`.
pub fn jump(call: Call) -> Outcome {
    let Ok((200, listing)) = call(Method::Get, LIST_PATH, LIST_TIMEOUT) else {
        return Outcome::OpenAgents;
    };
    let Some(path) = pick_focus_path(&listing) else {
        return Outcome::OpenAgents;
    };
    match call(Method::Post, &path, FOCUS_TIMEOUT) {
        Ok((status, body)) => classify(status, &body),
        Err(_) => Outcome::OpenAgents,
    }
}

/// One jump at a time: a second press while the first still waits for the person's confirmation
/// would stack a second confirmation prompt.
#[derive(Default)]
pub struct Guard {
    running: Arc<AtomicBool>,
}

/// Holds the guard until dropped (it can move to the thread that does the call).
pub struct Running(Arc<AtomicBool>);

impl Guard {
    /// `None` while a jump is already running.
    pub fn begin(&self) -> Option<Running> {
        (!self.running.swap(true, Ordering::AcqRel)).then(|| Running(Arc::clone(&self.running)))
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn listing(sessions: &[&str]) -> String {
        format!(r#"{{"sessions":[{}]}}"#, sessions.join(","))
    }

    fn session(agent: &str, id: &str, last_seen: &str, active: bool, has_terminal: bool) -> String {
        format!(
            r#"{{"id":"{id}","agent":"{agent}","project":"/p","repository":"p","first_seen":"{last_seen}","last_seen":"{last_seen}","active":{active},"step_count":3,"dropped_steps":0,"has_terminal":{has_terminal}}}"#
        )
    }

    #[test]
    fn the_focus_path_names_the_agent_and_encodes_the_colon() {
        assert_eq!(
            focus_path("claude-code", "a1b2"),
            Some("/api/agent/sessions/claude-code%3Aa1b2/focus-terminal".into())
        );
        // A colon inside the id is encoded too, so the path keeps exactly one `<agent>:<id>` segment.
        assert_eq!(
            focus_path("codex", "x:y"),
            Some("/api/agent/sessions/codex%3Ax%3Ay/focus-terminal".into())
        );
    }

    #[test]
    fn nothing_that_is_not_plain_text_reaches_a_path() {
        let long_id = "a".repeat(101);
        let long_agent = "a".repeat(25);
        for (agent, id) in [
            ("", "x"),
            ("Claude", "x"),
            ("a b", "x"),
            ("a/b", "x"),
            ("a", ""),
            ("a", "-leading-dash"),
            ("a", "../../x"),
            ("a", "x y"),
            ("a", "x/y"),
            ("a", "x?y=1"),
            ("a", "x\r\nHost: evil"),
            ("a", "x#y"),
            ("a", "é"),
            ("a", long_id.as_str()),
            (long_agent.as_str(), "x"),
        ] {
            assert_eq!(focus_path(agent, id), None, "{agent:?} {id:?}");
        }
    }

    #[test]
    fn picks_the_newest_active_session_with_a_terminal() {
        let body = listing(&[
            &session("codex", "old", "2026-10-20T08:00:00.000Z", true, true),
            &session("claude-code", "new", "2026-10-20T09:30:00.000Z", true, true),
            // Newer, but there is no terminal to focus, or it is not active.
            &session("gemini", "noterm", "2026-10-20T10:00:00.000Z", true, false),
            &session("codex", "idle", "2026-10-20T11:00:00.000Z", false, true),
        ]);
        assert_eq!(
            pick_focus_path(&body),
            Some("/api/agent/sessions/claude-code%3Anew/focus-terminal".into())
        );
    }

    #[test]
    fn no_usable_session_or_a_bad_document_means_the_agents_page() {
        for body in [
            "",
            "{}",
            "null",
            "[]",
            r#"{"sessions":"x"}"#,
            r#"{"sessions":[{"id":1}]}"#,
            "{ not json",
            &listing(&[]),
            &listing(&[&session("a", "x", "t", true, false)]),
            &listing(&[&session("a", "x", "t", false, true)]),
            // The only candidate is not plain text, so nothing is chosen.
            &listing(&[&session("a", "../x", "t", true, true)]),
        ] {
            assert_eq!(pick_focus_path(body), None, "{body}");
        }
    }

    #[test]
    fn classifies_core_answers() {
        assert_eq!(
            classify(200, r#"{"focused":true,"method":"osascript"}"#),
            Outcome::Focused
        );
        for body in [
            "",
            "{}",
            r#"{"focused":false}"#,
            r#"{"focused":"yes"}"#,
            "null",
        ] {
            assert_eq!(classify(200, body), Outcome::OpenAgents, "{body}");
        }
        // The person said no, or the emergency stop is on: nothing is opened.
        assert_eq!(
            classify(
                403,
                r#"{"code":"PERMISSION_DENIED","message":"Rejected by user"}"#
            ),
            Outcome::Refused
        );
        assert_eq!(
            classify(403, r#"{"code":"SECURITY_POLICY_BLOCKED","message":"x"}"#),
            Outcome::Refused
        );
        // Everything else (no terminal known, not supported, timeout, bad token) opens /agents.
        assert_eq!(classify(403, "{}"), Outcome::OpenAgents);
        assert_eq!(classify(403, "garbage"), Outcome::OpenAgents);
        for status in [400, 401, 404, 429, 500, 503, 504, 302] {
            assert_eq!(
                classify(status, r#"{"code":"CAPABILITY_UNAVAILABLE"}"#),
                Outcome::OpenAgents,
                "{status}"
            );
        }
    }

    type Seen = RefCell<Vec<(Method, String, Duration)>>;

    fn run(
        list: Result<(u16, String), CallError>,
        focus: Result<(u16, String), CallError>,
    ) -> (Outcome, Seen) {
        let seen: Seen = RefCell::new(Vec::new());
        let outcome = jump(&|method, path, timeout| {
            seen.borrow_mut().push((method, path.to_string(), timeout));
            if method == Method::Get {
                list.clone()
            } else {
                focus.clone()
            }
        });
        (outcome, seen)
    }

    fn one_session() -> Result<(u16, String), CallError> {
        Ok((
            200,
            listing(&[&session(
                "claude-code",
                "s1",
                "2026-10-20T09:00:00.000Z",
                true,
                true,
            )]),
        ))
    }

    #[test]
    fn lists_then_focuses_with_the_long_wait_only_for_the_confirmation() {
        let (outcome, seen) = run(one_session(), Ok((200, r#"{"focused":true}"#.into())));
        assert_eq!(outcome, Outcome::Focused);
        assert_eq!(
            *seen.borrow(),
            vec![
                (Method::Get, "/api/agent/sessions".to_string(), LIST_TIMEOUT),
                (
                    Method::Post,
                    "/api/agent/sessions/claude-code%3As1/focus-terminal".to_string(),
                    FOCUS_TIMEOUT
                ),
            ]
        );
        assert!(LIST_TIMEOUT <= Duration::from_secs(2));
    }

    #[test]
    fn falls_back_to_the_agents_page_when_core_cannot_be_used() {
        let ok_focus = Ok((200, r#"{"focused":true}"#.to_string()));
        // Core is down, refuses the token, or the list is unusable: the focus call is never made.
        for list in [
            Err(CallError::NoToken),
            Err(CallError::Unanswered),
            Ok((401, "{}".to_string())),
            Ok((500, "{}".to_string())),
            Ok((200, "garbage".to_string())),
            Ok((200, listing(&[]))),
        ] {
            let (outcome, seen) = run(list.clone(), ok_focus.clone());
            assert_eq!(outcome, Outcome::OpenAgents, "{list:?}");
            assert_eq!(seen.borrow().len(), 1, "{list:?}");
        }
        // The list worked but the focus call failed or Core says no terminal.
        for focus in [
            Err(CallError::Unanswered),
            Ok((503, r#"{"code":"CAPABILITY_UNAVAILABLE"}"#.to_string())),
            Ok((400, r#"{"code":"INVALID_REQUEST"}"#.to_string())),
            Ok((200, "{}".to_string())),
        ] {
            let (outcome, _) = run(one_session(), focus.clone());
            assert_eq!(outcome, Outcome::OpenAgents, "{focus:?}");
        }
    }

    #[test]
    fn a_declined_confirmation_opens_nothing() {
        let (outcome, _) = run(
            one_session(),
            Ok((
                403,
                r#"{"code":"PERMISSION_DENIED","message":"Rejected by user"}"#.into(),
            )),
        );
        assert_eq!(outcome, Outcome::Refused);
    }

    #[test]
    fn a_second_press_while_one_waits_does_not_start_another() {
        let guard = Guard::default();
        let first = guard.begin();
        assert!(first.is_some());
        assert!(guard.begin().is_none());
        assert!(guard.begin().is_none());
        drop(first);
        // Released: the next press works, and holding it again blocks again.
        let again = guard.begin();
        assert!(again.is_some());
        assert!(guard.begin().is_none());
    }

    /// A loopback "Core" that answers each request in turn (`replies[i]` for request `i`) and
    /// returns the request lines and `Authorization` headers it saw.
    fn fake_core(replies: Vec<String>) -> (String, std::thread::JoinHandle<Vec<String>>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            let mut seen = Vec::new();
            for reply in replies {
                let (mut stream, _) = listener.accept().unwrap();
                let mut raw = Vec::new();
                let mut buf = [0u8; 512];
                while !raw.windows(4).any(|w| w == b"\r\n\r\n") {
                    let n = stream.read(&mut buf).unwrap();
                    if n == 0 {
                        break;
                    }
                    raw.extend_from_slice(&buf[..n]);
                }
                let text = String::from_utf8_lossy(&raw).into_owned();
                let auth = text
                    .lines()
                    .find(|l| l.starts_with("Authorization:"))
                    .unwrap_or("");
                seen.push(format!("{} | {auth}", text.lines().next().unwrap_or("")));
                stream.write_all(reply.as_bytes()).unwrap();
            }
            seen
        });
        (base, handle)
    }

    fn json_reply(status: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    #[test]
    fn against_a_real_loopback_socket_it_lists_then_focuses_with_the_session_token() {
        let body = listing(&[&session(
            "claude-code",
            "s1",
            "2026-10-20T09:00:00.000Z",
            true,
            true,
        )]);
        let (base, server) = fake_core(vec![
            json_reply("200 OK", &body),
            json_reply("200 OK", r#"{"focused":true,"method":"fake"}"#),
        ]);
        let outcome = jump(&|method, path, timeout| {
            crate::core_status::call(&base, Some("tok-9"), method, path, timeout)
        });
        assert_eq!(outcome, Outcome::Focused);
        assert_eq!(
            server.join().unwrap(),
            vec![
                "GET /api/agent/sessions HTTP/1.1 | Authorization: Bearer tok-9".to_string(),
                "POST /api/agent/sessions/claude-code%3As1/focus-terminal HTTP/1.1 | Authorization: Bearer tok-9"
                    .to_string(),
            ]
        );
    }

    #[test]
    fn against_a_real_socket_a_refused_token_or_a_redirect_opens_the_agents_page() {
        let (base, server) = fake_core(vec![json_reply("401 Unauthorized", "{}")]);
        let outcome = jump(&|method, path, timeout| {
            crate::core_status::call(&base, Some("stale"), method, path, timeout)
        });
        assert_eq!(outcome, Outcome::OpenAgents);
        assert_eq!(server.join().unwrap().len(), 1);

        let redirect =
            "HTTP/1.1 302 Found\r\nLocation: http://evil.example/\r\nContent-Length: 0\r\n\r\n"
                .to_string();
        let (base, server) = fake_core(vec![redirect]);
        let outcome = jump(&|method, path, timeout| {
            crate::core_status::call(&base, Some("t"), method, path, timeout)
        });
        assert_eq!(outcome, Outcome::OpenAgents);
        assert_eq!(server.join().unwrap().len(), 1);
    }

    #[test]
    fn with_no_core_and_no_token_it_opens_the_agents_page() {
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let base = format!("http://127.0.0.1:{port}");
        assert_eq!(
            jump(&|method, path, timeout| {
                crate::core_status::call(&base, Some("t"), method, path, timeout)
            }),
            Outcome::OpenAgents
        );
        assert_eq!(
            jump(&|method, path, timeout| {
                crate::core_status::call(&base, None, method, path, timeout)
            }),
            Outcome::OpenAgents
        );
    }
}
