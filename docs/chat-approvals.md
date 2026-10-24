# Chat approvals (Phase 86)

Answer a pending agent or Phoenix approval from **Slack** or **Discord**, and get notified in **Teams**.
Package: `capabilities/chat-approvals` (`@phoenix/capability-chat-approvals`, capability id
`chat-approvals`). Builds on the audited path of [Phase 56](phases/phase-56-agent-approvals-from-fawkes.md)
and the request binding of [phone-link.md](phone-link.md) / [remote-relay.md](remote-relay.md).

**Simulated evidence only.** Every test uses signed fake callbacks and an injected HTTP transport or a
loopback server. No Slack workspace, Discord application or Teams tenant was contacted. The capability
is now wired into Core (see [How it is wired](#how-it-is-wired)), but only exercised through a running
Core with fakes. **The exit criterion "a real agent request is approved from Slack" is UNMET.**

## Security model

A chat provider cannot sign with a Phoenix device key, so **a button press is not authority by itself**.
A press only decides if all of this holds, checked in this order (`src/binding.ts`):

1. **Provider authenticity.** The provider's own scheme, verified on the raw bytes _before_ the body is
   parsed, with constant-time comparison:
   - Slack: HMAC-SHA256 `v0=` over `v0:<timestamp>:<body>` with the signing secret; timestamp within
     ±5 minutes.
   - Discord: Ed25519 over `<timestamp><body>` with the application public key; Core applies the same
     ±5 minute window (Discord itself publishes none).
   - A signature is remembered for the window and **refused the second time** (replay).
2. **Provider on and workspace matches.** Slack team id / Discord guild id must equal the configured one.
3. **Owner identity.** The provider user id must be in that provider's explicit `approvers` allow-list. An
   empty list means nobody, and no card is generated.
4. **Single-use token.** The button value is a random 128-bit token held in memory as a SHA-256 digest,
   bound to provider, channel, request and hash, expiring at the earlier of `token_ttl_seconds`
   (default 300) and the request's own expiry. Consumed before anything else can fail. A token from
   another provider or channel is refused. Nothing survives a restart.
5. **Allow is a two-step.** Allow answers with a confirm step (Yes / Cancel) whose tokens are bound to the
   _same person_. Deny decides at once; Cancel decides nothing and kills the Yes token.
6. **Bound to the exact request.** The `request_hash` Core computes (`requestHash()` in `phone-link.ts`:
   source, id, tool, preview hash, expiry) is stored with the token. At decision time the request is
   looked up again; if it is gone, expired, switched off for chat, or its hash differs, the press is
   refused. The host's `decide` must repeat the hash check.
7. **Audited path.** The host calls the same `PermissionGateway.resolveConfirmation` /
   `AgentApprovals.decide` the phone link uses, with actor `chat:<provider>:<user>`. This package also
   writes `chat.approval.decided` (allowed/denied), and `chat.approval.refused`, `chat.callback.refused`
   (bad signature; no user known), `chat.approval.confirm_requested`, `chat.approval.cancelled`.
   Refusal rows are capped at 20 a minute.

### Per-project switch (default OFF)

`projects: ["alpha", …]` lists the projects whose agent approvals may be answered from chat; Phoenix's own
confirmations (no project) need `phoenix_confirmations: true`. It is enforced **before a card is
generated** and **again on every press**, against live config, so switching a project off kills
outstanding buttons. Requests not switched on get no card; with `notify` on, a provider gets one generic
line ("an approval is waiting") with no title, tool or project.

### What a card shows

Tool name, project, a title cleaned once by `sanitizeText`: hidden characters (`HIDDEN_TEXT_CHARS`, the
same pattern as `agent-approvals.ts`, pinned by a test) become spaces, key-shaped runs and `Bearer …`
are replaced, clipped to 80 code points. Never the preview, arguments tail, hash or any secret. Slack gets
`plain_text` blocks (no mentions/formatting); Discord has `allowed_mentions.parse = []` and markup
characters stripped.

### Secrets

Only through `ctx.secret(name)`: `slack_bot_token`, `slack_signing_secret`, `discord_bot_token`,
`discord_public_key`, `teams_webhook_url`, `teams_link_key`. Config schema has no credential field and
the capability manager rejects secret-looking config. Least privilege: Slack bot needs only
`chat:write`; Discord bot only Send Messages. The bot token goes only to the provider's fixed API URL.

## Teams: notify-only (stated plainly)

Teams authenticates button callbacks with a bearer JWT validated against Microsoft's published keys
(a network fetch of OpenID metadata). That cannot be done honestly offline, and an unverified callback
would be a forged approval. **Teams therefore has no inbound path and no Allow/Deny button.** A Teams card
carries the sanitized title and an **Open in Phoenix** link `phoenix://approvals/open?s&i&h&e&m` signed
by Core (HMAC-SHA256 under `teams_link_key`, bound to source, id, request hash and expiry). Opening it
(`openTeamsLink`) verifies the signature, expiry, that the request is still pending, switched on and
unchanged, then **shows** it. The decision is made inside Phoenix by the existing desktop path under the
person's own actor. The webhook URL is a credential and must be https on a Microsoft webhook host.
The desktop shell now registers and handles `phoenix://approvals/…` (see
[The `phoenix://` handler](#the-phoenix-handler)); the shell does **not** call `openTeamsLink` (it holds no
Core secret), so a Teams link's signature is not checked by the shell, only the link's shape.

## Notifications and digests (opt-in)

Per provider `notify` (generic notice for requests not on for chat) and `digest` (counts only; project
names only for projects switched on). Both default off. Commands `post_pending` and `post_digest` are
`external` side effects and confirm every time.

### Scheduled digest (opt-in, default off)

Config `digest_schedule: { enabled, interval_minutes, quiet_hours }`, **off by default**, and sent only to
providers whose own `digest` switch is also on. The destination is the already configured, ID-validated
channel (Slack channel id, Discord channel id, Teams webhook) through the same transport host allow-list
as a card; **there is no DM destination** (only the configured channel id is ever used). It adds no new
recipient and no new credential.

- **Content** (`formatDigest`, `src/digest.ts`): counts of pending and decided approvals since the last
  digest, plus up to 5 pending approvals named by short id and action (tool) name, only for projects
  switched on for chat. Ids and action names are cut to `[A-Za-z0-9_-]`, so no URL, mention, markup or
  hidden character can ride along. Never a title, request body, path, command, project name, secret or
  agent output. At most 600 characters, control characters stripped.
- **Schedule** (`tickDigest`, driven by Core's 5-minute timer in `ChatApprovalsService`): at most one per
  interval (minimum 60 minutes, default 24 hours), the first check after switching on only starts the
  interval, nothing is sent in quiet hours (it waits for the next check; an unknown time zone or bad time
  counts as quiet), nothing is sent when nothing was decided and no new request is pending. A failed send
  still uses up the interval. The time of the last attempt is kept in the settings store
  (`chat-approvals.digest.last`, a single number).
- **Counting** uses only the `outcome` word of `agent.approval.resolved` and
  `security.confirmation.resolved`; counts live in memory and are lost on restart.
- **Audit:** every send attempt records `chat.digest.sent` (actor `chat:scheduler`; provider names and
  counts only). The timer does nothing while the capability is disabled or the kill switch is on.
- The manual `post_digest` command (confirmation-gated) is unchanged.

## The `phoenix://` handler

macOS: `Info.plist` declares `CFBundleURLTypes` for the scheme `phoenix` and Tauri delivers an opened URL
as `RunEvent::Opened` (no plugin, no new crate; the official deep-link plugin is not in `Cargo.lock`).
`apps/desktop/src-tauri/src/deeplink.rs` accepts only `phoenix://approvals/<id>` (`[A-Za-z0-9_-]{1,64}`)
and the Teams form `phoenix://approvals/open?…` (query never read), lowercase scheme and host, no userinfo,
port, fragment, escapes, extra segments or non-ASCII. The id is dropped and the shell opens the **fixed**
route `/panel/overview` (where pending approvals are listed) in the browser through the same
`open_in_phoenix` seam. Nothing from the URL is executed, fetched or forwarded and the link decides nothing.
Only the first URL of an event is considered. Windows and Linux have no handler (they would need the
deep-link plugin or single-instance argv handling). It was **not** tried with a real macOS URL open or an
installed bundle: the tests are a pure parser test, a check that `Info.plist` declares the scheme, and a
lifecycle test with Tauri's mock runtime calling `open_links`.

## Configuration

```jsonc
{
  "projects": ["alpha"],
  "phoenix_confirmations": false,
  "token_ttl_seconds": 300,
  "slack": {
    "enabled": true,
    "workspace": "T…",
    "channel": "C…",
    "approvers": ["U…"],
    "notify": false,
    "digest": false,
  },
  "discord": {
    "enabled": true,
    "workspace": "<guild id>",
    "channel": "<id>",
    "approvers": ["<user id>"],
  },
  "teams": { "enabled": true, "notify": false, "digest": false },
  "digest_schedule": {
    "enabled": false,
    "interval_minutes": 1440,
    "quiet_hours": { "timezone": "UTC", "start": "22:00", "end": "07:00" },
  },
}
```

## How it is wired

`createChatApprovals({ host, audit, transport, now?, config? })` is constructed by the runtime
(`core/runtime/src/chat-approvals/{index,service}.ts`). The capability `chat-approvals` is registered
(installed, **disabled**) and is absent from the demo runtime (no sockets).

- **Callback route.** `POST /api/chat-approvals/callback/:provider` (`slack` or `discord`) in
  `core/api/src/chat-approval-routes.ts`. It is a **public** route: it is authenticated by the provider
  signature, not the session token. The raw body bytes and headers go to `handleCallback`; the body is
  read by the shared bounded reader `core/api/src/raw-body.ts`. It answers 503 while the capability is
  disabled or the kill switch is on.
- **Posting cards.** A bus subscription on `security.confirmation.requested` and
  `agent.approval.requested` posts a card for projects the user switched on.
- **Decisions.** They reuse the phone link's `requestHash`/`previewHash`, the actor
  `chat:<provider>:<user>`, single use, expiry and the confirm step, through the same gateway and
  `AgentApprovals` path.
- **Outbound transport.** No redirects; https POST only to `slack.com`, `hooks.slack.com`,
  `discord.com` and Teams webhook hosts; 15 s timeout; 64 KiB response cap.
- **Privacy.** The stored config is listed as privacy row `chat_approvals_config`.
- **Tests.** `core/runtime/test/chat-approvals-wiring.test.ts` (7, real running Core, guards
  mutation-checked) and `chat-approvals-service.test.ts` (3); digest: `capabilities/chat-approvals/test/digest.test.ts`
  (13) and `core/runtime/test/chat-approvals-digest.test.ts` (3); handler: `deeplink.rs` unit tests (7) and
  `apps/desktop/src-tauri/tests/lifecycle.rs` (one case). All simulated.

## Still not done

- A `phoenix://` handler on Windows and Linux, and any run against a real macOS URL open; the handler does
  not call `openTeamsLink` and does not select a particular approval.
- Teams inbound approval (Teams stays notify-only).
- A real Slack/Discord workspace; DM digests (only the configured channel is used); a Settings UI for
  `digest_schedule` (it is config only).
- A UI to enter the secrets.

## Limitations

- No real Slack/Discord/Teams contact; payload shapes follow the providers' documented formats from
  memory and are **unverified against live APIs**.
- Replay memory and tokens are in-process, so a restart forgets them (tokens die; a captured signed
  request would pass the 5-minute window again if it is replayed _after_ a restart, but its token is gone).
- Slack `response_url` follow-ups and Discord interaction replies are not retried; a lost reply leaves the
  old buttons visible (they are dead server-side).
- `host_refused` hides the host's reason; Core's own audit row has it.
- No Slack/Discord app manifest, OAuth install flow, rate-limit handling or DM mode.
- Approvals that are questions (not permissions) are out of scope; chat cannot answer them.
