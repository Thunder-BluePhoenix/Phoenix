// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Where the dictation pill goes: a small window centred on the bottom edge of the chosen
//! monitor, a little above the Dock / taskbar. Pure geometry on top of the island's monitor
//! model (`island_geometry`), so the monitor choice and the scale handling are the same code
//! the island uses and are unit-tested the same way. Sizes are logical; rectangles are
//! physical pixels.

use crate::island_geometry::{select_monitor, IslandDisplay, MonitorInfo};
use crate::position::{Point, Rect};

/// Logical size of the pill window: five dots, a status line and three buttons.
pub const PILL_SIZE: (f64, f64) = (300.0, 72.0);
/// Logical gap between the pill and the bottom edge of the monitor (clears a Dock / taskbar).
pub const PILL_BOTTOM_MARGIN: f64 = 96.0;

fn scaled(logical: f64, scale: f64) -> i32 {
    (logical * scale).round() as i32
}

/// The pill's rectangle on `monitor`: horizontally centred, `PILL_BOTTOM_MARGIN` above the
/// bottom edge, never larger than the monitor and never above its top edge.
pub fn pill_rect(monitor: &MonitorInfo) -> Rect {
    let scale = if monitor.scale > 0.0 {
        monitor.scale
    } else {
        1.0
    };
    let w = scaled(PILL_SIZE.0, scale).clamp(1, monitor.rect.w.max(1));
    let h = scaled(PILL_SIZE.1, scale).clamp(1, monitor.rect.h.max(1));
    let margin = scaled(PILL_BOTTOM_MARGIN, scale);
    let x = monitor.rect.x + (monitor.rect.w - w) / 2;
    let y = (monitor.rect.y + monitor.rect.h - h - margin).max(monitor.rect.y);
    Rect::new(x, y, w, h)
}

/// The monitor the pill appears on: the one under the pointer when it is known (the user is
/// looking there), otherwise the primary monitor. `monitors` is in primary-first order.
pub fn pill_monitor(monitors: &[MonitorInfo], cursor: Option<Point>) -> Option<&MonitorInfo> {
    select_monitor(&IslandDisplay::FollowMouse, monitors, cursor, Some(0)).map(|i| &monitors[i])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monitor(x: i32, y: i32, w: i32, h: i32, scale: f64) -> MonitorInfo {
        MonitorInfo {
            rect: Rect::new(x, y, w, h),
            scale,
            name: None,
            notch: None,
        }
    }

    #[test]
    fn centred_on_the_bottom_edge_at_scale_one() {
        let r = pill_rect(&monitor(0, 0, 1920, 1080, 1.0));
        assert_eq!((r.w, r.h), (300, 72));
        assert_eq!(r.x, (1920 - 300) / 2);
        assert_eq!(r.y, 1080 - 72 - 96);
    }

    #[test]
    fn scales_with_a_retina_monitor() {
        let r = pill_rect(&monitor(0, 0, 2880, 1800, 2.0));
        assert_eq!((r.w, r.h), (600, 144));
        assert_eq!(r.x, (2880 - 600) / 2);
        assert_eq!(r.y, 1800 - 144 - 192);
    }

    #[test]
    fn follows_a_monitor_that_does_not_start_at_the_origin() {
        let r = pill_rect(&monitor(-1920, 200, 1920, 1080, 1.0));
        assert_eq!(r.x, -1920 + (1920 - 300) / 2);
        assert_eq!(r.y, 200 + 1080 - 72 - 96);
    }

    #[test]
    fn never_taller_or_wider_than_a_tiny_monitor() {
        let r = pill_rect(&monitor(10, 20, 200, 50, 1.0));
        assert_eq!((r.w, r.h), (200, 50));
        assert_eq!(r.x, 10);
        // The margin would push it off the top: it stays on the monitor.
        assert_eq!(r.y, 20);
    }

    #[test]
    fn a_zero_scale_is_treated_as_one() {
        assert_eq!(
            pill_rect(&monitor(0, 0, 1000, 800, 0.0)),
            pill_rect(&monitor(0, 0, 1000, 800, 1.0))
        );
    }

    #[test]
    fn the_pill_appears_where_the_pointer_is() {
        let monitors = [
            monitor(0, 0, 1920, 1080, 1.0),
            monitor(1920, 0, 1920, 1080, 1.0),
        ];
        let second = pill_monitor(&monitors, Some(Point { x: 2500, y: 300 })).unwrap();
        assert_eq!(second.rect.x, 1920);
        let first = pill_monitor(&monitors, Some(Point { x: 10, y: 10 })).unwrap();
        assert_eq!(first.rect.x, 0);
    }

    #[test]
    fn without_a_pointer_the_primary_monitor_is_used() {
        let monitors = [
            monitor(0, 0, 1920, 1080, 1.0),
            monitor(1920, 0, 1920, 1080, 1.0),
        ];
        assert_eq!(pill_monitor(&monitors, None).unwrap().rect.x, 0);
        // A pointer between monitors (outside all) also falls back to the primary.
        assert_eq!(
            pill_monitor(&monitors, Some(Point { x: -50, y: -50 }))
                .unwrap()
                .rect
                .x,
            0
        );
        assert!(pill_monitor(&[], None).is_none());
    }
}
