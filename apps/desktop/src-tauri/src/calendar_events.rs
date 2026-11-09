// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! The pure half of the macOS Calendar reader (Phase 83): turns what EventKit reported (already
//! reduced to plain values by `calendar_eventkit.rs`) into the bounded JSON snapshot Core accepts on
//! `POST /api/calendar/macos` (`capabilities/calendar/src/macos-feed.ts` is the contract and
//! validates it again). Nothing here touches the OS, so everything is tested with synthetic data.
//!
//! What the snapshot never carries: notes, location, attendee names, organiser, conference links,
//! alarms. Titles are clipped and stripped of control and bidirectional-override characters;
//! attendees are `mailto:` addresses only, at most eight per event; there are at most
//! [`MAX_EVENTS`] events and at most [`MAX_BODY_BYTES`] bytes of JSON (over either, the snapshot
//! says `truncated`, and Core then reports the feed incomplete rather than showing a partial one).
//! An event that cannot be written at all also sets `truncated`.

// Used by the macOS reader; other platforms only compile it for its tests.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use serde::Serialize;

/// Most events one snapshot carries (Core refuses more).
pub const MAX_EVENTS: usize = 100;
/// Longest title in code points (Core clips to the same).
pub const MAX_TITLE: usize = 300;
const MAX_ATTENDEES: usize = 8;
const MAX_EMAIL: usize = 120;
const MAX_URL: usize = 300;
const MAX_UID: usize = 200;
/// Core's body limit is 256 KiB; stay well below it.
pub const MAX_BODY_BYTES: usize = 200 * 1024;
/// Core refuses an ordinary event longer than this, and the whole feed with it.
const MAX_ORDINARY_MS: i64 = 31 * 86_400_000;
/// An event that ends no later than it starts is shown as lasting this long (Core rejects it).
const MIN_DURATION_MS: i64 = 60_000;
const MAX_INSTANT_MS: i64 = 253_402_300_799_999;
/// The title prefix of a deploy-freeze marker (the convention of `capabilities/calendar`).
const FREEZE_PREFIX: &str = "[deploy-freeze]";

/// What EventKit says about Calendar access. Only `Authorized` (full access) carries events.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AccessState {
    Authorized,
    Denied,
    Restricted,
    NotDetermined,
    WriteOnly,
}

impl AccessState {
    /// Maps `EKAuthorizationStatus` (0 notDetermined, 1 restricted, 2 denied, 3 fullAccess,
    /// 4 writeOnly). A value this build does not know is treated as restricted: no events.
    pub fn from_status(raw: isize) -> Self {
        match raw {
            0 => Self::NotDetermined,
            2 => Self::Denied,
            3 => Self::Authorized,
            4 => Self::WriteOnly,
            _ => Self::Restricted,
        }
    }

    /// In words for the person.
    pub fn describe(self) -> &'static str {
        match self {
            Self::Authorized => "Phoenix can read your calendar.",
            Self::Denied => "Calendar access was denied. Allow Phoenix under System Settings > Privacy & Security > Calendars.",
            Self::Restricted => "Calendar access is restricted on this Mac.",
            Self::NotDetermined => "Calendar access has not been granted yet.",
            Self::WriteOnly => "Phoenix only has write access to Calendar; choose Full Access under System Settings > Privacy & Security > Calendars.",
        }
    }
}

