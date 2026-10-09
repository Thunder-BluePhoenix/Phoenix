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
