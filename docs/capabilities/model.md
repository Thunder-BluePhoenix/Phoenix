# Capability Model

A **capability** is how Phoenix reaches an external system (Kage, Git, CI…). Everything a capability can do is declared up front in its manifest and checked at runtime.

## Manifest

Schema: [`protocol/schemas/capability-manifest-v1.schema.json`](../../protocol/schemas/capability-manifest-v1.schema.json).

```json
{
  "id": "git",
  "name": "Git",
  "version": "0.1.0",
  "description": "Local repository activity",
  "license": "GPL-3.0-or-later",
  "events": ["git.*"],
  "permissions": ["repository_access"],
  "data_categories": ["source code metadata"],
  "commands": [
    {
      "name": "status",
      "description": "Repository status",
      "side_effect": "read",
      "permissions": ["repository_access"]
    }
  ],
  "healthcheck": { "interval_ms": 30000, "timeout_ms": 5000 },
  "config_schema": { "type": "object", "properties": { "path": { "type": "string" } } },
  "state_rules": [
    { "match": "git.rebase.started", "effect": { "state": "WORKING", "explain": "Rebasing" } }
  ]
}
```

Rules enforced on registration: valid schema; `id` not reserved (`core`, `pet`, `system`, `security`, …); commands only use declared permissions; state rules only match declared events; embedded JSON Schemas compile.

## Two kinds

|                   | Builtin                                                 | External                                                       |
| ----------------- | ------------------------------------------------------- | -------------------------------------------------------------- |
| Runs              | Inside Phoenix Core                                     | Its own process, any language                                  |
| Intended for      | First-party, trusted code                               | Everything else (Kage, third parties)                          |
| Isolation         | Every call guarded: errors contained, timeouts enforced | Process boundary — a crash never touches core                  |
| Talks to core via | `CapabilityContext.emit()`                              | `POST /api/capabilities/{id}/events` with its capability token |

## Lifecycle

```
register → enable (grant declared permissions → init) → health checks → run → disable → uninstall
```

- **Enable** is a user action. It grants exactly the permissions the manifest declares (shown with plain-language descriptions first).
- **Restart:** capabilities the user enabled are resumed automatically — unless a new version asks for more permissions, in which case it waits for the user again.
- **Health:** checked on an interval; transitions emit `capability.unavailable` (Fawkes WARNING) / `capability.available`.
- **Kill switch:** engaging the emergency stop disables every capability. They stay disabled until the user re-enables them.
- **Uninstall** revokes permissions and, unless `retain_data` is set, deletes the capability's event history.

## Events

A capability may only emit event types listed in `events`, always with `source` = its `id`. Anything else is rejected with `SECURITY_POLICY_BLOCKED`.

## Commands

`POST /api/capabilities/{id}/commands/{name}` returns an operation immediately. Each command passes the permission gateway: read-only commands run straight away; `write`, `execute`, `external` and `production` side effects (and microphone/camera/recording permissions) wait for explicit user confirmation. Results are available from `GET /api/operations/{id}`; completion is also announced with `capability.command.completed` / `.failed` events (`correlation_id` = operation id).

## External capability HTTP contract

Phoenix calls the capability's loopback endpoint with header `X-Phoenix-Capability-Token`:

| Request                                                                    | Response                                                           |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `GET /health`                                                              | `{ "status": "healthy" \| "degraded" \| "unhealthy", "message"? }` |
| `POST /phoenix/lifecycle` `{ "action": "enable" \| "disable", "config"? }` | any 2xx                                                            |
| `POST /commands/{name}` `{ "input", "operation_id" }`                      | `{ "result" }`                                                     |

The capability registers with `POST /api/capabilities/register` (session token from `<dataDir>/session.token`) and receives its capability token. After a core restart it must register again.