/// One occurrence as EventKit reported it (recurrences already expanded by EventKit).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RawEvent {
    pub uid: String,
    /// The occurrence date of a recurring or detached event, so each occurrence has its own id.
    pub recurrence_ms: Option<i64>,
    pub title: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub timezone: Option<String>,
    /// Participant URLs as EventKit gives them (`mailto:a@b.c`).
    pub attendees: Vec<String>,
    pub url: Option<String>,
    pub cancelled: bool,
    /// The event has no organiser or the person is the organiser (a freeze marker must be theirs).
    pub owned: bool,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventJson {
    pub uid: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recurrence_id: Option<String>,
    pub title: String,
    pub start: String,
    pub end: String,
    pub timezone: String,
    pub attendees: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    pub cancelled: bool,
    pub deploy_freeze: bool,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct Snapshot {
    pub version: u8,
    pub state: AccessState,
    pub from: String,
    pub to: String,
    pub truncated: bool,
    pub events: Vec<EventJson>,
}

/// How far ahead the snapshot reads (the calendar capability asks for seven days) and how far back
/// (one minute, like the capability's own window).
pub const AHEAD_MS: i64 = 7 * 86_400_000;
pub const BEHIND_MS: i64 = 60_000;
/// How often the shell sends a snapshot while sharing is on. Core treats one older than three
/// minutes as stale.
pub const EVERY_SECS: u64 = 60;

/// The window of a snapshot taken at `now_ms`.
pub fn window(now_ms: i64) -> (i64, i64) {
    (now_ms - BEHIND_MS, now_ms + AHEAD_MS)
}

/// The tray item's text: what sharing is doing and, when it cannot, why, in plain words.
pub fn menu_text(sharing: bool, state: AccessState) -> String {
    let base = "Share macOS Calendar with Phoenix";
    match (sharing, state) {
        (false, _) => format!("{base}…"),
        (true, AccessState::Authorized) => base.to_string(),
        (true, AccessState::Denied) => format!("{base} (denied in System Settings)"),
        (true, AccessState::Restricted) => format!("{base} (restricted on this Mac)"),
        (true, AccessState::NotDetermined) => format!("{base} (not allowed yet)"),
        (true, AccessState::WriteOnly) => format!("{base} (needs Full Access)"),
    }
}

fn hidden(c: char) -> bool {
    c.is_control()
        || matches!(c, '\u{061c}' | '\u{200e}' | '\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
}

/// Control and bidirectional-override characters removed, at most `max` code points, trimmed.
pub fn clean_text(value: &str, max: usize) -> String {
    value
        .chars()
        .filter(|c| !hidden(*c))
        .take(max)
        .collect::<String>()
        .trim()
        .to_string()
}

/// `YYYY-MM-DDTHH:MM:SS.mmmZ`, or `None` outside years 0000 to 9999.
pub fn iso_utc(ms: i64) -> Option<String> {
    if !(0..=MAX_INSTANT_MS).contains(&ms) {
        return None;
    }
    let days = ms.div_euclid(86_400_000);
    let rest = ms.rem_euclid(86_400_000);
    // Days since 1970-01-01 to a civil date (H. Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    Some(format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rest / 3_600_000,
        rest / 60_000 % 60,
        rest / 1000 % 60,
        rest % 1000
    ))
}

/// The same shape Core checks: one `@`, no whitespace, a dot inside the domain.
fn email(value: &str) -> Option<String> {
    let rest = value
        .get(..7)
        .filter(|p| p.eq_ignore_ascii_case("mailto:"))?;
    let address = value[rest.len()..].split('?').next()?;
    let (local, domain) = address.split_once('@')?;
    let ok = !local.is_empty()
        && address.len() <= MAX_EMAIL
        && !address.chars().any(|c| c.is_whitespace() || hidden(c))
        && !domain.contains('@')
        && domain.len() >= 3
        && domain
            .char_indices()
            .any(|(i, c)| c == '.' && i > 0 && i < domain.len() - 1);
    ok.then(|| address.to_string())
}

fn zone(value: Option<&str>) -> String {
    match value {
        Some(z)
            if (z == "UTC" || z == "GMT" || z.contains('/'))
                && z.len() <= 64
                && z.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_+-/".contains(&b)) =>
        {
            z.to_string()
        }
        _ => "UTC".to_string(),
    }
}

fn link(value: Option<&str>) -> Option<String> {
    let v = value?;
    let rest = v.get(..8).filter(|p| p.eq_ignore_ascii_case("https://"))?;
    let tail = &v[rest.len()..];
    let authority = tail.split(['/', '?', '#']).next().unwrap_or("");
    (v.len() <= MAX_URL
        && !authority.is_empty()
        && !authority.contains('@')
        && !v.chars().any(|c| c.is_whitespace() || hidden(c)))
    .then(|| v.to_string())
}

