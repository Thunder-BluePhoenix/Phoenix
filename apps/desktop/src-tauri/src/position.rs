// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Where the floating Fawkes window goes. Pure geometry, no OS calls, so it is
//! unit-tested. All values are physical pixels in the virtual desktop space.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl Rect {
    pub fn new(x: i32, y: i32, w: i32, h: i32) -> Self {
        Self { x, y, w, h }
    }

    fn intersection_area(&self, other: &Rect) -> i64 {
        let left = self.x.max(other.x) as i64;
        let top = self.y.max(other.y) as i64;
        let right = (self.x as i64 + self.w as i64).min(other.x as i64 + other.w as i64);
        let bottom = (self.y as i64 + self.h as i64).min(other.y as i64 + other.h as i64);
        if right <= left || bottom <= top {
            0
        } else {
            (right - left) * (bottom - top)
        }
    }
}

/// Gap kept between the default position and the screen edge.
pub const DEFAULT_MARGIN: i32 = 24;

/// A saved position is kept only if at least half of the window is still on a
/// connected monitor; otherwise (monitor unplugged, resolution changed) the
/// pet would be unreachable.
pub fn is_reachable(window: Rect, monitors: &[Rect]) -> bool {
    let visible: i64 = monitors.iter().map(|m| window.intersection_area(m)).sum();
    let total = window.w as i64 * window.h as i64;
    total > 0 && visible * 2 >= total
}

/// Bottom-right corner of the first (primary) monitor.
pub fn default_position(size: (i32, i32), monitors: &[Rect]) -> Point {
    match monitors.first() {
        Some(m) => Point {
            x: m.x + m.w - size.0 - DEFAULT_MARGIN,
            y: m.y + m.h - size.1 - DEFAULT_MARGIN,
        },
        None => Point { x: 0, y: 0 },
    }
}

/// The saved position when it is still reachable, otherwise the default. With no
/// monitor information at all there is nothing to judge a saved position against,
/// so it is kept rather than thrown away on a transient failure.
pub fn place(saved: Option<Point>, size: (i32, i32), monitors: &[Rect]) -> Point {
    if let Some(p) = saved {
        if monitors.is_empty() || is_reachable(Rect::new(p.x, p.y, size.0, size.1), monitors) {
            return p;
        }
    }
    default_position(size, monitors)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SIZE: (i32, i32) = (180, 200);
    const MAIN: Rect = Rect {
        x: 0,
        y: 0,
        w: 1920,
        h: 1080,
    };
    const RIGHT: Rect = Rect {
        x: 1920,
        y: 0,
        w: 1920,
        h: 1080,
    };

    #[test]
    fn keeps_a_saved_position_that_is_on_screen() {
        let saved = Point { x: 400, y: 300 };
        assert_eq!(place(Some(saved), SIZE, &[MAIN]), saved);
    }

    #[test]
    fn keeps_a_position_on_a_second_monitor() {
        let saved = Point { x: 2500, y: 100 };
        assert_eq!(place(Some(saved), SIZE, &[MAIN, RIGHT]), saved);
    }

    #[test]
    fn recovers_when_the_monitor_it_was_on_is_gone() {
        let saved = Point { x: 2500, y: 100 };
        let p = place(Some(saved), SIZE, &[MAIN]);
        assert_eq!(p, default_position(SIZE, &[MAIN]));
        assert!(is_reachable(Rect::new(p.x, p.y, SIZE.0, SIZE.1), &[MAIN]));
    }

    #[test]
    fn straddling_two_monitors_counts_as_reachable() {
        // Half on each monitor: together 100% visible.
        let saved = Point { x: 1830, y: 100 };
        assert_eq!(place(Some(saved), SIZE, &[MAIN, RIGHT]), saved);
    }

    #[test]
    fn mostly_off_screen_is_not_reachable() {
        // Only 20 of 180 columns remain visible.
        let saved = Point { x: 1900, y: 100 };
        assert_eq!(
            place(Some(saved), SIZE, &[MAIN]),
            default_position(SIZE, &[MAIN])
        );
    }

    #[test]
    fn first_run_goes_bottom_right_of_the_primary_monitor() {
        assert_eq!(
            place(None, SIZE, &[MAIN, RIGHT]),
            Point {
                x: 1920 - 180 - DEFAULT_MARGIN,
                y: 1080 - 200 - DEFAULT_MARGIN
            }
        );
    }

    #[test]
    fn unknown_monitors_keep_what_was_saved_and_never_panic() {
        let saved = Point { x: 5, y: 5 };
        assert_eq!(place(Some(saved), SIZE, &[]), saved);
        assert_eq!(place(None, SIZE, &[]), Point { x: 0, y: 0 });
    }
}
