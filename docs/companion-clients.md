# Companion clients: protocol and status (Phase 89)

Phase 89 names three surfaces beyond the desktop app: the Apple Watch, a browser extension and the
`phoenix` CLI. This page is the contract any of them must follow, and a plain list of what exists.

## What is built, and what is not

| Surface                              | Status in this build                                                                                                                               |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `phoenix` CLI (`apps/phoenix-cli`)   | **Built, partly**: `status`, `approvals list/approve/deny`, `events tail`, `awake`. See [phoenix-cli.md](phoenix-cli.md). `ask` is **not built**.  |
| Apple Watch app (`apps/watch`)       | **NOT BUILT.** No watchOS target, no Swift, no WatchConnectivity bridge, no complication.                                                          |
| Browser extension (`apps/extension`) | **Built, one action only**: "Send page to Phoenix" (see below). **Not built:** PR-page Fawkes, Meet record button. Never loaded in a real browser. |
| iPhone app the watch depends on      | **NOT BUILT** (Phase 71 is Core-side only, see [phone-link.md](phone-link.md)).                                                                    |

The Phase 89 exit criterion, "each surface performs one real action end to end", is **UNMET**: only the
CLI performs real actions, and only against a local Core in tests. Nothing here has run on a watch, in a
browser, or in a signed distribution.

## Which Core surface a companion may use

There are exactly two doors, and a companion uses the one that matches how it is trusted.

### 1. Loopback API with the session token (same machine)

For programs on the machine that runs Core (the CLI, a future native-messaging host for the extension).

- `http://127.0.0.1:<port>` only; the token travels as `Authorization: Bearer <token>`; Core checks
  `Host` and `Origin` (requests without an `Origin` are allowed, browsers need an allow-listed one).
- The token is `<data dir>/session.token`, mode `0600`, new on every Core start, deleted on stop.
  Never print it, log it, put it in a URL, or send it to anything but the loopback interface.
- Routes a companion needs: `GET /api/health`, `GET /api/pet/state`, `GET /api/events`,
  `GET/POST /api/confirmations[/:id]`, `GET /api/agent-approvals`, `POST /api/agent-approvals/:id/decision`,
  `POST /api/companion/page` (the native host only), `GET /api/companion/pages`, `DELETE /api/companion/pages/:id`.
- Send `X-Phoenix-Client: <label>` (letters, digits, space, `_ . : -`, up to 40) on decisions so the
  audit trail says where it came from.