/// Why an event is not in the snapshot.
#[derive(Debug, PartialEq, Eq)]
pub enum Skip {
    /// An ordinary event longer than 31 days (a holiday block, not a meeting). Core would refuse the
    /// whole feed over it, and only a freeze marker may be that long, so it is left out.
    TooLong,
    /// No usable id or a time that cannot be written. The event could be anything (a freeze
    /// marker), so the snapshot is marked incomplete instead of looking whole.
    Unreadable,
}

pub fn map_event(raw: &RawEvent) -> Result<EventJson, Skip> {
    let uid = clean_text(&raw.uid, MAX_UID);
    if uid.is_empty() {
        return Err(Skip::Unreadable);
    }
    let title = clean_text(&raw.title, MAX_TITLE);
    let deploy_freeze =
        raw.owned && title.to_ascii_lowercase().starts_with(FREEZE_PREFIX) && !raw.cancelled;
    let end_ms = if raw.end_ms <= raw.start_ms {
        raw.start_ms
            .checked_add(MIN_DURATION_MS)
            .ok_or(Skip::Unreadable)?
    } else {
        raw.end_ms
    };
    if !deploy_freeze && end_ms - raw.start_ms > MAX_ORDINARY_MS {
        return Err(Skip::TooLong);
    }
    let mut attendees: Vec<String> = Vec::new();
    for address in raw.attendees.iter().filter_map(|a| email(a)) {
        if attendees.len() < MAX_ATTENDEES && !attendees.contains(&address) {
            attendees.push(address);
        }
    }
    Ok(EventJson {
        uid,
        recurrence_id: match raw.recurrence_ms {
            Some(ms) => Some(iso_utc(ms).ok_or(Skip::Unreadable)?),
            None => None,
        },
        title,
        start: iso_utc(raw.start_ms).ok_or(Skip::Unreadable)?,
        end: iso_utc(end_ms).ok_or(Skip::Unreadable)?,
        timezone: zone(raw.timezone.as_deref()),
        attendees,
        url: link(raw.url.as_deref()),
        cancelled: raw.cancelled,
        deploy_freeze,
    })
}

/// The snapshot for `state` over `[from_ms, to_ms]`. Events come only with full access. They are
/// sorted by start, and cut at [`MAX_EVENTS`] or [`MAX_BODY_BYTES`] with `truncated` set.
pub fn build_snapshot(
    state: AccessState,
    from_ms: i64,
    to_ms: i64,
    raw: &[RawEvent],
) -> Option<Snapshot> {
    build_within(state, from_ms, to_ms, raw, MAX_BODY_BYTES)
}

