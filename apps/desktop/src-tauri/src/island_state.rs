// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! The island's state machine: hidden -> small -> expanded. Pure: time is passed in
//! (milliseconds on any monotonic clock), nothing here reads a clock, a window or the
//! pointer, so every transition is unit-tested.
//!
//! * `Hidden`: invisible when idle. Only a thin hot zone at the top edge exists.
//! * `Small`: a peek (pointer on the hot zone) or the resting state while Fawkes is busy.
//! * `Expanded`: opened by a click; shows the bubble, the recording pill and actions.
//!
//! Safety rule: while Fawkes needs the user (`urgent`: an approval, an error, recording) the
//! island never goes back to `Hidden`.

use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IslandState {
    Hidden,
    Small,
    Expanded,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Event {
    PointerEntered,
    PointerLeft,
    /// Click on Fawkes, or the menu. Hidden and Small open; Expanded closes to Small.
    Toggle,
    Collapse,
    /// What Fawkes is doing. `active`: not idle/sleeping/offline. `urgent`: needs the user.
    Activity {
        active: bool,
        urgent: bool,
    },
}

/// How long each state lingers after the pointer or the activity goes away.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Timing {
    /// Small -> Hidden after the pointer left a peek.
    pub peek_linger_ms: u64,
    /// Expanded -> Small after the pointer left.
    pub collapse_linger_ms: u64,
    /// Small -> Hidden after Fawkes became idle (long enough to read "Done").
    pub settle_ms: u64,
    /// Expanded -> Small when opened without the pointer (tray / menu) and left alone.
    pub unattended_expand_ms: u64,
}