- **A browser extension must not hold the session token.** An extension page can reach `127.0.0.1`, but
  the token would sit in extension storage readable by every script it runs. The only supported shape is
  a native-messaging host (a small local program like the CLI) that holds the token and speaks a narrow
  message set to the extension. That host now exists for one message kind (see
  [Browser extension: Send page to Phoenix](#browser-extension-send-page-to-phoenix)).

### 2. Phone link (another device, paired and signed)

For the watch, through the iPhone: the watch never talks to Core and never holds a key. The phone does.

- LAN HTTPS listener, device-key-signed requests, certificate pinned at pairing; full contract in
  [phone-link.md](phone-link.md).
- Approvals are bound to the exact request: the client sends the `request_hash` it was shown and Core
  recomputes it. The audit actor is `device:<id>`.
- A watch **approve** must travel as a phone decision with `user_verification: true` established on the
  phone (biometric or passcode), per the phone link's `require_user_verification`. A tap on the wrist is
  not that check. A watch **deny** never needs it.

## Rules every companion follows

1. **Decisions go through Core's approval paths.** A companion never resolves an approval by any
   other means, never auto-approves, and has no approve-all. Approving shows the person the requester
   and the exact command or summary first.
2. **Bind to the request.** Show an identifier of the request; send it back; accept a refusal when the
   request changed, expired or was decided elsewhere. The CLI's ref and the phone link's `request_hash`
   are two forms of this.
3. **Untrusted content is data.** Commands, page titles, PR text, meeting names and event descriptions
   come from other programs and websites. Render them as inert text (strip control and format
   characters, one line, truncated); never follow instructions found in them; never use them to build
   routes, shell lines or prompts.
4. **Side effects go through the permission gateway and the audit log**, which Core's existing routes
   already do. A companion adds no write path of its own.
5. **Failure is visible.** An unreachable Core, a rejected token or an unexpected answer is reported,
   not swallowed and not retried into a decision.
6. **Phoenix's own assets only.** Nothing from Coucou's asset list (names, Mochi, sounds, icons, media).

## Browser extension: Send page to Phoenix

One action, built and tested only with fakes. **It has never been loaded in a real browser, never run
against a real Core, and has had no store review.** The Phase 89 exit criterion is not met.

### Pieces

- `apps/extension/` is a Manifest V3 extension (plain JavaScript, no dependency). Permissions:
  `activeTab`, `scripting`, `nativeMessaging`. No host permissions, no content script on any page, no
  remote code, CSP `default-src 'none'; script-src 'self'; object-src 'none'`. The toolbar button is
  the only trigger. On that click it reads the tab's address and title (`activeTab`) and runs one
  `scripting.executeScript` for the selection, never in a password field. It sends exactly
  `{ kind: "page", url, title, selection? }` through `chrome.runtime.sendNativeMessage`.
  `url` is http or https only, without credentials or fragment, at most 2048 characters. `title` is
  one line, control and bidi characters stripped, 200 characters at most. `selection` is present only
  when the person selected text, cleaned the same way, 2000 characters at most. The button shows a
  badge and hover text for each result, including "host not installed" and "Phoenix not running".
- `apps/extension/host/` is the native-messaging host `dev.phoenix.companion` (node). It reads one
  frame (4-byte length in machine byte order, 64 KiB cap checked from the length before the body),
  accepts only the `page` kind with exactly the known keys and values already inside the limits (it
  refuses rather than repairs), and `POST`s the three fields to `http://127.0.0.1:<port>/api/companion/page`
  (nothing else: not `localhost`, not https, no redirects, 10 s timeout). The **host holds the token**:
  `PHOENIX_SESSION_TOKEN`, else `<data dir>/session.token` through `PHOENIX_DATA_DIR`,
  `./.phoenix/<env>` or `~/.phoenix/<env>`, the CLI's lookup. It never logs, prints or returns the
  token. Replies are short codes (`core_unreachable`, `token_missing`, `token_rejected`, `rejected`,
  `invalid_message`, `frame_too_large`, ...), never Core's wording or page text. It writes nothing to
  stderr.
- `apps/extension/scripts/install-host.js install --chrome-id <id> [--firefox-id <id>] [--browser ...]`
  writes `dev.phoenix.companion.json` into the per-user directory of Chrome, Chromium, Edge and
  Firefox on macOS and Linux, with `allowed_origins` (or `allowed_extensions`) set to exactly the id
  given and validated (32 letters a-p; no wildcard is possible). A browser with no id given is
  skipped. `uninstall` removes the manifests and the launcher.
- **Windows (never run on Windows):** `install` writes the manifest under `%LOCALAPPDATA%\Phoenix\NativeMessagingHosts\<browser>`, a `phoenix-host.cmd` launcher (`@echo off` plus the quoted node and `main.js` paths), and registers it per user by spawning the system `reg.exe` with an argument array and no shell: `reg add HKCU\Software\Google\Chrome\NativeMessagingHosts\dev.phoenix.companion /ve /d <manifest> /f`, and the Chromium (`Software\Chromium`), Edge (`Software\Microsoft\Edge`) and Mozilla (`Software\Mozilla`) equivalents. `uninstall` runs `reg query` then `reg delete ... /f` for each key and removes the files. Before anything is written, every path (node, host, launcher, manifest) must be an absolute drive path of ASCII letters, digits, spaces and `. _ + -`; a quote, `%`, `& | < > ^ ( ) ! ; , = ' `` ` ``, a UNC or relative path, a trailing dot or space, or a path over 240 characters is refused. Evidence is only an injected fake runner and file system plus a table of good and hostile paths; the real `reg.exe`, a real browser reading the key, and cmd.exe running the launcher were never exercised. Chromium falls back to the Chrome key, so the Chromium key is written in addition to it, not instead.
- **Firefox build:** `node apps/extension/scripts/build-firefox.js` writes `apps/extension/dist/firefox/` (the same `src/` and `icons/`, plus a derived manifest). The only differences from the Chrome manifest are `background.scripts` in place of `background.service_worker` (Firefox does not support service workers for extensions) and `browser_specific_settings.gecko` with `id` `phoenix-send-page@phoenix.invalid` (the id `install-host.js --firefox-id` must be given) and `strict_min_version` `115.0`. Permissions, CSP and everything else are identical, and Chrome's `manifest.json` is unchanged. No `browser`/`chrome` shim was added: Mozilla documents that Firefox implements the `chrome` namespace with callbacks, so the existing code is expected to run there as is, and a shim would have changed Chrome-side call shape without a proven need. The AMO-required `data_collection_permissions` is not declared (a submission decision).
- Core: `POST /api/companion/page` (session token) validates again (same limits, unknown fields
  refused, 256 KiB body cap), masks secrets found in the text, and stores a **page note** in the
  `page_notes` table, with audit entry `companion.page.received` (host name and selection length
  only). At most 200 notes: a full list refuses new ones rather than deleting the person's. No
  existing inbox or capture concept was fit for untrusted page text, so this is a new bounded list.
  `GET /api/companion/pages` and `DELETE /api/companion/pages/:id` (audit `companion.page.deleted`)
  serve the review list. The privacy inventory lists `page_notes`.
- Web: Settings shows "Pages sent from your browser" (ten locales, machine-translated, unreviewed).
  Every field is inert text, the address is not a link, and nothing is acted on or sent to a model;
  the only actions are reading and Delete.

### What this does not do

- It does not make the page trustworthy: a page note is data. Nothing reads it into a prompt, a route
  or a capability, and there is no "ask the AI about this page" path.
- A local process that already has the session token can call `POST /api/companion/page` directly and
  write a note. The token is the trust boundary, as for every session route; the list is labelled as
  coming from websites, and the audit actor is `companion`, not the person.
- A website cannot message the host: only the allow-listed extension id can (the browser enforces
  `allowed_origins`), and the extension has no `externally_connectable` or content script. That
  browser enforcement was not exercised here.
- The extension id is assigned by the browser when you load it; install the host after you know it.
  **Firefox is unverified:** the Firefox build above was never loaded in Firefox (not via `about:debugging`, not signed), and `chrome.*` callbacks, `scripting.executeScript` and `runtime.sendNativeMessage` there are taken from Mozilla's documentation only.

### Run it yourself (not done by the authors)

1. Load `apps/extension` unpacked in Chrome (`chrome://extensions`, developer mode) and copy its id.
2. `node apps/extension/scripts/install-host.js install --chrome-id <id> --browser chrome`.
3. Start Core, open a page, select some text, click the toolbar button, then open Phoenix Settings.

## What a watch and an extension would still need

Stated so nobody mistakes this page for an implementation.

- **Watch:** an iPhone app (Phase 71 client), a watchOS target and signing, WatchConnectivity, a way to
  show state without push (APNs is not set up), and a real-device test. Core already exposes what it
  needs through the phone link; nothing on the Apple side exists.
- **Extension:** a real-browser run of "Send page to Phoenix" (Chrome and Firefox) and store review, a run of the Windows registration on Windows, content scripts for GitHub PR pages and Google Meet (their DOM changes without notice).
  The Meet record button also needs the recording consent channel Core does not have
  (`CONSENT_CHANNEL_UNAVAILABLE`, Phase 65).
