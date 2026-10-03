# capabilities/kage

Connects Phoenix to your [Kage](https://github.com/Thunder-BluePhoenix/kage) server ([Phase 15](../../docs/phases/phase-15-kage-adapter-meeting-lifecycle.md), contract: [kage-api-v0.md](../../docs/contracts/kage-api-v0.md)).
Phoenix follows each meeting through Kage's pipeline, keeps a local record (transcript and summary included) and can start a capture with Kage's Meet bot. Kage does the capturing, transcribing and summarising.

## Setup

1. Run Kage's backend and copy your API key from the Kage dashboard (`GET /auth/me`).
2. Store the key in your OS keychain and point Phoenix at Kage:

```sh
TOKEN=$(cat .phoenix/dev/session.token)
H=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')
read -rs KAGE_KEY && printf '{"value":"%s"}' "$KAGE_KEY" | \
  curl "${H[@]}" -d @- http://127.0.0.1:4870/api/capabilities/kage/secrets/api_key
curl "${H[@]}" -d '{"config":{"base_url":"http://127.0.0.1:8000","bot_path":"/absolute/path/to/kage/bot/bot.js"}}' \
  http://127.0.0.1:4870/api/capabilities/kage/config
curl "${H[@]}" -X POST -d '{}' http://127.0.0.1:4870/api/capabilities/kage/enable
```

Enabling grants `meeting_recording` and `network`. `bot_path` is only needed to start captures from Phoenix.

## What you get

- Fawkes follows every meeting: WORKING while Kage processes, SUCCESS when the transcript or summary is ready, ERROR with Kage's reason if it fails.
- `GET /api/meetings`, `/api/meetings/kage:<id>`, `…/transcript`, `…/summary`: Phoenix's copy, readable even while Kage is down.
- **Start a capture:** `meeting.start { meet_url, title }` asks for your approval every time, runs Kage's bot, and shows RECORDING until the bot finishes.
- Archive and delete apply to Phoenix's copy. Delete the recording itself in Kage.

## Limitations (Kage today)

- **No stop button.** Kage's bot stops when the call ends or after `max_duration_min`; remove the bot from the call to stop sooner. Disabling Kage or the emergency stop kills the bot and the in-progress recording is lost.
- Status is polled (`poll_ms`, default 5 s); transcripts are plain text without timestamps.
