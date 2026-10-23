// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! The Phase 73 quit veto in the desktop shell. Every way of quitting (the tray's Quit, Cmd+Q, the
//! last window closing) ends in Tauri's `ExitRequested`. The shell then always holds the exit,
//! asks Core (`GET /api/awake/quit-check`, session token, loopback, via `core_status::call`)
//! whether a change still needs undoing, and:
//!
//! - nothing pending, Core unreachable, no token, or an answer the shell cannot read: quits
//!   normally. A Core that is not running has nothing the shell could tell the person about, and
//!   an unreadable answer must never trap Quit;
//! - something pending: tells the person plainly what it is and lets them choose **Cancel**
//!   (the default) or **Quit anyway**. Nothing is undone or discarded by this; "Quit anyway" only
//!   closes the shell, and whatever is left is handled by Core's own recovery (the next launch,
//!   and for the `pmset` kinds the launchd backstop).
//!
//! The decision table, the answer parser, the dialog text and the one-dialog-at-a-time state
//! machine are pure and unit-tested here. The native dialog is the only platform code
//! (`native_dialog.rs`).

use serde::Deserialize;
use std::sync::Mutex;

/// Core's route for the veto (read-only, session token).
pub const PATH: &str = "/api/awake/quit-check";

/// What Core said about quitting.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Veto {
    /// Nothing needs undoing (or Core does not know of anything).
    Clear,
    /// `count` changes still need undoing; `what` names the kinds in words, without repeats.
    Pending { count: u64, what: Vec<&'static str> },
    /// Core did not answer, or answered something this shell cannot use.
    Unknown,
}

#[derive(Deserialize)]
struct View {
    available: bool,
    can_quit: bool,
    #[serde(default)]
    count: u64,
    #[serde(default)]
    pending: Vec<Entry>,
}

#[derive(Deserialize)]
struct Entry {
    #[serde(default)]
    kind: String,
}

/// A journal kind in words for the person. Core's text is data: only these fixed phrases are ever
/// shown, anything else (a newer kind, a forged one) is "another change".
fn describe(kind: &str) -> &'static str {
    match kind {
        "pmset.disablesleep" => "sleep is switched off for a closed lid",
        "pmset.lowpowermode" => "Low Power Mode is switched on",
        "lid.display" => "the display or its brightness was changed",
        "lid.mute" => "the sound was muted",
        "lid.freeze" => "chat apps were frozen",
        "lid.docker_freeze" => "Docker Desktop was frozen",
        "lid.app_nap" => "an App Nap setting was changed",
        _ => "another change was made",
    }
}

/// Reads Core's answer defensively: only a 200 with a well-formed document counts. A document that
/// says it is not available, or says quitting is fine, is `Clear`; one that says it is not fine is
/// `Pending` even when its list is empty or cut short (the count is at least 1).
pub fn parse(status: u16, body: &str) -> Veto {
    if status != 200 {
        return Veto::Unknown;
    }
    let Ok(view) = serde_json::from_str::<View>(body) else {
        return Veto::Unknown;
    };
    if !view.available || view.can_quit {
        return Veto::Clear;
    }
    let mut what: Vec<&'static str> = Vec::new();
    for entry in &view.pending {
        let words = describe(&entry.kind);
        if !what.contains(&words) {
            what.push(words);
        }
    }
    if what.is_empty() {
        what.push(describe(""));
    }
    Veto::Pending {
        count: view.count.max(view.pending.len() as u64).max(1),
        what,
    }
}

/// What the shell does with the answer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Decision {
    Quit,
    Ask(Prompt),
}

/// The words of the dialog.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Prompt {
    pub title: &'static str,
    pub message: String,
    /// The default button; Enter cancels.
    pub cancel: &'static str,
    pub quit_anyway: &'static str,
}

/// The decision table: only a `Pending` answer stops the quit.
pub fn decide(veto: &Veto) -> Decision {
    match veto {
        Veto::Clear | Veto::Unknown => Decision::Quit,
        Veto::Pending { count, what } => Decision::Ask(prompt(*count, what)),
    }
}

