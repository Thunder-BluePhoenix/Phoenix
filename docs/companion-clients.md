# Companion clients: protocol and status (Phase 89)

Phase 89 names three surfaces beyond the desktop app: the Apple Watch, a browser extension and the
`phoenix` CLI. This page is the contract any of them must follow, and a plain list of what exists.

## What is built, and what is not

| Surface                              | Status in this build                                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `phoenix` CLI (`apps/phoenix-cli`)   | **Built, partly**: `status`, `approvals list/approve/deny`, `events tail`, `awake`. See [phoenix-cli.md](phoenix-cli.md). `ask` is **not built**. |
| Apple Watch app (`apps/watch`)       | **NOT BUILT.** No watchOS target, no Swift, no WatchConnectivity bridge, no complication.                                                         |
| Browser extension (`apps/extension`) | **NOT BUILT.** No manifest, no content scripts, no PR-page Fawkes, no Meet record button, no "send page to Phoenix".                              |
| iPhone app the watch depends on      | **NOT BUILT** (Phase 71 is Core-side only, see [phone-link.md](phone-link.md)).                                                                   |

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
  `GET/POST /api/confirmations[/:id]`, `GET /api/agent-approvals`, `POST /api/agent-approvals/:id/decision`.
- Send `X-Phoenix-Client: <label>` (letters, digits, space, `_ . : -`, up to 40) on decisions so the
  audit trail says where it came from.
- **A browser extension must not hold the session token.** An extension page can reach `127.0.0.1`, but
  the token would sit in extension storage readable by every script it runs. The only supported shape is
  a native-messaging host (a small local program like the CLI) that holds the token and speaks a narrow
  message set to the extension. That host does not exist.

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

## What a watch and an extension would still need

Stated so nobody mistakes this page for an implementation.

- **Watch:** an iPhone app (Phase 71 client), a watchOS target and signing, WatchConnectivity, a way to
  show state without push (APNs is not set up), and a real-device test. Core already exposes what it
  needs through the phone link; nothing on the Apple side exists.
- **Extension:** a manifest and store review, a native-messaging host holding the token, content scripts
  for GitHub PR pages and Google Meet (their DOM changes without notice), a consent path for "send page
  to Phoenix" that treats the page as untrusted data, and a Core route to receive a page, which does not
  exist. The Meet record button also needs the recording consent channel Core does not have
  (`CONSENT_CHANNEL_UNAVAILABLE`, Phase 65).
