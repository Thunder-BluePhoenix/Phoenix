// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Ties the island's pieces together without touching the OS: the state machine
//! (`island_state`), where the window goes (`island_geometry`) and who sees the pointer
//! (`island_platform`). The Tauri glue (`island.rs`) feeds it monitors, the cursor and page
//! events and applies the `Frame` it returns, so everything decided here is unit-tested.

use crate::island_geometry::{
    layout_for, may_relocate, pointer_over, select_monitor, IslandDisplay, Layout, MonitorInfo,
};
use crate::island_platform::PointerSource;
use crate::island_state::{Event, IslandState, Machine, Timing};
use crate::position::Point;
use serde::{Deserialize, Serialize};

/// What the window should look like now.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Frame {
    pub state: IslandState,
    /// Who reports the hover: the shell polls the cursor, or the page does (Wayland).
    pub pointer: PointerSource,
    pub layout: Layout,
}

/// What the island page may tell the shell. An unknown `kind` is rejected by serde, so a page
/// can only do what this list says.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PageEvent {
    PointerEnter,
    PointerLeave,
    Toggle,
    Collapse,
    Activity { active: bool, urgent: bool },
}

impl From<PageEvent> for Event {
    fn from(event: PageEvent) -> Event {
        match event {
            PageEvent::PointerEnter => Event::PointerEntered,
            PageEvent::PointerLeave => Event::PointerLeft,
            PageEvent::Toggle => Event::Toggle,
            PageEvent::Collapse => Event::Collapse,
            PageEvent::Activity { active, urgent } => Event::Activity { active, urgent },
        }
    }
}

pub struct Controller {
    machine: Machine,
    display: IslandDisplay,
    source: PointerSource,
    monitors: Vec<MonitorInfo>,
    current: Option<usize>,
    published: Option<Frame>,
}

impl Controller {
    pub fn new(timing: Timing, display: IslandDisplay, source: PointerSource) -> Self {
        Self {
            machine: Machine::new(timing),
            display,
            source,
            monitors: Vec::new(),
            current: None,
            published: None,
        }
    }

    #[cfg(test)]
    pub fn state(&self) -> IslandState {
        self.machine.state()
    }

    /// Forget what was last handed out so the next call publishes the current frame again
    /// (the window was hidden and is shown again).
    pub fn invalidate(&mut self) {
        self.published = None;
    }

    pub fn display(&self) -> &IslandDisplay {
        &self.display
    }

    pub fn monitors(&self) -> &[MonitorInfo] {
        &self.monitors
    }

    /// The frame for the current state on the current monitor; `None` with no monitors.
    pub fn frame(&self) -> Option<Frame> {
        let monitor = self.monitors.get(self.current?)?;
        let state = self.machine.state();
        Some(Frame {
            state,
            pointer: self.source,
            layout: layout_for(state, monitor),
        })
    }

    /// Replaces the monitor list (connect / disconnect / resolution change).
    pub fn set_monitors(
        &mut self,
        monitors: Vec<MonitorInfo>,
        cursor: Option<Point>,
    ) -> Option<Frame> {
        self.monitors = monitors;
        self.current = select_monitor(&self.display, &self.monitors, cursor, self.current);
        self.publish()
    }

    pub fn set_display(&mut self, display: IslandDisplay, cursor: Option<Point>) -> Option<Frame> {
        self.display = display;
        self.current = select_monitor(&self.display, &self.monitors, cursor, self.current);
        self.publish()
    }

    /// A page event (hover reported by the page, click, Escape, activity).
    pub fn handle(&mut self, event: Event, now: u64) -> Option<Frame> {
        // The page only sees the pointer where the shell cannot; ignore its hover otherwise so
        // two sources never fight.
        let page_hover = matches!(event, Event::PointerEntered | Event::PointerLeft);
        if page_hover && self.source == PointerSource::Poll {
            return None;
        }
        self.machine.handle(event, now);
        self.publish()
    }

