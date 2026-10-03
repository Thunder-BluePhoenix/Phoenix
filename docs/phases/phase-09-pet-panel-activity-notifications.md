# Phase 09 — Pet Panel, Activity Feed & Notifications

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | Critical |
| Status | ⬜ Not started |
| Depends on | [Phase 08 — Web App Shell & Navbar Fawkes](phase-08-web-shell-navbar-fawkes.md) |
| Unblocks | [Phase 16 — Meetings UI & Recording Indicator](phase-16-meetings-ui.md), [Phase 19 — Settings & Privacy Controls](phase-19-settings-and-privacy.md) |

## Goal

Give users a contextual panel to inspect what Phoenix is doing and why.

## Scope

**In scope**

- PetPanel: PetStatus, ActiveTask, CapabilityList, ActivityFeed, QuickActions
- NotificationCenter
- Local event history (configurable)

**Out of scope**

- Meetings section (Phase 16)
- Settings (Phase 19)

## Tasks

- [ ] Implement PetPanel open/close from avatar
- [ ] PetStatus: state + explanation + active task
- [ ] ActiveTask with progress from task.updated
- [ ] ActivityFeed with source + severity filters
- [ ] NotificationCenter with unread state; persist Notification entity
- [ ] CapabilityList skeleton (health + permissions placeholder)
- [ ] QuickActions slot driven by context
- [ ] Configurable history retention
- [ ] UI + accessibility tests (US-02, US-03)

## Deliverables

- Pet Panel
- Notification Center

## Exit criteria

- [ ] US-02: state/task/events shown
- [ ] US-03: a build failure shows ERROR with text
- [ ] PRD Phase 2 exit: user can inspect/control

## Source documents

- Full System PRD v2.0 §5.3, §16
- Fawkes PRD v1.0 §5.3, FR-002, FR-006, FR-013

---
Back to [TRACKER](TRACKER.md)
