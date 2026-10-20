# Phase 67 — Service Integrations (Vercel, Stripe, n8n, Resend, Notion, Cal.com)

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | 🟨 Six capabilities built (installed, not enabled) and tested against mock services written from recollection of the public docs; no real API and no key was ever used, so every request and response shape is unverified; no per-service web UI beyond the generic capability card; the n8n base URL can still be repointed by a token holder (visible, not prevented); exit criterion not met |
| Depends on | [Phase 13 — Capability SDK, Mock Capability & Event Simulator](phase-13-capability-sdk-mock-simulator.md) |
| Unblocks | — |

## Goal

Bring the services developers run on into Fawkes as capabilities.

## Tasks — parity with Coucou

- [ ] Vercel deployments, Stripe payments, n8n workflows, Resend emails, Notion, Cal.com. All six are built (`capabilities/vercel`, `stripe`, `n8n`, `resend`, `notion`, `calcom`, each with `test/*.test.ts` against a local mock server) and registered in `builtinCapabilities` as installed, not enabled (`core/runtime/test/builtins.test.ts`). Unticked because nothing was run against a real service: the mocks encode the same reading of the docs as the code, so a misreading would pass. Unverified shapes are listed in the exit criterion below.
- [ ] Each with its own colour/mini Fawkes. Each service has its own colour and glyph (`SERVICE_SOURCE_STYLES` in `pet/assets/src/outfits/sources.ts`); there is **no per-service mini Fawkes artwork**, and no glance component per service (only the generic capability card and Settings).
- [x] Pollers paused when nothing is watching. Each poller waits while no authenticated WebSocket client is connected and resumes when one connects (`core/capability-manager/src/presence.ts`, `CapabilityContext.watched()` / `untilWatched()`). Tests: `core/runtime/test/viewer-presence.test.ts` (follows connections, stays watched until the last client leaves, releases a waiting poller on disable) and each capability's "makes no request while unwatched and resumes when someone watches". "Watching" means any authenticated WebSocket client, not a visible window.

## Tasks — Phoenix improvements

- [x] Read-only by default; safe actions (re-run, redeploy, pause a workflow) need approval; nothing that moves money or sends email. Stripe and Resend are read-only: no write command, no POST path, never import `ServiceClient` (asserted by `stripe.test.ts` "no source file imports ServiceClient or calls a `.post(` method", `resend.test.ts` "source never imports ServiceClient or the POST path"); Notion is GET-only (`notion.test.ts`); Cal.com is read-only. Vercel `redeploy` and n8n `run_again` / `pause_workflow` are side effect `external`, ask the person each time, take an `idempotency_key`, and a declined confirmation never calls the service (`vercel.test.ts`, `n8n.test.ts`). Tested against mocks only; the endpoints those three actions call are unverified (see the exit criterion).
- [x] Deploy events feed DEPLOYING/SUCCESS/ERROR and the knowledge graph. `vercel.deploy.started|succeeded|failed|cancelled` map to DEPLOYING, SUCCESS and ERROR (`vercel.test.ts` "a deployment that starts after enabling drives DEPLOYING, then SUCCESS", "a failed deployment is ERROR until dismissed") and `vercel.deploy.*` creates a Deployment node with PART_OF / DEPLOYED_TO edges (`ai/knowledge-graph/test/ingest.test.ts` "a vercel.deploy event creates a Deployment…"). Mock deployments only.

## Deliverables

- capabilities/vercel, stripe, n8n, resend, notion, calcom: built. Each has a README (config, secrets, commands, events, what is unverified).

## Exit criteria

- [ ] Each capability tested against a mock written from the service's docs, and against the real API where a key is available. Half met: the mocks were written from the agents' recollection of the public docs, not from recorded responses; **no real API and no key was used**. Shapes called out as unverified: Vercel `POST /v13/deployments?forceNew=1` body, the `meta.github*` fields and paging; the Stripe restricted-key scope needed for `/v1/charges` and `/v1/balance`; n8n `/executions/{id}/retry`, `/workflows/{id}/deactivate` and the response shapes per n8n version; Resend `created_at` variants and `last_event` values; Notion `last_edited_time` semantics; Cal.com response shapes.

## Implementation notes

### What was built

- Shared plumbing in `@phoenix/service-kit` (`sdk/service-kit`, no new npm dependency): `ReadOnlyClient` (GET only, no body method), `ServiceClient` (adds `post`), `safeBaseUrl`, `ServiceError`, defensive parsers, `startPolling`, `nextDelay`, `ChangeTracker` (history rule: nothing from before enabling is replayed) and `startMockService` for tests.
- Vercel: deployments, events, and `redeploy`. Stripe: payment counts, totals and balance; `stripe.payment.succeeded|failed`. n8n: workflows and executions (self-hosted, `base_url` required); `n8n.execution.failed|succeeded`; `run_again`, `pause_workflow`. Resend: delivery status with recipient domains only. Notion: pages and databases the person lists by id in `watch` (search is a POST, so there is no discovery). Cal.com: bookings with created, cancelled, rescheduled and an ephemeral starting-soon event.
- Every capability treats remote text as data: clipped, control characters dropped, credential-shaped text redacted, non-https links dropped; a 401 makes it degraded and waits at least five minutes; a 429 honours Retry-After; redirects are not followed; oversized responses are cut off.

### Security fixes that came from review

A static review (not a human audit) found the following; each was fixed with regression tests:

- A token holder could repoint `base_url` to make a capability send its stored credential elsewhere. For Vercel, Stripe, Resend, Notion and Cal.com `base_url` was **removed from config** (a code-only `apiUrl` option remains); the credential goes only to the service's own origin.
- Portfolio exchange endpoints are no longer configurable (code-only `exchangeUrls`); `endpoints` is network-only and credential-free (see [Phase 68](phase-68-media-and-portfolio.md)).
- `POST /api/events` refuses an `event_type` or `source` of the outbound-service families (403 `SECURITY_POLICY_BLOCKED`), so a token holder cannot forge a Vercel deploy or a Stripe payment.
- The Vercel mapper validates the project and keys the graph node `vercel:<project>:<id>`; remote text is redacted in Vercel, n8n and Stripe events and refused emits are counted (`events_refused`); an idempotency key is bound to its target; `redeploy` aborts if the response id differs from the requested id; the confirmation summary includes the target ids.

### Open (not fixed)

n8n is self-hosted, so `base_url` stays configurable. It is now **visible** (status `sends_key_to`, the health message and the README name the host) but **not prevented**: a session-token holder can still point it at another host and receive the stored key. Closing that needs a credential that tells a person from an agent, or a confirmation on a config change; this is an open owner decision recorded in the gap register.

### Other limits and decisions

- Idempotency keys are in memory only: lost on a Core restart or when the capability is disabled, so a repeated call can duplicate an action afterwards. An action whose outcome is unknown (a dropped POST or a 5xx) is reported as unknown and is not re-sent automatically.
- Stripe does not enforce a restricted key: a secret key pasted by mistake is only ever used for GET requests.
- The confirmation prompt names the target only through its summary text; the permission gateway copies `details` for workflows only.

What was not done or not run: any real service or key; per-service web glances; per-service mini Fawkes artwork; the terms and rate limits of these services were not reviewed. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
