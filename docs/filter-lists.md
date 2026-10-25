# Ad and tracker filter lists and shields (Phase 93)

## Status: settings, a downloader, a pure matcher and (macOS only, never run) a Rust translation to WebKit content rules.

Phoenix's browser host exists in Rust but **was never run on a display** (see [mini-browser.md](mini-browser.md)); on macOS it translates the enabled lists below to a WebKit content rule list (with a reported truncation at WebKit's 150,000-rule limit), and on Windows and Linux it blocks nothing. Everything below is the data and the logic a
future browser will use: it records the user's choices, can download two public filter lists on request, and has a pure
TypeScript matcher and counter that decide, for a given request, whether it would be blocked. No page is filtered today, the
blocked count is always 0 outside tests, and this is **not** comparable to Brave Shields: it can match network requests only.
Hiding page elements (cosmetic rules, scriptlets, HTML filters) is not implemented; those lines are counted and ignored. Brave
uses engine-level hooks (WebKit content rule lists, request interception in its own engine); the Phoenix equivalent is the
Rust port described in mini-browser.md, which does not exist.

The tests never contact easylist.to. Core tests download from a fake server on `127.0.0.1` that the test starts, with
synthetic list text. The one scratch measurement on the real lists, quoted below, was run by hand on 2026-10-24 and is not part
of the test suite.

## The lists

Fixed in code (`core/runtime/src/filter-lists/catalogue.ts`). The id, host and path are never read from settings, a request or
the environment.

| Id            | Address (pinned, https)                        | Licence (as offered by the list authors)                       |
| ------------- | ---------------------------------------------- | -------------------------------------------------------------- |
| `easylist`    | `https://easylist.to/easylist/easylist.txt`    | GPL-3.0-or-later **or** CC BY-SA 3.0 (or later), dual-licensed |
| `easyprivacy` | `https://easylist.to/easylist/easyprivacy.txt` | the same                                                       |

