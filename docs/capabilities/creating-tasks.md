# Creating GitHub issues, Linear and Jira issues, and Frappe tasks

Four capability commands write to the outside world. All are **opt-in twice** (a write credential you set yourself, and a confirmation you give for every call) and none has ever been run against a real GitHub repository, Linear workspace, Jira Cloud site or Frappe site; they were exercised only against local mock servers or a fake `fetch`.

## GitHub: `github.issue.create`

1. Create a fine-grained token with **Issues: read and write** on the repository you want, and store it as the `write_token` secret of the `github` capability (`POST /api/capabilities/github/secrets/write_token`). The read `token` used for watching is never used to write, and `write_token` is never used for watching. Without `write_token`, the command fails before sending anything.
2. Input: `{ repository, title, body?, labels?, idempotency_key }`. Always confirmed, side effect `external`.
3. The body ends with a hidden `<!-- phoenix-ref:KEY -->`. Repeating a call with the same key returns the existing issue (`status: "existing"`). GitHub search is eventually consistent, so a retry made long after, but before the search index catches up, can create a duplicate.

## Frappe: `frappe.task.create`

1. Create an API key and secret for a user that may create `Task` documents and store `api_key:api_secret` as the `write_token` secret of the `frappe` capability.
2. Tell Phoenix where to write: capability config `api` maps a site name to a base URL, for example `{"api": {"erp.localhost": "http://127.0.0.1:8000"}}` (https anywhere; http only for loopback). The write URL is never taken from your bench files or from the health-check `sites` overrides.
3. Input: `{ site, subject, description?, priority?, exp_end_date?, project?, idempotency_key }`. The description ends with a visible `Phoenix ref: KEY` line; a repeat with the same key finds the Task instead of creating another.

## Linear and Jira: `issues` capability (Phase 85)

Two more commands of the `issues` capability, `linear.issue.create` and `jira.issue.create`. Polling stays read-only; these two are the only writes. **Text only: no image, file or attachment is sent, and neither tracker has attachment support in Phoenix.**

1. Credentials are write-only secrets of the `issues` capability and separate from the polling ones (a polling key never enables writes; a missing write credential fails before any request): `linear_write_key` (Linear personal API key), or `jira_write_email` plus `jira_write_token` (Atlassian API token). They are never returned, logged, put in an error or audit row.
2. Linear: input `{ team_id, title, body? }` (`team_id` is the team's UUID). The request is one fixed GraphQL `issueCreate` mutation with the input as variables, always to `https://api.linear.app/graphql`; the polling `api_url` override does not apply.
3. Jira Cloud: set capability config `create.jira_site` to your site, `https://<name>.atlassian.net` (https and `*.atlassian.net` only; the configuration is rejected otherwise, and the client checks again). Input `{ project, title, body?, issue_type? }` (`issue_type` defaults to `Task`; `project` is the project key such as `PROJ`). The call is `POST <site>/rest/api/3/issue`; the description is sent as a plain Atlassian Document Format document of text and line breaks. The input cannot name a host.
4. Both are `external` commands: Core asks for confirmation on every call and the card shows the destination (team or project), title and the start of the description (control and format characters removed). Core's audit log records the confirmation request, the decision, the authorisation and the outcome; it holds the command name and a redacted summary, never a credential or the tracker's reply text.
5. Title (1 to 255 characters) and body (up to 10,000) are secret-redacted and stripped of control and format characters before sending. Redirects are refused, there is a 15 s timeout and a 256 KiB reply cap. The result is only `{ tracker, id, key, url }`: the Linear url must be an `https://linear.app/<workspace>/issue/<KEY>` link for that exact key, and the Jira url is built from the pinned site and the validated key, never taken from the reply. Errors are fixed text; after the request was sent, a timeout, a dropped connection, a redirect, an HTML or oversized reply or a 5xx says the issue may or may not exist.
6. **No idempotency key.** Neither tracker offers the cheap lookup GitHub's marker relies on, so repeating a call after an unknown outcome can create a second issue; look in the tracker first.

Evidence: `capabilities/issues/test/create.test.ts` runs both commands against a fake `fetch` only. No real Linear workspace, Jira site, account, key or token was contacted, and the request and reply shapes come from the vendors' documentation, not live responses.

## All of them

- A redirect from the server is refused. Responses are size-capped. Titles and bodies are secret-redacted before they leave the machine. Error messages never contain the credential or text from the remote side.
- If the connection drops after the request was sent, the outcome is unknown; the error says so. For GitHub and Frappe, retrying with the same key is safe; Linear and Jira have no key, so check the tracker first.
- These commands are used by the plan workflow of `ai/planning` (see Phase 36), which asks you to approve the exact plan first. By default the created task names only an opaque Phoenix plan id, never the meeting's title.
