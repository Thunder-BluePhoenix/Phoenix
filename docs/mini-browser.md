# Phoenix mini browser (Phase 93)

## Status: Rust host built and unit-tested; never run on a real display or webview.

Two things exist:

1. the tested TypeScript **policy engine** in `apps/web/src/core/browser/` (the specification), and
2. the **Rust host** in `apps/desktop/src-tauri/src/browser*.rs` (the enforcement), plus `capabilities/browser.json`.
   The chrome page (tabs, address bar) is a separate web entry (`apps/web/src/browser/`, `browser.html`).

**What was actually exercised** (cargo tests, the mock runtime and pure functions only):

- the Rust port of `decideNavigation`, `classifyHost`, `registrableDomain` and `SitePermissions`, against the SAME
  vectors as the TypeScript (`apps/web/test/fixtures/browser-policy-vectors.json`, read by both suites);
- DNS-on-the-resolved-address, HTTPS upgrade verdicts, popup, download, permission and port-radar decisions, with
  fake DNS and a fake folder dialog;
- the Adblock to WKContentRuleList **translation** (as JSON text, including the 150,000-rule truncation and its report);
- every browser command through Tauri's mock runtime: only the chrome window may call it, everything else gets
  `forbidden`, URLs and tab ids are validated, policy refusals resolve with a reason, tabs open and close;
- the capability files (one test reads `capabilities/*.json` and `tauri.conf.json`).

**What was NOT exercised, only reasoned from the vendored tauri 2.12.1 / wry 0.57 / objc2-web-kit 0.3.2 sources:**

- anything involving a real `WKWebView`, WebView2 or WebKitGTK: that `on_navigation` really fires for redirects,
  frames and `history.back()`; that incognito really leaves nothing on disk; that two top-level windows line up over
  each other; that `on_permission_request` returning `Deny` really suppresses the system prompt; that a download
  callback receives the folder the dialog chose;
- the compile and attach of the WebKit rule list (`browser_native::attach_rules`): it compiles under `objc2-web-kit`,
  but WebKit may reject the JSON, the regex subset or the rule count, and no page was ever filtered;
- the native folder dialogs (AppKit `NSOpenPanel` compiles on macOS but was never shown; the Windows `SHBrowseForFolderW`
  code was type-checked in a scratch crate for `x86_64-pc-windows-msvc`; the GTK `FileChooserDialog` code was read
  against gtk 0.18.2 and never compiled, because this machine cannot build GTK);
