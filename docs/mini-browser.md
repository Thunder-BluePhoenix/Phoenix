# Phoenix mini browser (Phase 93)

## Status: policy engine only. There is no browser surface yet.

What exists is a tested TypeScript **policy engine** in `apps/web/src/core/browser/`. What does **not** exist:

- no browser window, no webview, no tabs, no address bar, no `MiniBrowser.tsx`;
- no Rust or Tauri change (`Cargo.toml`, `tauri.conf.json`, `main.rs`, capabilities were not touched);
- no enforcement. Nothing calls this code from a webview. A policy that runs in page-reachable JavaScript would
  protect nothing, so the real checks must run in the Rust host (see [What the parent must build](#what-the-parent-must-build)).
  This TypeScript is the executable specification and test vectors for that port, and it can drive the chrome UI (address
  bar feedback, blocked count, permission prompts) once a webview exists.
- not verified: "Browsing works on macOS; blocking measured on a test page" and "Browser data is separate from the main
  browser" (Phase 93 exit criteria). Both need a real webview and are **unmet**. All evidence here is unit tests on injected
  inputs; no network, window, or OS call was made.

This slice was reviewed again after the Core wiring of Phases 86 to 96 and was deliberately not wired: a policy running in page JavaScript would protect nothing, so enforcement has to live in Rust, and no webview or Rust/Tauri change exists.

`MiniBrowser.tsx` was deliberately not written: a React component that draws an address bar and an `<iframe>` would be a fake
browser (iframes cannot be sandboxed to the degree required, are blocked by most sites' `X-Frame-Options`, and share
Phoenix's origin policy). It needs the native webview below.

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

Tests: `apps/web/test/browser-policy.test.ts` (80 tests), `apps/web/test/shields.test.ts` (shields model, matcher, a ~2 MB synthetic list and hostile rules) and `apps/web/test/shields-settings.test.tsx` (the settings card against a fake Core). Core side: `core/runtime/src/filter-lists/` and `core/runtime/test/filter-lists.test.ts`.

The filter-list updater, the per-site toggle and the blocked count now exist as **data and settings**, not as blocking: see [filter-lists.md](filter-lists.md). Nothing is blocked in any real page, because there is no browser window.

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
to a page, since no browser window exists. `STARTER_RULES` is a short hand-written host list used only while no list is on.
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
profiles are Phase 96. The guard keeps only in-memory counts and grants. The audit sink (`BrowserAuditSink`) receives the
**host only**: never a path or query, which can hold tokens (a test pins this).

## What the parent must build

Findings below come from reading `apps/desktop/src-tauri` and the vendored `tauri 2.12.1` / `wry 0.57.0` sources
(`Cargo.lock` pins 2.12.1). Existing windows use `WebviewWindowBuilder` in `island.rs`, `pill.rs` and `lib.rs`; the pill
already loads an external URL with `on_permission_request`, which is the closest pattern. Nothing there is a browser.

### 1. Cargo (`apps/desktop/src-tauri/Cargo.toml`)

- To put a remote page and Phoenix's chrome UI in one window, `Window::add_child` is needed; in tauri 2.12.1 it is gated
  behind `#[cfg(any(test, all(desktop, feature = "unstable")))]`, so add the `unstable` feature to the `tauri` dependency
  (`features = ["tray-icon", "macos-private-api", "unstable"]`). The alternative that needs no feature is two top-level
  windows (chrome window + content window) at the cost of managing their geometry together.
- Do **not** enable the `devtools` feature (and keep `.devtools(false)`); the content page is untrusted.
- Real subresource blocking needs platform code (item 4): `objc2-web-kit` for macOS (`WKContentRuleListStore`), `webkit2gtk`
  for Linux (`UserContentFilterStore`), and nothing extra on Windows beyond `windows`/`webview2-com` if
  `WebResourceRequested` is reached through `with_webview`. [INFERENCE] The exact crates and features were not checked
  against the lockfile; none of them is a dependency today.
- `macos-proxy` is not needed.

### 2. New webview window (new `browser.rs`, plus `lib.rs` registration)

Build with `WebviewWindowBuilder` / `WebviewBuilder`, label `phoenix-browser` (chrome) and `phoenix-browser-tab-<n>`
(content), and for each content webview:

| Builder call                                   | Value                                                                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.incognito(true)`                             | macOS: non-persistent data store; Windows: InPrivate (WebView2 ≥ 101.0.1210.39, older does nothing); Linux: see limits                                                   |
| no `.data_directory(..)`                       | nothing written under the app data dir. Phase 96 adds named profiles                                                                                                     |
| `.on_navigation(\|url\| …)`                    | port of `decideNavigation`; **cannot rewrite a URL**, so for an HTTPS upgrade return `false` and call the webview's `navigate` on the https URL                          |
| `.on_new_window(…)`                            | return Deny, or open a tab only after `decideNavigation(…, "new_window")`                                                                                                |
| `.on_download(…)`                              | return `false` until the user has picked a folder in a Phoenix dialog; set `destination` to that folder                                                                  |
| `.on_permission_request(…)`                    | map `PermissionKind` to the policy; return `Allow` only for a granted pair, otherwise **`Deny`, never `Default`** (macOS/Windows `Default` continues the OS prompt flow) |
| `.devtools(false)`, no `initialization_script` | untrusted page gets no Phoenix script                                                                                                                                    |

Also resolve DNS in Rust and run the `classifyHost` rules on the **resolved address**: the TypeScript check sees names only
and cannot stop DNS rebinding (a public name that resolves to `127.0.0.1`).

### 3. Capabilities (`apps/desktop/src-tauri/capabilities/`)

- A new `browser.json` granting only the chrome webview/window (label `phoenix-browser`) the browser commands (new
  `permissions/autogenerated/*.toml` entries for each command, following `pill.json`).
- The content webviews get **no capability file**, and `"remote"` must never list a web origin for them. Check
  `app.withGlobalTauri: true` in `tauri.conf.json`: it makes `window.__TAURI__` present in webviews it applies to, and while
  commands are still gated by capabilities, confirm with a test page that a content webview cannot invoke any command.
  [INFERENCE] I did not run a webview to verify this.
- The chrome UI page needs its own Vite entry (`apps/web/vite.config.ts` lists `index`, `floating`, `island`, `pill`
  inputs; add `browser`) and a local-origin CSP. The CSP in `tauri.conf.json` applies to Phoenix pages only, not to the
  remote content.

### 4. Things Tauri/wry do not give for free

- **Subresource blocking.** `on_navigation` sees top-level and frame navigations only, not scripts, images or XHR. In wry
  0.57 `WebResourceRequested` appears only inside `src/webview2/mod.rs` (internal); I found no public wry/tauri API for
  per-request filtering on any platform. Blocking therefore needs platform-native code reached through `Webview::with_webview`:
  WKContentRuleList (compiled from the rules; `RequestBlocker` rules map onto its JSON format) on macOS, a
  `WebResourceRequested` handler on WebView2, and `UserContentFilter` on WebKitGTK. Until that exists, **no request is
  blocked** and the blocked count is always 0.
- **Third-party cookie blocking** has no Tauri setting. WKWebView and WebView2 have their own tracking prevention; wry exposes
  `cookies()`/`delete_cookie()` only. Treat "third-party cookies off" as unmet until a native setting or a cookie sweep is built.
- **Linux:** wry's `with_incognito` and the `PermissionResponse::Default` behaviour (= Deny) differ from macOS/Windows.
  macOS has no backend for geolocation/notification permission prompts (`PermissionKind` docs), so those cannot be answered
  there.
- **Fingerprinting protection** is whatever each webview ships; Phoenix adds none. The Phase 93 task "document what each
  webview can and cannot do" is therefore only partly done: this section records the API surface checked, not measured
  behaviour of the three engines.
- Find in page, zoom (`set_zoom` exists on the webview) and tab management are native work not started.

### 5. Enforcement port

The Rust port of `decideNavigation`, `classifyHost`, `SitePermissions` and the blocklist (or a loader that compiles the
rules to WKContentRuleList JSON) should be tested against the same vectors as `browser-policy.test.ts`. Use the Public
Suffix List (a Rust crate) instead of the built-in suffix list in `site.ts`.

### 6. Gateway, audit, Fawkes

Side effects the browser can cause (download, form submit, opening a private-network site the user listed, granting a
permission) must go through the permission/tool gateway; `BrowserAuditSink` is the shape of the audit record, not a wired
sink. Page text is untrusted data: `BrowserGuard` never reads page content and nothing here lets page text change a policy
(grants require `userGesture` from Phoenix's own prompt). The "Fawkes in the corner of every tab" task is not started and
needs i18n keys under `apps/web/src/i18n/en/` in all nine locales once any user-visible string exists; none was added
because this slice has no UI.

## Exit criteria

| Criterion                                    | State                                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| Browsing works on macOS; blocking measured   | **Unmet.** No webview, no measurement.                                       |
| Browser data separate from the main browser  | **Unmet.** `webviewSettings` states the contract; nothing creates a webview. |
| Tested navigation/permission/blocking policy | Done as a reference implementation (unit tests, simulated inputs)            |
