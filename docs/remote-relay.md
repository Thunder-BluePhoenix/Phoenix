# Remote access relay (Phase 87)

Lets a paired phone answer Phoenix's pending approvals when it is not on the home network, through a
relay that **cannot read, forge or replay** anything. Two parts: `relay/` (the forwarder, `node:http`
only, package `@phoenix/relay`) and `core/runtime/src/remote-relay/` (Core's client, the
device-side protocol and the shared crypto).

**Simulated evidence only.** Everything below was exercised with a Node fake device and a relay on
`127.0.0.1`. No phone, mobile network, hosted instance or container image was involved (see
[What is not built](#what-is-not-built)). Core's side is now wired into the runtime (see
[How Core is wired](#how-core-is-wired)); that wiring is tested against a real `createRelayServer` only.

## Trust model

| Party                      | Trusted for                                 | Can see                                                             |
| -------------------------- | ------------------------------------------- | ------------------------------------------------------------------- |
| Core                       | everything: it owns the approval gateway    | plaintext decisions, after verifying them                           |
| Paired device              | speaking for itself, with its own P-256 key | Core's signed messages                                              |
| Relay (self-hosted/hosted) | delivering bytes, nothing else              | route id, peer address (`core` / `dev_…` / `tm_…`), frame size/time |
| Anyone on the Internet     | nothing                                     | only what the relay URL space exposes                               |

The relay is **untrusted** and **stateless**: no queue, no key, no device roster, no log, no
persistence. It imports only `node:http` (a test pins this). A post with nobody listening is refused
(`503`) so the sender knows it was not delivered; a late listener gets nothing.

## Keys are pinned at pairing

Pairing is the [phone link](phone-link.md) pairing (code + desktop confirmation). Core's relay
identity (`newCoreIdentity()`: P-256 key pair; the private key lives only in the OS secret store, never
in settings) is given to the device at pairing and **pinned** by it; Core pins the device's SPKI (the
`paired_devices` row). The relay never participates in key exchange, so it cannot substitute a key.
The 128-bit random route id is an address, **not** an authenticator.

## Wire format

Every frame the relay forwards is `{sender, ephemeral_key, iv, ciphertext, tag}` and nothing else
(the relay rejects extra fields, non-base64 fields, wrong `iv`/`tag` lengths, oversize bodies at
32 KiB, non-JSON content types, and wrong direction: Core → `dev_…` and `dev_…` → Core only; a team
address `tm_<12 hex>` may talk only to other team addresses and never to `core` or `dev_…`).

- **Encryption** (`crypto.ts`): per-message ephemeral P-256 ECDH to the recipient's pinned key →
  HKDF-SHA256 (salt = `sha256(route)`, info binds sender and recipient) → AES-256-GCM. The AAD binds
  route, sender, recipient and the ephemeral key, so a frame cannot be moved to another route,
  recipient or sender.
- The frame is anonymous on its own (the recipient's key is public). Authenticity comes from the
  signature **inside** it.

### Device → Core: reuses the phone-link signing, unchanged

The sealed plaintext is `{device_id, timestamp, nonce, signature, body}` where `signature` is
ECDSA-P-256-SHA256 over `signedRequestText(deviceId, "POST", "/remote/v1/decision", timestamp,
nonce, body)` (the same `PHX1` text, imported from `phone-link.ts`, so the two transports cannot
drift). `body` is exactly the phone-link decision `{id, source, decision, request_hash,
user_verification}`.

Core (`RemoteRelayClient.accept`) refuses, in order, and audits each refusal as
`relay.decision.refused` (device id and reason only, at most 20 rows a minute):

1. unknown or **revoked** device (read from the device store on every frame: revocation takes effect
   on the very next frame);
2. a frame that does not decrypt under Core's key for this route;
3. malformed fields; a timestamp more than 60 s from Core's clock;
4. a bad signature (any edit of the hash, id, decision or verification claim, or another key);
5. a **replayed nonce** (`replay.ts`: remembered for twice the signature window so a future-dated
   stamp cannot be replayed at the window edge; 4096 in total, 200 per device, so one device cannot
   exhaust the table; claimed only **after** the signature verified so a forger cannot burn a real
   device's nonces).

Only then is the decision passed to `PhoneDeviceApi.decide`: the same function the LAN listener
calls. It recomputes the request hash from the request as it exists **now** and refuses on any
difference, expiry or missing user verification, and resolves through
`PermissionGateway.resolveConfirmation` / `AgentApprovals.decide` with actor `device:<id>`, writing
`phone.approval.decided` (see [phone-link.md](phone-link.md#approvals-bound-to-the-exact-request)).
**Every remote decision is therefore audited by the existing path**; the relay adds no second path
that could skip it.

### Core → device

`pushApprovals(deviceId)` sends the approvals list (with each `request_hash`) and `sendToDevice`
any payload. Core wraps it in `{timestamp, nonce, signature, payload}`, signed with its relay
identity (`phoenix-relay-core-v1`, route + device bound). `RemoteRelayDevice.readCore` accepts it only
if the **pinned** Core key signed it, it is fresh (±60 s) and its nonce is new. Without this a
hostile relay could seal a fake "approve this harmless thing" list to the device's public key.
Core refuses to send to a revoked or unknown device.

## Running the relay

```ts
import { createRelayServer } from "@phoenix/relay";
createRelayServer().listen(8787, "0.0.0.0"); // behind your own TLS terminator
```

Routes (all other paths/methods: `404`): `GET /v1/routes/<32 hex>/peers/<core|dev_12hex|tm_12hex>`
opens a server-sent-event stream (4 per peer, 256 total; keep-alive every 20 s);
`POST` the same path with `application/json` delivers one frame to the open streams (`202`).

Core's client requires `https:` (plain `http:` only for loopback), no credentials, query or hash in the URL.
TLS to the relay protects metadata only; the payload protection does not depend on it.

## Self-hosting

`relay/` has no dependencies and no state, so any Node ≥ 22 host works: `tsx relay/src/...` under a
TLS terminator, or a container whose command starts `createRelayServer()`. **No Dockerfile or hosted
instance is shipped in this build.** The exact blocker is under [Why there is no Dockerfile](#why-there-is-no-dockerfile).

### Why there is no Dockerfile

A Dockerfile was deliberately **not** added, because a correct one cannot be written from what is in
the repository, and the Docker daemon is not available here to check a guess:

- `relay/` has **no entry point**. `relay/src/server.ts` only exports `createRelayServer()`; nothing
  reads a port or host and calls `listen()`. A container needs a command, so one would have to be
  written first (and then decided: environment variable names, bind address, graceful shutdown).
- The package is TypeScript source with **no build step** (`exports` points at `./src/server.ts`; no
  `dist/`). A plain Node image can run it only through `tsx` (a root `devDependency`, not a dependency
  of `@phoenix/relay`) or Node's type stripping. `.nvmrc` pins only the major (`22`), and `engines` is
  `>=22.13`; whether type stripping runs without a flag depends on the minor version, so the image
  would have to pin one that was never tried (type stripping is on by default only in later 22.x
  releases).
- The server has **no health route** (every other path is `404`), so a `HEALTHCHECK` could only probe
  the stream route, which is not a health check.

Until a start script and a build or runtime choice are made and tested with a real daemon, the
supported way to host it is the `tsx` one-liner above under your own TLS terminator.

## What the relay can still do

It sees route id, which peer, frame size and timing, and can drop, delay or duplicate frames
(duplicates die at the replay window). It can deny service. It cannot read, alter, forge, redirect
across routes, or replay a decision, and a device it does not control cannot be impersonated.

## Tests

`relay/test/server.test.ts` (forwarding, isolation, no storage, direction, caps, SSE-injection
guard, imports pinned to `node:http`) and `core/runtime/test/remote-relay.test.ts` (end-to-end
through a real loopback relay and a real `PhoneLink`): approve and deny reach the gateway and the
audit log; the wire carries no plaintext (request text, hash, decision, tool name, field names);
revoked/unknown devices are refused, audited, and cannot be sent to; replayed frames and reused
nonces, stale/future stamps and per-device capacity; a hash from another request, an edited
body or another key are refused with the request left pending; frames do not open under another
route/recipient/bit-flip; a device rejects unsigned/forged/late/replayed Core messages. The `tm_`
direction rule is covered in `relay/test/server.test.ts`. The runtime wiring is covered by
`core/runtime/test/remote-relay-wiring.test.ts` (8, against a real `createRelayServer`).

## How Core is wired

`RemoteRelayService` (`core/runtime/src/remote-relay/service.ts`) owns Core's side; shared stream helpers
are in `core/runtime/src/remote-relay/stream.ts` (SSE reader, a reconnect loop with 1 s → 60 s backoff,
and `relayUrl` validation). It is also the transport for [team presence](team-status.md).

- **Routes** (`core/api/src/remote-relay-routes.ts`, session token only): `GET`, `POST` and `DELETE
/api/remote-relay`, and `POST /api/remote-relay/devices/:id/approvals`.
- **Enabling** validates the URL (https, or http on loopback; no credentials, query or hash), creates a
  random route id and Core's relay identity. It resumes on boot.
- **Private key.** Stored only in the OS secret store under `remote-relay.core-private-key`; never in
  settings and never in any response. It is discarded on disable, on the kill switch (bus hook) and when
  a new route is enabled.
- **Secret store required.** The service is absent in the demo runtime.
- **Privacy.** The stored route and URL are privacy row `remote_relay`.

## Pairing and management UI (Settings → Remote relay)

`apps/web/src/components/RemoteRelay.tsx` (state in `apps/web/src/core/remote-relay.ts`) is built only
on the session-token routes above and `GET /api/phone/devices`; Core gained no new route.

- **Status:** off, on and connected, or on and not connected; the relay address; Core's `last_error`
  as plain text (control and bidirectional characters removed, capped at 200 characters). While the
  relay is on, the status is re-read every 5 s. If Core answers `404` (no OS secret store, so the
  service is absent) the section says so and offers nothing.
- **Turn on:** needs an explicit relay address. The UI checks it like Core's `relayUrl` (at most 300
  characters; `https:`, or `http:` only for `localhost`, `127.0.0.1`, `[::1]`; no credentials, query or
  fragment) and sends exactly `{"url": "<address>"}`. Core remains the authority and its refusal (for
  example the emergency stop) is shown as text.
- **Turn off:** asks first, and says that it discards the route and this computer's relay private
  key; only then `DELETE /api/remote-relay`.
- **Details for a device:** Core has **no pairing code or link for the relay**. The only pairing
  material it exposes is the relay address, the route id and Core's relay _public_ key (from
  `GET /api/remote-relay`). The UI shows these only while a "Show the relay details" panel is open and
  hides them again when it is closed, when the relay is turned off or when the route changes; they are
  kept in no storage and never logged. The route id is an address, not a password, and the private key
  is never in any response. Nothing here is a QR code or a pairing URI, and none is invented.
- **Paired devices:** the phone-link device list (names cleaned, grouped key fingerprints,
  revoked state) with a "send approvals" button per live device, which calls
  `POST /api/remote-relay/devices/:id/approvals`. Revoking is still done in the phone link section.
- **Text on screen:** the "can and cannot see" wording is taken from [Trust model](#trust-model) and
  [What the relay can still do](#what-the-relay-can-still-do): end-to-end encrypted payloads; the relay
  sees route id, peer address, frame size and timing, and can drop, delay or repeat frames.
- **i18n:** keys `relay.*` in all ten locale folders (`en` plus nine). The non-English strings are
  machine-translated and unreviewed.
- **Tests:** `apps/web/test/remote-relay.test.tsx` (24, against a fake Core): status states, exact
  enable body, address validation, disable confirmation and request, details shown then cleared,
  devices, errors as text, hostile text inert, route absent (404). **Simulated only:** no relay,
  network, TLS, phone or hosted instance was used.

## What is not built

- **Exit criterion "a phone on mobile data approves a request through the relay" is UNMET.** No
  phone app, no mobile network, no hosted relay. Only a Node fake device over loopback.
- No phone app, no pairing URI or QR for the relay, no TLS exercised, no hosting, no Dockerfile (see
  [why](#why-there-is-no-dockerfile)).
- Pairing a device _for the relay_ reuses the Phase 71 pairing; the device learns Core's relay public
  key out of band. The Settings section shows the address, route and public key to hand over (see above)
  but Core has no relay pairing code, so nothing carries them to a device for you.
- Device list/revoke is the phone-link list/revoke (`/api/phone/devices`); there is no relay-specific
  device list. The relay section only lists them and sends approvals.
- Resilience: no TLS to the relay is exercised, no rate limiting per client address, no
  presence/offline queueing by design (a device must be online to receive). The reconnect loop is
  tested against a loopback relay only.
- No forward-secrecy beyond per-message ephemeral keys on the sender side (the long-term recipient
  key is static); a stolen device or Core key reveals past captured frames to that recipient.
- Hosted instance and container image are not provided.
