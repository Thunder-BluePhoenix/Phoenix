# capabilities/n8n

Workflow executions of **your own** n8n in Fawkes ([Phase 67](../../docs/phases/phase-67-service-integrations.md)). n8n is self-hosted, so `base_url` has no default. Watching is read-only: the poller sends `GET /api/v1/executions?includeData=false` and `GET /api/v1/workflows`, only while something is watching Phoenix. Two commands change things and both always ask first.

| Event                     | When                                   | Fawkes                                        |
| ------------------------- | -------------------------------------- | --------------------------------------------- |
| `n8n.execution.failed`    | an execution ends `error` or `crashed` | ERROR "Workflow failed: name" until dismissed |
| `n8n.execution.succeeded` | an execution ends `success`            | SUCCESS for 5 s                               |

Payload: `execution_id`, `workflow_id`, optional `workflow` (name), `status`, `mode`, and `url` (the execution page in your n8n, only when `base_url` is https). Correlation id `n8n-execution-<id>`. Execution data (what the workflow processed) is never requested.

## Setup

```sh
TOKEN=$(cat .phoenix/dev/session.token)
H=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')
read -rs N8N_KEY && printf '{"value":"%s"}' "$N8N_KEY" | \
  curl "${H[@]}" -d @- http://127.0.0.1:4870/api/capabilities/n8n/secrets/api_key
curl "${H[@]}" -d '{"config":{"base_url":"https://n8n.example.com"}}' \
  http://127.0.0.1:4870/api/capabilities/n8n/config
curl "${H[@]}" -X POST -d '{}' http://127.0.0.1:4870/api/capabilities/n8n/enable
```

- **Secret `api_key`** (n8n Settings, n8n API): sent only in the `X-N8N-API-KEY` header to `base_url`; never logged, never in config or an error.
- Config: `base_url` (required; https, or http to localhost; no credentials, query or fragment), `poll_ms` (5000+, default 30000). Enabling grants `network` and `external_api`.

## Commands

- `status` (`read`): workflows and the latest executions.
- `run_again` (`external`, **always asks**): `{execution_id, idempotency_key}`; one `POST /api/v1/executions/{id}/retry`. Re-running a workflow may have effects of its own in whatever it connects to.
- `pause_workflow` (`external`, **always asks**): `{workflow_id, idempotency_key}`; one `POST /api/v1/workflows/{id}/deactivate`. Counted as paused only if n8n reports the workflow inactive.

Both reject ids that are not `[A-Za-z0-9_-]{1,100}` (they would reshape the request path) and any extra field. The same `idempotency_key` never acts twice in this process (`already_requested`); an unknown outcome (5xx, dropped connection) is reported as such and the key is not re-sent blindly. Configuration problems (no key, no `base_url`) fail before a key is spent.

## How it behaves

No history replay, pauses while nothing watches, 401 waits 5 minutes, 429/`Retry-After` honoured, redirects never followed, responses over 2 MiB cut off, text clipped, malformed entries skipped. If the workflow list fails, executions are still reported (named by id). Health is _degraded_ with no key or no `base_url`.

## Unverified

Written from the n8n public API documentation. **Nothing has been run against a real n8n.** The retry endpoint's response shape and which n8n versions expose `/executions/{id}/retry` and `/workflows/{id}/deactivate` are taken from the docs and unverified.
