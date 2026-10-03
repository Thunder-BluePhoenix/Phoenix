# Phase 16 — Meetings UI & Recording Indicator

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | Critical |
| Status | ⬜ Not started |
| Depends on | [Phase 15 — Kage Adapter & Meeting Lifecycle](phase-15-kage-adapter-meeting-lifecycle.md), [Phase 09 — Pet Panel, Activity Feed & Notifications](phase-09-pet-panel-activity-notifications.md) |
| Unblocks | [Phase 20 — Hardening, E2E, Observability & v0.1 Release](phase-20-hardening-and-v0-1-release.md), [Phase 35 — Kage Decisions & Action-Item Extraction](phase-35-kage-decisions-and-action-items.md) |

## Goal

Let users start/stop meetings, always see recording status, and review transcripts and summaries.

## Scope

**In scope**

- Meetings: MeetingList, MeetingDetail, Transcript, Summary
- Recording indicator in navbar, panel and desktop
- Stop control
- Delete / export
- Derived-action approval stub

**Out of scope**

- Automatic task creation

## Tasks

- [ ] Meetings section in Pet Panel + dedicated pages
- [ ] Start / Stop buttons with explicit confirmation
- [ ] Persistent RECORDING indicator everywhere Fawkes is visible
- [ ] Processing progress (transcribing / summarising)
- [ ] Transcript view with timestamps + speakers
- [ ] Summary view with topics
- [ ] Show storage location; delete with confirmation; export
- [ ] Approval dialog stub: any derived external action requires confirmation (no side effect before)
- [ ] E2E: start → transcript → summary visible

## Deliverables

- Meetings UI

## Exit criteria

- [ ] US-05: recording visibly indicated
- [ ] US-06: transcript + summary available
- [ ] US-07: no external side effect before confirmation
- [ ] PRD Phase 5 exit: end-to-end meeting workflow

## Source documents

- Full System PRD v2.0 §5.3, §11.4, §16, US-04…07
- Fawkes PRD v1.0 §9.3, FR-011, FR-012

---
Back to [TRACKER](TRACKER.md)
