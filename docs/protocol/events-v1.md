# Phoenix Event Protocol v1

> Status: **Frozen** for major version 1. Source of truth: [`protocol/schemas/event-v1.schema.json`](../../protocol/schemas/event-v1.schema.json).

Every component and capability communicates through events that use this envelope.

## Envelope

| Field                 | Required | Rule                                                                                                         |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `event_id`            | Yes      | Unique, `evt_` prefix. Used for deduplication.                                                               |
| `event_type`          | Yes      | Namespaced, lower-case, dot-separated (`kage.meeting.started`).                                              |
| `version`             | Yes      | Envelope version `1.x`.                                                                                      |
| `source`              | Yes      | Capability or core component id (`kage`, `git`, `core`). Must match the authenticated capability (ADR-0016). |
| `timestamp`           | Yes      | ISO-8601.                                                                                                    |
| `severity`            | Yes      | `info` · `success` · `warning` · `error`                                                                     |
| `payload`             | Yes      | Object. **Never contains secrets.**                                                                          |
| `correlation_id`      | No       | Groups events of one task/workflow (e.g. `meeting_id`).                                                      |
| `causation_id`        | No       | `event_id` of the triggering event.                                                                          |
| `subject`             | No       | What the event is about (repository, site…).                                                                 |
| `scope`               | No       | Authorisation scope (`project:phoenix`).                                                                     |
| `requires_action`     | No       | `true` when the user must act → Fawkes shows WAITING.                                                        |
| `ttl_ms`              | No       | Event expires `ttl_ms` after `timestamp`; expired events are dropped.                                        |
| `data_classification` | No       | `public` · `internal` (default) · `sensitive` · `secret`                                                     |
| `metadata`            | No       | Free-form object (no secrets).                                                                               |
| `provenance`          | No       | Source system ids / links (no secrets).                                                                      |

Unknown extra fields are allowed and must be ignored by consumers that do not understand them.

## Example

```json
{
  "event_id": "evt_01",
  "event_type": "kage.summary.ready",
  "version": "1.0",
  "source": "kage",
  "timestamp": "2026-10-03T12:00:00Z",
  "severity": "success",
  "correlation_id": "meeting_123",
  "requires_action": false,
  "payload": { "meeting_id": "meeting_123", "summary_id": "summary_456" }
}
```

## Namespaces

| Namespace    | Examples                                                                     |
| ------------ | ---------------------------------------------------------------------------- |
| `pet`        | `pet.state.changed`, `pet.clicked`                                           |
| `system`     | `system.online`, `system.warning`                                            |
| `capability` | `capability.enabled`, `capability.health`                                    |
| `agent`      | `agent.started`, `agent.waiting`, `agent.completed`, `agent.failed`          |
| `build`      | `build.started`, `build.passed`, `build.failed`                              |
| `deploy`     | `deploy.started`, `deploy.succeeded`, `deploy.failed`                        |
| `git`        | `git.commit.created`, `git.merge_conflict`                                   |
| `kage`       | `kage.connected`, `kage.meeting.*`, `kage.transcription.*`, `kage.summary.*` |
| `frappe`     | `frappe.site.unhealthy`, `frappe.migration.completed`                        |
| `security`   | `security.permission.denied`, `security.policy.violation`                    |

## Rules

1. Delivery is **at-least-once**. Consumers must be idempotent and deduplicate on `event_id`.
2. Payloads, metadata and provenance must not contain secrets. The validator rejects secret-like keys (`password`, `token`, `api_key`, …) and values (bearer tokens, GitHub/Slack/AWS keys, private keys) with `SECURITY_POLICY_BLOCKED`.
3. Schema-invalid events are rejected with `INVALID_EVENT`.
4. Adding an optional field is a minor version bump (`1.1`). Removing or changing a field requires major version 2 and a compatibility test.

## Error codes

| Code                           | Meaning                                           |
| ------------------------------ | ------------------------------------------------- |
| `CAPABILITY_DISABLED`          | Capability disabled                               |
| `CAPABILITY_UNAVAILABLE`       | Capability unreachable                            |
| `PERMISSION_DENIED`            | Permission missing                                |
| `INVALID_EVENT`                | Schema invalid                                    |
| `EVENT_DUPLICATE`              | Already processed                                 |
| `OPERATION_TIMEOUT`            | Operation timed out                               |
| `RESOURCE_NOT_FOUND`           | Resource unavailable                              |
| `ACTION_REQUIRES_CONFIRMATION` | Approval required                                 |
| `SECURITY_POLICY_BLOCKED`      | Security policy blocked action                    |
| `INVALID_REQUEST`              | Request malformed (API, since 1.1)                |
| `UNAUTHENTICATED`              | Missing or invalid session token (API, since 1.1) |
| `INTERNAL_ERROR`               | Unexpected internal error (API, since 1.1)        |

## Changelog

- **1.1** — added error codes `INVALID_REQUEST`, `UNAUTHENTICATED`, `INTERNAL_ERROR`; permission categories and side-effect classes (`protocol/src/permissions.ts`). Fully backwards compatible with 1.0.
- **1.0** — initial envelope.

## Fawkes states

See [ADR-0019](../adr/ADR-0019-canonical-fawkes-states-and-priority.md) and `protocol/src/fawkes-state.ts`.
