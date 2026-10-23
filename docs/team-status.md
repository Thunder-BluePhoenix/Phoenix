<!-- SPDX-License-Identifier: GPL-3.0-or-later -->

# Team status and incoming webhooks (Phase 92)

Two independent features that share one rule: **nothing happens until the user opts in, and untrusted
input is data, never an instruction.**

- `core/runtime/src/team-status/` – the logic. `link.ts` (`TeamLinkService`) wires it to the Phase 87 relay; the rest does no I/O of its own (the clock, secret store, bus, audit log and relay sender are injected).
- `core/api/src/team-webhook-routes.ts` and `core/api/src/team-link-routes.ts` (plus the existing `teamStatusRoutes`) – the HTTP surface.

## Incoming webhooks

A source is a name (`ci-main`), a list of event types it may send, and a secret. The sender POSTs to
`/api/webhooks/in/<source>`.

### Authentication is not the session token

`POST /api/webhooks/in/:source` is the **only** route in this module marked `public`, and "public" means
only that it skips the Core session-token check, because the caller is an external service that must
never hold that token. The route authenticates every request itself:

```
x-phoenix-timestamp: <unix seconds, 10 digits>
x-phoenix-signature: v1=<hex HMAC-SHA256(secret, "<timestamp>." + raw body bytes)>
content-type: application/json
```

An `Authorization: Bearer <session token>` header sent to this route is not read and grants nothing. A
valid signature needs no session token. `signWebhook(secret, timestamp, body)` is the reference
signer. Every other route below (`/api/team/...`) is an ordinary session-token route.

### What is checked, in order

