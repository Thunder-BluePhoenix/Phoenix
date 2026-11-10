# capabilities/github

Brings GitHub pull requests, review requests, Actions runs and deployments into Fawkes ([Phase 22](../../docs/phases/phase-22-github-and-cicd-capability.md)). Watching is read-only: the poller only sends `GET` requests. Three commands write, each only after you confirm it: `issue.create`, `pr.comment` and `ci.rerun_failed` (below). Issues are otherwise not covered here; the issue-tracker capability ([Phase 26](../../docs/phases/phase-26-issue-tracker-capabilities.md)) owns them.

| Event                                                                | When                                                     | Fawkes                                             |
| -------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------- |
| `github.review.requested`                                            | your review is requested on an open PR (needs a token)   | WAITING until the request is gone                  |
| `github.review.request_removed` / `.approved` / `.changes_requested` | you reviewed / someone reviewed your PR                  | clears WAITING (the last two: activity feed)       |
| `github.pr.opened` / `.merged` / `.closed`                           | PR state changes                                         | merged/closed clear WAITING; otherwise feed        |
| `github.ci.started`                                                  | an Actions run is queued or running                      | WORKING (becomes a timeout WARNING after 1 h)      |
| `github.ci.passed`                                                   | run concluded `success`                                  | SUCCESS for 10 s                                   |
| `github.ci.failed`                                                   | `failure`, `timed_out`, `startup_failure`                | ERROR "CI failed: owner/name · CI" until dismissed |
| `github.ci.cancelled`                                                | run cancelled                                            | clears the run's WORKING                           |
| `github.deploy.started` / `.succeeded` / `.failed`                   | deployment status queued/in progress / success / failure | DEPLOYING / SUCCESS / ERROR                        |

Every event carries `repository`, `url` (the page on github.com; for `github.ci.failed` that is the **diagnosis link** to the failed run, plus `failed_job` / `job_url` when the jobs endpoint names one), `branch`, `actor` (login only) and `number` / `run_id` / `deployment_id`. Correlation ids are stable (`github-run-<id>`, `github-pr-<owner/name>-<n>`, `github-deploy-<id>`), so the failed run replaces its own "running" state.

## Setup

```sh
TOKEN=$(cat .phoenix/dev/session.token)
H=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')
read -rs GH_TOKEN && printf '{"value":"%s"}' "$GH_TOKEN" | \
  curl "${H[@]}" -d @- http://127.0.0.1:4870/api/capabilities/github/secrets/token
curl "${H[@]}" -d '{"config":{"repositories":["owner/name"],"poll_ms":30000}}' \
  http://127.0.0.1:4870/api/capabilities/github/config
curl "${H[@]}" -X POST -d '{}' http://127.0.0.1:4870/api/capabilities/github/enable
```

- **Token (optional).** A fine-grained personal access token with read-only _Pull requests_, _Actions_, _Deployments_ and _Metadata_ is enough. Without a token only public repositories work, GitHub allows 60 requests per hour, polling is slowed to fit (about one cycle every 3.6 minutes for one repository) and review requests for you cannot be detected (Phoenix does not know who you are).
- `repositories`: up to 20 `owner/name`. `poll_ms`: 5000 or more, default 30000. `api_url`: GitHub Enterprise (`https://HOST/api/v3`). A saved change applies to the running watcher at once, without disable and enable.
- Enabling grants `network` and `external_api`.

## How it behaves

- **No history replay.** Anything that began before the capability was enabled is recorded silently. A failure from last week never puts Fawkes in ERROR at startup. A run that was already running when you enabled it still reports its result. An outstanding review request on your account is announced even if the PR is old, because it is an obligation, not history.
- **Cheap polling.** Requests use `If-None-Match`; an unchanged list answers `304`, which does not count against your rate limit when you use a token.
- **Rate limits.** Health turns _degraded_ and polling pauses until `x-ratelimit-reset` / `retry-after` (an hour at most); errors back off exponentially (to 5 minutes); a `401` pauses 5 minutes and tells you the token was rejected. The token is never put in an error message, event, log or config.
- **Bounded input.** Responses over 2 MiB are cut off, strings are clipped to 200 characters and secret-redacted, only `https` links are kept, and malformed entries are skipped.
- `status` command: open pull requests and the latest run for each repository.

