# capabilities/notion

Tells Fawkes when a Notion page or database you name is edited ([Phase 67](../../docs/phases/phase-67-service-integrations.md)). Read-only, GET-only (`ReadOnlyClient`; no `ServiceClient`, no POST).

## The limitation (read this)

Notion's discovery endpoints, `POST /v1/search` and `POST /v1/databases/{id}/query`, are POST requests (reads, but POST). Phoenix keeps this capability GET-only, so it **cannot discover recently edited pages by itself**. It only watches what you list by id in `watch`, using `GET /v1/pages/{id}`, `GET /v1/databases/{id}` and `GET /v1/users/me` (token check). Each listed page/database must be shared with your integration in Notion, otherwise Notion answers 404 and the capability reports that item as degraded.

| Event                     | When                                                           | Fawkes        |
| ------------------------- | -------------------------------------------------------------- | ------------- |
| `notion.page.updated`     | a watched page's `last_edited_time` moved (or it was archived) | activity feed |
| `notion.database.updated` | the same for a watched database                                | activity feed |

Payload: `page_id`/`database_id`, `title` (clipped), `archived`, `edited_at`, `url` (https only, omitted otherwise). Correlation id `notion-<page|database>-<id>`.

## Setup

- Secret `integration_token`: a Notion internal integration token with **Read content** only. The `Notion-Version` header is fixed to `2022-06-28`.
- Config: `watch` (up to 20 `{ "type": "page"|"database", "id": "<uuid, with or without dashes>" }`), `poll_ms` (15 000 or more, default 60 000). There is deliberately **no `base_url` setting**: anyone holding the API token could otherwise point the stored token at a host of their choosing, so it only ever goes to `https://api.notion.com`. Tests inject a local mock through the code-only `apiUrl` creation option.
- `status` command (read): each watched item, its title and last edit time.

## Behaviour

- **History rule.** An object whose first-seen `last_edited_time` is before you enabled the capability is recorded silently; later edits are announced once each.
- **Pauses when unwatched.** No requests while no window or client is connected to Core.
- **Failures.** 404/403/malformed on one item degrade that item only; 401 pauses 5 min; 429 waits `Retry-After`; redirects and responses over 2 MiB are refused. Without a token or a `watch` list nothing is called.
- **Untrusted text.** Titles are clipped, control characters removed, credential-shaped text redacted; ids are validated as UUIDs before they reach a URL; non-https links are dropped. The token never appears in a log, event or error.

## Not verified

The mock (`testing/mock-notion.ts`) was written from Notion's public API reference. **Nothing was tested against the real Notion API.** Unconfirmed: that `last_edited_time` of a page changes for every kind of edit Notion considers one (it is minute-granular in Notion), and the exact shape of `in_trash`.
