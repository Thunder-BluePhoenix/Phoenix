// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Phase 83 on macOS: while the person has chosen **Share macOS Calendar with Phoenix** in the tray
//! menu, the shell reads Calendar through EventKit once a minute and POSTs the bounded snapshot
//! (`calendar_events.rs`) to Core (`POST /api/calendar/macos`, session token, loopback, replace not
//! append). Core cannot call the shell, so the shell pushes.
//!
//! Permission: the system prompt is requested only when the person turns sharing on from the tray
//! (an explicit click), never at startup and never on the timer. A saved opt-in at launch only
//! reads the current state and shares what that allows; a denied, restricted or undecided state is
//! sent to Core as that state (no events) so the feed says so instead of looking empty.
//!
//! Not run by the author: no real calendar, no real prompt, no real Core.

use crate::calendar_eventkit;
use crate::calendar_events::{self, AccessState};
use crate::connection::connection;
use crate::core_status::{self, TIMEOUT};
use crate::{pill, Shell};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, Runtime};

/// Core's door for the snapshot.
pub const PATH: &str = "/api/calendar/macos";
/// The tray item's id.
pub const ITEM_ID: &str = "calendar_share";

static LOOP_STARTED: AtomicBool = AtomicBool::new(false);

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Reads EventKit and posts one snapshot. Returns the access state it saw. Never prompts.
fn sync_once<R: Runtime>(app: &AppHandle<R>) -> AccessState {
    let state = calendar_eventkit::state();
    let (from, to) = calendar_events::window(now_ms());
    let events = if state == AccessState::Authorized {
        calendar_eventkit::read_events(from, to)
    } else {
        Vec::new()
    };
    if let Some(snapshot) = calendar_events::build_snapshot(state, from, to, &events) {
        if let Ok(body) = serde_json::to_string(&snapshot) {
            let connected = connection(&app.state::<Shell<R>>().locator);
            // A refusal or an unreachable Core is simply retried a minute later.
            let _ = core_status::post_json(
                &connected.base_url,
                connected.token.as_deref(),
                PATH,
                &body,
                TIMEOUT,
            );
        }
    }
    state
}

fn show<R: Runtime>(app: &AppHandle<R>, sharing: bool, state: AccessState) {
    let main = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(items) = main.state::<Shell<R>>().menu.lock().as_ref() {
            let _ = items.calendar.set_checked(sharing);
            let _ = items
                .calendar
                .set_text(calendar_events::menu_text(sharing, state));
        }
    });
}

/// The tray choice. Turning it on asks macOS for access (once, if it has not been decided), then
/// shares. Turning it off stops sharing; Core's copy goes stale within three minutes and is then
/// reported as such. Runs off the main thread because the prompt blocks until it is answered.
pub fn set_sharing<R: Runtime>(app: &AppHandle<R>, on: bool) {
    app.state::<Shell<R>>().update(|s| s.calendar_share = on);
    if !on {
        show(app, false, AccessState::NotDetermined);
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let state = calendar_eventkit::request_access();
        if state != AccessState::Authorized {
            pill::error(&app, state.describe());
        }
        show(&app, true, state);
        let state = sync_once(&app);
        show(&app, true, state);
    });
}

/// The once-a-minute loop. Started once by `run`; it only shares while the saved choice is on.
pub fn spawn_loop<R: Runtime>(app: AppHandle<R>) {
    if LOOP_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || loop {
        let Some(shell) = app.try_state::<Shell<R>>() else {
            break;
        };
        if shell.settings.lock().calendar_share {
            let state = sync_once(&app);
            show(&app, true, state);
        }
        std::thread::sleep(Duration::from_secs(calendar_events::EVERY_SECS));
    });
}
