# capabilities/web-search

Lets Fawkes (and you) search the web ([Phase 66](../../docs/phases/phase-66-ok-fawkes-voice-assistant.md) gap). **The query text you search for is sent to a search provider. Nothing else about you is.** **Once you enable this capability, with no setup at all a query goes to DuckDuckGo** (`https://api.duckduckgo.com`): it needs no key. The capability is installed but never auto-enabled, and the secret guard still refuses a query that looks like a secret before any request. **No real SearXNG instance, Brave Search or DuckDuckGo was contacted by any test**: everything was tested against local loopback mocks written from the providers' public documentation (and, for DuckDuckGo, from one manual single-request probe, which was not a test).

## Providers (the chain)

A search asks the providers in this order, **one attempt each, at most three requests, one rate slot per search**:

1. **SearXNG**, only if you set `searxng_url` (keyless). `GET <searxng_url>/search?q=…&format=json&safesearch=1`, reading `results[].title|url|content`. An instance whose owner has not enabled `json` under `search.formats` answers **403**; many public instances do. The capability then reports a fixed message saying so, without repeating what the server sent.
2. **Brave Search**, only if you stored an API key (`api_key`, write-only; Capability settings → Secrets). `https://api.search.brave.com`, `GET /res/v1/web/search`, header `x-subscription-token`. Brave has no keyless endpoint.
3. **DuckDuckGo Instant Answer API**, always (keyless, host fixed in code). `GET https://api.duckduckgo.com/?q=…&format=json&no_html=1&skip_disambig=1&no_redirect=1`. **It is not a ranked web search**: it returns topic and entity summaries (an abstract plus related topics), and nothing at all for most queries. An empty answer is a normal empty result with a fixed note (`note`), not an error.

The next provider is asked **only when the one before it failed**: network error, timeout, any non-2xx status (403 json-disabled included), a redirect, or an oversized, non-JSON or wrongly shaped body. It is **never** asked after an empty successful answer, after the capability's own refusal of a query, or after the per-minute cap. The result's `provider` says who answered and `fallback_from` lists the ids (never error text) of the providers that failed first.

If every provider fails, the error is one fixed sentence naming the providers and a fixed reason each (`The search failed: SearXNG answered with an error status; Brave Search …`). It repeats nothing a server sent, no address, no key.

### Where queries go, and the approved search

- The query goes to **every provider that is actually attempted**, so with a chain it can reach more than one host. The `search` description and the manifest's `data_categories` name all three.
- **`search_confirmed` (the only search voice can start) asks exactly ONE provider (the first in the chain) and never falls back.** Core's approval card shows the command description and the `query` value only; the manifest is fixed and cannot show the owner-set SearXNG host there. Falling back would send an approved query to a host the card did not name, so a failure of the one provider is the whole answer. The description names the three possible providers and says one is used.
- **Keys:** the Brave key is sent only to Brave's host, in that header, never in an address, log, event, audit record or error. SearXNG and DuckDuckGo are sent no credential, and tests assert this on every mock's recorded headers.
- **Hosts:** Brave's and DuckDuckGo's hosts are constants in code (no setting, no response field can change them; tests inject loopback mocks through the code-only `hosts` option). Result links are returned as text and never fetched.

### `searxng_url` (the one setting)

