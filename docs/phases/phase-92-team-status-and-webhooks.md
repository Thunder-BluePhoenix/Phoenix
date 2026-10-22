# Phase 92 — Team Status & Incoming Webhooks

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Low |
| Status | 🟨 Built as code and wired into Core; every check is simulated (fakes, in-memory state, two real Cores through a loopback relay). Incoming-webhook routes and team presence (`TeamLinkService`, `/api/team/*`) are constructed by the runtime (both need an OS secret store; absent in the demo runtime). **Not done:** a pairing flow beyond copying the id and public key by hand, a web screen to create webhook sources, any real teammate or relay host. Neither exit criterion is met |
| Depends on | [Phase 87 — Remote Access Relay](phase-87-remote-access-relay.md) |
| Unblocks | — |

## Goal

Optional shared status for a team, and a universal way to drive Fawkes.

## Tasks

- [ ] Team status: share chosen states (deploying, long agent run, in a meeting) with teammates; off by default, per-item consent. Per-kind consent is built and only `{kind, since}` leaves. Simulated. Unticked: roster entry is by hand, no pairing flow, no real teammate.
- [ ] Shared through the relay (Phase 87), end-to-end encrypted. Frames are sealed and signed and only rostered senders are accepted; the relay now accepts `tm_<12 hex>` team addresses and `TeamLinkService` sends through it. Simulated: tested on loopback only. Unticked.
- [ ] Incoming webhooks: a URL + token per source turns any tool's POST into a Phoenix event (validated against the event schema). `POST /api/webhooks/in/:source` is built with a per-source HMAC-SHA256 signature instead of a URL token, and is registered in `buildRoutes` when the runtime has a secret store. Tested through the real server with a loopback client only. Unticked: no real service has sent one.
- [ ] Webhook tokens revocable; rate limits. Secrets are revocable and rotatable, with a per-source budget and a shared junk bucket; the state is in memory. Simulated. Unticked.

## Deliverables

- `core/runtime/src/team-status`: team presence (`link.ts` `TeamLinkService`) and webhook handling. Constructed by the runtime (needs a secret store). Routes in `core/api/src/team-link-routes.ts` plus `teamStatusRoutes`: `GET/POST/DELETE /api/team/link`, `POST /api/team/link/pause`, `GET /api/team/status`, `PUT /api/team/sharing`, `POST /api/team/members`, `DELETE /api/team/members/:id` (session token only). Transport is the Phase 87 relay with `tm_<12 hex>` addresses. Identity private key only in the secret store (`team-status.private-key`); roster in settings `team-status.roster`; link config in `team-status.link`. Privacy row `team_status`. Test `core/runtime/test/team-link-wiring.test.ts` (10).

## Exit criteria

- [ ] Two Phoenix installs see each other's shared state. **Unmet.** Two real Cores in one test process saw each other's state through a loopback `createRelayServer`; no second machine, no real relay host and no pairing flow.
- [ ] A webhook from a real service drives Fawkes. **Unmet.** The route is registered and tested over loopback (`core/runtime/test/team-webhooks-wiring.test.ts`), but no real service sent a webhook and there is no UI to create a source.

## Implementation notes

### What was built

- **Webhook route** `POST /api/webhooks/in/:source`: per-source HMAC-SHA256 over `<ts>.<raw body>`, 16 KiB cap, ±5 minute window, event-id dedupe that fails closed when full, a strict schema, closed event-type namespaces, an identical 401 for every authentication failure, secrets only in the secret store, and a master switch plus a per-source switch, both **off by default**.
- **Team presence:** per-kind consent, only `{kind, since}` leaves, sealed and signed frames, rostered senders only. Adding a member whose id is already on the roster is refused (so a pinned key is never swapped); inbound frames are rate-limited per sender; `webhook-*` sources are never observed as the user's status; the kill switch pauses the link and keeps roster and identity; leaving sends a final "not sharing" frame and forgets identity, route and roster; a 60 s heartbeat refreshes status (stale after 3 min).
- Documentation: [team-status.md](../team-status.md).

### Deviations

- Webhooks use a signature over the body with a per-source secret rather than a URL plus bearer token.

### Security review

A static read-only review by tools (not a human audit) found three issues, each fixed with a test that failed before:

- Unauthenticated requests with a wrong signature could spend a real source's rate-limit budget; now only unsignable or out-of-window junk is charged, to one shared bucket.
- A delivery in flight when a source was disabled, revoked or rotated was still accepted; it is now refused after the secret read.
- The public body read had no deadline; it now has a 10 s deadline (injectable).

### What was not built

A pairing flow beyond copying the id and public key by hand, a web screen to create webhook sources (Settings section for team presence: see `apps/web/src/components/TeamSettings.tsx`), any real teammate or relay host, and relay `write()`-false backpressure beyond the test seam. Dedupe and rate-limit state is in memory only.

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
