// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Where the island window goes and how big it is. Pure geometry, no OS calls, so it is
//! unit-tested like `position.rs`. Rectangles are physical pixels in the virtual desktop
//! space; sizes below are logical (points) and are scaled by the monitor's scale factor.
//!
//! The island sits flush with the top edge of the chosen monitor, centred. On a Mac with a
//! notch the small and expanded islands are wider than the notch so Fawkes shows in the
//! "ears" on either side of it; without a notch (or on Linux/Windows) the island is a pill
//! of `DEFAULT_PILL_WIDTH` at the top centre.

use crate::island_state::IslandState;
use crate::position::{Point, Rect};
use serde::{Deserialize, Serialize};

/// Hidden island: a thin strip along the top edge that is the hover target.
pub const HOT_ZONE_HEIGHT: f64 = 4.0;
/// Pill width when there is no notch (logical).
pub const DEFAULT_PILL_WIDTH: f64 = 220.0;
/// Space either side of a notch that stays visible (logical).
pub const EAR_WIDTH: f64 = 72.0;
/// Small island height when there is no notch to match (logical).
pub const SMALL_HEIGHT: f64 = 34.0;
pub const EXPANDED_SIZE: (f64, f64) = (360.0, 176.0);
/// The pointer may drift this far (logical) outside a shown island before it counts as left.
pub const HOVER_SLOP: f64 = 6.0;

/// The notch of one screen, logical points.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Notch {
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MonitorInfo {
    pub rect: Rect,
    pub scale: f64,
    pub name: Option<String>,
    pub notch: Option<Notch>,
}

/// Which monitor the island lives on.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum IslandDisplay {
    /// The first (primary) monitor.
    #[default]
    Primary,
    /// The monitor under the pointer; the island moves while it is hidden.
    FollowMouse,
    /// A monitor by its OS name; the primary when it is not connected.
    Named(String),
}

/// Menu text for the island display choice.
pub fn display_label(display: &IslandDisplay) -> String {
    match display {
        IslandDisplay::Primary => "Island display: main screen".into(),
        IslandDisplay::FollowMouse => "Island display: follows the mouse".into(),
        IslandDisplay::Named(name) => format!("Island display: {name}"),
    }
}

/// Puts the monitor that is at `primary`'s position first (the OS does not promise its list
/// starts with the primary), keeping the order of the rest.
pub fn primary_first(monitors: &mut [MonitorInfo], primary: Option<Rect>) {
    if let Some(i) = primary.and_then(|p| monitors.iter().position(|m| m.rect == p)) {
        monitors[..=i].rotate_right(1);
    }
}

/// The next choice when the user cycles "Island display": primary, follow the mouse, then
/// each other monitor by name, then back to primary. `monitors` is in primary-first order.
pub fn next_display(current: &IslandDisplay, monitors: &[MonitorInfo]) -> IslandDisplay {
    let mut cycle = vec![IslandDisplay::Primary, IslandDisplay::FollowMouse];
    cycle.extend(
        monitors
            .iter()
            .skip(1)
            .filter_map(|m| m.name.clone().map(IslandDisplay::Named)),
    );
    match cycle.iter().position(|d| d == current) {
        Some(i) => cycle[(i + 1) % cycle.len()].clone(),
        None => IslandDisplay::Primary,
    }
}

/// What the page needs to lay itself out: where the notch is inside the window.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Layout {
    /// Window rect for the state (physical pixels).
    pub rect: Rect,
    /// Width of the notch in the window's logical pixels; 0 without a notch.
    pub notch_width: i32,
    pub has_notch: bool,
}

fn px(logical: f64, scale: f64) -> i32 {
    (logical * scale).round() as i32
}

/// The pill width in logical points for this monitor.
pub fn small_width(notch: Option<Notch>) -> f64 {
    match notch {
        Some(n) => n.width + 2.0 * EAR_WIDTH,
        None => DEFAULT_PILL_WIDTH,
    }
}