An owner-set address, https, or plain http **only** to this computer (`127.0.0.1`, `localhost`, `[::1]`); an optional port; a path that is empty or plain prefix segments such as `/searx`. Refused: user name or password, query, fragment, `.` or `..` segments, empty segments, backslashes, percent escapes, spaces, newlines, non-ASCII hosts (write an internationalised name in its ASCII `xn--` form, so a look-alike cannot pass for another host), any other scheme (`javascript:`, `file:`, `ftp:`, `data:`), more than 2048 characters. It is checked when saved (the config schema's `pattern`) **and again on every search**; a stored value that fails the second check refuses the search outright (it does not skip SearXNG and send the query elsewhere). Changes apply when the capability is enabled.

**Risk, stated plainly:** whoever can change this capability's config can point search queries at another host. Only queries go there (no credential is attached), and nothing from its answer is fetched or interpreted beyond JSON parsing. An owner-set host may also be on the local network, so this is SSRF-shaped reach: a GET with a query string to an address you chose.

- Enabling grants `network` and `external_api`. It is installed, never auto-enabled.
- The provider seam is `src/provider.ts` (`SearchProvider`): host, optional key, GET path and a parser.

## Commands

| Command            | Side effect | What it does                                                                                                                                                                                                                                         |
| ------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search`           | `read`      | `query` (1 to 200 characters) and optional `limit` (1 to 10, default 5). Returns `{ untrusted, notice, provider, query, results: [{ title, url, snippet, untrusted }], fallback_from?, note? }`. Tries the chain above.                              |
| `search_confirmed` | `external`  | The same search, but Core asks a person **before every call**, the prompt shows the whole query, and **one provider only is asked, with no fallback**. `query` only, at most 80 characters, no hidden characters or extra spaces. Same result shape. |

`search_confirmed` is the only command « OK Fawkes » can start (see [voice-assistant.md](../../docs/voice-assistant.md)); `search` is for the owner, the API and agents that are allowed a read. The command `timeout_ms` of `search` covers the worst case (three attempts of 15 s plus slack).

## What is checked

- **Before any request** the query has control and invisible characters turned into spaces, is capped, and is refused if the agent secret detector (`scanText` from `@phoenix/capability-agents`: GitHub, Slack, Stripe, GitLab, npm, AWS, Bearer, JWT, PEM, `API_KEY=…` assignments) or a `scheme://user:password@` address matches. A refused query never makes a request to any provider (the keyless ones included), never uses a rate slot and is never echoed in the error. The capability manager also refuses secret-shaped input before the capability runs. A query that is too long is refused, never cut (a cut could keep half a secret).
- **The network:** GET only (the code never imports the writing client), redirects refused, 15 s timeout per attempt, 1 MiB body cap, a per-minute cap of 6 searches shared by both commands (a search that falls back still costs one slot), fixed secret-free error messages (nothing a server said is repeated).
- **Results are untrusted text.** Every title and snippet has markup removed, entities decoded, remaining angle brackets and control characters removed, secret lookalikes redacted and is clipped (150 and 300 characters). A link must be `https`, with credentials and fragments removed; links to an IP address, a name without a dot or a local-network suffix are dropped. Duplicates are dropped. The answer carries `untrusted: true` and a fixed notice, and each result is marked too. Text that tells an agent what to do is just text: nothing in a result is interpreted, followed or fetched. The `note` and `fallback_from` fields are written by this code (a fixed sentence and provider ids), never copied from a server.
- **DuckDuckGo mapping:** the abstract (`Heading`, `AbstractText`, `AbstractURL`) becomes the first result; each flat `RelatedTopics` entry and each entry of a grouped `{ Name, Topics }` becomes one (`Text`, `FirstURL`). The HTML `Result` field, icons and images are never read. Everything goes through the same cleaning, so entries without a clean https, non-IP link are dropped.

## Not verified

The mocks (`testing/mock-search.ts`) were written from public documentation. **Nothing was tested against a real SearXNG instance, Brave Search or DuckDuckGo.**

- SearXNG: the `results[]` shape and the 403 behaviour come from SearXNG's search API documentation and were not confirmed against a live instance; instances differ in version, enabled formats, rate limiting and engines.
- Brave: the live response for queries with no results, how `count` behaves per plan, whether `description` can contain markup when `text_decorations=false`, rate-limit and quota responses, the terms of use, and whether a free plan permits this use. Brave's terms and rate limits were not reviewed.
- DuckDuckGo: the response shape was read from **one manual request** (HTTP 200, `content-type: application/x-javascript`, keys `Abstract…`, `RelatedTopics` entries `{ FirstURL, Icon, Result, Text }`), not a test. Grouped `Topics` and the `Results` field are documented but were not seen. The API is for instant answers, not a search engine; it may change, throttle or be removed; its terms of use were not reviewed.
