# Phase 09 — Pet Panel, Activity Feed & Notifications

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | Critical |
| Status | ✅ Done |
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

- [x] Implement PetPanel open/close from avatar
- [x] PetStatus: state + explanation + active task
- [x] ActiveTask with progress from task.updated
- [x] ActivityFeed with source + severity filters
- [x] NotificationCenter with unread state; persist Notification entity
- [x] CapabilityList skeleton (health + permissions placeholder)
- [x] QuickActions slot driven by context
- [x] Configurable history retention
- [x] UI + accessibility tests (US-02, US-03)

## Deliverables

- Pet Panel
- Notification Center

## Exit criteria

- [x] US-02: state/task/events shown
- [x] US-03: a build failure shows ERROR with text
- [x] PRD Phase 2 exit: user can inspect/control

## Progress log

- 2026-10-03: core/notifications — notifications for errors, warnings, anything requiring action and notable successes (meeting summary ready); preferences (enabled, minimum severity, muted sources); 30 s duplicate suppression; stored locally (bounded) and streamed as `notification.created`. API: list, mark read, read-all, preferences.
- StateEngine.describe(): one wording for Fawkes, activity feed and notifications (plus templates for bookkeeping events such as "Deployer enabled"). Event history and `event.created` carry `description`.
- Pet Panel tabs: Overview (status + "for N min", approvals with Approve/Reject, active tasks, quick actions: dismiss errors, pause/wake, two-step emergency stop), Activity (live, source + severity filters), Capabilities (status, health, permissions, data categories, enable/disable). Notification bell with unread count, popover, mark read / all read. Tabs follow the WAI-ARIA pattern (arrow keys, Home/End).
- Verified in Chromium against a real core with a real external capability: production action → Fawkes WAITING → approved from the panel → operation succeeded; build failure → notification. Screenshots: docs/images/web-approval.png, web-activity.png. 38 new tests.
- History retention is configurable via `eventHistoryLimit` (config); a settings UI for it comes in Phase 19.

## Source documents

- Full System PRD v2.0 §5.3, §16
- Fawkes PRD v1.0 §5.3, FR-002, FR-006, FR-013

---
Back to [TRACKER](TRACKER.md)