/// Window rect for a state: top-centre of the monitor, flush with its top edge. Never wider
/// than the monitor.
pub fn rect_for(state: IslandState, monitor: &MonitorInfo) -> Rect {
    let scale = if monitor.scale > 0.0 {
        monitor.scale
    } else {
        1.0
    };
    let small_w = small_width(monitor.notch);
    let small_h = monitor
        .notch
        .map_or(SMALL_HEIGHT, |n| n.height.max(SMALL_HEIGHT));
    let (w, h) = match state {
        IslandState::Hidden => (small_w, HOT_ZONE_HEIGHT),
        IslandState::Small => (small_w, small_h),
        IslandState::Expanded => (small_w.max(EXPANDED_SIZE.0), EXPANDED_SIZE.1),
    };
    let width = px(w, scale).clamp(1, monitor.rect.w.max(1));
    let height = px(h, scale).clamp(1, monitor.rect.h.max(1));
    Rect::new(
        monitor.rect.x + (monitor.rect.w - width) / 2,
        monitor.rect.y,
        width,
        height,
    )
}

pub fn layout_for(state: IslandState, monitor: &MonitorInfo) -> Layout {
    Layout {
        rect: rect_for(state, monitor),
        notch_width: monitor.notch.map_or(0, |n| n.width.round() as i32),
        has_notch: monitor.notch.is_some(),
    }
}

fn contains(rect: Rect, p: Point) -> bool {
    p.x >= rect.x && p.x < rect.x + rect.w && p.y >= rect.y && p.y < rect.y + rect.h
}

/// Is the pointer over the island? A shown island tolerates a few pixels of drift so the
/// edge does not flicker; the hidden hot zone is exact. The pointer pushed against the top
/// edge of the screen reports y = top, which the hot zone includes.
pub fn pointer_over(state: IslandState, window: Rect, scale: f64, cursor: Point) -> bool {
    let slop = match state {
        IslandState::Hidden => 0,
        _ => px(HOVER_SLOP, scale),
    };
    let area = Rect::new(
        window.x - slop,
        window.y - slop,
        window.w + 2 * slop,
        window.h + 2 * slop,
    );
    contains(area, cursor)
}

fn monitor_at(monitors: &[MonitorInfo], p: Point) -> Option<usize> {
    monitors.iter().position(|m| contains(m.rect, p))
}

/// Picks the monitor index. `current` is where the island is now (kept when the pointer is
/// between monitors or its position is unknown). `None` only when there are no monitors.
pub fn select_monitor(
    display: &IslandDisplay,
    monitors: &[MonitorInfo],
    cursor: Option<Point>,
    current: Option<usize>,
) -> Option<usize> {
    if monitors.is_empty() {
        return None;
    }
    let current = current.filter(|i| *i < monitors.len());
    Some(match display {
        IslandDisplay::Primary => 0,
        IslandDisplay::FollowMouse => cursor
            .and_then(|c| monitor_at(monitors, c))
            .or(current)
            .unwrap_or(0),
        IslandDisplay::Named(name) => monitors
            .iter()
            .position(|m| m.name.as_deref() == Some(name.as_str()))
            .unwrap_or(0),
    })
}

/// The island only changes monitor while nobody can be looking at it: hidden, and the pointer
/// is not on it. Moving a shown island under the pointer would be disorienting.
pub fn may_relocate(state: IslandState) -> bool {
    state == IslandState::Hidden
}

/// Notch width assumed when the OS says there is a camera housing (top safe-area inset) but
/// does not report the auxiliary areas either side of it (logical).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))] // only macOS reads NSScreen
pub const DEFAULT_NOTCH_WIDTH: f64 = 200.0;

/// Notch from macOS `NSScreen` values (all logical points): the screen frame width, the top
/// safe-area inset, and the widths of `auxiliaryTopLeftArea` / `auxiliaryTopRightArea`. The
/// notch is the part of the top bar those two areas do not cover. No inset = no notch.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))] // only macOS reads NSScreen
pub fn notch_from_areas(
    frame_width: f64,
    safe_top: f64,
    left_area: f64,
    right_area: f64,
) -> Option<Notch> {
    if safe_top <= 0.0 {
        return None;
    }
    let width = frame_width - left_area.max(0.0) - right_area.max(0.0);
    let plausible = width > 0.0 && width < frame_width * 0.5;
    Some(Notch {
        width: if plausible {
            width
        } else {
            DEFAULT_NOTCH_WIDTH
        },
        height: safe_top,
    })
}

/// A screen as the OS reports it for notch detection: logical frame size and notch.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ScreenNotch {
    pub width: f64,
    pub height: f64,
    pub notch: Option<Notch>,
}

