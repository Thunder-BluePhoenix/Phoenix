# Phase 92 — Team Status & Incoming Webhooks

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Low |
| Status | 🟨 Built as code and tested with fakes and in-memory state; every check is simulated. The incoming-webhook routes are now registered and constructed by the runtime (needs an OS secret store). **Not wired:** team presence/sharing and its routes, any roster or pairing UI, and the relay addresses only core and dev peers, so teammates cannot use it yet. Neither exit criterion is met |
| Depends on | [Phase 87 — Remote Access Relay](phase-87-remote-access-relay.md) |
| Unblocks | — |

## Goal

Optional shared status for a team, and a universal way to drive Fawkes.

## Tasks

- [ ] Team status: share chosen states (deploying, long agent run, in a meeting) with teammates; off by default, per-item consent. Per-kind consent is built and only `{kind, since}` leaves. Simulated. Unticked: no roster or pairing UI.
- [ ] Shared through the relay (Phase 87), end-to-end encrypted. Frames are sealed and signed and only rostered senders are accepted. Simulated. Unticked: the relay addresses only core and dev peers, so teammates cannot use it.
- [ ] Incoming webhooks: a URL + token per source turns any tool's POST into a Phoenix event (validated against the event schema). `POST /api/webhooks/in/:source` is built with a per-source HMAC-SHA256 signature instead of a URL token, and is registered in `buildRoutes` when the runtime has a secret store. Tested through the real server with a loopback client only. Unticked: no real service has sent one.
- [ ] Webhook tokens revocable; rate limits. Secrets are revocable and rotatable, with a per-source budget and a shared junk bucket; the state is in memory. Simulated. Unticked.

## Deliverables

- `core/runtime/src/team-status`: team presence and webhook handling. Built, not constructed by the runtime.
- `core/api/src/team-webhook-routes.ts`: `POST /api/webhooks/in/:source`, the only public route in this phase. Registered in `buildRoutes` (as `teamWebhooks` on `CoreServices`) and constructed by `PhoenixRuntime` when a secret store is supplied. See [team-status.md](../team-status.md).

## Exit criteria

- [ ] Two Phoenix installs see each other's shared state. **Unmet.** Team presence was exercised in tests only, and the relay cannot address teammates.
- [ ] A webhook from a real service drives Fawkes. **Unmet.** The route is registered and tested over loopback (`core/runtime/test/team-webhooks-wiring.test.ts`), but no real service sent a webhook and there is no UI to create a source.

## Implementation notes

### What was built

- **Webhook route** `POST /api/webhooks/in/:source`: per-source HMAC-SHA256 over `<ts>.<raw body>`, 16 KiB cap, ±5 minute window, event-id dedupe that fails closed when full, a strict schema, closed event-type namespaces, an identical 401 for every authentication failure, secrets only in the secret store, and a master switch plus a per-source switch, both **off by default**.
- **Team presence:** per-kind consent, only `{kind, since}` leaves, sealed and signed frames, rostered senders only.
- Documentation: [team-status.md](../team-status.md).

### Deviations

- Webhooks use a signature over the body with a per-source secret rather than a URL plus bearer token.

### Security review

A static read-only review by tools (not a human audit) found three issues, each fixed with a test that failed before:

- Unauthenticated requests with a wrong signature could spend a real source's rate-limit budget; now only unsignable or out-of-window junk is charged, to one shared bucket.
- A delivery in flight when a source was disabled, revoked or rotated was still accepted; it is now refused after the secret read.
- The public body read had no deadline; it now has a 10 s deadline (injectable).

### What was not built

Team presence and sharing construction and routes (`teamStatusRoutes` is not registered), a roster or pairing UI, relay addressing for teammates, a web screen to create webhook sources. Dedupe and rate-limit state is in memory only.

### What was not run

Any real webhook sender, any two real installs. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