fn prompt(count: u64, what: &[&'static str]) -> Prompt {
    let list = what.join("; ");
    let how_many = if count == 1 {
        "1 change".to_string()
    } else {
        format!("{count} changes")
    };
    Prompt {
        title: "Changes still need undoing",
        message: format!(
            "Phoenix made {how_many} to this computer that it has not undone yet: {list}.\n\n\
             To undo them, choose Cancel, open Phoenix, find Lid-closed mode and recovery and press Undo now.\n\n\
             If you quit anyway, they stay in place until Phoenix is started again and undoes them."
        ),
        cancel: "Cancel",
        quit_anyway: "Quit anyway",
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Idle,
    /// Core is being asked.
    Checking,
    /// The dialog is on screen.
    Asking,
    /// Decided: the next exit request goes through.
    Approved,
}

/// What a new quit request does.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Request {
    /// Let the exit happen (it was already approved).
    Proceed,
    /// Hold the exit and start the check.
    Start,
    /// Hold the exit; a check or a dialog is already open, so do not stack another.
    AlreadyAsking,
}

/// What to do after Core's answer or the person's choice.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Next {
    /// Exit now.
    Exit,
    /// Show the dialog.
    Ask,
    /// Stay running.
    Stay,
}

/// The one-at-a-time state machine. Shared by the exit handler, the check thread and the dialog.
pub struct Gate {
    phase: Mutex<Phase>,
}

impl Default for Gate {
    fn default() -> Self {
        Self {
            phase: Mutex::new(Phase::Idle),
        }
    }
}

impl Gate {
    fn with<T>(&self, f: impl FnOnce(&mut Phase) -> T) -> T {
        // A poisoned lock only means a thread died; the phase value is still a valid one.
        let mut guard = self.phase.lock().unwrap_or_else(|e| e.into_inner());
        f(&mut guard)
    }

    /// An exit was requested (tray, Cmd+Q, last window closed).
    pub fn request(&self) -> Request {
        self.with(|phase| match *phase {
            Phase::Approved => Request::Proceed,
            Phase::Idle => {
                *phase = Phase::Checking;
                Request::Start
            }
            Phase::Checking | Phase::Asking => Request::AlreadyAsking,
        })
    }

    /// Core answered (or did not): quit, or show the dialog.
    pub fn checked(&self, decision: &Decision) -> Next {
        self.with(|phase| match (*phase, decision) {
            (Phase::Checking, Decision::Quit) => {
                *phase = Phase::Approved;
                Next::Exit
            }
            (Phase::Checking, Decision::Ask(_)) => {
                *phase = Phase::Asking;
                Next::Ask
            }
            _ => Next::Stay,
        })
    }

    /// The person chose. `quit_anyway` false (Cancel, or the dialog could not be shown) keeps
    /// Phoenix running and allows the next Quit to ask again.
    pub fn answered(&self, quit_anyway: bool) -> Next {
        self.with(|phase| match *phase {
            Phase::Asking if quit_anyway => {
                *phase = Phase::Approved;
                Next::Exit
            }
            Phase::Asking => {
                *phase = Phase::Idle;
                Next::Stay
            }
            _ => Next::Stay,
        })
    }
}