/// Finds the notch for a monitor from the OS screen list by logical size. Tauri's monitor
/// handle does not expose the display id, so screens are matched by size; if two screens of
/// the same size disagree about the notch, no notch is assumed (a plain pill is always safe).
pub fn match_notch(monitor: &Rect, scale: f64, screens: &[ScreenNotch]) -> Option<Notch> {
    if scale <= 0.0 {
        return None;
    }
    let (w, h) = (monitor.w as f64 / scale, monitor.h as f64 / scale);
    let mut found = screens
        .iter()
        .filter(|s| (s.width - w).abs() < 1.5 && (s.height - h).abs() < 1.5)
        .map(|s| s.notch);
    let first = found.next()?;
    found.all(|n| n == first).then_some(first).flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monitor(x: i32, y: i32, w: i32, h: i32, scale: f64, notch: Option<Notch>) -> MonitorInfo {
        MonitorInfo {
            rect: Rect::new(x, y, w, h),
            scale,
            name: None,
            notch,
        }
    }

    const NOTCH: Notch = Notch {
        width: 200.0,
        height: 38.0,
    };

    fn plain() -> MonitorInfo {
        monitor(0, 0, 1920, 1080, 1.0, None)
    }

    fn mac() -> MonitorInfo {
        // 16" MacBook Pro: 3456x2234 physical at 2x.
        monitor(0, 0, 3456, 2234, 2.0, Some(NOTCH))
    }

    #[test]
    fn without_a_notch_the_pill_is_centred_flush_with_the_top() {
        let r = rect_for(IslandState::Small, &plain());
        assert_eq!(r, Rect::new((1920 - 220) / 2, 0, 220, 34));
    }

    #[test]
    fn with_a_notch_the_island_is_wider_than_the_notch_by_two_ears() {
        let r = rect_for(IslandState::Small, &mac());
        assert_eq!(r.w, ((200.0 + 144.0) * 2.0) as i32);
        assert_eq!(r.h, 76, "matches the notch height (38pt at 2x)");
        assert_eq!(r.y, 0);
        assert_eq!(r.x * 2 + r.w, 3456, "centred on the notch");
        let layout = layout_for(IslandState::Small, &mac());
        assert!(layout.has_notch);
        assert_eq!(layout.notch_width, 200);
    }

    #[test]
    fn a_short_notch_still_gets_the_minimum_height() {
        let n = Notch {
            width: 150.0,
            height: 10.0,
        };
        let r = rect_for(IslandState::Small, &monitor(0, 0, 2000, 1000, 1.0, Some(n)));
        assert_eq!(r.h, 34);
    }

    #[test]
    fn hidden_is_a_thin_strip_and_expanded_is_the_largest() {
        let hidden = rect_for(IslandState::Hidden, &plain());
        let small = rect_for(IslandState::Small, &plain());
        let open = rect_for(IslandState::Expanded, &plain());
        assert_eq!(hidden.h, 4);
        assert_eq!(hidden.w, small.w);
        assert!(open.w > small.w && open.h > small.h);
        assert_eq!(open.x * 2 + open.w, 1920);
        for r in [hidden, small, open] {
            assert_eq!(r.y, 0);
        }
    }

    #[test]
    fn second_monitor_offsets_and_negative_origins_are_respected() {
        let right = monitor(1920, 0, 2560, 1440, 1.0, None);
        let left = monitor(-1280, -200, 1280, 720, 1.0, None);
        let r = rect_for(IslandState::Small, &right);
        assert_eq!((r.x, r.y), (1920 + (2560 - 220) / 2, 0));
        let l = rect_for(IslandState::Small, &left);
        assert_eq!((l.x, l.y), (-1280 + (1280 - 220) / 2, -200));
    }

    #[test]
    fn hidpi_scales_logical_sizes() {
        let m = monitor(0, 0, 2880, 1800, 2.0, None);
        let r = rect_for(IslandState::Small, &m);
        assert_eq!((r.w, r.h), (440, 68));
    }

    #[test]
    fn never_wider_than_a_tiny_monitor() {
        let m = monitor(0, 0, 200, 100, 1.0, None);
        let r = rect_for(IslandState::Expanded, &m);
        assert_eq!(r.w, 200);
        assert_eq!(r.x, 0);
    }

    #[test]
    fn bad_scale_falls_back_to_one() {
        let m = monitor(0, 0, 1920, 1080, 0.0, None);
        assert_eq!(rect_for(IslandState::Small, &m).w, 220);
    }

    #[test]
    fn hot_zone_includes_the_very_top_row_and_excludes_outside() {
        let zone = rect_for(IslandState::Hidden, &plain());
        let mid = zone.x + zone.w / 2;
        assert!(pointer_over(
            IslandState::Hidden,
            zone,
            1.0,
            Point { x: mid, y: 0 }
        ));
        assert!(pointer_over(
            IslandState::Hidden,
            zone,
            1.0,
            Point { x: mid, y: 3 }
        ));
        assert!(!pointer_over(
            IslandState::Hidden,
            zone,
            1.0,
            Point { x: mid, y: 4 }
        ));
        assert!(!pointer_over(
            IslandState::Hidden,
            zone,
            1.0,
            Point {
                x: zone.x - 1,
                y: 0
            }
        ));
        assert!(!pointer_over(
            IslandState::Hidden,
            zone,
            1.0,
            Point {
                x: zone.x + zone.w,
                y: 0
            }
        ));
    }

    #[test]
    fn a_shown_island_tolerates_drift_but_not_a_long_way() {
        let r = rect_for(IslandState::Small, &plain());
        let below = Point {
            x: r.x + 10,
            y: r.y + r.h + 5,
        };
        assert!(pointer_over(IslandState::Small, r, 1.0, below));
        let far = Point {
            x: r.x + 10,
            y: r.y + r.h + 40,
        };
        assert!(!pointer_over(IslandState::Small, r, 1.0, far));
    }

    fn two() -> Vec<MonitorInfo> {
        let mut right = monitor(1920, 0, 1920, 1080, 1.0, None);
        right.name = Some("Right".into());
        let mut main = plain();
        main.name = Some("Main".into());
        vec![main, right]
    }

    #[test]
    fn primary_always_picks_the_first_monitor() {
        let m = two();
        let at_right = Some(Point { x: 2500, y: 10 });
        assert_eq!(
            select_monitor(&IslandDisplay::Primary, &m, at_right, Some(1)),
            Some(0)
        );
    }

    #[test]
    fn follow_mouse_picks_the_monitor_under_the_pointer() {
        let m = two();
        let d = IslandDisplay::FollowMouse;
        assert_eq!(
            select_monitor(&d, &m, Some(Point { x: 2500, y: 10 }), Some(0)),
            Some(1)
        );
        assert_eq!(
            select_monitor(&d, &m, Some(Point { x: 5, y: 5 }), Some(1)),
            Some(0)
        );
    }

    #[test]
    fn follow_mouse_keeps_the_current_monitor_when_the_pointer_is_unknown() {
        let m = two();
        let d = IslandDisplay::FollowMouse;
        assert_eq!(select_monitor(&d, &m, None, Some(1)), Some(1));
        // Pointer in a gap between monitors, or a stale index after unplugging.
        assert_eq!(
            select_monitor(&d, &m, Some(Point { x: 9000, y: 9000 }), Some(1)),
            Some(1)
        );
        assert_eq!(select_monitor(&d, &m, None, Some(7)), Some(0));
        assert_eq!(select_monitor(&d, &m, None, None), Some(0));
    }

    #[test]
    fn named_display_falls_back_to_primary_when_unplugged() {
        let m = two();
        assert_eq!(
            select_monitor(&IslandDisplay::Named("Right".into()), &m, None, None),
            Some(1)
        );
        assert_eq!(
            select_monitor(&IslandDisplay::Named("Gone".into()), &m, None, None),
            Some(0)
        );
    }

    #[test]
    fn the_primary_monitor_is_moved_to_the_front() {
        let mut m = two();
        primary_first(&mut m, Some(Rect::new(1920, 0, 1920, 1080)));
        assert_eq!(m[0].name.as_deref(), Some("Right"));
        assert_eq!(m[1].name.as_deref(), Some("Main"));
        let mut unchanged = two();
        primary_first(&mut unchanged, None);
        assert_eq!(unchanged[0].name.as_deref(), Some("Main"));
        primary_first(&mut unchanged, Some(Rect::new(9, 9, 9, 9)));
        assert_eq!(unchanged[0].name.as_deref(), Some("Main"));
    }

    #[test]
    fn display_labels_name_the_choice() {
        assert_eq!(
            display_label(&IslandDisplay::Primary),
            "Island display: main screen"
        );
        assert_eq!(
            display_label(&IslandDisplay::FollowMouse),
            "Island display: follows the mouse"
        );
        assert_eq!(
            display_label(&IslandDisplay::Named("Dell".into())),
            "Island display: Dell"
        );
    }

    #[test]
    fn cycling_visits_primary_follow_and_each_other_monitor_then_wraps() {
        let m = two();
        let a = next_display(&IslandDisplay::Primary, &m);
        assert_eq!(a, IslandDisplay::FollowMouse);
        let b = next_display(&a, &m);
        assert_eq!(b, IslandDisplay::Named("Right".into()));
        assert_eq!(next_display(&b, &m), IslandDisplay::Primary);
        // A remembered monitor that is no longer connected restarts the cycle.
        assert_eq!(
            next_display(&IslandDisplay::Named("Gone".into()), &m),
            IslandDisplay::Primary
        );
        assert_eq!(
            next_display(&IslandDisplay::Primary, &[]),
            IslandDisplay::FollowMouse
        );
    }

    #[test]
    fn no_monitors_means_no_choice() {
        assert_eq!(
            select_monitor(&IslandDisplay::Primary, &[], None, None),
            None
        );
        assert_eq!(
            select_monitor(&IslandDisplay::FollowMouse, &[], None, None),
            None
        );
    }

    #[test]
    fn the_island_only_moves_while_hidden() {
        assert!(may_relocate(IslandState::Hidden));
        assert!(!may_relocate(IslandState::Small));
        assert!(!may_relocate(IslandState::Expanded));
    }

    #[test]
    fn display_choice_serialises_for_the_settings_file() {
        assert_eq!(
            serde_json::to_string(&IslandDisplay::Primary).unwrap(),
            "\"primary\""
        );
        assert_eq!(
            serde_json::to_string(&IslandDisplay::FollowMouse).unwrap(),
            "\"follow_mouse\""
        );
        let named: IslandDisplay = serde_json::from_str(r#"{"named":"DELL U2720Q"}"#).unwrap();
        assert_eq!(named, IslandDisplay::Named("DELL U2720Q".into()));
    }

    #[test]
    fn notch_width_is_what_the_two_auxiliary_areas_leave_uncovered() {
        // 14" MacBook Pro: 1512pt wide, areas of 656pt either side.
        let n = notch_from_areas(1512.0, 32.0, 656.0, 656.0).unwrap();
        assert_eq!(
            n,
            Notch {
                width: 200.0,
                height: 32.0
            }
        );
    }

    #[test]
    fn no_top_inset_means_no_notch() {
        assert_eq!(notch_from_areas(1920.0, 0.0, 0.0, 0.0), None);
    }

    #[test]
    fn missing_or_absurd_areas_use_the_default_notch_width() {
        let d = Some(Notch {
            width: DEFAULT_NOTCH_WIDTH,
            height: 32.0,
        });
        assert_eq!(
            notch_from_areas(1512.0, 32.0, 0.0, 0.0),
            d,
            "areas not reported"
        );
        assert_eq!(
            notch_from_areas(1512.0, 32.0, 900.0, 900.0),
            d,
            "areas overlap"
        );
    }

    #[test]
    fn notch_is_matched_to_the_screen_of_the_same_size() {
        let screens = [
            ScreenNotch {
                width: 1728.0,
                height: 1117.0,
                notch: Some(NOTCH),
            },
            ScreenNotch {
                width: 2560.0,
                height: 1440.0,
                notch: None,
            },
        ];
        let builtin = Rect::new(0, 0, 3456, 2234);
        assert_eq!(match_notch(&builtin, 2.0, &screens), Some(NOTCH));
        let external = Rect::new(3456, 0, 2560, 1440);
        assert_eq!(match_notch(&external, 1.0, &screens), None);
    }

    #[test]
    fn ambiguous_or_unknown_screens_assume_no_notch() {
        let same_size = [
            ScreenNotch {
                width: 1728.0,
                height: 1117.0,
                notch: Some(NOTCH),
            },
            ScreenNotch {
                width: 1728.0,
                height: 1117.0,
                notch: None,
            },
        ];
        let m = Rect::new(0, 0, 3456, 2234);
        assert_eq!(match_notch(&m, 2.0, &same_size), None);
        assert_eq!(match_notch(&m, 2.0, &[]), None);
        assert_eq!(match_notch(&m, 0.0, &same_size), None);
    }
}