- Windows and Linux compile of `browser.rs` itself: not run locally (Windows `cargo check` of the full crate needs
  `llvm-rc`; Linux needs GTK). The cfg gates were reasoned (see [Platform support](#platform-support)).

Both Phase 93 exit criteria ("Browsing works on macOS; blocking measured on a test page" and "Browser data is separate
from the main browser") remain **unmet**: that needs a person to run the app and look.

## What was built

| File (`apps/web/src/core/browser/`) | Purpose                                                                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `network.ts`                        | `classifyHost`: loopback, RFC 1918, link-local, CGNAT, multicast, reserved, IPv4 in IPv6 forms, obfuscated IPv4 (`2130706433`, `0x7f.1`), intranet names; `isBadPort`           |
| `site.ts`                           | `registrableDomain` (small built-in suffix list, **not** the Public Suffix List), `isThirdParty`, `hostMatchesSite`, `hostOf`                                                   |
| `navigation.ts`                     | `decideNavigation(url, policy, intent)`: scheme, credentials, `file:`, private network, bad ports, deny list, HTTPS upgrade; `resolveOmnibox`                                   |
| `blocklist.ts`                      | `RequestBlocker`: Adblock-syntax subset matcher, `STARTER_RULES` (hand-written hosts, not EasyList)                                                                             |
| `permissions.ts`                    | `SitePermissions`: default-deny, session-only grants, gesture-gated, never-grantable kinds                                                                                      |
| `profile.ts`                        | `PRIVATE_PROFILE` and `webviewSettings()`: the data contract the Rust builder must honour                                                                                       |
| `guard.ts`                          | `BrowserGuard`: one object per window combining the above, per-tab blocked counts, per-site toggle, audit events                                                                |
| `shields.ts`                        | `Shields`: global switch, per-site off-list, per-site blocked counts, connector-policy exemption, matcher built from enabled list text (see [filter-lists.md](filter-lists.md)) |

Tests: `apps/web/test/browser-policy.test.ts` (84 tests, 4 of them over the shared Rust/TypeScript fixture), `apps/web/test/shields.test.ts` (shields model, matcher, a ~2 MB synthetic list and hostile rules) and `apps/web/test/shields-settings.test.tsx` (the settings card against a fake Core). Core side: `core/runtime/src/filter-lists/` and `core/runtime/test/filter-lists.test.ts`.

The filter-list updater, the per-site toggle and the shields model exist as **data and settings**: see [filter-lists.md](filter-lists.md). On macOS the Rust host now compiles the enabled lists into a WKContentRuleList (reasoned, never run); the blocked count is still always 0 (see [Blocking](#blocking-macos-only)).

### Navigation rules (`decideNavigation`)

Denied, in this order, with a `reason` the UI can show:

1. unparseable input or empty host (`unparseable`);
2. `file:` in any case, even if a policy lists it (`file_blocked`);
3. `javascript:`, `data:`, `blob:`, `vbscript:`, `filesystem:`, `view-source:`, `about:`, `tauri:`, `ipc:`, `asset:` even if listed (`dangerous_scheme`);
4. any scheme not in `allowedSchemes` (default `["https"]`; `http` is only reachable through the upgrade) (`scheme_not_allowed`);
5. username or password in the URL, in any encoding (`credentials_in_url`);
6. a site on `deniedSites`, subdomains included (`site_denied`);
7. a private or local host (`private_network`, with `privateReason`). It is allowed only when the intent is `typed` **and**
   the site is in `privateNetworkAllowedSites`. Links, redirects, subresources and popups never reach the private network,
   because a public page pointing at `http://localhost:4870/` (Phoenix Core) or `http://169.254.169.254/` is the attack;
8. ports the Fetch spec bans (22, 25, 6667, ...) (`bad_port`).

Plain `http:` is rewritten to `https:` (an explicit `:80` is dropped) unless the site is in `insecureAllowedSites` or is an
allowed private host. With `upgradeHttp: false` it is refused (`insecure_blocked`) unless `http` is in `allowedSchemes`.

`resolveOmnibox` makes host-like text `https://…` and everything else a search; dangerous schemes pass through on purpose so
the policy, not the omnibox, refuses them.

### Content blocking (`RequestBlocker`)

Understands the part of Adblock syntax that decides block/allow for a URL: `||host^`, `|` anchors, `*`, `^`, `@@`
exceptions, `$third-party` / `$~third-party`, resource types (`script`, `image`, `xhr`, ... and `~type`), `domain=a|~b`.
Rules with options it cannot honour (`$important`, `$redirect`, `$csp`, `$removeparam`, regex rules, cosmetic `##` rules)
are **counted and skipped**, never half-applied, and the load report says how many (`blocker.report`). Rules over 512
characters or with more than 8 wildcards are dropped. Host-anchored rules are indexed by host so a list of tens of
thousands of rules does not scan linearly. Without a type option a rule never matches a top-level `document`.

The matcher does not use regular expressions: a rule is compiled to literal pieces matched left to right, each at its
earliest place, so `a*a*a*b` against a URL of many `a`s cannot backtrack. It is also bounded on every side (pattern 512
characters, 8 wildcards, 1,024 `domain=` entries, 16 KiB per rule line, 2,048 URL characters examined, 300,000 rules in
all, 2,000 rules per host or word bucket, a per-request work budget after which the request is let through and counted in
`budgetExhausted`). Rules are indexed by anchored host, then by a whole word of the pattern, so a request does not try
every rule. See [filter-lists.md](filter-lists.md) for measurements.

Limits: no EasyList or EasyPrivacy text is bundled. The filter-list updater exists in Core (`core/runtime/src/filter-lists/`,
[filter-lists.md](filter-lists.md)): it downloads a list only when the user presses Update. Nothing applies a downloaded list
to a page in this TypeScript; the Rust host reads the same stored lists and translates them for WebKit (see [Blocking](#blocking-macos-only)). `STARTER_RULES` is a short hand-written host list used only while no list is on.
`$third-party` uses the built-in suffix list in `site.ts`, so look-alike tenants under suffixes missing from it are treated as
one site. Cosmetic filtering (element hiding, scriptlets) is not implemented and its rules are counted and ignored, so this
is request blocking only and not comparable to Brave Shields.

YouTube (`youtube.com`, `youtube-nocookie.com`, `ytimg.com`, `googlevideo.com`) is exempt from blocking by default
(`DEFAULT_BLOCKING_EXEMPT_SITES`) because blocking YouTube's ads breaks its embedded-player terms; the user can turn
blocking on per site. The most specific site toggle wins. With `Shields` in use (`BrowserGuardOptions.shields`) the exemption
is read from the music connector policy instead (`adBlocking: "exempt"` of `GET /api/music/connectors`, which is YouTube's
exact hosts while its connector is on), not from this list; the old per-guard toggle and `blockingExemptSites` are then not
consulted.

### Permissions (`SitePermissions`)

Every request is denied unless the user has granted that exact origin that exact kind in this session, the top-level origin
is `https` and public, and the asking frame is that origin (a third-party iframe never inherits). `grant()` requires a
`userGesture` flag, which must come from a real click on Phoenix's own prompt, never from page content or from Fawkes.
`display-capture`, `file-system-access`, `automatic-downloads`, `clipboard-read`, `local-fonts`, `window-management`,
`media-key-system-access` and `other` can never be granted. Grants live in memory and `clear()` / `BrowserGuard.end()` drops
them. `PERMISSION_KINDS` mirrors the display names of `tauri::webview::PermissionKind`.

### No persistent state by default

`PRIVATE_PROFILE`: `persistence: "none"`, third-party cookies off, HTTPS upgrade on, telemetry off, downloads `ask`.
`webviewSettings()` states what the Rust builder must set (`incognito`, no `data_directory`, devtools off). Persistent
profiles are Phase 96: a PRIVATE tab keeps the contract above; a profile tab (`open_tab` with `profileId`) is the one exception and exists only because the person chose that profile (see [browser-profiles.md](browser-profiles.md#the-shell-side-rust-phase-96)). The guard keeps only in-memory counts and grants. The audit sink (`BrowserAuditSink`) receives the
**host only**: never a path or query, which can hold tokens (a test pins this).

### Chrome UI (`apps/web/src/browser/`, Vite entry `browser`)

**Nothing here ran in a real window or webview.** The chrome page is tested only with React Testing Library in happy-dom
against a fake shell (`apps/web/src/browser/fake-shell.ts`); no page was loaded, no request was made, no Tauri command was
invoked. The Rust side (content webviews, enforcement, capability) is a separate piece of work and is not verified by
these tests.

- `browser.html` + `src/browser/main.tsx`: the page the shell opens in the chrome window (label `phoenix-browser`) on Core's
  own origin (`<Core>/browser.html`, like the pill), so it gets Core's local-origin CSP (`default-src 'self'`, no remote
  script, image or frame; `frame-ancestors 'none'`) and reads the injected session token to save a Shields choice.
  `tauri.conf.json` is unchanged: its CSP is for pages the shell serves itself and this one is served by Core.
  An optional `?open=<loopback url>` query asks for the port-radar confirmation at start.
- `shell.ts`: the ONE bridge. `tauriBrowserShell()` maps to the Tauri commands `open_tab`, `close_tab`, `navigate`,
  `back`, `forward`, `reload`, `zoom` plus `activate_tab`, `set_site_shields`, `set_chrome_height`, and the events
  `browser://tab`, `browser://tab-closed`, `browser://open-request`. Every payload is parsed (`parseTab`,
  `parseOpenResult`); a policy refusal is a resolved `{ ok: false, reason }`, never a rejection.
- `address.ts`: `classifyAddress` (typed text through `resolveOmnibox` and `decideNavigation` with intent `typed`, no
  private-network exception; search is DuckDuckGo, `DEFAULT_SEARCH_TEMPLATE`; Phoenix's web-search settings configure
  Core's own search tool and are not read) and `classifyPortRadarUrl` (only `http://127.0.0.1|localhost:<port>/`; the
  address that is opened is rebuilt from the port number).
- `state.ts`: the chrome as a pure reducer (tabs, active tab, typed draft, refusal, pending port-radar open).
- `BrowserApp.tsx`: tab strip, address bar, back/forward/reload, zoom steps (50% to 300%), a per-site Shields checkbox
  (registrable domain; applied through the shell and saved with `PUT /api/browser/shields/sites/:site`) and the blocked
  count of the active tab (reported by the shell; 0 until the shell counts something). A refused address is shown as
  plain text under the bar. A loopback page from the port radar is only opened after the person presses "Open it" in a
  confirmation panel (the chrome strip grows through `set_chrome_height` while it is shown).
- Page content is untrusted and is never rendered here: only `TabInfo` text (title, address) crosses, as text nodes.
- The chrome's refusals are feedback; the Rust shell must validate every URL again.
- **Phase 93 follow-ups (chrome side; run only against the fake shell, never in a real window):**
  - `find.ts` / `FindBar.tsx`: Ctrl/Cmd+F (or the toolbar button) opens a find bar for the active tab; typing searches (`find_in_page`
    `{tabId, query, forward}`), Enter / Shift+Enter and the arrow buttons step, Escape closes and sends the empty query to clear the
    highlight. A query is checked like the shell checks it (200 characters, no control character, no bidirectional-control
    character) and an invalid one is never sent; the shell still refuses it with `bad_query`.
  - `permissions.ts` / `PermissionPanel.tsx`: a `browser://permission-request` shows the site (`origin`, control and bidi characters
    replaced, text node only) and the permission (the `PERMISSION_KINDS` id, in words) with Allow once and Deny only, oldest first,
    at most eight queued, a 30 second countdown, and `answer_permission {requestId, allow}`. Rust is the authority on the timeout
    (it denies by itself; the chrome also sends a deny at 30 s, harmless if late); `browser://permission-resolved` drops a prompt.
    Allow is once: nothing is remembered by the chrome. Whether Rust grants anything on `allow: true` is Rust's.
  - `corner.ts` / `CornerFawkes.tsx`: a small Fawkes in the corner of the chrome window (never injected into a page: pages are separate
    content webviews). It is the existing `FawkesAvatar` showing existing display states only: WAITING (a permission is asked),
    WARNING (the last address or action was refused), WORKING (the active tab is loading), THINKING (a find is running), IDLE
    (found / not found / Shields off for this site / N requests blocked), SLEEPING (no tab), OFFLINE (no shell). The words are Phoenix's
    own translated messages (page text never reaches it) and are the avatar's accessible name. Reduced motion follows
    Settings > Fawkes; the checkbox "Show Fawkes in the corner of the Phoenix browser" (`browser_corner` in `/api/pet/settings`, on by
    default) hides it. It has no click action and no interactions or sounds.
  - The blocked count is still whatever `TabInfo.blocked` says; the shell's count is Rust's (see above).
- Not built in the chrome: downloads prompt, a search-provider picker, and
  the port-radar button itself (the radar still opens loopback links in the system browser; the shell or Phoenix must send
  `browser://open-request` or open the window with `?open=`).
- All strings are in the ten locales (`browser.*`); non-English text is machine-translated and unreviewed.

### Phase 95: chrome relay and approval card (`apps/web`)

**Only ran against fakes in happy-dom** (a scripted client, `fake-shell.ts`, a fake fetch). No Tauri command was invoked,
no real webview, window or display was involved, and Core's relay routes were not exercised from here.

- `shell.ts`: `pageSnapshot()` and `pageAction(req)` map to the chrome-only commands `page_snapshot` / `page_action`
  (camelCase args). `parsePageSnapshotResult` / `parsePageActionResult` accept only the documented shapes; anything else,
  a rejected invoke included, becomes the resolved `{ ok: false, reason: "failed" }`. A reason must be a short lower-case id.
- `relay.ts`: while a shell exists and Core is online, the chrome page long-polls `GET /api/browser/relay/next?wait=20000`
  and handles one request at a time. The request is validated strictly (kind whitelist, exact field set, string types,
  lengths 512/4096/2048, no control characters except in typed text); unknown shapes are answered `{ ok: false, reason:
"failed" }` without calling the shell. The result goes to `POST /api/browser/relay/:id/result`: snapshot ->
  `{ ok: true, snapshot: { url, title, html, truncated } }` (no `tabId`), action -> `{ ok: true, url }` or `{ ok: false,
reason }`; a body over ~14 MiB serialised is replaced by `{ ok: false, reason: "too_large" }`. Errors back off 1 s,
  doubling to 15 s; unmount aborts and nothing is run or posted afterwards. The loop never throws and never logs; snapshot
  HTML and typed text are never put in the DOM.
- `Approvals.tsx`: a confirmation with `details.browser` (or capability `browser`) shows the localised action, the page
  (host and path; any query, fragment or credentials Core might send are cut again here), the selector or destination
  (with a note when the query is hidden) and, for `type`, the FULL text in a `pre-wrap` text node with its length. A missing
  fact is said to be missing. The typed text is in no attribute, live-region announcement, console call or storage.
  The high-risk "I understand" step is unchanged. Strings: `browserApproval.*` in all ten locales (machine-translated,
  unreviewed).

## The Rust host

Files in `apps/desktop/src-tauri/src/`:

| File                | Purpose                                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `browser_policy.rs` | Port of `network.ts`, `site.ts`, `navigation.ts`, `permissions.ts`. Pure. Adds `dns_private` and `dns_failed` denials and `classify_ip` for resolved addresses |
| `browser_rules.rs`  | Adblock text to WebKit content rule list JSON; the 150,000-rule limit; per-site exemptions; fixed private-network block                                        |
| `browser_core.rs`   | Pure helpers: tab ids, zoom clamp, history counter, popup rate limit, download names, port-radar URL rules                                                     |
| `browser_native.rs` | The only platform code: folder dialogs (macOS, Windows, Linux) and the macOS WKContentRuleList compile and attach                                              |
| `browser.rs`        | `Host` state, the window builder, `on_*` hooks, the chrome commands, the lifecycle                                                                             |
| `browser_page.rs`   | Phase 95, pure: the fixed page scripts, selector allow-pattern, JSON string-literal substitution, request validation, reply decoding and caps                  |

### Window layout

Two kinds of top-level window, no `unstable` feature, no `Window::add_child`:

- the **chrome** window, label `phoenix-browser`, loads `browser.html` from the app bundle (tabs, address bar, buttons);
- one **content** window per tab, label `phoenix-browser-tab-N` (`N` counts up and is never reused), undecorated, hidden
  unless active, a child window of the chrome window (`WebviewWindowBuilder::parent`), moved and resized over the chrome
  window's area below the chrome strip (`set_chrome_height`: 80 logical px, 220 while the confirmation panel is open) on
  every chrome move, resize and scale change.

The cost of this choice: two windows must be kept aligned by events (a drag can lag a frame), the child-window behaviour
differs per OS (macOS `addChildWindow`, Windows owner window, Linux transient-for) and was not seen on any of them, and
a window manager that lets the user focus the content window alone can leave the chrome behind it. `Window::add_child`
(one window, several webviews) would remove those problems but needs tauri's `unstable` feature; it was not taken.

At most 12 tabs. Closing the chrome closes every tab and forgets grants, DNS answers and pending requests.

### What every content webview gets

| Setting                                     | Value                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `incognito(true)`                           | macOS: `WKWebsiteDataStore.nonPersistentDataStore`. Windows: InPrivate (WebView2 101.0.1210.39 or newer; older does nothing). Linux: see below                                                                                                                                                                                        |
| no `data_directory`                         | nothing is written under Phoenix's app data directory by the browser                                                                                                                                                                                                                                                                  |
| `devtools(false)`                           | and the tauri `devtools` feature is not enabled                                                                                                                                                                                                                                                                                       |
| no `initialization_script`                  | the page gets no Phoenix script; `withGlobalTauri` injects `window.__TAURI__` only for webviews with IPC access                                                                                                                                                                                                                       |
| `on_navigation`                             | `Host::judge`: the Rust `decideNavigation` (intent "link"), then DNS (below); `Upgrade` = return `false` and `navigate` to the https URL on a thread                                                                                                                                                                                  |
| `on_new_window`                             | always returns `Deny`; a permitted target (`decideNavigation` intent "new_window", https only, at most 3 per 10 s) is reopened as a tab                                                                                                                                                                                               |
| `on_download`                               | refused unless the URL passes the policy and the person picks a folder in a native dialog (at most 3 dialogs per 10 s); the file name is sanitised, an existing file gets ` (2)`; a refusal emits `browser://download-refused`                                                                                                        |
| `on_permission_request`                     | `Allow` only for a session grant (`SitePermissions`, nothing makes one) or a live "allow once" the person gave in the Phoenix prompt for this exact (tab, origin, permission); otherwise `Deny` and, for a grantable request, a prompt in the chrome (see [Phase 93 follow-ups](#phase-93-follow-ups-rust-host)). **Never `Default`** |
| `on_page_load`, `on_document_title_changed` | update the tab and emit `browser://tab`; title is stripped of control characters and cut to 300                                                                                                                                                                                                                                       |

Only the top-level `https:` or loopback-radar navigation reaches the page. `about:blank` and `about:srcdoc` are the only
`about:` URLs allowed (the webview creates them itself); every other `about:`, `file:`, `data:`, `blob:`, `javascript:`,
`tauri:`, `ipc:`, `asset:` is refused by the port.

### DNS and the remaining time-of-check gap

For every allowed `http`/`https` navigation to a **name** (not an IP literal) the host resolves the name in Rust
(`ToSocketAddrs`, 2 s limit, answers cached 60 s) and applies the `classify_host` tables to **every** returned address
(`classify_ip`): a name with one private address among public ones is refused too (`dns_private`); a name that does not
resolve in time is refused (`dns_failed`, fail closed). A port-radar tab may reach its one dev-server origin
(`localhost`/`127.0.0.1`/`[::1]` and the confirmed port) only if every answer is loopback.

**The gap that remains (time of check to time of use).** The webview resolves the name again when it connects. A DNS
server that answers with a public address to Phoenix and a private one to the webview a moment later (short-TTL
rebinding) is not caught by this check. What narrows it: the 60 s cache means Phoenix and the webview usually see the
same answer; subresources and redirects of a loaded page are not re-resolved by Phoenix at all; and on macOS the
content rule list blocks private-range **literal** hosts in subresources. What does NOT close it: no connect-time hook
exists in tauri/wry on any platform, and pinning an address is impossible through the webview API. Closing it needs a
local proxy or a custom resolver in the engine; that is not built.

`on_navigation` is synchronous on the main thread, so a DNS lookup there blocks the UI for up to 2 s the first time a
name is seen (cached afterwards). Commands (`open_tab`, `navigate`) resolve on a worker thread first, so the typed path
normally warms the cache before the webview asks.

### Commands (chrome window only)

All arguments are camelCase from the page. Every command's first statement is `chrome_only(&window)?` (a test reads the
source to enforce that), so a call from any other window label (the pet, a content window, anything) returns
`{"code":"forbidden"}` and does nothing. The contract with the chrome page is in `apps/web/src/browser/shell.ts`.

| Command                                                             | Behaviour                                                                                                                                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open_tab { url, intent }`                                          | `typed` or `port_radar`. URL: at most 2048 bytes, no control characters. Refusals resolve `{ok:false, reason}`; success `{ok:true, tab}`                                                    |
| `navigate { tabId, url, intent: "typed" }`                          | the same validation; any other intent is rejected                                                                                                                                           |
| `close_tab`, `activate_tab`                                         | tab id is canonical decimal digits only and must exist                                                                                                                                      |
| `back`, `forward`, `reload`                                         | `back`/`forward` use a host-side history counter and `history.back()`/`history.forward()` (the only script Phoenix ever evaluates in a page; it carries no data)                            |
| `zoom { tabId, factor }`                                            | clamped to 0.5 to 3, NaN to 1; applies `set_zoom`                                                                                                                                           |
| `set_chrome_height { height }`                                      | clamped to 40 to 400 logical px                                                                                                                                                             |
| `set_site_shields { site, blocking }`                               | `site` must be a plain host name; recompiles and re-attaches the rule list on macOS                                                                                                         |
| `shields_status`                                                    | whether native blocking is active, which source (lists, starter, off), the conversion report and any attach error                                                                           |
| `page_snapshot {}`                                                  | Phase 95: the active tab's markup (at most 4 MiB) with the host's tab id, URL and title; see [Phase 95: page snapshot and page actions](#phase-95-page-snapshot-and-page-actions-rust-host) |
| `page_action { kind, selector?, text?, destination?, expectedUrl }` | Phase 95: one approved click, type, submit, download or navigate on the active tab, same section                                                                                            |

Events to the chrome window only: `browser://tab` (a `TabInfo` upsert), `browser://tab-closed`, `browser://open-request`,
`browser://download-refused`. `TabInfo.blocked` is always 0: no webview reports how many requests a content rule list
blocked.

### Phase 95: page snapshot and page actions (Rust host)

**Never run against a real webview.** Everything below was exercised only with pure unit tests and the mock runtime plus
the `Hooks::script_runner` fake, which answers instead of a page. The fixed scripts were never executed by any
JavaScript engine from here, in WKWebView, WebView2 or WebKitGTK or anywhere else. What is proven is the host: caller
check, validation, the active-tab and URL checks, how replies are decoded and bounded, and that a refusal is a resolved value.

Two more chrome-only commands (first statement `chrome_only(&window)?`, in `browser.rs`; pure parts and the scripts in
`browser_page.rs`). Neither takes a tab id: both act on the Host's ACTIVE tab, whose id, URL and title are the HOST's
tracked values, never script output. Core's relay (see the chrome section above) drives them after the person approved.

| Command                                                             | Behaviour                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `page_snapshot {}`                                                  | `{ok:true, tabId, url, title, html, truncated}` or `{ok:false, reason}`; reasons `no_active_tab`, `not_a_web_page` (tab URL is not http/https), `page_changed`, `timeout`, `too_large` (raw reply over 24 MiB), `failed`                                                                                                 |
| `page_action { kind, selector?, text?, destination?, expectedUrl }` | `kind` is `click`, `type`, `submit`, `download` or `navigate`. `{ok:true, url}` or `{ok:false, reason}`; reasons `bad_kind`, `bad_selector`, `bad_text`, `bad_url`, `no_active_tab`, `page_changed`, `timeout`, `not_found`, `ambiguous`, `protected`, `unsupported`, `failed`, or a navigation-denial id for `navigate` |

Bounds: selector at most 512 characters (its pattern is far tighter, below), `text` at most 4096 characters (required for
`type`, forbidden otherwise), `destination` at most 2048 (`navigate` only), `expectedUrl` at most 2048 and http(s); no
control characters in the URLs. Validation happens before the tab is looked at and before any script text exists.

**Page check.** `expectedUrl` (fragment stripped, compared as parsed URL strings) must equal the active tab's host-tracked
URL, else `page_changed`, and this happens before any script runs. A snapshot is `page_changed` when the host URL (or the
active tab) differs before and after the script, or when the page's own `location.href` (fragment stripped) differs from
the host URL. For the scripted kinds the host first runs the fixed `URL_SCRIPT` (returns `location.href`, no input) and
refuses if it is not the approved page, re-checks the host state, then runs the action script, which reports the page it
started on; that must match too. This narrows, and cannot close, the gap between the check and the click: a page can still
navigate between the last check and the script's first statement.

**Fixed scripts.** `SNAPSHOT_SCRIPT` and `URL_SCRIPT` have no input. The action scripts are `const &str` text with two
placeholders; the ONLY values that ever enter one are the selector and (for `type`) the text, each as ONE serde_json
string literal with U+2028/U+2029 additionally escaped. Substitution is a single pass over the template, so a value that
contains a placeholder name is never substituted again. No other field (`destination`, `expectedUrl`, anything a page
returned) can reach a script. Tests parse the declaration line back as JSON and check a hostile text (quotes,
`</script>`, backslashes, U+2028/2029, `${}`, backticks, control characters) appears exactly once, only as that literal.

The scripts never call `querySelector`, `eval`, `Function` or `innerHTML`. They resolve the control by iterating
`document.getElementsByTagName(tag)` and comparing a cleaned `id` (or, when the element has no id, cleaned `name`) with
the selector's token, where "clean" is the reader's `cleanToken` (strip invisible, bidi and control characters, collapse
whitespace, trim, cut to 80, replace `[^A-Za-z0-9_:.-]` with `_`); exactly one match is required (`not_found`,
`ambiguous`). Defence in depth, repeating `ai/browsing` rules inside the page: `click`/`download` only on a `button` or
`input`; `type` only into `textarea` or `input` of type text/search/email/url/tel, not disabled or read-only, using the
native prototype value setter and then dispatching bubbling `input` and `change` events; `submit` on a `form` or a submit
control through `requestSubmit`. Password, hidden and file types and any control whose type, autocomplete, name, id,
aria-label, placeholder, title or label matches the reader's `forbiddenField` pattern are `protected`, and a form with any
protected control is never submitted or clicked-to-submit. The script returns `JSON.stringify({ok:true,u})` or
`{ok:false,reason}`; the host decodes either a JSON string of JSON or an object, maps `reason` onto
`not_found|ambiguous|protected|unsupported|failed` (anything else becomes `failed`, so page text never reaches the chrome),
and bounds the raw reply (24 MiB).

**Selector allow-pattern.** Exactly what `ai/browsing/src/page-snapshot.ts` emits for a unique control: `<tag>#<token>` or
`<tag>[name="<token>"]` with `tag` one of `input`, `button`, `form`, `select`, `textarea` (lower case) and `token` =
`[A-Za-z0-9_:.-]{1,80}`. Refused as `bad_selector`: the reader's `:nth-of-type(N)` form, its `~N` duplicate suffix,
`<form> :unreported-controls`, quotes, backslashes, angle brackets, spaces, newlines, any non-ASCII, any other tag, empty,
and anything over 80 token characters. Those reader forms are not valid CSS and not unique, so they cannot be clicked.
The cost: a control with neither a usable id nor name cannot be acted on at all.

**Snapshot.** The fixed script returns `document.documentElement.outerHTML` cut at 4 MiB (4,194,304 UTF-16 units) with the
page's `location.href`; lone surrogates become U+FFFD so the reply is valid JSON. Rust cuts again at 4 Mi characters after
decoding and sets `truncated` if either cut anything. The page's markup is untrusted input for the reader in `ai/browsing`,
which is the only thing that should interpret it; the chrome never renders it. The shadow DOM, iframes and anything
rendered after the script ran are not in `outerHTML`.

**`navigate` kind.** The destination is vetted exactly like the `navigate` command (`Host::vet(radar, url, typed = true)`,
DNS lookup off the main thread); a policy denial resolves `{ok:false, reason: <denial id>}` (`private_network`, `dns_private`,
...), and success calls the tab's `navigate` and returns the new URL. The page is re-checked after the DNS wait.

**Timeouts and the test seam.** The real path calls `eval_with_callback` on the active tab's content window and waits on a
one-shot channel (`Mutex<Option<Sender>>` taken once) with `recv_timeout` of 10 s, on a blocking thread. The callback may
never fire (a hung page, or a platform that drops it): that is `timeout`, and a late answer is dropped. `Hooks` has an
optional `script_runner(label, script) -> Option<String>`; `Hooks::system` sets `None`. `Some(raw)` is the raw callback
string, `None` falls through to the real eval path (the mock runtime evaluates and never calls back, which the timeout test
uses).

**Never logged.** `text` is never in a result, an error, a log line, or `Debug` output (`Plan` prints only its variant); a
refusal reason is one of the fixed ids above.

**Not verified:**

- Whether `eval_with_callback` returns what the code assumes on WKWebView, WebView2 and WebKitGTK (a JSON string of the
  script's string result, per tauri's docs, and the Windows note that exceptions are swallowed). The decoder accepts both
  an object and a JSON string of JSON because this was not observed.
- That any of the scripts behave as described on a real page: React/Vue controlled inputs (the prototype-setter plus
  `input` event is the usual trick, not proof), `requestSubmit` validation, a click that opens a popup or a download (the
  download path still goes through `on_download` and its folder dialog, not through this command), shadow DOM, cross-origin
  iframes, pages with a Trusted Types or script-blocking policy, sandboxed pages, a CSP (`eval_with_callback` is not
  subject to the page's CSP, but this was not observed).
- Behaviour of the 4 MiB / 24 MiB bounds against real memory pressure; and the timing gap between the URL checks and the
  action (above).
- That the chrome-only ACL rejects a call from a real remote page (as for every command here: the mock runtime checks the
  label only).

### Capabilities

`capabilities/browser.json` grants `core:default` and the `allow-*` permission of every browser command (16 now: the eleven above plus `page_snapshot`, `page_action`, `find_in_page` and `answer_permission`, and `purge_profile_data`) to the window
`phoenix-browser` only, as a **local** capability (the chrome is a page from the app bundle). The content windows have
no capability file, no `remote` entry anywhere lists a web origin (the only remote entry in the repository is the exact
loopback `pill.html` URL of Phoenix Core), and the one runtime `add_capability` call names only the pill window.
`capability_tests` in `browser.rs` read `capabilities/*.json`, `tauri.conf.json` and `lib.rs` to assert this; the
lifecycle test also invokes every command from the pet window, a content window and a stranger window and expects
`forbidden`. **Not verified:** that a real remote page with `window.__TAURI__` cannot invoke a command (the mock runtime
checks the label, not the ACL; the ACL layer is tauri's own). A person should open a test page in a tab and run
`window.__TAURI__.core.invoke("close_tab", …)` from its console, but devtools are off, so use a page that calls it.

### Blocking (macOS only)

`browser_rules::convert` turns the **enabled and downloaded** lists (read from Core over loopback: `GET
/api/browser/filter-lists` then `/:id/text`; the starter rules only when no list contributed a rule, exactly as
`Shields` does) into WebKit content rule list JSON, and `browser_native::attach_rules` compiles it (store in a
per-process 0700 temp directory, removed again after attaching) and attaches it to the tab's `WKUserContentController`
BEFORE the first page loads (the tab starts on `about:blank`, then `navigate`). If compiling fails the tab is **not
opened** (`shields_unavailable`): it never loads unfiltered on macOS.

Translation limits (all in `browser_rules.rs`, tested): a rule WebKit's format cannot express is **skipped and counted**,
never widened: `$websocket`, `$ping`, `$other`, `$subdocument` mixed with other types, `$important`, `$redirect`, `$csp`,
`$popup`, regex rules, `domain=` mixing include and exclude, non-ASCII patterns, `@@…$document`. Cosmetic rules are
counted and ignored. A rule with no type option covers image, style-sheet, script, font, raw (XHR/fetch), svg-document
and media: requests WebKit files as `ping`, `websocket` or `other` are not blocked. A trailing `^` needs one more
character in the URL.

**The 150,000-rule limit.** WebKit refuses a list over 150,000 rules. EasyList plus EasyPrivacy convert to well over
110,000 rules, so Phoenix keeps a deterministic prefix: the fixed rules first counted, then up to 10,000 exceptions, then
blocking rules **in the order Core stores the lists**; the tail is dropped. The conversion report
(`shields_status.report`: `converted`, `keptBlocking`, `truncatedBlocking`, `truncatedExceptions`, `unsupported`,
`cosmetic`, `duplicates`, `fixedRules`, `siteExemptions`, `limit`) says exactly how many were dropped, and a test pins
that the same input gives the same output. Whether the truncated list blocks usefully was not measured.

Fixed rules, always on and last in the list (nothing earlier can lift them): subresources and child frames to loopback,
private ranges, link-local, CGNAT and intranet names are blocked (loopback is allowed only when the page itself is
`localhost` or `127.0.0.1`, i.e. a dev server opened from the port radar); Phoenix Core's port is blocked for **every**
page. These work on the URL text WebKit holds, so a public **name** that resolves to a private address in a subresource is
not caught (the DNS gap above).

The master switch off leaves only the fixed rules. Per-site "shields off" (from Core's off-list and the music
connector's exact hosts, YouTube by default) becomes `ignore-previous-rules` rules scoped by `if-domain` to the page's
host; the off-list entries are registrable domains and match subdomains. At most 600 are kept, and the report counts what
was dropped. `set_site_shields` also applies at once, keeping an in-memory override until Core's list catches up.

### Platform support

- **macOS:** everything above; blocking is built but unseen.
- **Windows:** tabs open with navigation policy, DNS check, popup, download and permission handling, and NO request
  blocking: `shields_status.platformBlocking` is `false`. A `WebResourceRequested` filter through
  `Webview::with_webview` was **not built**: it needs the `webview2-com` types and a request-pattern list, which could not
  be compiled or exercised here. The download dialog uses `SHBrowseForFolderW` (type-checked only).
- **Linux:** the same as Windows; `UserContentFilterStore` was not built (see the follow-ups section; the safe bindings do not wrap it). The third-party cookie policy is the one Linux-only addition, reasoned only. The download
  dialog is `gtk::FileChooserDialog`, not compiled here. WebKitGTK has no in-private flag exposed by wry's `incognito`
  on every version: whether a Linux tab leaves cookies on disk was not checked.

CI compiles Windows and Linux; the cfg gates were written so no helper is dead there (`SHIELDS_ATTACH_TIMEOUT`,
`attach_and_load` and `reattach` carry the macOS cfg or a non-macOS twin), but that is reasoning, not a CI run.

### Other things tauri and wry do not give for free

- **Third-party cookie blocking:** tauri 2.12.1 / wry 0.57.0 have no setting for it. Checked: `WebviewBuilder` has none;
  wry's cookie API (`Webview::cookies`, `set_cookie`, `delete_cookie`) is a store reader/writer with no hook that says
  which request or frame a cookie came from, so a sweep could only delete cookies by domain AFTER they were set and used
  (and could not tell a first-party cookie of `a.example` from a third-party one without knowing which tab was framing it).
  That is not honest blocking and is **not built**. macOS: `WKHTTPCookieStore` has only Allow/Disallow for ALL cookies
  (`setCookiePolicy:`), which would break every login, so it is not used. Linux: `WebKitCookieManager` has a real
  `ACCEPT_NO_THIRD_PARTY` policy and `limit_third_party_cookies` sets it per tab (`webkit2gtk` 2.0.2 from the lockfile,
  `cfg(target_os = "linux")` only; **compiled on neither platform, reasoned only**). Windows: WebView2 has no
  third-party-cookie switch in the locked `webview2-com-sys` 0.39.1 (only Edge's own Tracking Prevention, which is a
  profile-level user setting). So: Linux reasoned, macOS and Windows **missing**.
- **Fingerprinting protection** is whatever each webview ships; Phoenix adds none.
- **Permission prompts:** built, see [Phase 93 follow-ups](#phase-93-follow-ups-rust-host). macOS has no backend for
  geolocation or notification prompts (wry only asks for camera and microphone there).
- **Find in page:** built, see the same section. **Zoom, back, forward, reload** exist as commands.
- **Frame awareness:** `on_navigation` does not say which frame navigated. The HTTPS upgrade-in-place is limited to the
  same registrable domain as the tab (or a tab with no page yet), so an iframe cannot steer the tab to another site; a
  third-party http link in a frame is simply refused.
- **Public Suffix List:** `registrable_domain` uses the same small built-in list as `site.ts`, not the PSL (no PSL crate is
  in the lockfile).
- **`TabInfo.blocked`:** always 0, on purpose (see [the blocked counter](#the-blocked-counter-why-it-stays-0)).

### Phase 93 follow-ups (Rust host)

Rust only; the chrome side is `apps/web/src/browser/` (find bar, permission prompt). None of this ran on a real display or
webview. The mock-runtime tests exercise the host state, the fixed scripts and the IPC layer, not WebKit.

#### `find_in_page { tabId, query, forward }` (chrome window only)

Resolves `{ok:true, found, count}` or `{ok:false, reason}`; reasons `bad_query`, `unknown_tab`, `no_page` (not an http/https
page), `timeout`, `failed`. A refusal is a resolved value.

- The query is at most 200 characters (code points), with no control character, no bidi control (U+061C, U+200E/F,
  U+202A-E, U+2066-9) and no U+2028/9. Checked in Rust before any script exists (`find_query_ok`).
- It runs ONE fixed script (`browser_page::FIND_HEAD` + `FIND_BODY`, or `FIND_CLEAR_SCRIPT` for the empty query). The query
  enters only as one JSON string literal (`js_string_literal`, also escaping U+2028/9) and the direction as `true`/`false`; a
  test replaces the literal and compares the rest to the fixed text. The script has no `eval`, no selector engine, no
  `innerHTML`, writes nothing to the page and has no slot.
- Counting is a TreeWalker over text nodes, skipping `script`/`style`/`noscript`, at most 500 matches and 2,000,000
  UTF-16 units of text scanned (the chrome shows "500+"); the highlight is the engine's own `window.find` (case-insensitive,
  wraps). Where `window.find` does not exist `found` is whether the count is above 0 and nothing is highlighted.
- It works on any tab id, active or not. Closing a tab destroys the webview and the highlight with it; the host keeps no
  find state. Whether `window.find` highlights inside a WKWebView/WebView2/WebKitGTK content window was not seen.
- Not guarded against a page that overrides `String.prototype.toLowerCase` or `window.find`: the reply is decoded as data and
  the count is clamped in Rust (500), so a hostile page can only lie about its own text.

#### Permission prompt

When a content page asks for a permission, `on_permission_request` calls the host, which answers at once (the callback runs
on the UI thread and cannot wait) and, when the request is one policy would ever grant (known kind, `https`, public host,
not a never-grantable kind), raises a Phoenix-owned prompt:

1. Event `browser://permission-request` to the chrome: `{requestId, tabId, origin, permission}` (`permission` is a
   `PERMISSION_KINDS` id; `origin` is the HOST's view of the tab's origin, capped at 256 characters). At most 4 prompts are
   open at once and one per exact (tab, origin, permission); a request beyond that is denied unasked.
2. **The page that asked is answered `Deny` now.** The prompt offers Allow once and Deny only; "always for this site" is not
   offered and no command records a session grant.
3. `answer_permission { requestId, allow }` (chrome only; any other window gets `forbidden`). Allow records ONE "allow
   once" for that prompt's exact (tab, origin, permission), valid for 30 s: the page's NEXT request of that same triple is
   answered `Allow` and consumes it. Another permission, another origin or another tab stays denied.
4. No answer for 30 s: the prompt is dropped (default deny), `browser://permission-resolved {requestId}` tells the chrome, and
   a late `answer_permission` is a no-op. Closing the tab or the chrome drops its prompts and allowances (the resolved event
   fires for the tab case).

Deviation worth knowing: because the engine callback cannot wait, an allowed permission takes effect on the page's retry (a
page that asks once and gives up is simply denied). Making the first request wait would need an asynchronous permission API;
wry 0.57's `permission_handler` is synchronous on every platform. The ask is attributed to the tab's top-level origin (the
asking frame is not given).

#### The blocked counter: why it stays 0

`TabInfo.blocked` is 0 on every platform and that is deliberate. A `WKContentRuleList` blocks a request inside WebKit with no
callback: wry 0.57 exposes no navigation-failure, resource-load or content-rule hook, and Phoenix adds no
`WKNavigationDelegate` of its own. A navigation-level count was considered (count top-level loads that never reach
`on_page_load`) and rejected: a blocked top-level load and a cancelled, failed or closed one are indistinguishable from the
host, so the number would be a guess. The honest number that exists is how many rules are APPLIED, in
`shields_status.report` (`keptBlocking`, `keptExceptions`, `truncated*`); it is not a count of blocked requests and the chrome
must not present it as one.

#### Request blocking on Windows and Linux

Not built. Reasons, from reading the locked crates:

- **Linux:** `webkit2gtk-sys` 2.0.2 has `webkit_user_content_filter_store_*` (feature `v2_24`), but the safe `webkit2gtk`
  2.0.2 wraps neither `UserContentFilterStore` nor `UserContentManager::add_filter` (both are commented out as "Ignored"
  in `auto/user_content_manager.rs`). Using it means raw FFI with GLib async callbacks and `GBytes` ownership, none of
  which can be compiled or run here (no GTK); that is too much unverifiable unsafe code to ship. The content-rule JSON
  itself is already shared with macOS.
- **Windows:** `webview2-com` 0.39.1 has `add_WebResourceRequested` and `AddWebResourceRequestedFilter`, but a filter needs
  a per-request matcher compiled in Rust (the WebKit JSON is not usable) plus COM event-handler plumbing and `Deferral`
  handling. That could not be built or type-checked here (the Windows target needs `llvm-rc` for the build script).

Tabs on those platforms open unfiltered and `shields_status.platformBlocking` says so.

### Phase 80: opening a radar server in the Phoenix browser

The Rust side is `phoenix://browser/open?url=<percent-encoded loopback URL>`, handled where `phoenix://approvals/…` already
is (`open_links`, macOS `RunEvent::Opened`; `Info.plist` already declares the `phoenix` scheme). There is no Tauri command
for it, so no web page can ask the browser to open anything.

1. The link must be exactly that shape (host `browser`, path `/open`, one `url` query parameter, no fragment) and the
   inner URL must be `http` or `https` to `127.0.0.1`, `localhost` or `[::1]` with an explicit port that is not Phoenix
   Core's own and no credentials. Anything else is dropped silently.
2. The host records the URL (at most 4 pending, 120 s), shows the chrome window and emits `browser://open-request`.
3. **Nothing opens yet.** The chrome page shows its own confirmation panel; only its confirmation calls
   `open_tab { intent: "port_radar" }`, which succeeds once, for exactly the recorded URL, and is refused as
   `not_requested` otherwise.
4. The new tab may stay on that one origin (host and port) as a typed, listed private host without an https upgrade; every
   other private target stays refused, and Core's port is blocked for all pages by the content rule list.

**Web side:** `PortRadar.tsx` shows an "Open in Phoenix browser" button next to the plain link (macOS scans only; never for
Core's own port). It builds the link from the port number (`phoenixBrowserLink` in `core/ports.ts`) and hands it to a
`PhoenixLinkShell` (default: `location.assign`, delivered by the operating system as `RunEvent::Opened`). Tests use a fake shell and
check the link parses the way `radar_link` does; nothing ran on a display, and a Windows or Linux handler does not exist.

### Gateway, audit, Fawkes

Side effects the browser can cause (download, form submit, opening a private-network site, granting a permission) are NOT
routed through the permission/tool gateway or audit log from the Rust host: the download dialog and the radar
confirmation are the Phoenix-side decisions. `BrowserAuditSink` is still only the shape of a record. Page text is
untrusted data: nothing a page says changes a policy. The Fawkes in the chrome corner is built on the chrome side (see above); it was never seen on a real display.

## Exit criteria

| Criterion                                    | State                                                                                                                      |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Browsing works on macOS; blocking measured   | **Unmet.** The host is built; no webview was ever shown, no page loaded, no blocking measured.                             |
| Browser data separate from the main browser  | **Unmet.** Built as `incognito(true)` with no data directory; whether the engine writes nothing was never checked.         |
| Tested navigation/permission/blocking policy | Done as a reference implementation (TypeScript) and as a Rust port against the same vectors (unit tests, simulated inputs) |
