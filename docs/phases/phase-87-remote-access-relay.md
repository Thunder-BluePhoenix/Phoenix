# Phase 87 — Remote Access Relay

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | 🟨 Built as code and tested with loopback servers and fakes; every check is simulated. **Not built:** no phone app, no real network or TLS, no hosted instance, no Dockerfile, no pairing UI, and the runtime does not construct `RemoteRelayClient`. Neither exit criterion is met |
| Depends on | [Phase 71 — Phone Link & Mobile Companions](phase-71-phone-link-and-mobile.md) |
| Unblocks | [Phase 86 — Approvals in Slack, Discord & Teams](phase-86-chat-app-approvals.md), [Phase 92 — Team Status & Incoming Webhooks](phase-92-team-status-and-webhooks.md) |

## Goal

Reach Phoenix from your phone or chat away from home, without exposing it.

## Tasks

- [ ] Stateless relay that forwards end-to-end-encrypted messages between Core and paired devices. `@phoenix/relay` (node:http only, stateless SSE forwarder) and a Core client with sealed frames are built. Simulated. Unticked: no real device or network.
- [ ] Relay sees only routing metadata; keys pinned at pairing. Frames are ECDH + AES-GCM sealed; Core messages are signed by the pinned Core key. The route id is routing metadata, not an authenticator. Simulated. Unticked: no real pairing was run.
- [ ] Self-hostable relay (container) plus optional hosted instance. **Not built:** no Dockerfile and no hosted instance.
- [ ] Device list with revoke; every remote decision audited. A revoked or unknown device is refused and audited, and decisions go through `PhoenixPhoneLink.decide` with `request_hash` binding. Simulated. Unticked: no pairing UI exists and no real device was revoked.

## Deliverables

- `relay/` (`@phoenix/relay`): the stateless forwarder; added to `pnpm-workspace.yaml` and the root `tsconfig` include. Built; simulated evidence only.
- Core relay client and device protocol in `core/runtime/src/remote-relay`: built but not constructed by the runtime. See [remote-relay.md](../remote-relay.md).

## Exit criteria

- [ ] A phone on mobile data approves a request through the relay. **Unmet.** No phone app and no real network path exist.
- [ ] A revoked device is refused. **Simulated only:** the Core client refused and audited a revoked and an unknown device in tests. No real paired device was revoked.

## Implementation notes

### What was built

- **Relay:** `node:http` only, a stateless SSE forwarder with 32 KiB frames, 4 streams per peer and 256 in total; direction is enforced.
- **Core client and device protocol:** ECDH + AES-GCM sealed frames; Core messages signed by the pinned Core key; a replay window (nonces kept for 2 windows, 4096 in total and 200 per device); revoked or unknown devices refused and audited; decisions go through `PhoenixPhoneLink.decide` (`request_hash` binding).
- Documentation: [remote-relay.md](../remote-relay.md).

### Deviations

- No container or hosted instance was produced, so the "self-hostable" and "hosted" tasks are open.

### Security review

A static read-only review by tools (not a human audit) found that a backpressured stream could buffer frames without bound; such a stream is now destroyed (fixed, with a test that failed before).

### What was not built

A phone app, real network and TLS, a hosted instance, a Dockerfile, a pairing UI, and runtime construction of `RemoteRelayClient`. Frames carry no version negotiation and the recipient key is static (see the [gap register](../gaps.md)).

### What was not run

Any phone, any real network or TLS, any hosted or self-hosted relay deployment.

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
