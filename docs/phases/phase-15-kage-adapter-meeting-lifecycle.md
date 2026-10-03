# Phase 15 — Kage Adapter & Meeting Lifecycle

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | Critical |
| Status | ⬜ Not started |
| Depends on | [Phase 13 — Capability SDK, Mock Capability & Event Simulator](phase-13-capability-sdk-mock-simulator.md) |
| Unblocks | [Phase 16 — Meetings UI & Recording Indicator](phase-16-meetings-ui.md) |

## Goal

Integrate Kage as the first real capability, driving the full meeting lifecycle without duplicating Kage's engine.

## Scope

**In scope**

- capabilities/kage adapter
- Lifecycle: IDLE → START_REQUESTED → RECORDING → MEETING_ENDED → PROCESSING → TRANSCRIBING/SUMMARIZING → READY → ARCHIVED
- Kage commands + events
- Meeting API endpoints
- Mock Kage server for tests

**Out of scope**

- Decision/action-item extraction (Phase 35)

## Tasks

- [ ] Implement adapter against the Kage API contract from Phase 00
- [ ] Commands: meeting.start, meeting.stop (explicit user action), get_status, get_transcript, get_summary, archive, delete (confirmation)
- [ ] Map Kage callbacks to events: kage.connected, kage.meeting.started/recording/ended, kage.transcription.started/completed, kage.summary.started/ready, kage.meeting.failed
- [ ] Persist Meeting, Transcript, Summary entities (recording by reference + retention metadata)
- [ ] Endpoints: GET /api/meetings, /{id}, /{id}/transcript, /{id}/summary
- [ ] Request meeting_recording + microphone permissions on enable
- [ ] Build mock Kage service; integration tests for whole lifecycle
- [ ] Outage test: core survives Kage being unreachable (CAPABILITY_UNAVAILABLE)

## Deliverables

- capabilities/kage
- Mock Kage
- Meeting API

## Exit criteria

- [ ] US-04: authorised meeting workflow starts
- [ ] Core survives Kage outage

## Notes & risks

- Phoenix must never silently record.

## Source documents

- Full System PRD v2.0 §11
- Fawkes PRD v1.0 §9, FR-009, FR-010

---
Back to [TRACKER](TRACKER.md)