/// [`build_snapshot`] with an explicit byte bound. Tests lower it to exercise the cut cheaply.
fn build_within(
    state: AccessState,
    from_ms: i64,
    to_ms: i64,
    raw: &[RawEvent],
    max_bytes: usize,
) -> Option<Snapshot> {
    let mut unreadable = false;
    let mut events: Vec<EventJson> = Vec::new();
    if state == AccessState::Authorized {
        let mut sorted: Vec<&RawEvent> = raw.iter().collect();
        sorted.sort_by_key(|e| (e.start_ms, e.uid.clone()));
        for event in sorted {
            match map_event(event) {
                Ok(json) => events.push(json),
                Err(Skip::TooLong) => {}
                Err(Skip::Unreadable) => unreadable = true,
            }
        }
    }
    let mut truncated = unreadable || events.len() > MAX_EVENTS;
    events.truncate(MAX_EVENTS);
    let mut snapshot = Snapshot {
        version: 1,
        state,
        from: iso_utc(from_ms)?,
        to: iso_utc(to_ms)?,
        truncated,
        events,
    };
    while serde_json::to_vec(&snapshot).ok()?.len() > max_bytes {
        snapshot.events.pop()?;
        truncated = true;
        snapshot.truncated = truncated;
    }
    Some(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;

    const T0: i64 = 1_792_670_400_000; // 2026-10-22T12:00:00Z
    const MIN: i64 = 60_000;

    fn raw(uid: &str, start: i64) -> RawEvent {
        RawEvent {
            uid: uid.into(),
            recurrence_ms: None,
            title: "Planning".into(),
            start_ms: start,
            end_ms: start + 30 * MIN,
            timezone: Some("Europe/Berlin".into()),
            attendees: vec!["mailto:a@example.com".into()],
            url: None,
            cancelled: false,
            owned: true,
        }
    }

    #[test]
    fn instants_are_formatted_as_utc_iso() {
        assert_eq!(iso_utc(0).unwrap(), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_utc(T0).unwrap(), "2026-10-22T12:00:00.000Z");
        assert_eq!(
            iso_utc(951_782_400_000).unwrap(),
            "2000-02-29T00:00:00.000Z"
        );
        assert_eq!(iso_utc(1_234_567).unwrap(), "1970-01-01T00:20:34.567Z");
        assert_eq!(iso_utc(-1), None);
        assert_eq!(iso_utc(MAX_INSTANT_MS + 1), None);
        assert_eq!(iso_utc(MAX_INSTANT_MS).unwrap(), "9999-12-31T23:59:59.999Z");
    }

    #[test]
    fn authorization_states_map_honestly() {
        assert_eq!(AccessState::from_status(0), AccessState::NotDetermined);
        assert_eq!(AccessState::from_status(1), AccessState::Restricted);
        assert_eq!(AccessState::from_status(2), AccessState::Denied);
        assert_eq!(AccessState::from_status(3), AccessState::Authorized);
        assert_eq!(AccessState::from_status(4), AccessState::WriteOnly);
        // Unknown and negative values never count as access.
        assert_eq!(AccessState::from_status(9), AccessState::Restricted);
        assert_eq!(AccessState::from_status(-1), AccessState::Restricted);
        for s in [
            AccessState::Denied,
            AccessState::Restricted,
            AccessState::NotDetermined,
            AccessState::WriteOnly,
        ] {
            assert!(!s.describe().is_empty());
        }
    }

    #[test]
    fn text_is_clipped_and_stripped_of_control_and_bidi() {
        assert_eq!(
            clean_text("a\u{202e}b\u{7}c\u{2066}d\u{200f}\n", 50),
            "abcd"
        );
        assert_eq!(clean_text(&"é".repeat(400), MAX_TITLE).chars().count(), 300);
        assert_eq!(clean_text("  x  ", 10), "x");
    }

    #[test]
    fn an_event_carries_only_the_contract_fields() {
        let mut e = raw("u1", T0);
        e.url = Some("https://meet.example.com/j/1".into());
        let json = serde_json::to_value(map_event(&e).unwrap()).unwrap();
        let mut keys: Vec<&str> = json
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "attendees",
                "cancelled",
                "deployFreeze",
                "end",
                "start",
                "timezone",
                "title",
                "uid",
                "url"
            ]
        );
        assert_eq!(json["start"], "2026-10-22T12:00:00.000Z");
        assert_eq!(json["end"], "2026-10-22T12:30:00.000Z");
        assert_eq!(json["timezone"], "Europe/Berlin");
    }

    #[test]
    fn attendees_are_mailto_addresses_only_deduped_and_capped() {
        let mut e = raw("u1", T0);
        e.attendees = vec![
            "mailto:A@Example.com".into(),
            "MAILTO:a@example.com?x=1".into(),
            "mailto:a@example.com".into(),
            "https://example.com/p".into(),
            "mailto:no-at".into(),
            "mailto:a b@example.com".into(),
            "mailto:a@b".into(),
            "mailto:a@.com".into(),
            "mailto:x@y@z.com".into(),
            "mailto:\u{202e}a@example.com".into(),
        ];
        e.attendees
            .extend((0..20).map(|i| format!("mailto:p{i}@example.com")));
        let got = map_event(&e).unwrap().attendees;
        assert_eq!(got.len(), MAX_ATTENDEES);
        assert_eq!(got[0], "A@Example.com");
        assert_eq!(got[1], "a@example.com");
        assert!(got
            .iter()
            .all(|a| !a.contains(' ') && a.matches('@').count() == 1));
        assert_eq!(
            got[2], "p0@example.com",
            "every malformed address was refused"
        );
    }

    #[test]
    fn zones_links_and_ids_are_checked() {
        let mut e = raw("u1", T0);
        e.timezone = Some("GMT+0100".into());
        assert_eq!(map_event(&e).unwrap().timezone, "UTC");
        e.timezone = Some("../../etc".into());
        assert_eq!(map_event(&e).unwrap().timezone, "UTC");
        e.timezone = None;
        assert_eq!(map_event(&e).unwrap().timezone, "UTC");
        e.timezone = Some("America/Argentina/Buenos_Aires".into());
        assert_eq!(
            map_event(&e).unwrap().timezone,
            "America/Argentina/Buenos_Aires"
        );
        for bad in [
            "http://x.example/a",
            "https://u:p@x.example/",
            "javascript:alert(1)",
            "https://",
            "https://x.example/a b",
        ] {
            e.url = Some(bad.into());
            assert_eq!(map_event(&e).unwrap().url, None, "{bad}");
        }
        e.url = Some(format!("https://x.example/{}", "a".repeat(400)));
        assert_eq!(map_event(&e).unwrap().url, None);
        assert_eq!(
            map_event(&raw("\u{7}", T0)),
            Err(Skip::Unreadable),
            "an id with nothing left"
        );
    }

    #[test]
    fn recurring_occurrences_get_their_own_recurrence_id() {
        let mut e = raw("series", T0);
        e.recurrence_ms = Some(T0);
        assert_eq!(
            map_event(&e).unwrap().recurrence_id.as_deref(),
            Some("2026-10-22T12:00:00.000Z")
        );
        e.recurrence_ms = Some(-5);
        assert_eq!(map_event(&e), Err(Skip::Unreadable));
    }

    #[test]
    fn times_core_would_refuse_are_repaired_or_dropped_before_they_reach_it() {
        let mut zero = raw("z", T0);
        zero.end_ms = T0;
        assert_eq!(map_event(&zero).unwrap().end, "2026-10-22T12:01:00.000Z");
        let mut backwards = raw("b", T0);
        backwards.end_ms = T0 - MIN;
        assert_eq!(
            map_event(&backwards).unwrap().end,
            "2026-10-22T12:01:00.000Z"
        );
        let mut long = raw("l", T0);
        long.end_ms = T0 + 40 * 86_400_000;
        assert_eq!(
            map_event(&long),
            Err(Skip::TooLong),
            "ordinary event over 31 days"
        );
        let mut ok = raw("k", T0);
        ok.end_ms = T0 + 31 * 86_400_000;
        assert!(map_event(&ok).is_ok());
        let mut far = raw("f", MAX_INSTANT_MS);
        far.end_ms = MAX_INSTANT_MS + 1000;
        assert_eq!(map_event(&far), Err(Skip::Unreadable));
    }

    #[test]
    fn a_freeze_marker_needs_the_prefix_and_the_owner_and_may_be_long() {
        let mut e = raw("fr", T0);
        e.title = "[Deploy-Freeze] holidays".into();
        e.end_ms = T0 + 40 * 86_400_000;
        let json = map_event(&e).expect("a freeze may be long");
        assert!(json.deploy_freeze);
        e.owned = false;
        assert_eq!(
            map_event(&e),
            Err(Skip::TooLong),
            "an invited event's prefix is ignored"
        );
        e.owned = true;
        e.end_ms = T0 + MIN;
        e.title = "not [deploy-freeze]".into();
        assert!(!map_event(&e).unwrap().deploy_freeze);
        e.title = "[deploy-freeze]".into();
        e.cancelled = true;
        assert!(!map_event(&e).unwrap().deploy_freeze);
    }

    #[test]
    fn snapshots_without_full_access_carry_no_events() {
        for state in [
            AccessState::Denied,
            AccessState::Restricted,
            AccessState::NotDetermined,
            AccessState::WriteOnly,
        ] {
            let s = build_snapshot(state, T0, T0 + 1000, &[raw("a", T0)]).unwrap();
            assert!(s.events.is_empty() && !s.truncated);
            let json = serde_json::to_value(&s).unwrap();
            assert_eq!(json["version"], 1);
            assert!(json["state"].is_string());
        }
        let ok = build_snapshot(AccessState::Authorized, T0, T0 + 1000, &[raw("a", T0)]).unwrap();
        assert_eq!(ok.events.len(), 1);
        assert_eq!(serde_json::to_value(&ok).unwrap()["state"], "authorized");
        assert_eq!(
            serde_json::to_value(AccessState::NotDetermined).unwrap(),
            "notDetermined"
        );
        assert_eq!(
            serde_json::to_value(AccessState::WriteOnly).unwrap(),
            "writeOnly"
        );
    }

    #[test]
    fn events_are_sorted_and_cut_at_the_count_bound() {
        let events: Vec<RawEvent> = (0..MAX_EVENTS as i64 + 5)
            .rev()
            .map(|i| raw(&format!("e{i}"), T0 + i * MIN))
            .collect();
        let s = build_snapshot(AccessState::Authorized, T0, T0 + 1000, &events).unwrap();
        assert_eq!(s.events.len(), MAX_EVENTS);
        assert!(s.truncated);
        assert_eq!(s.events[0].uid, "e0");
        assert!(s.events.windows(2).all(|w| w[0].start <= w[1].start));
        let exact: Vec<RawEvent> = (0..MAX_EVENTS as i64)
            .map(|i| raw(&format!("e{i}"), T0 + i * MIN))
            .collect();
        let s = build_snapshot(AccessState::Authorized, T0, T0 + 1000, &exact).unwrap();
        assert!(!s.truncated);
    }

    #[test]
    fn the_body_is_cut_at_the_byte_bound() {
        let events: Vec<RawEvent> = (0..MAX_EVENTS as i64)
            .map(|i| {
                let mut e = raw(&format!("e{i}"), T0 + i * MIN);
                e.title = "é".repeat(MAX_TITLE);
                e
            })
            .collect();
        // 100 ordinary events fit the real bound.
        let all = build_snapshot(AccessState::Authorized, T0, T0 + 1000, &events).unwrap();
        assert!(!all.truncated);
        assert!(serde_json::to_vec(&all).unwrap().len() <= MAX_BODY_BYTES);
        let s = build_within(AccessState::Authorized, T0, T0 + 1000, &events, 10_000).unwrap();
        assert!(s.truncated);
        assert!(!s.events.is_empty() && s.events.len() < MAX_EVENTS);
        assert!(serde_json::to_vec(&s).unwrap().len() <= 10_000);
        assert!(build_within(AccessState::Authorized, T0, T0 + 1000, &events, 10).is_none());
    }

    #[test]
    fn a_long_ordinary_event_is_left_out_but_an_unreadable_one_marks_the_snapshot_incomplete() {
        let mut long = raw("l", T0);
        long.end_ms = T0 + 40 * 86_400_000;
        let s = build_snapshot(
            AccessState::Authorized,
            T0,
            T0 + 1000,
            &[long, raw("k", T0)],
        )
        .unwrap();
        assert_eq!(s.events.len(), 1);
        assert!(!s.truncated);
        let s = build_snapshot(
            AccessState::Authorized,
            T0,
            T0 + 1000,
            &[raw("", T0), raw("k", T0)],
        )
        .unwrap();
        assert_eq!(s.events.len(), 1);
        assert!(s.truncated);
    }

    #[test]
    fn the_window_and_menu_text_are_fixed() {
        assert_eq!(window(T0), (T0 - 60_000, T0 + 7 * 86_400_000));
        assert_eq!(
            menu_text(false, AccessState::Authorized),
            "Share macOS Calendar with Phoenix…"
        );
        assert_eq!(
            menu_text(true, AccessState::Authorized),
            "Share macOS Calendar with Phoenix"
        );
        for state in [
            AccessState::Denied,
            AccessState::Restricted,
            AccessState::NotDetermined,
            AccessState::WriteOnly,
        ] {
            assert!(menu_text(true, state).contains('('), "{state:?} says why");
        }
    }

    #[test]
    fn a_window_outside_the_supported_years_makes_no_snapshot() {
        assert!(build_snapshot(AccessState::Authorized, -1, 5, &[]).is_none());
    }
}