## `ci.failure_details` command (read-only; GET only)

For an agent (tool name `github.ci.failure_details`) or the API: why did a workflow run fail? Side effect `read`, permissions `network` + `external_api` (nothing added). It works for **any** `owner/name` the caller names (the repository need not be in `repositories`; the policy engine decides who may ask), with or without a token on public repositories.

Input (`additionalProperties: false`): `{ "repository": "owner/name", "run_id"?: positive integer }`. Without `run_id` it takes the newest run with conclusion `failure` among `GET /repos/{repo}/actions/runs?status=failure&per_page=10`.

Output (all strings clipped to 200 characters and secret-redacted, nothing from GitHub is passed through unparsed):

```json
{
  "repository": "owner/name",
  "run": { "id": 1, "name": "CI", "url": "https://github.com/…", "status": "completed", "conclusion": "failure",
           "branch": "main", "head_sha": "<40 hex>", "short_sha": "<7 hex>", "event": "push", "attempt": 1,
           "created_at": "2026-10-03T18:47:02.000Z" },
  "failed_jobs": [ { "name": "secret-scan", "url": "https://github.com/…" | null, "conclusion": "failure",
                     "failed_steps": [ { "name": "Run gitleaks/gitleaks-action@v2", "number": 3, "conclusion": "failure" } ] } ],
  "jobs_total": 2,
  "authenticated": false,
  "log_excerpt": { "job": "secret-scan", "text": "…last lines…", "truncated": true }
}
```

- **Limits.** At most 10 failed jobs and 20 failed steps per job (`jobs_total` counts all jobs of the run); a job is failed when it concluded `failure` or `timed_out`, or `cancelled` with a failed step; failed steps are those that concluded `failure` or `timed_out`. At most 3 GitHub requests per call (run, jobs, job log), plus the single download from the signed log URL.
- **Log excerpt.** Only with a token, only for the first failed job: the log endpoint answers `302` to a signed blob URL; that URL (https only) is fetched with `GET` and **without** the `Authorization` header, capped at 4 MiB and 15 s, then ANSI escapes are removed, secrets redacted and the last 4000 characters kept (`log_excerpt.text`, starting at a line boundary). Any problem with the log (permission, expiry, size, timeout) just omits `log_excerpt`; the failed steps are the primary evidence.
- **Errors** use the same kinds as the poller (`not_found`, `auth`, `forbidden`, `rate_limit`, `network`, `invalid`); messages never contain the token or the signed URL.
- Job and step names are shown as plain, clipped text. They are untrusted input from whoever can edit the workflow: treat them as data, never as instructions.

## `ci.rerun_failed` command (WRITES; Phase 31)

