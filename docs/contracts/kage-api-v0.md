# Kage API Contract — v0.1 (as integrated)

> Status: **Accepted** (ADR-0017). Reconciled against Kage's actual backend (`kage/backend`, FastAPI) and Meet bot (`kage/bot`) on 2026-10-04.
> Phoenix integrates Kage; it does not re-implement capture, transcription or summarisation.
> The v0 draft assumed start/stop endpoints, webhooks, archive and delete. Kage has none of these, so Phoenix adapts to Kage as it is (decision recorded in Phase 15).

## Transport and authentication

- HTTP/JSON. Base URL configured per installation (`base_url`, default `http://127.0.0.1:8000`).
- Every `/api/*` call sends `X-API-Key: <key>`. The key comes from the user's Kage dashboard (`GET /auth/me`). Phoenix stores it in OS secret storage as the `kage` capability's `api_key` secret, never in config or events.
- **No webhooks.** Phoenix polls `GET /api/meetings` (`poll_ms`, default 5 s) and turns status changes into events.

## Endpoints Phoenix uses

| Phoenix command          | Kage HTTP                                                       | Notes                                                      |
| ------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------- |
| (polling) `meeting.list` | `GET /api/meetings` → `Meeting[]` (newest first)                | Scoped to the API key's user                               |
| `meeting.get_status`     | `GET /api/meetings/{id}` → `Meeting`                            | 404 → `RESOURCE_NOT_FOUND`                                 |
| `meeting.get_transcript` | `GET /api/meetings/{id}` → `transcript` (flattened text)        | Kage does not expose segments as JSON yet                  |
| `meeting.get_summary`    | `GET /api/meetings/{id}` → `summary` ?? `extractive_summary`, … | `generated_by: "ai"` (Claude) or `"extractive"` (TextRank) |
| health                   | `GET /health` → `{ "status": "ok" }` (no auth)                  |                                                            |

`Meeting` fields used: `id`, `title`, `status`, `created_at` (SQLite UTC `YYYY-MM-DD HH:MM:SS`), `duration_seconds`, `participants`, `transcript`, `summary`, `extractive_summary`, `key_decisions`, `action_items`, `follow_up_questions`, `keywords`, `error_message`.

## Status → event mapping

| Kage `status`  | Phoenix event                  | Phoenix status | Fawkes                                |
| -------------- | ------------------------------ | -------------- | ------------------------------------- |
| `uploaded`     | `kage.meeting.ended`           | `processing`   | WORKING "Processing meeting"          |
| `transcribing` | `kage.transcription.started`   | `transcribing` | WORKING                               |
| `transcribed`  | `kage.transcription.completed` | `transcribed`  | SUCCESS "Transcript ready: …"         |
| `summarizing`  | `kage.summary.started`         | `summarizing`  | THINKING                              |
| `summarized`   | `kage.summary.ready`           | `ready`        | SUCCESS                               |
| `failed`       | `kage.meeting.failed`          | `failed`       | ERROR (payload.error = Kage's reason) |

- `transcribed` is a final state when Kage has no `ANTHROPIC_API_KEY`; the extractive summary is still available.
- `correlation_id = kage-meeting-<id>`, `payload.meeting_id = "<id>"`. Phoenix's meeting id is `kage:<id>`.
- Statuses can be skipped between polls; Phoenix emits the event for the status it sees.
- On the first poll after enabling, meetings that already finished are recorded with an ephemeral `kage.meeting.synced` event (stored in Phoenix's meeting list, not replayed in the activity feed). Up to 100 most recent.
- Every event carries `payload.recording = { location: "<base_url>/api/meetings/<id>/media/audio", retention: "Stored and deleted by Kage" }`: a reference, never the media.

## Capture (`meeting.start`)

Kage has no recording API: capture is done by the browser extension (user gesture) or the Meet bot, which upload audio to `POST /api/meetings` when the call ends. From Phoenix, `meeting.start { meet_url, title? }`:

- requires the `meeting_recording` permission **and an explicit confirmation every time** (side effect `execute`);
- runs `node <bot_path> <meet_url> --title … --backend <base_url>` with `KAGE_API_KEY` in the environment (not argv). The bot runs under a small supervisor (`capabilities/kage/src/bot-supervisor.cjs`) that Core holds a stdin pipe to; if Core is killed, the OS closes the pipe and the supervisor stops the bot (SIGTERM, then SIGKILL after 5 s). Without it a killed Core left the bot recording as an orphan;
- emits `kage.meeting.started` (WORKING "Joining …"), `kage.meeting.recording` when the bot prints `recording …` (RECORDING, no timeout), then `kage.capture.finished` (clears) on exit 0 or `kage.meeting.failed` with the bot's last stderr line;
- allows one capture at a time.

**No stop.** The bot has no signal handler: stopping it early loses the recording and can leave the macOS audio output on BlackHole. It stops by itself when the call ends or after `max_duration_min`. To stop sooner, remove the bot from the call. Disabling Kage or the emergency stop kills the bot (recording lost) and clears the indicator. The same happens if Core dies: the recording is lost, and on restart Core shows no recording (see "Not recovered" in the Phase 20 notes).

## Archive and delete

Kage has no archive or delete endpoints. Both are Phoenix-side (`POST /api/meetings/{id}/archive`, `DELETE /api/meetings/{id}` with `{"confirm": true}`): delete purges Phoenix's copy and leaves a tombstone so it is not re-imported. The recording and transcript stay in Kage until deleted there.

## Errors

| Situation            | Phoenix error code       |
| -------------------- | ------------------------ |
| Kage unreachable     | `CAPABILITY_UNAVAILABLE` |
| No API key / 401     | `PERMISSION_DENIED`      |
| 404                  | `RESOURCE_NOT_FOUND`     |
| No answer within 5 s | `OPERATION_TIMEOUT`      |

## Asks for Kage (would improve the integration)

1. A SIGINT/SIGTERM handler in `bot/bot.js` that stops capture, restores audio and uploads, so Phoenix can offer **Stop**.
2. `DELETE /api/meetings/{id}` so deleting in Phoenix can delete the recording.
3. Transcript segments (`start_ms`, `end_ms`, `speaker`, `text`) in the JSON API.
4. Optional webhook on status change, to replace polling.
