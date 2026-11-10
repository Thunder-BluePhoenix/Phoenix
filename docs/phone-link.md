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

| Property  | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bind      | one private LAN IPv4 address chosen by the user (only RFC 1918 `10/8`, `172.16/12`, `192.168/16` and `100.64/10` are offered; default: the first of those), TCP port **47821 by default, user-configurable** (`phone.port`, see [Port](#port)). If the chosen address vanishes the link stays **off** (status `off_reason: "address_changed"`, the setting is kept) and never opens on another interface; Settings then shows a prompt (see [Address changed](#address-changed)) |
| Transport | HTTPS, TLS 1.2+, self-signed certificate made by Phoenix                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Routes    | only `/phone/v1/*` (table below). No static files, no directory listing, no WebSocket/CONNECT, no CORS                                                                                                                                                                                                                                                                                                                                                                           |
| `Host`    | must be exactly `<address>` or `<address>:<port>` (DNS-rebinding allow-list)                                                                                                                                                                                                                                                                                                                                                                                                     |
| `Origin`  | any `Origin` header is refused (native clients only; **PWAs are not supported**, see GAPS)                                                                                                                                                                                                                                                                                                                                                                                       |
| Body      | `application/json`, at most 16 KiB; 32 connections, at most 4 per remote address; TLS handshake timeout 8 s; header/request timeouts 10 s/15 s                                                                                                                                                                                                                                                                                                                                   |
| Logs      | route name, status and device id only: never a path with an id, a code, a key or a signature                                                                                                                                                                                                                                                                                                                                                                                     |

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
(`phoenixphone://pair?host=…&port=…&code=…&fp=…`, shown as text **and** as a QR code, see
[QR code](#qr-code)). The phone connects, compares the presented certificate's fingerprint to the one it was
given, and pins it. It must refuse any other certificate. It never uses a CA store for this link.

### Port

`phone.port` is the TCP port the listener binds. Default **47821**; `POST /api/phone/settings {"port":N}`
accepts a whole number from **1024 to 65535** that is **not a port Core itself uses**: the loopback API's
port (the one it actually bound) and the MCP server's configured port are refused with `400`; anything
else (a string, a float, `null`, out of range) is `400` too. The change is audited as
`phone.settings.changed {port}` (only when the value changed). It takes effect the way an address
change does: if the link is on (or enabled but off), it is closed and reopened on the new port at once,
and a pairing code shown for the old listener dies with it. If the new port is already taken by
another program the reopen fails (`503`, the setting is kept, the link stays off). The pairing URI and
the status route carry the **effective** port (`port` is where it listens now, `configured_port` is the
setting, which applies the next time the link opens). The TLS certificate does not depend on the port, so
it keeps its fingerprint, but phones paired earlier may still be configured with the old port and have to
be paired again. "Delete all phone data" clears the setting (back to 47821).

### Address changed

When the link is enabled but the address the user chose is no longer on this computer, Core reports
`off_reason: "address_changed"` and stays off. Settings → Phone link then shows a prompt (only for that
state; not with the kill switch engaged, not while listening) that says a paired phone may not reach this
computer any more, that nothing was opened on another network, and offers the existing safe actions:
pick one of the addresses Core offers right now and apply it (`POST /api/phone/settings {"address":…}`),
or turn the link off (`{"enabled":false}`). If Core offers no address the prompt says so and only offers
to turn the link off. After a new address the certificate is reissued, so the phone has to pair again.

### QR code

While the pairing prompt is open (a code was returned to this page and has not expired, been cancelled or
been used) Settings draws the pairing URI as a QR code next to the text link. The encoder is
`apps/web/src/core/qr.ts`: pure TypeScript, no dependency, no network; byte mode, error correction level
**M**, versions 1 to 14 (up to **362 bytes** of UTF-8; longer text is refused and the page shows the text
link and says no QR code could be made), the mask of lowest penalty, drawn as an inline SVG (black on
white, with the 4-module quiet zone). The URI contains the pairing code, so it is secret for two
minutes: it is held only in the component's state, the SVG holds module path data (not the text), nothing
is logged or stored, and the drawing disappears with the code (expiry, cancel, a phone asking to pair, a
closed listener, a new address or port). A code that Core only reports as active after a page reload is
not drawn again. **Verification:** the encoder is tested against ISO/IEC 18004 vectors (format and
version information tables, generator polynomial, a published Reed-Solomon example, capacity and
interleaving tables) and, outside the repository and not as a test, the matrices of 20 symbols
(versions 1 to 14, UTF-8 and the maximum length) were decoded back to the original text with OpenCV's QR
detector. **No real phone camera or phone app scanned a code from the screen.**

## Pairing

1. Desktop: `POST /api/phone/pairing` → `{code, expires_at, fingerprint, address, port, uri}`. The code
   is 12 characters from a 32-letter alphabet (60 bits), shown as `ABCD-EFGH-JKLM`, valid 2 minutes,
   **single use**, held only as a SHA-256 in memory, and returned only in this response (never in the
   status route, logs, events or audit).
2. Phone: generates an ECDSA P-256 key pair (hardware-backed where it can) and sends
   `POST /phone/v1/pair {"code","name","public_key","binding_v":1,"binding"}` where `public_key` is the
   base64 DER SPKI and `binding` is the channel-binding proof (see [Channel binding](#channel-binding)),
   computed over the certificate the phone **actually saw on this TLS connection**. The pairing URI
   also carries `bv=1`.
3. Core checks the code in constant time. The first correct code spends it, whatever else is wrong with
   the request. Wrong codes count **only while a code is live**: 5 from one remote address lock that address
   out for 5 minutes (`429` + `Retry-After`) without touching the live code or other addresses, and 20
   wrong guesses from all addresses together destroy the live code and pause pairing for 5 minutes. Bad
   posts while no code is live cost nothing. A request while the link is off is refused. Core then
   checks the channel binding; a missing, malformed or wrong one is refused (see below). Response:
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

### Channel binding

The binding is **required** (`binding_v: 1`); there is no compatibility switch. No phone client and no
paired device predates it (the Core side was the only implementation, see GAPS), so nothing existing
breaks. A request without `binding_v: 1` and a 64-hex-character lower-case `binding` is refused exactly
like a wrong binding. Any other field value of `binding_v` is refused too.

```
binding = HMAC-SHA256( key = code, msg = "phoenix-pair-v1" || spki_sha256 || cert_sha256 || device_public_key )
```

| Part                | Bytes | Content                                                                                                  |
| ------------------- | ----- | -------------------------------------------------------------------------------------------------------- |
| `code` (HMAC key)   | 12    | the pairing code's 12 characters, upper case, dashes and spaces removed, as ASCII bytes (`ABCDEFGHJKLM`) |
| `"phoenix-pair-v1"` | 15    | ASCII label, no terminator                                                                               |
| `spki_sha256`       | 32    | SHA-256 of the DER `SubjectPublicKeyInfo` of the certificate the phone saw on the TLS connection         |
| `cert_sha256`       | 32    | SHA-256 of the DER certificate itself (the value behind the pinned `fp`, as raw bytes)                   |
| `device_public_key` | var.  | the DER SPKI bytes of the phone's own key, i.e. base64-decoded `public_key`                              |

All parts are fixed-width except the last, so no delimiters exist. `binding` is the 32-byte digest as 64
lower-case hex characters. The phone must hash the certificate from the connection it POSTs on, not
a stored copy. Core recomputes the HMAC from **its own** certificate and the code it holds and compares in
constant time (`timingSafeEqual`). If something between phone and Core terminated TLS with another
certificate, the phone's SPKI/certificate hashes differ from Core's and the pairing is refused.

**On mismatch** Core refuses with `403` and one fixed message (`Pairing refused: channel binding failed;
start a new pairing`) that does not say which part failed. The single-use code is **already burned**
(the code check spends it before the binding is looked at), no pending pairing and no confirmation
prompt are created, and the audit gets `phone.pair.refused {reason: "binding_missing" | "binding_mismatch",
code_burned: true}`: no code, binding or key. The user starts a new pairing to retry.

**Test vector** (inputs fixed bytes: `code = ABCDEFGHJKLM`, `spki_sha256` = bytes `00 01 … 1f`, `cert_sha256` =
bytes `20 21 … 3f`, `device_public_key` = 91 bytes `40 41 … 9a`):

```
4921cacc117faf0614a29973a6defe615a348cfdd8b4ba6d7e5019e7e7ecfab5
```

`core/runtime/test/phone-link.test.ts` ("the test vector in docs/phone-link.md…") recomputes this from
those inputs and asserts that this document contains the hex, so the document and the code cannot drift.

**Limits, honestly:** this is verified only against the Node fake phone (`core/runtime/test/phone-client.ts`,
which implements the phone side independently of Core's function); no real phone exists, and **no real
LAN man-in-the-middle was staged**: the substituted-certificate test simulates it by having the fake
phone hash a different certificate. The pairing `code` is still sent in the request body (the wire
contract is unchanged), so an active man in the middle that terminates TLS **and** reads the body
learns the code and could compute a binding over Core's certificate for a relayed request. The binding
therefore detects a phone that hashed a certificate other than Core's (a phone that does not pin, or
a relay that cannot read the body) but is not by itself a proof against that attacker; the phone's
certificate pin and the person comparing the key fingerprint in the confirmation remain the other
checks. A stronger design (the phone sends a code-derived proof instead of the code) is a protocol
change recorded as a decision in the gap register.

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
device, withdraws a pairing in flight, clears the `phone.address`, `phone.port` and `phone.require_user_verification`
settings, closes the listener and deletes the certificate (a removal failure is logged, never thrown). The inventory lists `phone_devices`.

## Audit

`phone.listener.enabled|disabled|closed`, `phone.settings.changed`, `phone.pairing.started|cancelled`,
`phone.pair.requested|refused|lockout|denied|expired`, `phone.device.paired|revoked`,
`phone.auth.failed`, `phone.approval.decided|refused` plus the gateway's own
`confirmation.approved|rejected` rows. Details hold ids, key fingerprints and reasons: never a
public/private key, signature, nonce, code or token.

## What is not built

Recorded in the [gap register](gaps.md). Not built: `apps/ios`, `apps/android` (no Xcode/Android
toolchain was verified; push notifications need APNs/FCM accounts), Live Activities / Dynamic Island,
widgets, Control Center, Siri and Shortcuts, Face ID / fingerprint prompts (phone side), Spotlight,
Focus filter, PWA support. **The exit criterion “a permission request is approved from a
real phone with biometric confirmation” is UNMET.** Verified only with a Node test client acting as the
phone.

The pairing code is bound to the listener's certificate by an HMAC ([Channel binding](#channel-binding)),
verified only against the Node fake phone: no phone client implements it yet and no real LAN
man-in-the-middle was staged. The person comparing the fingerprint in the confirmation remains the second check.