/// Runs one whole quit check for a request the gate let `Start`: asks Core (`fetch`), decides,
/// and, when something is pending, shows the dialog (`ask`: `Some(true)` is "Quit anyway",
/// `Some(false)` is Cancel, `None` is "the dialog could not be shown", which keeps Phoenix
/// running). Returns whether to exit now. `ask` is called at most once.
pub fn resolve(
    gate: &Gate,
    fetch: impl FnOnce() -> Veto,
    ask: impl FnOnce(&Prompt) -> Option<bool>,
) -> Next {
    let decision = decide(&fetch());
    match (gate.checked(&decision), &decision) {
        (Next::Ask, Decision::Ask(prompt)) => gate.answered(ask(prompt).unwrap_or(false)),
        (next, _) => next,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pending(count: u64, kinds: &[&str]) -> String {
        let list: Vec<String> = kinds
            .iter()
            .map(|k| format!(r#"{{"kind":"{k}","at":1760000000000}}"#))
            .collect();
        format!(
            r#"{{"available":true,"can_quit":false,"count":{count},"pending":[{}]}}"#,
            list.join(",")
        )
    }

    #[test]
    fn a_pending_change_names_what_still_needs_undoing() {
        let Veto::Pending { count, what } =
            parse(200, &pending(2, &["pmset.disablesleep", "lid.mute"]))
        else {
            panic!("expected pending");
        };
        assert_eq!(count, 2);
        assert_eq!(
            what,
            vec![
                "sleep is switched off for a closed lid",
                "the sound was muted"
            ]
        );
    }

    #[test]
    fn repeats_are_listed_once_and_unknown_kinds_are_only_another_change() {
        let Veto::Pending { count, what } = parse(
            200,
            &pending(
                4,
                &["lid.mute", "lid.mute", "evil\\u0000<b>kind", "also-unknown"],
            ),
        ) else {
            panic!("expected pending");
        };
        assert_eq!(count, 4);
        assert_eq!(what, vec!["the sound was muted", "another change was made"]);
    }

    #[test]
    fn can_quit_false_is_pending_even_when_the_list_is_empty_or_the_count_is_missing() {
        let empty = r#"{"available":true,"can_quit":false,"count":0,"pending":[]}"#;
        assert_eq!(
            parse(200, empty),
            Veto::Pending {
                count: 1,
                what: vec!["another change was made"]
            }
        );
        let bare = r#"{"available":true,"can_quit":false}"#;
        assert!(matches!(parse(200, bare), Veto::Pending { count: 1, .. }));
        // A list longer than the count still counts every entry.
        let Veto::Pending { count, .. } = parse(200, &pending(0, &["lid.mute", "lid.freeze"]))
        else {
            panic!()
        };
        assert_eq!(count, 2);
    }

    #[test]
    fn nothing_pending_or_nothing_known_is_clear() {
        let clean = r#"{"available":true,"can_quit":true,"count":0,"pending":[]}"#;
        assert_eq!(parse(200, clean), Veto::Clear);
        // The capability never ran in this Core: nothing is known, quitting is fine.
        let unavailable = r#"{"available":false,"can_quit":true,"count":0,"pending":[]}"#;
        assert_eq!(parse(200, unavailable), Veto::Clear);
        // A contradictory document that is not available never blocks.
        let odd = r#"{"available":false,"can_quit":false,"count":4,"pending":[]}"#;
        assert_eq!(parse(200, odd), Veto::Clear);
    }

    #[test]
    fn garbage_and_refusals_are_unknown() {
        for body in [
            "",
            "{}",
            "null",
            "[]",
            "{ not json",
            r#"{"available":"yes","can_quit":false}"#,
            r#"{"available":true,"can_quit":"no"}"#,
            r#"{"available":true}"#,
            r#"{"available":true,"can_quit":false,"count":-1}"#,
            r#"{"available":true,"can_quit":false,"pending":"x"}"#,
        ] {
            assert_eq!(parse(200, body), Veto::Unknown, "{body}");
        }
        for status in [204, 302, 400, 401, 403, 404, 500, 503] {
            assert_eq!(
                parse(status, &pending(1, &["lid.mute"])),
                Veto::Unknown,
                "{status}"
            );
        }
    }

    #[test]
    fn only_a_pending_answer_stops_the_quit() {
        assert_eq!(decide(&Veto::Clear), Decision::Quit);
        assert_eq!(decide(&Veto::Unknown), Decision::Quit);
        let Decision::Ask(prompt) = decide(&parse(200, &pending(1, &["pmset.disablesleep"])))
        else {
            panic!("a pending change must ask");
        };
        assert_eq!(prompt.cancel, "Cancel");
        assert_eq!(prompt.quit_anyway, "Quit anyway");
        assert!(prompt.message.contains("1 change "));
        assert!(prompt
            .message
            .contains("sleep is switched off for a closed lid"));
        assert!(prompt.message.contains("Undo now"));
        assert!(prompt.message.contains("Quit anyway") || prompt.message.contains("quit anyway"));
    }

    #[test]
    fn the_message_counts_changes_and_never_shows_core_text() {
        let Decision::Ask(many) = decide(&parse(
            200,
            &pending(5, &["lid.freeze", "<script>alert(1)</script>"]),
        )) else {
            panic!()
        };
        assert!(many.message.contains("5 changes"));
        assert!(!many.message.contains('<'));
        assert!(many.message.contains("chat apps were frozen"));
    }

    fn ask() -> Decision {
        decide(&parse(200, &pending(1, &["lid.mute"])))
    }

    #[test]
    fn a_clear_check_quits() {
        let gate = Gate::default();
        assert_eq!(gate.request(), Request::Start);
        assert_eq!(gate.checked(&Decision::Quit), Next::Exit);
        // The exit that follows is let through, not asked about again.
        assert_eq!(gate.request(), Request::Proceed);
    }

    #[test]
    fn a_second_quit_while_checking_or_asking_does_not_stack_a_dialog() {
        let gate = Gate::default();
        assert_eq!(gate.request(), Request::Start);
        // Cmd+Q and the tray both pressed while Core is being asked.
        assert_eq!(gate.request(), Request::AlreadyAsking);
        assert_eq!(gate.checked(&ask()), Next::Ask);
        for _ in 0..3 {
            assert_eq!(gate.request(), Request::AlreadyAsking);
        }
        assert_eq!(gate.answered(false), Next::Stay);
    }

    #[test]
    fn cancel_keeps_phoenix_running_and_the_next_quit_asks_again() {
        let gate = Gate::default();
        assert_eq!(gate.request(), Request::Start);
        assert_eq!(gate.checked(&ask()), Next::Ask);
        assert_eq!(gate.answered(false), Next::Stay);
        assert_eq!(gate.request(), Request::Start);
        assert_eq!(gate.checked(&ask()), Next::Ask);
        assert_eq!(gate.answered(true), Next::Exit);
        assert_eq!(gate.request(), Request::Proceed);
    }

    #[test]
    fn quit_anyway_exits_only_after_the_person_chose_it() {
        let gate = Gate::default();
        // An answer with no dialog open changes nothing.
        assert_eq!(gate.answered(true), Next::Stay);
        assert_eq!(gate.request(), Request::Start);
        assert_eq!(gate.answered(true), Next::Stay);
        assert_eq!(gate.checked(&ask()), Next::Ask);
        // A late "clear" for a dialog that is already open cannot skip it.
        assert_eq!(gate.checked(&Decision::Quit), Next::Stay);
        assert_eq!(gate.answered(true), Next::Exit);
    }

    #[test]
    fn resolve_quits_without_a_dialog_unless_something_is_pending() {
        for veto in [Veto::Clear, Veto::Unknown] {
            let gate = Gate::default();
            assert_eq!(gate.request(), Request::Start);
            let next = resolve(
                &gate,
                || veto,
                |_| panic!("no dialog when nothing is pending"),
            );
            assert_eq!(next, Next::Exit);
            assert_eq!(gate.request(), Request::Proceed);
        }
    }

    #[test]
    fn resolve_shows_the_dialog_once_and_follows_the_choice() {
        let pending_veto = || parse(200, &pending(2, &["pmset.disablesleep", "lid.mute"]));
        for (answer, expected, then) in [
            (Some(false), Next::Stay, Request::Start),
            (None, Next::Stay, Request::Start),
            (Some(true), Next::Exit, Request::Proceed),
        ] {
            let gate = Gate::default();
            assert_eq!(gate.request(), Request::Start);
            let mut asked = 0;
            let next = resolve(&gate, pending_veto, |prompt| {
                asked += 1;
                assert!(prompt.message.contains("2 changes"));
                // A second Quit while the dialog is open must not stack another one.
                assert_eq!(gate.request(), Request::AlreadyAsking);
                answer
            });
            assert_eq!((next, asked), (expected, 1), "{answer:?}");
            assert_eq!(gate.request(), then, "{answer:?}");
        }
    }

    #[test]
    fn against_a_real_loopback_socket_core_answers_decide_the_quit() {
        use std::io::{Read, Write};
        let answer = |status: &str, body: String| {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let base = format!("http://{}", listener.local_addr().unwrap());
            let reply = format!(
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let server = std::thread::spawn(move || {
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
            let veto = match crate::core_status::call(
                &base,
                Some("tok-7"),
                crate::core_status::Method::Get,
                PATH,
                crate::core_status::TIMEOUT,
            ) {
                Ok((code, text)) => parse(code, &text),
                Err(_) => Veto::Unknown,
            };
            (veto, server.join().unwrap())
        };
        let (veto, seen) = answer("200 OK", pending(1, &["pmset.disablesleep"]));
        assert!(matches!(decide(&veto), Decision::Ask(_)));
        assert!(seen.starts_with("GET /api/awake/quit-check HTTP/1.1"));
        assert!(seen.contains("Authorization: Bearer tok-7"));
        let (veto, _) = answer(
            "200 OK",
            r#"{"available":true,"can_quit":true,"count":0,"pending":[]}"#.into(),
        );
        assert_eq!(decide(&veto), Decision::Quit);
        // A refused token, a redirect or a server error never traps Quit.
        for status in ["401 Unauthorized", "302 Found", "500 Internal Server Error"] {
            let (veto, _) = answer(status, "{}".into());
            assert_eq!(decide(&veto), Decision::Quit, "{status}");
        }
        // Nothing listening: Core is not running, so Quit works.
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let down = crate::core_status::call(
            &format!("http://127.0.0.1:{port}"),
            Some("t"),
            crate::core_status::Method::Get,
            PATH,
            crate::core_status::TIMEOUT,
        );
        assert!(down.is_err());
    }
}
