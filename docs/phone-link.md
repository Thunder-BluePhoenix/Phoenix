# Phone link (Phase 71, Core side)

The phone link lets a phone (or any native client) list and answer Phoenix's pending approvals over
the local network. It lives in Core so every client uses the same audited approval path. **Core
side only:** no iOS or Android app exists (see [What is not built](#what-is-not-built)).

Off by default. Turning it on in **Settings → Phone link** (`POST /api/phone/settings
{"enabled":true}`) starts a **separate** HTTPS listener on one LAN address. The loopback API port
stays loopback-only and unchanged.

## Threat model in one paragraph

A person on your Wi-Fi can reach the listener's port. They must not be able to approve anything, pair
a phone, or learn anything. They cannot without a paired device's private key (requests are signed),
and they cannot pair without a code that is shown only on the desktop and works once for two
minutes. A phone never receives the desktop session token. **Core cannot tell a person from a
program** on the desktop that holds the session token (the known gap behind every token-authed
route): such a program can start a pairing and read the code. The pairing is therefore confirmed by a
Core-raised prompt (`Pair "<name>"? Key fingerprint …`) through the existing confirmation mechanism,
which is the same mechanism, with the same limit, as every other approval. See GAPS below.

## Listener

| Property  | Value                                                                                                                                                           |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bind      | one private LAN IPv4 address chosen by the user (only RFC 1918 `10/8`, `172.16/12`, `192.168/16` and `100.64/10` are offered; default: the first of those), port 47821 (`phone.port` is not user-configurable in this build). If the chosen address vanishes the link stays **off** (status `off_reason: "address_changed"`, the setting is kept) and never opens on another interface |
| Transport | HTTPS, TLS 1.2+, self-signed certificate made by Phoenix                                                                                                        |
| Routes    | only `/phone/v1/*` (table below). No static files, no directory listing, no WebSocket/CONNECT, no CORS                                                          |
| `Host`    | must be exactly `<address>` or `<address>:<port>` (DNS-rebinding allow-list)                                                                                    |
| `Origin`  | any `Origin` header is refused (native clients only; **PWAs are not supported**, see GAPS)                                                                      |
| Body      | `application/json`, at most 16 KiB; 32 connections, at most 4 per remote address; TLS handshake timeout 8 s; header/request timeouts 10 s/15 s                    |
| Logs      | route name, status and device id only: never a path with an id, a code, a key or a signature                                                                    |

Closing: disabling the link, deleting phone data, the **kill switch**, and Core shutdown all close
the socket, destroy every connection (including half-open TLS ones), and clear the live pairing code and the replay-nonce cache. The
kill switch also turns the setting off: after it is released the link stays off until the user turns it
on again, and an old code is dead.

### Certificate and the pin

Node can parse and verify X.509 but cannot create it. `core/runtime/src/phone-cert.ts` is a minimal
X.509 v3 DER builder (one fixed profile) signed with `node:crypto`, no new dependency and no
`openssl` at runtime:

- ECDSA P-256 key, `ecdsa-with-SHA256`, random 127-bit serial, subject CN `Phoenix Phone Link`.
- `subjectAltName` = the one LAN IPv4 address; `basicConstraints` CA:FALSE (critical); `keyUsage`
  digitalSignature (critical); `extendedKeyUsage` serverAuth.
- Validity 90 days, reissued when fewer than 30 days remain or the address changes (the fingerprint
  then changes and phones must re-pin: pair again).
- Files `<data dir>/phone/tls-key.pem` and `tls-cert.pem`, mode 0600 (the directory 0700; both are re-tightened on every load); removed by "delete all phone data".

The builder is checked by tests with `X509Certificate` (parse, signature verification against the
public key, SAN, validity, key match), a real TLS handshake that trusts only that certificate, and
`openssl x509 -text` / `openssl verify` when `openssl` is installed (tests skip those when it is not).
It is **not** verified against iOS/Android TLS stacks (GAPS).

**Pinning:** the desktop shows the certificate's SHA-256 fingerprint (uppercase hex pairs joined by
`:`, the form `X509Certificate.fingerprint256` gives) next to the pairing code and in the pairing URI
(`phoenixphone://pair?host=…&port=…&code=…&fp=…`, shown as text; **no QR image is generated in this
build**). The phone connects, compares the presented certificate's fingerprint to the one it was
given, and pins it. It must refuse any other certificate. It never uses a CA store for this link.

## Pairing

1. Desktop: `POST /api/phone/pairing` → `{code, expires_at, fingerprint, address, port, uri}`. The code
   is 12 characters from a 32-letter alphabet (60 bits), shown as `ABCD-EFGH-JKLM`, valid 2 minutes,
   **single use**, held only as a SHA-256 in memory, and returned only in this response (never in the
   status route, logs, events or audit).
2. Phone: generates an ECDSA P-256 key pair (hardware-backed where it can) and sends
   `POST /phone/v1/pair {"code","name","public_key"}` where `public_key` is the base64 DER SPKI.
3. Core checks the code in constant time. The first correct code spends it, whatever else is wrong with
   the request. Wrong codes count **only while a code is live**: 5 from one remote address lock that address
   out for 5 minutes (`429` + `Retry-After`) without touching the live code or other addresses, and 20
   wrong guesses from all addresses together destroy the live code and pause pairing for 5 minutes. Bad
   posts while no code is live cost nothing. A request while the link is off is refused. Response:
   `{pair_id, status:"pending", expires_at}`.
4. Core raises a confirmation `Pair phone "<name>"? Key fingerprint <fp>` (capability `phone-link`,
   side effect `execute`) via the permission gateway. The desktop UI answers it with the existing
   `POST /api/confirmations/:id`. The name is the phone's own text: shown as plain text, control,
   format (bidi, zero-width, soft hyphen, tag characters) and line/paragraph separator characters refused, 64 characters max.
5. Phone polls `GET /phone/v1/pair/:pair_id` → `{status:"pending"}` | `{status:"approved",device_id}` |
   `{status:"denied"}` | `{status:"expired"}`. Unconfirmed pairings expire after 2 minutes.
6. The phone's confirmation is **never listed to phones** and a device decision for it is refused:
   a phone cannot approve another phone's pairing.

At most 20 unrevoked devices; one pending pairing at a time; the same key cannot be paired twice.

## Request signing

Every other `/phone/v1/*` request carries:

```
X-Phoenix-Device:    dev_<12 hex>
X-Phoenix-Timestamp: <unix ms>
X-Phoenix-Nonce:     <16–64 chars of [A-Za-z0-9_-], fresh per request>
X-Phoenix-Signature: base64( ECDSA-P256-SHA256, ASN.1 DER ) over the UTF-8 text
                     "PHX1\n<device id>\n<METHOD>\n<request target as sent>\n<timestamp>\n<nonce>\n<sha256(body) hex>"
```

Core refuses (all `401`, indistinguishable to the caller) an unknown or **revoked** device, a bad
signature (so a tampered body, path, method, timestamp or nonce), a timestamp more than 60 s from
Core's clock, and a **replayed nonce** (remembered 120 s per device, at most 4096 in total and 200 per device, so one device cannot exhaust the table for the others). 10 failed requests
per minute from one address are answered `429`; failures are audited (device id and reason only, at
most 20 audit rows/minute so a flood cannot fill the log). The session token is not accepted on the
LAN listener and device signatures are not accepted on the loopback API (separate servers, separate
route tables).

## Routes (LAN listener)

| Method and path                     | Auth                        | Purpose                                                                                               |
| ----------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------- |
| `POST /phone/v1/pair`               | pairing code                | register a device key (above)                                                                         |
| `GET /phone/v1/pair/:id`            | none (id is 128-bit random) | pairing result                                                                                        |
| `GET /phone/v1/whoami`              | signature                   | `{device_id, name, require_user_verification, server_time}` (use `server_time` to correct clock skew) |
| `GET /phone/v1/approvals`           | signature                   | pending approvals                                                                                     |
| `POST /phone/v1/approvals/decision` | signature                   | approve or deny one                                                                                   |

Nothing else exists on this socket: every other method/path is `404`.

## Approvals bound to the exact request

`GET /phone/v1/approvals` → `{approvals:[{source, id, tool, title, preview, preview_hash, expires_at,
request_hash}]}` read through the same services as the desktop (`PermissionGateway.pendingConfirmations`
for `source:"confirmation"`, `AgentApprovals.list` for `source:"agent"`, permission requests only).
`title`/`preview` are untrusted text (a command an agent wants to run): show them as text.

- `preview_hash = sha256_hex(canonicalJson(preview))`
- `request_hash = sha256_hex("phoenix-phone-approval-v1\n" + canonicalJson({source, id, tool, preview_hash, expires_at}))`
  where `canonicalJson` is JSON with object keys sorted (`core/workflows/src/canonical.ts`).

To decide, the phone sends `POST /phone/v1/approvals/decision`:

```json
{
  "id": "…",
  "source": "confirmation",
  "decision": "approve",
  "request_hash": "<hex>",
  "user_verification": true
}
```

Core **recomputes** the request hash from the request as it exists now and refuses (`403`) if it
differs from the one the phone saw (changed details or expiry), `404` if it is no longer pending
(already resolved, withdrawn, the kill switch rejected it), `504` if it has expired. The decision then
goes through the same audited paths as the desktop: `PermissionGateway.resolveConfirmation(id,
approved, "device:<id>")` or `AgentApprovals.decide`. Audit actor is `device:<id>`; the
`phone.approval.decided` entry records `{id, source, tool, decision, user_verification, request_hash}`.

`user_verification` is the **phone's claim** that it did a biometric/passcode check. With
`require_user_verification` (default **true**) an approve without `true` is refused; a deny never needs
it. Core cannot verify the claim (GAPS); it only records it.

The signature on the request (device key over the body, which contains the request hash and the
claim) is what makes the statement the device's; the bound hash is what makes it about _this_ request.

## Devices and revocation

`GET /api/phone/devices` and `DELETE /api/phone/devices/:id` (session token, audited
`phone.device.revoked`). A revoked device fails on its very next request. The table `paired_devices`
(migration 29) stores id, name, **public** key, created/last-seen/revoked times: no secret and no code.
This closes the [Phase 45](phases/phase-45-cross-device-context.md) device-revocation gap **for the
phone link only**; encrypted-sync/relay device identity and revocation is separate and still open.
"Delete all phone data" (`POST /api/privacy/delete {"data":"phone","confirm":true}`) removes every
device, withdraws a pairing in flight, clears the `phone.address` and `phone.require_user_verification`
settings, closes the listener and deletes the certificate (a removal failure is logged, never thrown). The inventory lists `phone_devices`.

## Audit

`phone.listener.enabled|disabled|closed`, `phone.settings.changed`, `phone.pairing.started|cancelled`,
`phone.pair.requested|refused|lockout|denied|expired`, `phone.device.paired|revoked`,
`phone.auth.failed`, `phone.approval.decided|refused` plus the gateway's own
`confirmation.approved|rejected` rows. Details hold ids, key fingerprints and reasons: never a
public/private key, signature, nonce, code or token.

## What is not built

Recorded in the gap register by the parent. Not built: `apps/ios`, `apps/android` (no Xcode/Android
toolchain was verified; push notifications need APNs/FCM accounts), Live Activities / Dynamic Island,
widgets, Control Center, Siri and Shortcuts, Face ID / fingerprint prompts (phone side), Spotlight,
Focus filter, PWA support, a QR image. **The exit criterion “a permission request is approved from a
real phone with biometric confirmation” is UNMET.** Verified only with a Node test client acting as the
phone.

Also not built: the pairing code is not yet cryptographically bound to the listener's key and certificate
(an HMAC over the SPKI + certificate fingerprint would need a protocol change and a phone client), so a
man in the middle on the LAN during the 2-minute pairing window is stopped only by the person comparing the
fingerprint in the confirmation.
