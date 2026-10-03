# Phase 16 — Meetings UI & Recording Indicator

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | Critical |
| Status | ✅ Done |
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

- [x] Meetings section in Pet Panel + dedicated pages (`#/meetings`, `#/meetings/<id>`)
- [x] Start with explicit confirmation (permission-gateway approval shown inline). **Stop is not offered**: Kage's bot cannot stop gracefully (contract asks); the UI says how to stop (remove the bot from the call)
- [x] Persistent RECORDING indicator everywhere Fawkes is visible today: navbar pill, Fawkes dot, Pet Panel, Meetings pages (desktop Fawkes arrives in Phase 14)
- [x] Processing progress (processing / transcribing / summarising, step n of 3), live
- [x] Transcript view with timestamps + speakers when segments exist (Kage currently provides plain text, shown as-is)
- [x] Summary view with topics, decisions, action items, follow-up questions; labels AI vs extractive summary
- [x] Show storage location; delete with confirmation (two-step, Phoenix copy); export (Markdown download); archive
- [x] Derived actions: action items are shown with a note that Phoenix never acts on them by itself; any capability command with side effects already waits for approval in the permission gateway (Phase 11). Task creation lands in Phase 36
- [x] E2E: start → approve → recording → transcript → summary visible (run in the real app against a stand-in Kage and bot; automated browser E2E belongs to Phase 20)

## Deliverables

- Meetings UI

## Exit criteria

- [x] US-05: recording visibly indicated
- [x] US-06: transcript + summary available
- [x] US-07: no external side effect before confirmation (verified: no bot process and no capture events until Approve)
- [x] PRD Phase 5 exit: end-to-end meeting workflow

## Implementation notes

- `apps/web/src/components/Meetings.tsx`: MeetingsPage, MeetingDetail, MeetingsGlance (Pet Panel); hash routing via `useHashRoute`, no router dependency.
- Content (transcript/summary) is fetched from Kage just after the status event, so the detail view re-checks for up to 5 s until it lands.
- Navbar at phone width: the brand word and state label hide below 420 px so Fawkes, the bell, the recording pill and both nav links always fit.

## Source documents

- Full System PRD v2.0 §5.3, §11.4, §16, US-04…07
- Fawkes PRD v1.0 §9.3, FR-011, FR-012

---
Back to [TRACKER](TRACKER.md)
