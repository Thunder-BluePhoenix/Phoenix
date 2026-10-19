# capabilities/vercel

Vercel deployments in Fawkes and the knowledge graph ([Phase 67](../../docs/phases/phase-67-service-integrations.md)). Watching is read-only: the poller only sends `GET /v6/deployments`, and only while something is watching Phoenix (`startPolling` / `ctx.untilWatched`). The one command that changes anything is `redeploy`, and it always asks first.

| Event                     | When                                              | Fawkes                                                  |
| ------------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| `vercel.deploy.started`   | deployment `QUEUED` / `INITIALIZING` / `BUILDING` | DEPLOYING (timeout WARNING after 1 h)                   |
| `vercel.deploy.succeeded` | `READY`                                           | SUCCESS for 8 s                                         |
| `vercel.deploy.failed`    | `ERROR`                                           | ERROR "Deploy failed: project (target)" until dismissed |
| `vercel.deploy.cancelled` | `CANCELED`                                        | clears DEPLOYING                                        |

Payload: `deployment_id`, `project`, `environment`/`target`, `state`, and, when Vercel gives them and they pass validation, `url` (https only), `branch`, `sha` (40 hex), `repository` (`owner/name`, from the GitHub link of the deployment) and `actor`. Correlation id `vercel-deploy-<id>`, so a failure replaces its own "deploying" state. The knowledge graph (`GRAPH_EVENT_PATTERNS` has `vercel.deploy.*`) turns each event into a `Deployment` node, `PART_OF` the repository and `DEPLOYED_TO` from the commit when a repository and a full sha are present, and `DEPLOYED_TO` the project's `Service`.

## Setup

```sh
TOKEN=$(cat .phoenix/dev/session.token)
H=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')
read -rs VERCEL_TOKEN && printf '{"value":"%s"}' "$VERCEL_TOKEN" | \
  curl "${H[@]}" -d @- http://127.0.0.1:4870/api/capabilities/vercel/secrets/token
curl "${H[@]}" -d '{"config":{"team_id":"team_xxx","poll_ms":30000}}' \
  http://127.0.0.1:4870/api/capabilities/vercel/config
curl "${H[@]}" -X POST -d '{}' http://127.0.0.1:4870/api/capabilities/vercel/enable
```

- **Secret `token`**: a Vercel access token scoped to the team you watch. Never put it in config, a log or a command input; Phoenix refuses secrets there.
- Config: `team_id` (optional), `project` (optional filter), `poll_ms` (5000+, default 30000), `base_url` (default `https://api.vercel.com`; https, or http to localhost; no credentials, query or fragment).
- Enabling grants `network` and `external_api`. Installed, never auto-enabled.

## Commands

- `status` (side effect `read`): the latest deployments as `{configured, items[]}`.
- `redeploy` (side effect `external`, **always asks**): `{deployment_id, idempotency_key}` (`additionalProperties:false`). It reads the deployment (GET) and then makes one `POST /v13/deployments?forceNew=1` naming the project, source deployment id and target. The same `idempotency_key` never starts a second deployment in this process (it answers `already_requested`). If the POST's outcome is unknown (5xx, dropped connection) the answer says so and the key is not re-sent blindly; use a new key after checking.

## How it behaves

- **No history replay.** A deployment first seen older than the moment the capability was enabled is recorded silently. One that was still building then reports how it ended.
- **Pausing.** No request is made while no client is connected; polling resumes the moment one connects.
- **Errors.** 401 pauses polling for 5 minutes and sets health _degraded_; 429/`Retry-After` is honoured (an hour at most); other failures back off to 5 minutes. Error messages never contain the token, the URL or text the remote sent. Redirects are never followed, responses over 2 MiB are cut off, strings are clipped, only https links survive, malformed entries are skipped. Health is _degraded_ when no token is set.

## Unverified

Written from Vercel's public API documentation (field names, paths, auth). **Nothing has been run against the real Vercel API**; the mock in `testing/mock-vercel.ts` encodes my reading of the docs, so a difference between the docs and the service would not show up in the tests. The redeploy request body in particular (`name`, `deploymentId`, `target`, `forceNew`) should be checked against a real project before relying on it.
