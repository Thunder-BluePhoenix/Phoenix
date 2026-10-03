# Phase 15 — Kage Adapter & Meeting Lifecycle

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | Critical |
| Status | ✅ Done |
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

- [x] Implement adapter against the Kage API contract from Phase 00 (contract reconciled with real Kage → v0.1)
- [x] Commands: meeting.start (confirmation every time), get_status, get_transcript, get_summary, list; archive/delete are Phoenix-side (`/api/meetings`), delete needs `{"confirm": true}`. **meeting.stop not offered**: Kage's bot cannot stop gracefully (see notes)
- [x] Map Kage status changes (polled; Kage has no callbacks) to events: kage.connected, kage.meeting.started/recording/ended, kage.transcription.started/completed, kage.summary.started/ready, kage.meeting.failed, plus kage.capture.finished and ephemeral kage.meeting.synced
- [x] Persist Meeting, Transcript, Summary entities (recording by reference + retention metadata): `meetings` table (migration 5), synced from events by `core/runtime/src/meetings.ts`
- [x] Endpoints: GET /api/meetings, /{id}, /{id}/transcript, /{id}/summary (+ archive, delete)
- [x] Request meeting_recording + network on enable (not microphone: the bot captures system audio, not the mic)
- [x] Build mock Kage service; integration tests for whole lifecycle (plus a verified run against the real Kage backend)
- [x] Outage test: core survives Kage being unreachable (CAPABILITY_UNAVAILABLE)

## Deliverables

- capabilities/kage
- Mock Kage
- Meeting API

## Exit criteria

- [x] US-04: authorised meeting workflow starts
- [x] Core survives Kage outage

## Implementation notes

- **Real Kage differs from the v0 draft** (no start/stop API, no webhooks, no archive/delete, API-key auth). The user chose to adapt Phoenix to Kage as-is; ADR-0017 amended, contract rewritten as v0.1 with a list of asks for Kage.
- **OS secret storage** landed here (ADR-0014's deferred keychain store): `KeychainSecretStore` (macOS `security`, Linux `secret-tool`, values on stdin only), `POST/DELETE /api/capabilities/{id}/secrets/{name}`, `ctx.secret(name)` for builtins, audited, removed on uninstall.
- **Disabling a capability now clears its Fawkes conditions** (`StateEngine.clearSource`), so a disabled Kage can never leave a stale RECORDING indicator (and a disabled Git no stale conflict WARNING).
- Capabilities can emit ephemeral events (`ctx.emit(event, { ephemeral: true })`): used to sync past meetings without flooding the activity feed.
- Verified against the real Kage backend (isolated DB, offline models): upload → `transcription.started` → `meeting.failed` with Kage's reason, Fawkes ERROR, meeting record with recording reference; API key stored in and deleted from the macOS keychain.

## Notes & risks

- Phoenix must never silently record. Capture needs an explicit confirmation every time and shows RECORDING (no timeout) while the bot runs.
- Without a graceful bot stop, disabling Kage or the emergency stop mid-capture loses the recording (and Kage's bot may leave macOS audio output on BlackHole). Fix belongs in Kage (contract "asks").

## Source documents

- Full System PRD v2.0 §11
- Fawkes PRD v1.0 §9, FR-009, FR-010

---
Back to [TRACKER](TRACKER.md)
