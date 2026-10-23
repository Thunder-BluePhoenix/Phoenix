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
- Config: `team_id` (optional), `project` (optional filter), `poll_ms` (5000+, default 30000). There is deliberately **no `base_url` setting**: the token is sent only to `https://api.vercel.com`, because anyone holding the API token could otherwise point the stored credential at a host of their choosing. Tests inject a local mock through the code-only `apiUrl` creation option.
- Enabling grants `network` and `external_api`. Installed, never auto-enabled.

## Commands

- `status` (side effect `read`): the latest deployments as `{configured, items[]}`.
- `redeploy` (side effect `external`, **always asks**): `{deployment_id, idempotency_key}` (`additionalProperties:false`). It reads the deployment (GET), checks that Vercel answered with the deployment that was asked for (otherwise it aborts with nothing posted), and then makes one `POST /v13/deployments?forceNew=1` naming the project, source deployment id and target. The same `idempotency_key` for the same deployment never starts a second deployment while Phoenix runs (it answers `already_requested`); a key reused for a different deployment is refused. Keys are remembered in memory only, until Phoenix restarts or the capability is disabled. If the POST's outcome is unknown (5xx, dropped connection) the answer says so and the key is not re-sent blindly; use a new key after checking.

## Web glance

The Overview shows the latest deployments with their state (address shown as a host, and linked only when it is plain https), and counts of failed and in-progress deployments. It calls only the read command `status` through Core's capability command route and never `redeploy`/`run_again`/`pause_workflow`; it refreshes on this capability's events and every 60 s, only while the page is visible. Components: `apps/web/src/components/ServiceGlancesA.tsx`; test `apps/web/test/service-glances-a.test.tsx` (fake Core only; no real account, key or browser was used). See [Phase 67](../../docs/phases/phase-67-service-integrations.md).

## How it behaves

- **No history replay.** A deployment first seen older than the moment the capability was enabled is recorded silently. One that was still building then reports how it ended.
- **Pausing.** No request is made while no client is connected; polling resumes the moment one connects.
- **Errors.** 401 pauses polling for 5 minutes and sets health _degraded_; 429/`Retry-After` is honoured (an hour at most); other failures back off to 5 minutes. Error messages never contain the token, the URL or text the remote sent. Redirects are never followed, responses over 2 MiB are cut off, strings are clipped, only https links survive, malformed entries are skipped. Branch and actor text is redacted if it looks like a credential. If Core refuses an event it is logged (code only) and counted as `events_refused` in `status` and the health message. Health is _degraded_ when no token is set.

## Unverified

Written from Vercel's public API documentation (field names, paths, auth). **Nothing has been run against the real Vercel API**; the mock in `testing/mock-vercel.ts` encodes my reading of the docs, so a difference between the docs and the service would not show up in the tests. The redeploy request body in particular (`name`, `deploymentId`, `target`, `forceNew`) should be checked against a real project before relying on it.
