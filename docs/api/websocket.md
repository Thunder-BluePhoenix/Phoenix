# Phoenix Core WebSocket API

Endpoint: `ws://127.0.0.1:4870/api/ws`

## Connecting

Browsers cannot set headers on WebSocket requests, so the session token travels in the subprotocol list:

```js
const ws = new WebSocket("ws://127.0.0.1:4870/api/ws", ["phoenix.v1", `phoenix.token.${token}`]);
```

The server selects `phoenix.v1`. A missing or wrong token is rejected with HTTP 401 during the upgrade. The same Host and Origin checks as the HTTP API apply.

On connect the server sends:

```json
{
  "type": "hello",
  "protocol": "1.1",
  "channels": [
    "state.changed",
    "event.created",
    "task.updated",
    "capability.health",
    "notification.created"
  ]
}
```

## Subscribing

```json
{ "type": "subscribe", "channels": ["state.changed", "event.created"], "since_seq": 42 }
```

- `state.changed` and `task.updated` immediately receive the current value.
- `since_seq` (optional) replays durable events with a higher history sequence on `event.created` (up to 1000) — use the last `seq` you saw to resume after a reconnect.

Reply: `{ "type": "subscribed", "channels": [...] }`. Errors: `{ "type": "error", "code": "INVALID_REQUEST", "message": "..." }`.

## Channels

| Channel                | `data`                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `state.changed`        | Fawkes state snapshot (same shape as `GET /api/pet/state`)                               |
| `event.created`        | `{ "seq": number, "event": PhoenixEvent, "description": string }` for each durable event |
| `task.updated`         | `{ "tasks": ActiveTask[] }` whenever the active-task list or progress changes            |
| `capability.health`    | `capability.*` events                                                                    |
| `notification.created` | `notification.created` events; the notification is in `payload.notification`             |

Messages: `{ "type": "message", "channel": "...", "data": ... }`.

## Liveness and back-pressure

The server pings every 30 s and drops clients that do not answer. Clients whose send buffer exceeds 1 MB are closed with code 1013 and should reconnect with `since_seq`.
