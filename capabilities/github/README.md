# capabilities/github

Brings GitHub pull requests, review requests, Actions runs and deployments into Fawkes ([Phase 22](../../docs/phases/phase-22-github-and-cicd-capability.md)). Read-only: it only sends `GET` requests. Issues are not covered here; the issue-tracker capability ([Phase 26](../../docs/phases/phase-26-issue-tracker-capabilities.md)) owns them.

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
- `repositories`: up to 20 `owner/name`. `poll_ms`: 5000 or more, default 30000. `api_url`: GitHub Enterprise (`https://HOST/api/v3`).
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
