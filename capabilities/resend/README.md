# capabilities/resend

Shows Fawkes the delivery status of emails your Resend account has sent ([Phase 67](../../docs/phases/phase-67-service-integrations.md)). **Strictly read-only.** It reads `GET /emails` through service-kit's `ReadOnlyClient`, which has no method that sends a body. There is no send command, no POST code path, and a test asserts the source never imports `ServiceClient` and the manifest declares only read commands.

| Event                    | When                                 | Fawkes                |
| ------------------------ | ------------------------------------ | --------------------- |
| `resend.email.delivered` | an email's last event is `delivered` | SUCCESS for 4 s       |
| `resend.email.bounced`   | `bounced`                            | WARNING for 1 min     |
| `resend.email.failed`    | `failed`                             | ERROR until dismissed |

Events carry `email_id`, `subject` (clipped), `status`, `to_count`, `to_domains` (recipient **domains** only, never addresses), `created_at` and `url` (built as `https://resend.com/emails/<id>` from the validated id). Correlation id: `resend-email-<id>`. Opens, clicks and in-flight states (`sent`, `queued`) are not announced.

## Setup

- Secret `api_key`: a Resend API key. Resend only lets a full-access key list emails, and that key could also send mail; Phoenix never does, but use a key you can revoke.
- Config: `poll_ms` (10 000 or more, default 60 000). There is deliberately **no `base_url` setting**: anyone holding the API token could otherwise point the stored key at a host of their choosing, so the key only ever goes to `https://api.resend.com`. Tests inject a local mock through the code-only `apiUrl` creation option.
- Enabling grants `network` and `external_api`. It is installed, never auto-enabled.
- `status` command (read): the newest 25 emails with their state.

## Behaviour

- **History rule.** An email first seen that was created before you enabled the capability is recorded silently; later changes of any email (e.g. `sent` → `bounced`) are announced once.
- **Pauses when unwatched.** Polling waits while no window or client is connected to Core.
- **Failures.** 401 → degraded, wait 5 min; 429 → degraded, wait for `Retry-After` (an hour at most); other errors back off exponentially to 5 min. Redirects are refused, responses over 2 MiB are refused. Without a key the capability is degraded and calls nothing.
- **Untrusted text.** Subjects are clipped to 200 characters, control characters removed, credential-shaped text redacted; ids that could change a URL are dropped. Nothing from Resend is ever treated as an instruction. The key is sent only to Resend's own API origin in the `Authorization` header and appears in no log, event or error.

## Web glance

The Overview shows a read-only glance (`ResendGlance`, apps/web) built from the `status` command only: counts of the recent emails by delivery state and the newest send time. Subjects, recipient domains and links are never shown.

## Not verified

The mock (`testing/mock-resend.ts`) was written from Resend's public API reference. **Nothing was tested against the real Resend API.** Unconfirmed: the exact `created_at` format variants, whether `last_event` can hold values other than the ones documented, and rate-limit headers.