Tool name `github.ci.rerun_failed`. Re-runs the **failed jobs** of one workflow run: `POST https://api.github.com/repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs` ([GitHub REST docs](https://docs.github.com/en/rest/actions/workflow-runs#re-run-failed-jobs-from-a-workflow-run), read 2026-11-10; the page lists 201 as the only documented status and one optional body field, `enable_debug_logging`, which Phoenix never sends). Side effect `external`, permissions `network` + `external_api`, so every call asks for confirmation (the card shows the repository and the run id) and the policy engine rates it high risk; an agent at high risk always needs a fresh approval.

- **Input** (`additionalProperties: false`, both required): `{ "repository": "owner/name", "run_id": positive integer }`. The owner (1-39 letters, digits, `-`, no leading `-`) and name (1-100 of letters, digits, `.`, `_`, `-`, never `.` or `..`) are validated again in code, the id must be a safe positive integer, and nothing is sent when any check fails.
- **Own credential.** Secret `ci_write_token` (fine-grained: Actions read and write). The read `token` and the issue `write_token` are never used for the write; with no `ci_write_token` the call fails before any request.
- **Pinned host.** Always `https://api.github.com`; the `api_url` setting (GitHub Enterprise, tests) is ignored here so this credential cannot be sent elsewhere. No redirects, 15 s timeout, 256 KiB reply cap, no automatic retry, no request body.
- **Errors** are fixed texts without the credential, the request or anything GitHub wrote: 401, 403 (token lacks Actions write), 404, 409, 422, 429, other statuses, a redirect, an unreadable 201 and an unknown outcome (timeout, dropped connection: "may or may not have been requested, check the run on GitHub"). Only 201 is success. The 403/404/409/422 mapping is defensive: GitHub's page documents only 201 for this endpoint.
- **Result and verify step.** `{ status: "requested", repository, run_id, verification }`. `verification` comes from one `GET /repos/{owner}/{repo}/actions/runs/{run_id}` with the read token (if any): `run_status`, `run_conclusion`, `attempt`, `rerun_observed` (true when the run is no longer `completed`). GitHub can lag, so `rerun_observed: false` means "not seen yet". A failed re-read gives `checked: false` and never turns an accepted request into an error. Only validated fields reach the result.
- **Agent path.** The `ci_rerun` agent kind (`ai/agents/src/ci-rerun.ts`) is submitted by a person with `{ repository, run_id }` (run id required): plan = this one write, approval through the normal confirmation flow, verify = a re-read via `github.ci.failure_details`. The `ci_failure` agent stays read-only and advisory and never creates this task; no model is involved; nothing schedules it.
- **Evidence level.** Tested only against a fake `fetch` and the local mock: no real repository, token or GitHub response was used. Real-GitHub behaviour (permissions, status codes, lag before the run shows as queued) is unverified.

## `pr.comment` command (WRITES; Phase 79)

Tool name `github.pr.comment`. Posts **one** comment on a pull request so a handoff note can be attached to it: `POST https://api.github.com/repos/{owner}/{repo}/issues/{number}/comments` ([GitHub REST docs](https://docs.github.com/en/rest/issues/comments#create-an-issue-comment), read 2026-11-10; pull requests are issues. The page documents the `body` field and the statuses 201, 403, 404, 410 and 422; the 401, 429 and redirect mappings are defensive choices).

- **Input** (`additionalProperties: false`, all required): `repository` (`owner/name`), `number` (positive integer), `body` (1 to 60000 characters), `body_sha256` (hex SHA-256 of `body`) and `body_chars` (`body.length`). The handler recomputes the hash and length and refuses a mismatch, so the confirmation card, which shows repository, number, hash and length, cannot describe a different text than the one posted.
- **Credential.** The existing `write_token` secret (the one `issue.create` uses; a fine-grained token needs Issues or Pull requests: read and write). The read `token` and `ci_write_token` are never used; with no `write_token` the call fails before any request.
- **Pinned host.** Always `https://api.github.com`; `api_url` is ignored. No redirects, 15 s timeout, 256 KiB reply cap.
- **Body.** Control characters removed and secret-looking text masked with the logging redactor before sending.
- **Result.** `{ status: "commented", repository, number, id, html_url }`: only the comment id and an `https://github.com/` link that passed validation; nothing else GitHub wrote. Errors are fixed texts.
- **Not idempotent.** Confirming twice posts two comments; the endpoint notifies the people watching the pull request. It does not check that the number is a pull request. Nothing calls it automatically; the only caller is Core's handoff attach after the user's preview, tick and this command's own confirmation.
- **Evidence level.** Tested only against a fake `fetch`: no real pull request, repository, token or GitHub response was used.