1. **Body size** – at most 16 KiB (`WEBHOOK_BODY_MAX_BYTES`), by `Content-Length` and again while streaming; the connection is dropped with `413`. The signature is over the raw bytes, so there is no re-serialization step to disagree about.
2. **Pre-authentication rate limit** – per claimed source; every unknown source id shares one bucket, so guessing ids neither grows memory nor spends a real source's budget. Costs nothing but a map lookup, before any secret is read.
3. **Opt-in** – the master switch (default **off**) and the per-source switch must both be on. A stored source that does not say `enabled: true` is disabled.
4. **Format** – timestamp is 10 digits, signature is `v1=` + 64 hex.
5. **Replay window** – the timestamp must be within ±5 minutes of Core's clock (`WEBHOOK_WINDOW_SECONDS`). This is checked before the secret is fetched.
6. **Signature** – recomputed from the per-source secret and compared with `timingSafeEqual` on equal-length buffers. The secret comes from the injected `SecretStore` (`team-webhook.<source>`), is 32 random bytes (base64url), and is returned **once**, in the response to creating or rotating the source. It is never in settings, status views, events or the audit log. A stored secret shorter than 32 characters is refused rather than used.
7. **Per-source rate limit** (token bucket, injected clock) – `429` with `Retry-After`.
8. **Strict payload schema** – exactly these keys, nothing else: `event_id` (8–128 of `A-Za-z0-9_.:-`), `event_type`, optional `severity`, `subject` (≤200), `message` (≤280), `data` (≤16 keys, `lower_snake_case`, string ≤200 / finite number / boolean, no nesting). Text may not contain control, line-separator, bidi or zero-width characters. Unknown fields are rejected, not ignored. `source`, `timestamp`, `version`, `data_classification` and every other envelope field are chosen by Core, never by the sender.
9. **Event-type grant** – the type must be one the source was created with, and every type must be in a closed set of namespaces (`build test deploy ci alert monitor release task webhook`). A webhook can therefore never produce `dictation.idle`, `agent.*`, `security.*`, `pet.*`, `stripe.*`, `github.*` and so on.
10. **Dedupe** – `(source, event_id)` is remembered for twice the window. A repeat is `409 EVENT_DUPLICATE`. If the table is full the delivery is refused (`429`) rather than evicting an id that could still be replayed. A delivery refused later (for example by the bus's secret scan) releases its id so the sender can retry the corrected payload.
11. **Publish** – the validated fields become an event on the bus: `source: "webhook-<id>"`, `event_id: "evt_wh_<hash of source+id>"` (so sources cannot pre-empt each other's ids), `data_classification: "internal"`, `metadata.untrusted: true`, `provenance.kind: "incoming_webhook"`. The bus still runs the v1 envelope schema and the no-secrets rule; a body containing a credential-shaped value is `403`.

Authentication failures (steps 3–6, including an unknown source) all answer the same `401 UNAUTHENTICATED "Webhook authentication failed"` with `WWW-Authenticate: Phoenix-HMAC-SHA256`, so a caller cannot tell an unknown source from a disabled one or a wrong secret. (A non-JSON content type or an oversize body is refused with `400`/`413` before any lookup, and says nothing about the source.) Specific errors (`400`, `403`, `409`, `429`) are returned only after the signature verified. The audit log records the real reason (`unknown_source`, `source_disabled`, `bad_signature`, …); refusals are themselves rate limited (5 per minute per source key, with a `suppressed` count) so an unauthenticated flood cannot fill the audit table.

### Managing sources (session-token routes)

| Method and path                                      | Effect                                                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `GET /api/team/webhooks`                             | master switch, sources with their path, types, enabled flag, last accepted time. No secrets. |
| `PUT /api/team/webhooks` `{enabled}`                 | master switch                                                                                |
| `POST /api/team/webhooks/sources` `{id, eventTypes}` | create; `201` with the secret, once                                                          |
| `POST /api/team/webhooks/sources/:id/rotate`         | new secret; the old one stops working immediately                                            |
| `PUT /api/team/webhooks/sources/:id` `{enabled}`     | disable / enable one source                                                                  |
| `DELETE /api/team/webhooks/sources/:id`              | revoke: config removed, dedupe state dropped, secret deleted                                 |

At most 16 sources. Creating, rotating, toggling and revoking are audited with the actor `team-webhooks`.

## Team status

Share a few chosen states with teammates. Off by default; every item is a separate consent.

### Outgoing – `TeamSharing`

- `enabled` (master) is **off** by default and each kind – `deploying`, `agent_run`, `meeting` – is **off** by default. A malformed stored value reads as off.
- States are learned from `deploy.started/succeeded/failed`, `agent_run.*` and `kage.meeting.*` events by **event type and correlation key only; the payload is never read**. Events whose source starts with `webhook-` are ignored, so an incoming POST cannot make me appear to be deploying or in a meeting.
- An agent run is shared only after it has run for 10 minutes ("long agent run"). An activity with no end event stops being shared after 6 hours.
- The unit of sharing is `{kind, since}` with `since` rounded down to the minute. No repository, branch, prompt, meeting title or attendee can be expressed. `view().outgoing` is exactly what a teammate would receive, so the UI can show it before and while sharing.
- Unknown consent kinds are rejected (a typo cannot silently consent).

### Transport – `sealTeamFrame` / `openTeamFrame`

Each update is a separate frame per teammate: ECDH (P-256) + AES-256-GCM to that teammate's pinned public key, using the same sealing primitive as the Phase 87 relay under a distinct domain label (`team-status-v1`), so a relay sees only opaque ciphertext. Sealing alone does not authenticate the sender (anyone can encrypt to a public key), so the plaintext also carries an ECDSA signature over `sender, recipient, body` that is verified against the key pinned for that sender. `TeamStatus.broadcast()` sends via an injected `send(recipientId, frame)`; it sends nothing while sharing has never been on, and one final "not sharing" frame after it is turned off.

### Incoming – `TeamPresence`

A frame is accepted only if the sender is on the **local roster** (id, locally chosen label, pinned key), the signature verifies, the body has exactly the keys `v, sentAt, sharing, items` with closed-set kinds, `sentAt` is within ±2 minutes, and `sentAt` is newer than the last accepted one (replay counter). Failures return a reason with no detail about why decryption or verification failed.

`summary()` aggregates **only** members who are rostered, report `sharing: true` and were heard from in the last 3 minutes. The output is the member id, the **local** label, kinds, minute-rounded starts and per-kind counts – no remote string is ever displayed or interpreted, and a member who is not sharing does not appear at all (not even as "offline"). Removing a member forgets everything they sent.

## How it is wired

**Incoming webhooks:** `PhoenixRuntime` constructs `TeamWebhooks` with the OS secret store (when one is supplied), `CoreServices.teamWebhooks` exposes it, `buildRoutes` registers `teamWebhookRoutes`, `ApiServer` already skips authentication for `route.public`, and `POST /api/events` refuses a `webhook-<source>` source. `core/runtime/test/team-webhooks-wiring.test.ts` drives it through the real server. The privacy inventory lists the sources as `team_webhook_sources`. The web UI creates, lists, enables/disables, rotates and deletes sources (see "Settings section for webhook sources" below); the CORS allow-list needs no change because senders are servers.

**Team presence:** `TeamLinkService` (`core/runtime/src/team-status/link.ts`) constructs `TeamSharing`, `TeamPresence` and `TeamStatus` and uses the [Phase 87 relay](remote-relay.md) as transport with `tm_<12 hex>` addresses (the relay now accepts that peer kind; a team address talks only to team addresses, never to `core` or `dev_…`). Frames are sealed to the recipient and signed by the sender (unchanged `team-status-v1`). It needs a secret store and is absent from the demo runtime (no sockets).

Routes (`core/api/src/team-link-routes.ts` and `teamStatusRoutes`, session token only): `GET/POST/DELETE /api/team/link`, `POST /api/team/link/pause`, `GET /api/team/status`, `PUT /api/team/sharing`, `POST /api/team/members`, `DELETE /api/team/members/:id`.

- **Identity.** The private key is only in the OS secret store (`team-status.private-key`). The roster (id, label, pinned public key) is in settings `team-status.roster`; the link config is in settings `team-status.link`. Privacy row `team_status` (counts roster entries).
- **Roster.** Adding a member whose id is already on the roster is refused (remove first), so a pinned key is never silently swapped. Your own id or key is refused.
- **Inbound.** Frames are rate-limited per sender. Only a rostered sender with a verifying signature is shown. `webhook-*` sources are never observed as the user's status.
- **Kill switch.** It pauses the link and keeps the roster and identity.
- **Leaving** sends a final "not sharing" frame, then forgets identity, route and roster.
- **Heartbeat.** Status is refreshed every 60 s; a member counts as stale after 3 min.
- **Settings section:** see `apps/web/src/components/TeamSettings.tsx`.
- **Settings section for webhook sources:** `apps/web/src/components/TeamWebhooks.tsx` (state in `apps/web/src/core/team-webhooks.ts`, strings in `i18n/*/team-webhooks.ts`), mounted in Settings after team presence. It uses only the existing session-token routes above; no Core route was added. It shows the master switch, each source (name, address path, event types, enabled flag, last accepted time) a per-source Enable/Disable button, a Rotate secret action and a create form. Names and event types are validated client-side with the same rules as Core (`^[a-z][a-z0-9_-]{2,31}$`; 1 to 16 types, each `ns.name` with `ns` in the closed namespace list), and Core still decides: its error text is shown as text. Deleting and rotating ask for confirmation first (rotating breaks the sender until it is given the new secret). The signing secret Core returns when a source is created **or rotated** is shown **once**, in a panel with a Copy button and a plain warning that it cannot be shown again; it is held only in that panel's React state, is not written to storage, the list or any log, is dropped when the panel is closed or its source is deleted, and a reload never brings it back. Only one secret panel can be open at a time: creating is blocked while it is open, and a second rotate replaces the panel's contents (the earlier secret is gone from the page). A rotated secret uses the same panel, Copy button and warning, plus a note that the old secret has stopped working (Core's `rotateSecret` replaces it immediately). The Enable/Disable button sends `PUT /api/team/webhooks/sources/:id` with exactly `{"enabled": <bool>}` and the row shows what Core's response says (no optimistic update); a disabled source is labelled Disabled with a note that Phoenix refuses everything sent to it. Core errors from either action are shown as text. Source names, paths and types come from Core and are treated as untrusted: hidden/bidi/control characters are removed and the result is bounded and rendered as React text, never HTML. The nine non-English locales of this section are machine-translated and unreviewed. Tests: `apps/web/test/team-webhooks.test.tsx` (simulated Core via `fakeApi`; no real browser, Core or sender).
- **Tests.** `core/runtime/test/team-link-wiring.test.ts` (10) runs two real Cores through a real `createRelayServer` on loopback.

**Still not done:** a pairing flow beyond copying the id and public key by hand; any real teammate or relay host; relay `write()`-false backpressure beyond the test seam. Webhook dedupe and rate-limit state is still held in memory only and is lost on a Core restart.

## Limitations and unmet exit criteria

- **"Two Phoenix installs see each other's shared state" is only shown on loopback**: two real Cores exchange sealed, signed frames through a real `createRelayServer` in tests (`team-link-wiring.test.ts`). No second machine, no real relay host and no pairing/roster exchange UI was involved.
- **"A webhook from a real service drives Fawkes" is not met.** The tests POST locally signed requests to the route handlers over loopback HTTP and check the event reaches an `EventBus` subscriber. No real third-party service signs with `x-phoenix-signature` (real services use their own header schemes; an adapter or a small forwarder would be needed), and Fawkes' state engine was not run.
- The signature scheme is Phoenix's own (`v1=` HMAC over `timestamp.body`), not GitHub's or Stripe's.
- Replay and dedupe state is in memory: a Core restart forgets event ids, so a captured delivery can be replayed for the rest of its 5 minute window after a restart. The pre-auth and per-source rate limits also reset.
- The rate-limited audit means a sustained flood is summarized, not individually recorded.
- Roster exchange is by hand (copy the member id and public key). The `tm_` relay addressing is tested on loopback only.
- Webhook events are untrusted: they appear on the bus and in the activity feed like any event, but downstream consumers must keep treating `metadata.untrusted` events as data.
- Web UI for webhook sources does not exist. Team presence has no pairing flow; see the Settings note above.
