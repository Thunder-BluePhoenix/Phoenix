# Phase 71 — Phone Link & Mobile Companions

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | 🟨 Built, exit criteria not met: only the Core side exists (off-by-default HTTPS LAN listener, pairing, signed requests, approvals bound to the exact request, device list and revoke, a Settings page); no iOS or Android app, no push, no biometric prompt, no PWA; tested with a Node fake phone over loopback and the web page against fake responses; never used with a real phone or over a real LAN; pairing code not bound to the certificate by HMAC (open); the exit criterion is not met |
| Depends on | [Phase 45 — Cross-Device Context & Sync](phase-45-cross-device-context.md), [Phase 56 — Agent Approvals & Questions from Fawkes](phase-56-agent-approvals-from-fawkes.md) |
| Unblocks | [Phase 87 — Remote Access Relay](phase-87-remote-access-relay.md), [Phase 89 — Apple Watch, Browser Extension & phoenix CLI](phase-89-watch-extension-cli.md) |

## Goal

Follow agents and approve requests from a phone.

## Tasks — parity with Coucou

- [ ] iPhone: Live Activity / Dynamic Island, notifications you can act on, Face ID on every Allow, widgets, Control Center, Siri and Shortcuts, Spotlight, Focus filter. **Not built.** There is no `apps/ios`, no push notification path (it needs APNs/FCM accounts) and no biometric prompt; the phone side of `user_verification` does not exist.
- [ ] Android: approvals with fingerprint, agents at a glance, answers and chat, island overlay, home-screen widgets. **Not built.** There is no `apps/android`.
- [ ] LAN phone link: off by default, pairing code, pinned TLS, approvals bound to the exact request. The Core side of every part is built (see the notes below and [phone-link.md](../phone-link.md)) and tested with a Node fake phone over loopback (`core/runtime/test/phone-link.test.ts`, `phone-cert.test.ts`, the client in `phone-client.ts`) and with the web page against fake responses (`apps/web/test/phone-link.test.tsx`). Unticked because pinning is the phone's job (it compares the certificate's SHA-256 fingerprint) and only the Node fake phone ever did it, because the pairing code is not bound to the certificate by an HMAC (open), and because **no real phone, no iOS or Android TLS stack and no real LAN took part.**

## Tasks — Phoenix improvements

- [ ] The phone link lives in Core, so any client (phones, a PWA) uses the same audited approval path. Core side built: a device decision goes through `PermissionGateway.resolveConfirmation` or `AgentApprovals` with actor `device:<id>`. Unticked because a PWA is **not supported**: any request with an `Origin` header is refused (native clients only).
- [x] Device list with revoke (closes the Phase 45 device-revocation gap). `GET /api/phone/devices` and `DELETE /api/phone/devices/:id`; a revoked device fails on its next request (`core/runtime/test/phone-link.test.ts`). This closes the revocation gap **for the phone link only**; device identity and revocation for encrypted sync and the relay is separate and still open.

## Deliverables

- Core phone link: built (`core/runtime/src/phone-link.ts`, `phone-cert.ts`; `core/api/src/phone-routes.ts`, `phone-listener.ts`; `core/persistence/src/device-store.ts`; `apps/web/src/components/PhoneLink.tsx`; [phone-link.md](../phone-link.md); OpenAPI entries).
- apps/ios: **not built**.
- apps/android: **not built**.

## Exit criteria

- [ ] A permission request is approved from a real phone with biometric confirmation. **Unmet.** No phone app exists, so no phone, real or simulated by a person, ever approved anything with a biometric prompt. The only evidence is the Node fake phone in the tests, which sends `user_verification: true` as a claim.

## Implementation notes

### What was built

- **Listener** (`core/api/src/phone-listener.ts`): a separate HTTPS server, off by default, on one private LAN IPv4 address chosen by the user (RFC 1918 and `100.64/10` only), port 47821 by default (`phone.port`, user-configurable from 1024 to 65535, never a port Core itself uses, audited; a change reopens the listener), serving only `/phone/v1/*`. The loopback API port is unchanged. If the chosen address vanishes the link stays off with `off_reason: address_changed` and never opens on another interface. Disabling, deleting phone data, the kill switch and Core shutdown close the socket and destroy every connection, including half-open TLS ones.
- **Certificate** (`core/runtime/src/phone-cert.ts`): a minimal X.509 v3 DER builder (ECDSA P-256, one fixed profile) signed with `node:crypto`; no dependency. Keys are stored with restrictive permissions under the data directory.
- **Pairing** (`core/runtime/src/phone-link.ts`): a 60-bit single-use code valid for two minutes, held only as a hash in memory; per-address lockout after 5 wrong codes and a global budget of 20 wrong guesses per live code; the pairing is confirmed by a Core-raised prompt that shows the key fingerprint.
- **Signed requests**: ECDSA P-256 over method, path and query, timestamp, nonce and body hash; replay protection and a per-device nonce quota; failures audited with device id and reason only.
- **Approvals bound to the exact request**: the phone sends the hash it saw; Core recomputes the hash from the request as it exists now and refuses on a mismatch. Decisions go through the same audited paths as the desktop. `require_user_verification` defaults to true; it is a claim the phone makes and Core cannot verify.
- **Devices**: `paired_devices` (migration 29, public key only), device list and revoke routes, privacy-inventory row `phone_devices`, delete-all kind `phone`.
- **Web**: `PhoneLink.tsx` (Settings, `phone.*` keys). An `address_changed` prompt (shown for that state only: says the paired phone may not reach this computer, nothing opened on another network, offers choosing an offered address or turning the link off through the existing settings route); a port field with an honest note; and a QR code of the pairing URI drawn by `apps/web/src/core/qr.ts` (pure TypeScript, byte mode, level M, versions 1 to 14, inline SVG with a quiet zone, no dependency) only while the pairing prompt is open, next to the text link. Strings exist in all ten locales; the nine non-English ones are machine-translated and unreviewed.

### Security review

An independent static review (read-only, not a human audit) found the following; each was **fixed** with regression tests:

- no TLS handshake timeout and no per-address connection cap;
- the global pairing lockout could be destroyed by anonymous posts when no code was live;
- `close()` could hang on a half-open TLS connection;
- a fallback to another interface when the chosen address vanished;
- a narrow device-name sanitiser (control, format and separator characters now refused);
- `deleteAll` was asynchronous with an unhandled rejection;
- nonce exhaustion: one device could fill the replay table for the others;
- key directory permissions.

**Not fixed (open):** the pairing code is not bound to the TLS certificate or the device key by an HMAC. Closing it needs a protocol change and a phone client, so until then a man in the middle on the LAN during the two-minute pairing window is stopped only by the person comparing the fingerprint in the confirmation prompt.

Also open and inherited: Core cannot tell a person from a program on the desktop that holds the session token, so such a program can start a pairing and read the code (the pairing confirmation prompt has the same limit as every other approval); and `GET /` injects the session token unauthenticated (pre-existing, see the [gap register](../gaps.md)).

### What was not built

`apps/ios`, `apps/android`, push notifications, biometric prompts (phone side) and PWA support (browser `Origin` requests are refused).

### What was not run

Nothing was run with a real phone, over a real LAN or against iOS or Android TLS stacks. The certificate builder was checked with `X509Certificate` and a real TLS handshake in tests, and with `openssl` only where it is installed (those tests skip without it). The web page was tested against fake responses. The QR encoder was checked against ISO/IEC 18004 table vectors in tests and, once and outside the repository, by decoding 20 generated symbols with OpenCV's QR detector; no phone camera scanned a code from a screen, and no phone app consumed the `phoenixphone://` link (none exists). Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
