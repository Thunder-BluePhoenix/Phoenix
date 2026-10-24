// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! The Keep-awake countdown in the tray (Phase 72). The shell asks Core (`GET /api/awake/status`,
//! session token, loopback, via `core_status::call`) how long the running session has left and
//! shows it as a disabled menu entry at the top of the tray menu and in the tray tooltip. It only
//! reads: it can neither start, extend nor end a session (those stay confirmed in Core).
//!
//! Nothing is shown unless Core says a session is running: no token, Core not running, a non-200
//! answer, a document the shell cannot read, a session without a believable end time and a number
//! larger than any session Core can hold all hide the entry. Core's text is data: only the numbers
//! are used, and the words are fixed here.
//!
//! The pure parts (parser, wording, refresh interval) are unit-tested here; the menu and the
//! refresh loop that use them live in `lib.rs`.

use crate::core_status::{call, Method, TIMEOUT};
use serde::Deserialize;
use std::time::Duration;

/// Core's route for the countdown (read-only, session token).
pub const PATH: &str = "/api/awake/status";

/// How often Core is asked while a session is running (the menu shows whole minutes).
pub const ACTIVE_REFRESH: Duration = Duration::from_secs(20);
/// How often Core is asked while nothing is shown, to notice a session that has just started. One
/// small loopback request; it stops being sent at all once the app is gone.
pub const IDLE_PROBE: Duration = Duration::from_secs(60);

/// The longest remaining time believed: Core caps a session at 10080 minutes (7 days), so
/// anything past 8 days is a document this shell does not trust.
pub const MAX_BELIEVED_SECONDS: i64 = 8 * 24 * 3600;

/// What the tray shows.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Awake {
    /// No entry (nothing running, or nothing believable).
    Hidden,
    /// A session with `seconds` left (never negative, never past [`MAX_BELIEVED_SECONDS`]).
    Timed { seconds: i64 },
    /// An agents-grace session held by working agents: it has no end time yet.
    WhileAgentsWork,
}

#[derive(Deserialize)]
struct View {
    available: bool,
    active: bool,
    #[serde(default)]
    mode: Option<String>,
    #[serde(default)]
    remaining_seconds: Option<i64>,
}

/// Reads Core's answer defensively: only a 200 with a well-formed document counts.
pub fn parse(status: u16, body: &str) -> Awake {
    if status != 200 {
        return Awake::Hidden;
    }
    let Ok(view) = serde_json::from_str::<View>(body) else {
        return Awake::Hidden;
    };
    if !view.available || !view.active {
        return Awake::Hidden;
    }
    match view.remaining_seconds {
        // A negative number is a session that has just run out: shown as ending, not as a bug.
        Some(seconds) if seconds <= MAX_BELIEVED_SECONDS => Awake::Timed {
            seconds: seconds.max(0),
        },
        Some(_) => Awake::Hidden,
        None if view.mode.as_deref() == Some("agents_grace") => Awake::WhileAgentsWork,
        None => Awake::Hidden,
    }
}

/// Asks Core. Any failure (Core not running, no token, a refusal, garbage) hides the entry.
pub fn fetch(base_url: &str, token: Option<&str>) -> Awake {
    match call(base_url, token, Method::Get, PATH, TIMEOUT) {
        Ok((status, body)) => parse(status, &body),
        Err(_) => Awake::Hidden,
    }
}

/// "45 min left", "1 h 05 min left", "2 d 3 h left". Zero (or a negative number: the session has
/// just run out) is "ending now"; under a minute is "less than 1 min left". `None` for a number
/// past [`MAX_BELIEVED_SECONDS`], which is never shown.
pub fn format_remaining(seconds: i64) -> Option<String> {
    if seconds > MAX_BELIEVED_SECONDS {
        return None;
    }
    let seconds = seconds.max(0);
    let minutes = seconds / 60;
    Some(match seconds {
        0 => "ending now".to_string(),
        1..=59 => "less than 1 min left".to_string(),
        _ if minutes < 60 => format!("{minutes} min left"),
        _ if minutes < 24 * 60 => match minutes % 60 {
            0 => format!("{} h left", minutes / 60),
            rest => format!("{} h {rest:02} min left", minutes / 60),
        },
        _ => match (minutes / 60) % 24 {
            0 => format!("{} d left", minutes / (24 * 60)),
            hours => format!("{} d {hours} h left", minutes / (24 * 60)),
        },
    })
}

/// The text of the disabled menu entry, or `None` when nothing is shown.
pub fn menu_text(awake: &Awake) -> Option<String> {
    match awake {
        Awake::Hidden => None,
        Awake::Timed { seconds } => {
            format_remaining(*seconds).map(|left| format!("Keep awake: {left}"))
        }
        Awake::WhileAgentsWork => Some("Keep awake: while agents work".to_string()),
    }
}