impl Default for Timing {
    fn default() -> Self {
        Self {
            peek_linger_ms: 600,
            collapse_linger_ms: 1_200,
            settle_ms: 3_000,
            unattended_expand_ms: 8_000,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Machine {
    timing: Timing,
    state: IslandState,
    pointer: bool,
    active: bool,
    urgent: bool,
    deadline: Option<u64>,
}

impl Machine {
    pub fn new(timing: Timing) -> Self {
        Self {
            timing,
            state: IslandState::Hidden,
            pointer: false,
            active: false,
            urgent: false,
            deadline: None,
        }
    }

    pub fn state(&self) -> IslandState {
        self.state
    }

    pub fn pointer_inside(&self) -> bool {
        self.pointer
    }

    /// Applies an event. Returns true when the visible state changed.
    pub fn handle(&mut self, event: Event, now: u64) -> bool {
        let before = self.state;
        match event {
            Event::PointerEntered => {
                self.pointer = true;
                self.deadline = None;
                if self.state == IslandState::Hidden {
                    self.state = IslandState::Small;
                }
            }
            Event::PointerLeft => {
                self.pointer = false;
                self.arm(now, self.timing.peek_linger_ms);
            }
            Event::Toggle => {
                self.state = match self.state {
                    IslandState::Hidden | IslandState::Small => IslandState::Expanded,
                    IslandState::Expanded => IslandState::Small,
                };
                self.deadline = None;
                if self.state == IslandState::Expanded && !self.pointer {
                    self.deadline = Some(now + self.timing.unattended_expand_ms);
                } else {
                    self.arm(now, self.timing.peek_linger_ms);
                }
            }
            Event::Collapse => {
                if self.state == IslandState::Expanded {
                    self.state = IslandState::Small;
                    self.arm(now, self.timing.peek_linger_ms);
                }
            }
            Event::Activity { active, urgent } => {
                let was_active = self.active;
                self.urgent = urgent;
                self.active = active || urgent;
                if self.active {
                    if self.state == IslandState::Hidden {
                        self.state = IslandState::Small;
                    }
                    if self.state == IslandState::Small {
                        // Busy: stay put until Fawkes is idle again.
                        self.deadline = None;
                    }
                } else if was_active {
                    self.arm(now, self.timing.settle_ms);
                }
            }
        }
        self.state != before
    }

    /// Advances time. Returns true when the visible state changed.
    pub fn tick(&mut self, now: u64) -> bool {
        if self.pointer {
            return false;
        }
        let Some(deadline) = self.deadline else {
            return false;
        };
        if now < deadline {
            return false;
        }
        self.deadline = None;
        match self.state {
            IslandState::Expanded => {
                self.state = IslandState::Small;
                self.arm(now, self.timing.peek_linger_ms);
                true
            }
            IslandState::Small if !self.active && !self.urgent => {
                self.state = IslandState::Hidden;
                true
            }
            _ => false,
        }
    }

    /// Schedules the next step down. Never while the pointer is on the island, and never
    /// for a Small island that is still busy.
    fn arm(&mut self, now: u64, small_linger_ms: u64) {
        self.deadline = if self.pointer {
            None
        } else {
            match self.state {
                IslandState::Hidden => None,
                IslandState::Small => (!self.active).then_some(now + small_linger_ms),
                IslandState::Expanded => Some(now + self.timing.collapse_linger_ms),
            }
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn machine() -> Machine {
        Machine::new(Timing::default())
    }

    const T: Timing = Timing {
        peek_linger_ms: 600,
        collapse_linger_ms: 1_200,
        settle_ms: 3_000,
        unattended_expand_ms: 8_000,
    };

    #[test]
    fn starts_hidden_and_stays_hidden_when_idle() {
        let mut m = machine();
        assert_eq!(m.state(), IslandState::Hidden);
        assert!(!m.tick(1_000_000));
        assert_eq!(m.state(), IslandState::Hidden);
    }

    #[test]
    fn hover_peeks_and_leaving_hides_after_the_linger() {
        let mut m = machine();
        assert!(m.handle(Event::PointerEntered, 0));
        assert_eq!(m.state(), IslandState::Small);
        // Still on it: never hides, however long.
        assert!(!m.tick(60_000));
        assert_eq!(m.state(), IslandState::Small);

        assert!(!m.handle(Event::PointerLeft, 100_000));
        assert!(!m.tick(100_000 + T.peek_linger_ms - 1));
        assert_eq!(m.state(), IslandState::Small);
        assert!(m.tick(100_000 + T.peek_linger_ms));
        assert_eq!(m.state(), IslandState::Hidden);
    }

    #[test]
    fn coming_back_before_the_linger_ends_cancels_the_hide() {
        let mut m = machine();
        m.handle(Event::PointerEntered, 0);
        m.handle(Event::PointerLeft, 10);
        m.handle(Event::PointerEntered, 300);
        assert!(!m.tick(10_000));
        assert_eq!(m.state(), IslandState::Small);
    }

    #[test]
    fn click_expands_and_collapses_back_to_small() {
        let mut m = machine();
        m.handle(Event::PointerEntered, 0);
        assert!(m.handle(Event::Toggle, 10));
        assert_eq!(m.state(), IslandState::Expanded);
        assert!(m.handle(Event::Toggle, 20));
        assert_eq!(m.state(), IslandState::Small);
    }

    #[test]
    fn expanded_steps_down_one_level_at_a_time_after_the_pointer_leaves() {
        let mut m = machine();
        m.handle(Event::PointerEntered, 0);
        m.handle(Event::Toggle, 0);
        m.handle(Event::PointerLeft, 1_000);
        assert!(!m.tick(1_000 + T.collapse_linger_ms - 1));
        assert!(m.tick(1_000 + T.collapse_linger_ms));
        assert_eq!(m.state(), IslandState::Small);
        let t = 1_000 + T.collapse_linger_ms;
        assert!(m.tick(t + T.peek_linger_ms));
        assert_eq!(m.state(), IslandState::Hidden);
    }

    #[test]
    fn escape_collapses_an_expanded_island_only() {
        let mut m = machine();
        assert!(!m.handle(Event::Collapse, 0));
        assert_eq!(m.state(), IslandState::Hidden);
        m.handle(Event::PointerEntered, 0);
        m.handle(Event::Toggle, 0);
        assert!(m.handle(Event::Collapse, 5));
        assert_eq!(m.state(), IslandState::Small);
    }

    #[test]
    fn opening_from_the_tray_without_the_pointer_closes_itself_later() {
        let mut m = machine();
        assert!(m.handle(Event::Toggle, 0));
        assert_eq!(m.state(), IslandState::Expanded);
        assert!(!m.tick(T.unattended_expand_ms - 1));
        assert!(m.tick(T.unattended_expand_ms));
        assert_eq!(m.state(), IslandState::Small);
    }

    #[test]
    fn activity_shows_the_island_and_keeps_it_while_busy() {
        let mut m = machine();
        assert!(m.handle(
            Event::Activity {
                active: true,
                urgent: false
            },
            0
        ));
        assert_eq!(m.state(), IslandState::Small);
        assert!(!m.tick(10_000_000));
        assert_eq!(m.state(), IslandState::Small);
    }

    #[test]
    fn finishing_work_settles_to_hidden_after_a_few_seconds() {
        let mut m = machine();
        m.handle(
            Event::Activity {
                active: true,
                urgent: false,
            },
            0,
        );
        m.handle(
            Event::Activity {
                active: false,
                urgent: false,
            },
            5_000,
        );
        assert!(!m.tick(5_000 + T.settle_ms - 1));
        assert!(m.tick(5_000 + T.settle_ms));
        assert_eq!(m.state(), IslandState::Hidden);
    }

    #[test]
    fn urgent_activity_is_never_hidden_even_if_reported_inactive() {
        let mut m = machine();
        m.handle(
            Event::Activity {
                active: false,
                urgent: true,
            },
            0,
        );
        assert_eq!(m.state(), IslandState::Small);
        m.handle(Event::PointerEntered, 1);
        m.handle(Event::PointerLeft, 2);
        assert!(!m.tick(1_000_000));
        assert_eq!(m.state(), IslandState::Small);
    }

    #[test]
    fn busy_island_survives_a_pointer_peek() {
        let mut m = machine();
        m.handle(
            Event::Activity {
                active: true,
                urgent: false,
            },
            0,
        );
        m.handle(Event::PointerEntered, 10);
        m.handle(Event::Toggle, 20);
        m.handle(Event::PointerLeft, 30);
        assert!(m.tick(30 + T.collapse_linger_ms));
        assert_eq!(m.state(), IslandState::Small);
        assert!(!m.tick(10_000_000));
        assert_eq!(m.state(), IslandState::Small);
    }

    #[test]
    fn going_idle_while_hovering_waits_for_the_pointer_to_leave() {
        let mut m = machine();
        m.handle(
            Event::Activity {
                active: true,
                urgent: false,
            },
            0,
        );
        m.handle(Event::PointerEntered, 10);
        m.handle(
            Event::Activity {
                active: false,
                urgent: false,
            },
            20,
        );
        assert!(!m.tick(1_000_000));
        m.handle(Event::PointerLeft, 1_000_000);
        assert!(m.tick(1_000_000 + T.peek_linger_ms));
        assert_eq!(m.state(), IslandState::Hidden);
    }
}