    /// One tick of the shell's loop: the global cursor (when known) and the clock.
    pub fn poll(&mut self, cursor: Option<Point>, now: u64) -> Option<Frame> {
        if may_relocate(self.machine.state()) && !self.machine.pointer_inside() {
            self.current = select_monitor(&self.display, &self.monitors, cursor, self.current);
        }
        if self.source == PointerSource::Poll {
            if let (Some(cursor), Some(frame)) = (cursor, self.frame()) {
                let scale = self.monitors[self.current.unwrap_or(0)].scale;
                let over = pointer_over(frame.state, frame.layout.rect, scale, cursor);
                if over != self.machine.pointer_inside() {
                    let event = if over {
                        Event::PointerEntered
                    } else {
                        Event::PointerLeft
                    };
                    self.machine.handle(event, now);
                }
            }
        }
        self.machine.tick(now);
        self.publish()
    }

    /// Returns the frame only when it differs from the last one handed out.
    pub fn republish(&mut self) -> Option<Frame> {
        self.invalidate();
        self.publish()
    }

    fn publish(&mut self) -> Option<Frame> {
        let frame = self.frame()?;
        if self.published == Some(frame) {
            return None;
        }
        self.published = Some(frame);
        Some(frame)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::island_geometry::Notch;
    use crate::position::Rect;

    fn monitor(x: i32, w: i32, notch: Option<Notch>) -> MonitorInfo {
        MonitorInfo {
            rect: Rect::new(x, 0, w, 1080),
            scale: 1.0,
            name: None,
            notch,
        }
    }

    fn controller(display: IslandDisplay, source: PointerSource) -> Controller {
        let mut c = Controller::new(Timing::default(), display, source);
        let first = c.set_monitors(
            vec![monitor(0, 1920, None), monitor(1920, 1920, None)],
            None,
        );
        assert!(first.is_some(), "first monitor list publishes a frame");
        c
    }

    fn top_centre(x: i32) -> Point {
        Point { x, y: 0 }
    }

    #[test]
    fn page_events_parse_from_the_shape_the_page_sends_and_nothing_else() {
        let ok = |json: &str| serde_json::from_str::<PageEvent>(json).ok();
        assert_eq!(ok(r#"{"kind":"toggle"}"#), Some(PageEvent::Toggle));
        assert_eq!(
            ok(r#"{"kind":"pointer_enter"}"#),
            Some(PageEvent::PointerEnter)
        );
        assert_eq!(
            ok(r#"{"kind":"activity","active":true,"urgent":false}"#),
            Some(PageEvent::Activity {
                active: true,
                urgent: false
            })
        );
        assert_eq!(ok(r#"{"kind":"activity","active":true}"#), None);
        assert_eq!(ok(r#"{"kind":"quit"}"#), None);
        assert_eq!(Event::from(PageEvent::Collapse), Event::Collapse);
    }

    #[test]
    fn a_hidden_island_has_a_thin_frame_at_the_top_centre() {
        let c = controller(IslandDisplay::Primary, PointerSource::Poll);
        let f = c.frame().unwrap();
        assert_eq!(f.state, IslandState::Hidden);
        assert_eq!(f.layout.rect.y, 0);
        assert_eq!(f.layout.rect.h, 4);
    }

    #[test]
    fn nothing_is_published_without_monitors_or_without_change() {
        let mut c = Controller::new(
            Timing::default(),
            IslandDisplay::Primary,
            PointerSource::Poll,
        );
        assert_eq!(c.frame(), None);
        assert_eq!(c.poll(Some(top_centre(10)), 0), None);
        c.set_monitors(vec![monitor(0, 1920, None)], None);
        assert_eq!(
            c.poll(Some(Point { x: 500, y: 500 }), 10),
            None,
            "idle polling is silent"
        );
    }

    #[test]
    fn hovering_the_hot_zone_peeks_and_leaving_hides_it_again() {
        let mut c = controller(IslandDisplay::Primary, PointerSource::Poll);
        let centre = top_centre(960);
        let peek = c.poll(Some(centre), 0).unwrap();
        assert_eq!(peek.state, IslandState::Small);
        assert!(peek.layout.rect.h > 4);
        assert_eq!(c.poll(Some(centre), 5_000), None, "still hovering: stays");
        // Pointer moves well away.
        assert_eq!(
            c.poll(Some(Point { x: 960, y: 600 }), 6_000),
            None,
            "linger running"
        );
        let hidden = c.poll(Some(Point { x: 960, y: 600 }), 6_700).unwrap();
        assert_eq!(hidden.state, IslandState::Hidden);
    }

    #[test]
    fn a_click_expands_and_the_page_hover_is_ignored_when_the_shell_polls() {
        let mut c = controller(IslandDisplay::Primary, PointerSource::Poll);
        c.poll(Some(top_centre(960)), 0);
        assert_eq!(c.handle(Event::PointerLeft, 1), None);
        let open = c.handle(Event::Toggle, 2).unwrap();
        assert_eq!(open.state, IslandState::Expanded);
        assert!(open.layout.rect.h > 100);
    }

    #[test]
    fn on_wayland_the_page_reports_the_hover_and_the_cursor_is_ignored() {
        let mut c = controller(IslandDisplay::Primary, PointerSource::Page);
        assert_eq!(c.poll(Some(top_centre(960)), 0), None);
        let peek = c.handle(Event::PointerEntered, 1).unwrap();
        assert_eq!(peek.state, IslandState::Small);
        c.handle(Event::PointerLeft, 100);
        let gone = c
            .poll(None, 100 + Timing::default().peek_linger_ms)
            .unwrap();
        assert_eq!(gone.state, IslandState::Hidden);
    }

    #[test]
    fn follow_mouse_moves_the_hidden_island_to_the_other_monitor() {
        let mut c = controller(IslandDisplay::FollowMouse, PointerSource::Poll);
        let before = c.frame().unwrap().layout.rect;
        let moved = c.poll(Some(Point { x: 2500, y: 400 }), 0).unwrap();
        assert_eq!(moved.state, IslandState::Hidden);
        assert_eq!(moved.layout.rect.x, before.x + 1920);
    }

    #[test]
    fn a_shown_island_stays_on_its_monitor_even_if_the_pointer_wanders() {
        let mut c = controller(IslandDisplay::FollowMouse, PointerSource::Poll);
        c.handle(
            Event::Activity {
                active: true,
                urgent: false,
            },
            0,
        );
        let shown = c.frame().unwrap().layout.rect;
        assert_eq!(c.poll(Some(Point { x: 2500, y: 400 }), 10), None);
        assert_eq!(c.frame().unwrap().layout.rect, shown);
    }

    #[test]
    fn choosing_a_display_republishes_there() {
        let mut c = controller(IslandDisplay::Primary, PointerSource::Poll);
        let f = c
            .set_display(IslandDisplay::FollowMouse, Some(Point { x: 2500, y: 5 }))
            .unwrap();
        assert!(f.layout.rect.x >= 1920);
    }

    #[test]
    fn unplugging_the_monitor_recovers_to_the_one_left() {
        let mut c = controller(IslandDisplay::FollowMouse, PointerSource::Poll);
        c.poll(Some(Point { x: 2500, y: 5 }), 0);
        let f = c.set_monitors(vec![monitor(0, 1920, None)], None).unwrap();
        assert!(f.layout.rect.x < 1920);
        assert_eq!(c.set_monitors(Vec::new(), None), None);
        assert_eq!(c.frame(), None);
    }

    #[test]
    fn a_notch_is_reflected_in_the_layout_the_page_gets() {
        let mut c = Controller::new(
            Timing::default(),
            IslandDisplay::Primary,
            PointerSource::Poll,
        );
        let notch = Notch {
            width: 200.0,
            height: 38.0,
        };
        let f = c
            .set_monitors(
                vec![MonitorInfo {
                    rect: Rect::new(0, 0, 3456, 2234),
                    scale: 2.0,
                    name: None,
                    notch: Some(notch),
                }],
                None,
            )
            .unwrap();
        assert!(f.layout.has_notch);
        assert_eq!(f.layout.notch_width, 200);
    }

    #[test]
    fn urgent_activity_pops_the_island_up_and_it_does_not_go_away() {
        let mut c = controller(IslandDisplay::Primary, PointerSource::Poll);
        let f = c
            .handle(
                Event::Activity {
                    active: true,
                    urgent: true,
                },
                0,
            )
            .unwrap();
        assert_eq!(f.state, IslandState::Small);
        assert_eq!(c.poll(Some(Point { x: 10, y: 900 }), 1_000_000), None);
        assert_eq!(c.state(), IslandState::Small);
    }
}