Licence wording was read on 2026-10-24 at https://easylist.to/pages/licence.html: the repository content "is dual licensed
under the GNU General Public License version 3 of the License, or (at your option) any later version, and Creative Commons
Attribution-ShareAlike 3.0 Unported, or (at your option) any later version", and "The EasyList authors
(https://easylist.to/)" should be attributed. Both lists carry `! Licence: https://easylist.to/pages/licence.html` in their own
header. The page also says some subscriptions other than EasyList, EasyPrivacy, EasyList Germany and EasyList Italy may be
under other conditions; Phoenix offers only the first two. The licence and the credit line are shown next to each list in
Settings. No list text is in this repository, and the file Phoenix stores for the user is the user's copy of the public list,
not a distributed part of Phoenix. [INFERENCE] Whether storing the list on the user's machine needs anything beyond the credit
line was not reviewed by a lawyer.

## What contacts the network

Only `POST /api/browser/filter-lists/:id/update`, which the Update button calls, and only for a list in the catalogue. Nothing
refreshes a list by itself: **no background or scheduled download exists**. `refreshAfterDays` (from the list's own `! Expires`,
bounded to 1..30 days, default 4) and `dueAt` are advice shown to the user; nothing acts on them.

One update is one `GET` to the pinned address with:

- `redirect: "manual"`: any 3xx answer is refused and the address it points to is never requested;
- no cookies, no credentials, no body, no Phoenix identifier;
- a 15 s limit for the response headers and a further 30 s for the body;
- a size cap of 8 MiB (checked against `Content-Length` first and then while reading); EasyList is about 2.2 MB;
- the `Content-Type` must be `text/plain`;
- the emergency stop (kill switch) refuses the update before any request is made.

The downloaded bytes must then be valid UTF-8, at most 500,000 lines, no line over 16 KiB, and the first non-blank line must be
an `[Adblock …]` header or a `! Title`/`! Version`/`! Last modified`/`! Expires`/`! Homepage` comment (so an HTML page is
refused even if served as text/plain). NUL and other control characters and a leading byte-order mark are removed; CRLF becomes LF.
From the text Core keeps only the list text itself and, as metadata, `! Title`, `! Version`, `! Last modified` and `! Expires`
(reduced to letters, digits and a few punctuation characters and cut to 80 characters).

If an update fails, or the new list is **under half the size** of the stored one (possible truncation or tampering), the stored
copy is kept untouched and the user is told so. A list at half the size or more replaces it: the guard is a ratio, not a lock.
A server that can deliver a valid list can still deliver a bad one over the size threshold; Phoenix does not verify the lists
against a signature (the publisher offers none that Phoenix checks) and relies on TLS to the pinned host.

## Storage

One file per list at `<Core data dir>/filter-lists/<id>.filterlist`: a JSON header line (id, sha256, byte size, fetched-at,
version, title, last-modified, refresh days, rule counts) then the list text. The directory is 0700 and the file 0600. It is
written to a temporary file in the same directory (mode 0600, exclusive create) and renamed over the old copy, so a reader sees
the old or the new file and a failed write leaves no temporary file. On every read Core checks the header's shape and that the
body matches the stored size and sha256; a copy that does not is reported as `damaged`, is never served and is never on. This
detects accidental damage and a casual edit of the body; it does not stop someone who can write the data directory and edit the
header too (that person can already edit the settings). Rule counts: **network** lines (including `@@` exceptions) and **cosmetic**
lines (counted and ignored). The browser-side matcher may drop network rules it cannot model (regex rules, `$redirect`, `$csp`,
`$important`, …); on the real lists measured by hand it kept 114,045 of about 117,000.

## Settings and routes

All routes need the session token. Defaults: shields on, every list off and not downloaded.

| Route                                       | Does                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /api/browser/filter-lists`             | the catalogue with status, date, size, hash, rule counts, licence, source address, plus the shields    |
| `POST /api/browser/filter-lists/:id/update` | the download above; the only route that contacts a list server                                         |
| `PUT /api/browser/filter-lists/:id`         | `{ "enabled": boolean }`; a list can be turned on only after a good download                           |
| `DELETE /api/browser/filter-lists/:id`      | deletes the stored copy and turns the list off                                                         |
| `GET /api/browser/filter-lists/:id/text`    | the stored, hash-checked text (at most 8 MiB) for the web app's matcher                                |
| `GET/PUT /api/browser/shields`              | the master switch: `{ "enabled": boolean }`                                                            |
| `PUT /api/browser/shields/sites/:site`      | `{ "blocking": boolean }`; `false` puts a **host name** (not a URL) on the off-list, at most 500 sites |

Settings keys: `browser.filter-lists.enabled` (list ids) and `browser.shields` (`{ enabled, offSites }`). Both appear in the
privacy inventory as `browser_filter_lists`. The existing browser profile model has no per-site field (`blockingExemptSites` is
a fixed default of the in-memory profile), so the off-list lives in Core settings. Every change and every update attempt is
audited (`browser.filter_list.update`, `.changed`, `.removed`, `browser.shields.changed`) with the list id, sizes, hash, rule
count and a closed-set refusal reason: **never any response text, list text, page address or query**. The only code-only
override is `RuntimeOptions.filterLists.baseUrl` (and a fetcher and timeouts), used by tests; it accepts https, or http to
loopback, and no setting or request can set it.

## Shields (`apps/web/src/core/browser/shields.ts`)

A pure model, built by `loadShields()` in `apps/web/src/core/filter-lists.ts` from what Core stores: the text of the enabled,
downloaded lists (the starter rules only when no list contributed a rule), the master switch, the off-list, and the music
connector policy.

- Order of decisions: master switch off → off-list (the most specific entry wins; a site includes its subdomains) → site ads
  exempt → the matcher.
- **YouTube** is not special-cased: `GET /api/music/connectors` already reports `adBlocking: "exempt"` for YouTube's exact
  hosts while its connector is on (capabilities/youtube-music), and `Shields` consumes that field. With the connector off, or
  the policy unreachable, nothing is exempt.
- Counts: in memory, per registrable domain of the page and in total, reset with `resetCounts()`; only a host name and a number
  are kept, never a URL or query; at most 2,000 sites have their own count. `BrowserGuard` takes an optional `shields` and then
  uses it for every request and its audit events (host only).

## The matcher and hostile lists

`RequestBlocker` no longer builds a regular expression per rule. A rule is compiled to literal pieces, matched left to right
(each at its earliest place) with `indexOf`, so a rule such as `a*a*a*a*a*a*a*a*b` cannot backtrack on a URL of many `a`s. That
was a real problem: the earlier regex form took seconds to minutes on such a URL and the old test only used a case the engine
handled well. Bounds: pattern 512 characters, 8 wildcards, 1,024 `domain=` entries (more drops the whole rule, never part of it),
16 KiB per rule line, 2,048 URL characters examined (a rule that must match the end of the URL cannot be judged on a cut-off URL,
so it does not block, and a needle after the cut is not seen), 300,000 rules in all (`DEFAULT_MAX_RULES`), 2,000 rules in one
host or word bucket, 25,000 rules with neither a host nor a word, and a per-request work budget after which the request is let
through and counted in `budgetExhausted`. Rules dropped by a cap are counted in `droppedRules`. A rule that matches nothing but
anchors and wildcards is refused so it cannot match every URL. Rules are found by anchored host, then by a whole word of the
pattern that must also be a whole word of the URL, then (few) tried every time.

Measured, in tests: a ~2 MB synthetic list loads and 10,000 URLs are matched well inside bounds of 20 s and 10 s (about 0.2 s
and 0.05 s on the development machine; the bounds are loose so a slow CI machine passes and a return to per-rule regex scanning
fails). By hand on the real lists (not a test): EasyList plus EasyPrivacy loaded in about 0.2 s and 10,000 lookups took about
50 ms; 114,045 rules loaded, 24,743 cosmetic and 3,222 unsupported lines were counted and ignored, none dropped by a cap.
Tests with hostile rules: exponential-looking patterns, 9 and 12 wildcards, a thousand scan-heavy rules against a 2,000-character
URL, 5,000-entry `domain=` lists, 600-character patterns, regex-form rules, over-full buckets, a 1 MB URL.

## What stays unreachable

- No browser window, so no real request reaches the matcher and no page is filtered; "blocking measured on a test page" is unmet.
- Cosmetic filtering, scriptlets, `$redirect`, `$csp`, `$important`, `$removeparam`, popup and regex rules are not implemented.
- The Rust host would have to enforce this natively (WebKit content rule lists, WebView2 request interception); the matcher is
  the specification and test vectors for that, not the enforcement.
- No scheduled refresh; the user presses Update. The lists were never downloaded by these tests.
- The registrable-domain test uses a small built-in suffix list, not the Public Suffix List (see mini-browser.md).
- Non-English Settings text is machine-translated and unreviewed.

## Where

`core/runtime/src/filter-lists/{catalogue,service}.ts`, `core/api/src/filter-list-routes.ts`, `apps/web/src/core/browser/{blocklist,shields,guard}.ts`,
`apps/web/src/core/filter-lists.ts`, `apps/web/src/components/ShieldsSettings.tsx`, strings in `apps/web/src/i18n/*/shields.ts`.
Tests: `core/runtime/test/filter-lists.test.ts`, `apps/web/test/shields.test.ts`, `apps/web/test/shields-settings.test.tsx`.
