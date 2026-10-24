# capabilities/web-search

Lets Fawkes (and you) search the web ([Phase 66](../../docs/phases/phase-66-ok-fawkes-voice-assistant.md) gap). **The query text you search for is sent to the search host.** Nothing else about you is. No real search service was contacted when this was built: everything was tested against a local mock written from the provider's public documentation.

## Provider

The one provider is **Brave Search** (`https://api.search.brave.com`, `GET /res/v1/web/search`, header `x-subscription-token`). It has **no keyless endpoint**, so you supply your own API key as the write-only secret `api_key` (Capability settings → Secrets). Without a key the capability is degraded and sends nothing. I know of no search service with a documented, stable, keyless JSON endpoint, so none is used.

- The host is a constant in code. There is **no** `base_url`/host setting (the config schema has no properties), a response cannot change it, and result links are returned as text and never fetched. Tests inject a loopback mock through the code-only `apiUrl` option.
- Enabling grants `network` and `external_api`. It is installed, never auto-enabled.
- The key is sent only to that host, in that header, never in the address, a log, an event, an audit record or an error.
- The provider seam is `src/provider.ts` (`SearchProvider`): host, secret name, key header, GET path and a parser. Another provider would be one more object there plus a decision about which is built in.

## Commands

| Command            | Side effect | What it does                                                                                                                                                                   |
| ------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `search`           | `read`      | `query` (1 to 200 characters) and optional `limit` (1 to 10, default 5). Returns `{ untrusted, notice, provider, query, results: [{ title, url, snippet, untrusted }] }`.      |
| `search_confirmed` | `external`  | The same search, but Core asks a person **before every call** and the prompt shows the whole query. `query` only, at most 80 characters, no hidden characters or extra spaces. |

`search_confirmed` is the only command « OK Fawkes » can start (see [voice-assistant.md](../../docs/voice-assistant.md)); `search` is for the owner, the API and agents that are allowed a read.

## What is checked

- **Before any request** the query has control and invisible characters turned into spaces, is capped, and is refused if the agent secret detector (`scanText` from `@phoenix/capability-agents`: GitHub, Slack, Stripe, GitLab, npm, AWS, Bearer, JWT, PEM, `API_KEY=…` assignments) or a `scheme://user:password@` address matches. A refused query never makes a request, never uses a rate slot and is never echoed in the error. The capability manager also refuses secret-shaped input before the capability runs. A query that is too long is refused, never cut (a cut could keep half a secret).
- **The network:** GET only (the code never imports the writing client), redirects refused, 15 s timeout, 1 MiB body cap, a per-minute cap of 6 searches shared by both commands, fixed secret-free error messages (nothing the service said is repeated).
- **Results are untrusted text.** Every title and snippet has markup removed, entities decoded, remaining angle brackets and control characters removed, secret lookalikes redacted and is clipped (150 and 300 characters). A link must be `https`, with credentials and fragments removed; links to an IP address, a name without a dot or a local-network suffix are dropped. Duplicates are dropped. The answer carries `untrusted: true` and a fixed notice, and each result is marked too. Text that tells an agent what to do is just text: nothing in a result is interpreted, followed or fetched.

## Not verified

The mock (`testing/mock-search.ts`) was written from Brave's public API reference. **Nothing was tested against the real Brave Search API.** Unconfirmed: the live response for queries with no results, how `count` behaves per plan, whether `description` can contain markup when `text_decorations=false`, rate-limit and quota responses, the terms of use, and whether a free plan permits this use. Brave's terms and rate limits were not reviewed.
