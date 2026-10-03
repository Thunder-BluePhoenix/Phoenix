# Kage API Contract — v0 (Draft)

> Status: **Draft** (ADR-0017). Must be confirmed with the Kage maintainers before Phase 15.
> Phoenix integrates Kage; it does not re-implement capture, transcription or summarisation.

## Transport

- HTTP/JSON for commands, base URL configured per installation (default `http://127.0.0.1:8765`).
- Kage pushes status changes to Phoenix through a webhook (`POST {phoenix}/api/capabilities/kage/events`) authenticated with the per-capability token (ADR-0016). Polling `GET /meetings/{id}` is the fallback.

## Commands (Phoenix → Kage)

| Phoenix command          | HTTP                                                                                                               | Authorisation in Phoenix |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| `meeting.start`          | `POST /meetings` `{ "title"?: string, "meet_url"?: string }` → `{ "meeting_id" }`                                  | Explicit user action     |
| `meeting.stop`           | `POST /meetings/{id}/stop`                                                                                         | Explicit user action     |
| `meeting.get_status`     | `GET /meetings/{id}` → `{ "meeting_id", "status", "started_at", "ended_at"? }`                                     | Capability access        |
| `meeting.get_transcript` | `GET /meetings/{id}/transcript` → `{ "segments": [{ "start_ms", "end_ms", "speaker"?, "text" }] }`                 | Authorised user          |
| `meeting.get_summary`    | `GET /meetings/{id}/summary` → `{ "text", "topics": string[], "decisions"?: string[], "action_items"?: string[] }` | Authorised user          |
| `meeting.archive`        | `POST /meetings/{id}/archive`                                                                                      | Authorised user          |
| `meeting.delete`         | `DELETE /meetings/{id}`                                                                                            | Explicit confirmation    |
| health                   | `GET /health` → `{ "status": "ok" }`                                                                               | —                        |

`status` is one of: `start_requested`, `recording`, `ended`, `processing`, `transcribing`, `summarizing`, `ready`, `archived`, `failed`.

## Events (Kage → Phoenix, normalised by the adapter)

| Kage status change | Phoenix event                  |
| ------------------ | ------------------------------ |
| reachable          | `kage.connected`               |
| `start_requested`  | `kage.meeting.started`         |
| `recording`        | `kage.meeting.recording`       |
| `ended`            | `kage.meeting.ended`           |
| `transcribing`     | `kage.transcription.started`   |
| transcript ready   | `kage.transcription.completed` |
| `summarizing`      | `kage.summary.started`         |
| `ready`            | `kage.summary.ready`           |
| `failed`           | `kage.meeting.failed`          |

All events use `correlation_id = meeting_id`.

## Errors

Kage errors map to Phoenix error codes: unreachable → `CAPABILITY_UNAVAILABLE`, 404 → `RESOURCE_NOT_FOUND`, timeout → `OPERATION_TIMEOUT`.

## Open questions for Kage maintainers

1. Does Kage already expose an HTTP API, or does it need a thin server?
2. Webhook vs polling — which does Kage support today?
3. Recording storage location and retention controls — exposed via API?
