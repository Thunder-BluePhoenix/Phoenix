// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! The EventKit backend of the macOS Calendar reader (Phase 83). macOS only. It only reads the
//! authorization state, asks for access when the caller says so (an explicit tray choice, never a
//! timer), and lists events for a window with `predicateForEventsWithStartDate:endDate:calendars:`,
//! which makes EventKit expand recurrences itself. Everything it learns is reduced to the plain
//! [`RawEvent`] values of `calendar_events.rs`, which clips, strips and bounds them.
//!
//! **Never run against a real calendar or a real permission prompt.** It compiles and the pure
//! parts are tested; whether macOS shows the prompt, what it returns for iCloud/Exchange calendars,
//! and the exact occurrence dates of detached events are unverified. An `EKEventStore` is created
//! per call and never stored: it is not `Send`, and a fresh one always sees the current state.

use crate::calendar_events::{AccessState, RawEvent};
use block2::RcBlock;
use objc2::runtime::{Bool, NSObjectProtocol};
use objc2::sel;
use objc2_event_kit::{EKEntityType, EKEvent, EKEventStatus, EKEventStore};
use objc2_foundation::{NSDate, NSError, NSTimeZone};
use std::sync::mpsc;
use std::time::Duration;

/// The most events read out of EventKit before the snapshot logic cuts it down (and marks it
/// truncated): a bound on work, not a limit on what is shown.
const MAX_READ: usize = 400;
/// How long a request for access may wait for the person to answer the system prompt.
const PROMPT_WAIT: Duration = Duration::from_secs(5 * 60);

/// The current Calendar authorization, without prompting.
pub fn state() -> AccessState {
    // SAFETY: a plain class method that reads the process's TCC state.
    let status = unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Event) };
    AccessState::from_status(status.0)
}

/// Asks macOS for full access to events. Call it only from an explicit user action. It blocks
/// until the person answers the system prompt (at most [`PROMPT_WAIT`]) and returns the state
/// afterwards, so a denial is reported as denied, never as success. Already decided: no prompt.
pub fn request_access() -> AccessState {
    let before = state();
    if before != AccessState::NotDetermined {
        return before;
    }
    let store = unsafe { EKEventStore::new() };
    let (tx, rx) = mpsc::channel::<bool>();
    let block = RcBlock::new(move |granted: Bool, _error: *mut NSError| {
        let _ = tx.send(granted.as_bool());
    });
    // SAFETY: the block is valid for the call and copied by EventKit. macOS 14 renamed the call;
    // an older system only knows the entity-type form.
    unsafe {
        if store.respondsToSelector(sel!(requestFullAccessToEventsWithCompletion:)) {
            store.requestFullAccessToEventsWithCompletion(RcBlock::as_ptr(&block));
        } else {
            #[allow(deprecated)]
            store
                .requestAccessToEntityType_completion(EKEntityType::Event, RcBlock::as_ptr(&block));
        }
    }
    let _ = rx.recv_timeout(PROMPT_WAIT);
    state()
}

fn ms(date: &NSDate) -> i64 {
    // Saturating float-to-int cast: NaN is 0 and out-of-range values clamp; the pure side rejects
    // anything outside the supported years.
    (date.timeIntervalSince1970() * 1000.0).floor() as i64
}

fn raw(event: &EKEvent, local_zone: &str) -> RawEvent {
    // SAFETY: plain property getters on a live EKEvent.
    unsafe {
        let uid = event
            .eventIdentifier()
            .unwrap_or_else(|| event.calendarItemIdentifier())
            .to_string();
        let series = event.hasRecurrenceRules() || event.isDetached();
        let attendees = event
            .attendees()
            .map(|list| {
                list.iter()
                    .filter_map(|p| p.URL().absoluteString())
                    .map(|u| u.to_string())
                    .collect()
            })
            .unwrap_or_default();
        RawEvent {
            uid,
            recurrence_ms: if series {
                event.occurrenceDate().map(|d| ms(&d))
            } else {
                None
            },
            title: event.title().to_string(),
            start_ms: ms(&event.startDate()),
            end_ms: ms(&event.endDate()),
            timezone: Some(
                event
                    .timeZone()
                    .map(|z| z.name().to_string())
                    .unwrap_or_else(|| local_zone.to_string()),
            ),
            attendees,
            url: event
                .URL()
                .and_then(|u| u.absoluteString())
                .map(|u| u.to_string()),
            cancelled: event.status() == EKEventStatus::Canceled,
            owned: event.organizer().map(|o| o.isCurrentUser()).unwrap_or(true),
        }
    }
}

/// Events overlapping `[from_ms, to_ms]` across every calendar, recurrences expanded by EventKit.
/// Empty unless access is full; callers check [`state`] first.
pub fn read_events(from_ms: i64, to_ms: i64) -> Vec<RawEvent> {
    let store = unsafe { EKEventStore::new() };
    let start = NSDate::dateWithTimeIntervalSince1970(from_ms as f64 / 1000.0);
    let end = NSDate::dateWithTimeIntervalSince1970(to_ms as f64 / 1000.0);
    let local_zone = NSTimeZone::localTimeZone().name().to_string();
    // SAFETY: the predicate comes from this store's own constructor, as EventKit requires.
    let found = unsafe {
        let predicate = store.predicateForEventsWithStartDate_endDate_calendars(&start, &end, None);
        store.eventsMatchingPredicate(&predicate)
    };
    found
        .iter()
        .take(MAX_READ)
        .map(|event| raw(&event, &local_zone))
        .collect::<Vec<_>>()
}