/// The tray's tooltip.
pub fn tooltip(awake: &Awake) -> String {
    match menu_text(awake) {
        Some(text) => format!("Fawkes - {text}"),
        None => "Fawkes".to_string(),
    }
}

/// When to ask Core next: soon after the end of a session that is about to finish (so the entry
/// goes away promptly), every [`ACTIVE_REFRESH`] otherwise, and every [`IDLE_PROBE`] when nothing
/// is shown.
pub fn next_delay(awake: &Awake) -> Duration {
    match awake {
        Awake::Hidden => IDLE_PROBE,
        Awake::WhileAgentsWork => ACTIVE_REFRESH,
        Awake::Timed { seconds } => {
            let until_end = Duration::from_secs((*seconds).max(0) as u64 + 1);
            ACTIVE_REFRESH.min(until_end)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(active: bool, mode: &str, remaining: &str) -> String {
        format!(
            r#"{{"available":true,"active":{active},"mode":"{mode}","remaining_seconds":{remaining}}}"#
        )
    }

    /// Serves `reply` (a whole HTTP response) once on a free loopback port; returns the port and
    /// the request head it saw.
    fn serve_once(reply: String) -> (u16, std::thread::JoinHandle<String>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
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
            stream.write_all(reply.as_bytes()).unwrap();
            String::from_utf8_lossy(&raw).into_owned()
        });
        (port, handle)
    }

    fn ok(body: &str) -> String {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    #[test]
    fn fetch_sends_one_authenticated_get_to_the_status_route() {
        let (port, seen) = serve_once(ok(&body(true, "timed", "125")));
        let awake = fetch(&format!("http://127.0.0.1:{port}"), Some("tray-token_1"));
        assert_eq!(awake, Awake::Timed { seconds: 125 });
        let head = seen.join().unwrap();
        assert!(
            head.starts_with("GET /api/awake/status HTTP/1.1\r\n"),
            "{head}"
        );
        assert!(
            head.contains("Authorization: Bearer tray-token_1\r\n"),
            "{head}"
        );
    }

    #[test]
    fn fetch_hides_the_entry_without_a_token_a_refusal_or_a_listener() {
        assert_eq!(fetch("http://127.0.0.1:1", None), Awake::Hidden);
        assert_eq!(
            fetch("http://127.0.0.1:1", Some("tray-token_1")),
            Awake::Hidden
        );
        let (port, seen) = serve_once(
            "HTTP/1.1 401 Unauthorized\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}"
                .to_string(),
        );
        assert_eq!(
            fetch(&format!("http://127.0.0.1:{port}"), Some("tray-token_1")),
            Awake::Hidden
        );
        seen.join().unwrap();
        // Never a non-loopback address, whatever the token.
        assert_eq!(
            fetch("http://192.0.2.1:4870", Some("tray-token_1")),
            Awake::Hidden
        );
    }

    #[test]
    fn a_running_timed_session_shows_its_seconds() {
        assert_eq!(
            parse(200, &body(true, "timed", "3900")),
            Awake::Timed { seconds: 3900 }
        );
    }

    #[test]
    fn nothing_running_or_not_available_hides_the_entry() {
        assert_eq!(parse(200, &body(false, "timed", "null")), Awake::Hidden);
        // Not running, whatever number is left in the document.
        assert_eq!(parse(200, &body(false, "timed", "600")), Awake::Hidden);
        assert_eq!(
            parse(200, r#"{"available":false,"active":false}"#),
            Awake::Hidden
        );
        // A document that claims a session while saying it knows nothing is not believed.
        assert_eq!(
            parse(
                200,
                r#"{"available":false,"active":true,"mode":"timed","remaining_seconds":60}"#
            ),
            Awake::Hidden
        );
    }

    #[test]
    fn a_failed_status_or_garbled_document_hides_the_entry() {
        let good = body(true, "timed", "60");
        for status in [0, 204, 301, 401, 404, 500] {
            assert_eq!(parse(status, &good), Awake::Hidden, "status {status}");
        }
        for garbage in [
            "",
            "{",
            "null",
            "[]",
            "true",
            "<html>nope</html>",
            r#"{"available":true}"#,
            r#"{"available":true,"active":"yes"}"#,
            r#"{"available":true,"active":true,"mode":"timed","remaining_seconds":"60"}"#,
            r#"{"available":true,"active":true,"mode":"timed","remaining_seconds":1.5}"#,
            // Active with no end and not an agents-grace session: nothing believable to show.
            r#"{"available":true,"active":true,"mode":"timed","remaining_seconds":null}"#,
            r#"{"available":true,"active":true}"#,
        ] {
            assert_eq!(parse(200, garbage), Awake::Hidden, "{garbage}");
        }
    }

    #[test]
    fn a_session_held_by_working_agents_has_no_end_time() {
        assert_eq!(
            parse(200, &body(true, "agents_grace", "null")),
            Awake::WhileAgentsWork
        );
        // Once the last agent has finished the grace countdown is a normal countdown.
        assert_eq!(
            parse(200, &body(true, "agents_grace", "600")),
            Awake::Timed { seconds: 600 }
        );
    }

    #[test]
    fn negative_and_huge_numbers_are_handled() {
        assert_eq!(
            parse(200, &body(true, "timed", "-5")),
            Awake::Timed { seconds: 0 }
        );
        assert_eq!(
            parse(200, &body(true, "timed", &MAX_BELIEVED_SECONDS.to_string())),
            Awake::Timed {
                seconds: MAX_BELIEVED_SECONDS
            }
        );
        assert_eq!(
            parse(
                200,
                &body(true, "timed", &(MAX_BELIEVED_SECONDS + 1).to_string())
            ),
            Awake::Hidden
        );
        assert_eq!(
            parse(200, &body(true, "timed", &i64::MAX.to_string())),
            Awake::Hidden
        );
        // Larger than i64: not a number this shell reads.
        assert_eq!(
            parse(200, &body(true, "timed", "99999999999999999999999")),
            Awake::Hidden
        );
        assert_eq!(
            parse(200, &body(true, "timed", &i64::MIN.to_string())),
            Awake::Timed { seconds: 0 }
        );
    }

    #[test]
    fn wording_covers_zero_seconds_minutes_hours_and_days() {
        let text = |s| format_remaining(s).unwrap();
        assert_eq!(text(0), "ending now");
        assert_eq!(text(-1), "ending now");
        assert_eq!(text(i64::MIN), "ending now");
        assert_eq!(text(1), "less than 1 min left");
        assert_eq!(text(59), "less than 1 min left");
        assert_eq!(text(60), "1 min left");
        assert_eq!(text(119), "1 min left");
        assert_eq!(text(45 * 60), "45 min left");
        assert_eq!(text(59 * 60 + 59), "59 min left");
        assert_eq!(text(3600), "1 h left");
        assert_eq!(text(3600 + 5 * 60), "1 h 05 min left");
        assert_eq!(text(23 * 3600 + 59 * 60 + 59), "23 h 59 min left");
        assert_eq!(text(24 * 3600), "1 d left");
        assert_eq!(text(24 * 3600 + 3 * 3600 + 30), "1 d 3 h left");
        assert_eq!(text(7 * 24 * 3600), "7 d left");
        assert_eq!(text(MAX_BELIEVED_SECONDS), "8 d left");
    }

    #[test]
    fn a_number_past_the_limit_has_no_wording() {
        assert_eq!(format_remaining(MAX_BELIEVED_SECONDS + 1), None);
        assert_eq!(format_remaining(i64::MAX), None);
    }

    #[test]
    fn the_menu_entry_and_tooltip_follow_the_state() {
        assert_eq!(menu_text(&Awake::Hidden), None);
        assert_eq!(tooltip(&Awake::Hidden), "Fawkes");
        let timed = Awake::Timed { seconds: 3900 };
        assert_eq!(
            menu_text(&timed).as_deref(),
            Some("Keep awake: 1 h 05 min left")
        );
        assert_eq!(tooltip(&timed), "Fawkes - Keep awake: 1 h 05 min left");
        assert_eq!(
            menu_text(&Awake::WhileAgentsWork).as_deref(),
            Some("Keep awake: while agents work")
        );
        // A number the wording refuses is never shown, even if constructed by hand.
        assert_eq!(
            menu_text(&Awake::Timed {
                seconds: MAX_BELIEVED_SECONDS + 1
            }),
            None
        );
    }

    #[test]
    fn the_refresh_interval_is_bounded_and_short_near_the_end() {
        assert_eq!(next_delay(&Awake::Hidden), IDLE_PROBE);
        assert_eq!(next_delay(&Awake::WhileAgentsWork), ACTIVE_REFRESH);
        assert_eq!(next_delay(&Awake::Timed { seconds: 3600 }), ACTIVE_REFRESH);
        assert_eq!(
            next_delay(&Awake::Timed { seconds: 5 }),
            Duration::from_secs(6)
        );
        assert_eq!(
            next_delay(&Awake::Timed { seconds: 0 }),
            Duration::from_secs(1)
        );
        for awake in [
            Awake::Hidden,
            Awake::WhileAgentsWork,
            Awake::Timed { seconds: 0 },
            Awake::Timed {
                seconds: MAX_BELIEVED_SECONDS,
            },
        ] {
            let delay = next_delay(&awake);
            assert!(delay >= Duration::from_secs(1) && delay <= IDLE_PROBE);
        }
    }
}
