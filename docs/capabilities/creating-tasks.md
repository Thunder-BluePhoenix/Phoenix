# Creating GitHub issues and Frappe tasks

Two capability commands write to the outside world. Both are **opt-in twice** (a write credential you set yourself, and a confirmation you give for every call) and neither has ever been run against a real GitHub repository or a real Frappe site; they were exercised only against local mock servers.

## GitHub: `github.issue.create`

1. Create a fine-grained token with **Issues: read and write** on the repository you want, and store it as the `write_token` secret of the `github` capability (`POST /api/capabilities/github/secrets/write_token`). The read `token` used for watching is never used to write, and `write_token` is never used for watching. Without `write_token`, the command fails before sending anything.
2. Input: `{ repository, title, body?, labels?, idempotency_key }`. Always confirmed, side effect `external`.
3. The body ends with a hidden `<!-- phoenix-ref:KEY -->`. Repeating a call with the same key returns the existing issue (`status: "existing"`). GitHub search is eventually consistent, so a retry made long after, but before the search index catches up, can create a duplicate.

## Frappe: `frappe.task.create`

1. Create an API key and secret for a user that may create `Task` documents and store `api_key:api_secret` as the `write_token` secret of the `frappe` capability.
2. Tell Phoenix where to write: capability config `api` maps a site name to a base URL, for example `{"api": {"erp.localhost": "http://127.0.0.1:8000"}}` (https anywhere; http only for loopback). The write URL is never taken from your bench files or from the health-check `sites` overrides.
3. Input: `{ site, subject, description?, priority?, exp_end_date?, project?, idempotency_key }`. The description ends with a visible `Phoenix ref: KEY` line; a repeat with the same key finds the Task instead of creating another.

## Both

- A redirect from the server is refused. Responses are size-capped. Titles and bodies are secret-redacted before they leave the machine. Error messages never contain the credential or text from the remote side.
- If the connection drops after the request was sent, the outcome is unknown; the error says so and that retrying with the same key is safe.
- These commands are used by the plan workflow of `ai/planning` (see Phase 36), which asks you to approve the exact plan first. By default the created task names only an opaque Phoenix plan id, never the meeting's title.
