# Phase 86 — Approvals in Slack, Discord & Teams

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | High |
| Status | 🟨 Built as code and wired into Core; every check is simulated (fakes, loopback servers). Core has a public provider-callback route and a bus subscription that posts cards. **Not done:** Teams inbound approval, DM digests, any Windows/Linux `phoenix://` handler. A macOS-only `phoenix://approvals/…` handler and an opt-in scheduled channel digest are built and tested with fakes only. No real Slack, Discord or Teams workspace was contacted; the exit criterion is not met |
| Depends on | [Phase 56 — Agent Approvals & Questions from Fawkes](phase-56-agent-approvals-from-fawkes.md), [Phase 87 — Remote Access Relay](phase-87-remote-access-relay.md) |
| Unblocks | — |

## Goal

Answer an agent or Phoenix approval from the chat tool you are already in.

## Tasks

- [ ] Slack, Discord and Teams apps that post approval cards with Allow / Deny. Slack and Discord cards are built and posted by a bus subscription for projects the user switched on; **Teams is notify-only** (a signed deep link, no inbound approval). Simulated. Unticked: no real workspace.
- [ ] Decisions go through the same audited path as Phase 56 and are bound to the exact request. Decisions reuse the phone link's `requestHash`/`previewHash`; the audit actor is `chat:<provider>:<user>`; single-use, expiring, confirm-gated. `POST /api/chat-approvals/callback/:provider` delivers callbacks. Simulated. Unticked: no real provider sent a callback.
- [ ] Notifications and digests to a channel or DM (opt-in). The opt-in scheduled channel digest (counts, short ids and action names; at most once per interval of at least 1 hour; quiet hours; skipped when idle) is built and fake-tested; there is no DM destination. Unticked: nothing was sent to a real workspace.
- [ ] Bot tokens in the OS keychain; least-privilege scopes. Secrets are read through `ctx.secret`; no real token or scope was exercised. Unticked.

## Deliverables

- `capabilities/chat-approvals` (`@phoenix/capability-chat-approvals`): Slack and Discord approval cards and callback verification, Teams notify-only link. Wired into Core: `core/runtime/src/chat-approvals/{index,service}.ts`, route `core/api/src/chat-approval-routes.ts`, shared bounded body reader `core/api/src/raw-body.ts`. The capability is registered (installed, disabled) and absent in the demo runtime. Privacy row `chat_approvals_config`. Simulated evidence only. See [chat-approvals.md](../chat-approvals.md).
- Tests: `core/runtime/test/chat-approvals-wiring.test.ts` (7) and `chat-approvals-service.test.ts` (3), through a real running Core.
- Also built: `capabilities/chat-approvals/src/digest.ts` (formatter, quiet hours, schedule verdict) with `tickDigest`, the Core timer in `chat-approvals/service.ts`; `apps/desktop/src-tauri/src/deeplink.rs`, `Info.plist` `CFBundleURLTypes` and the `RunEvent::Opened` hook (macOS only, no new crate). Tests: `capabilities/chat-approvals/test/digest.test.ts`, `core/runtime/test/chat-approvals-digest.test.ts`, `deeplink.rs` unit tests, one lifecycle case.
- Not built: `capabilities/slack`, `discord` and `teams` as separate packages, DM digests, a `phoenix://` handler on Windows or Linux.

## Exit criteria

- [ ] A real agent request is approved from Slack. **Unmet.** Nothing was sent to or received from a real Slack workspace. The capability is reachable from the running Core but ships disabled and was only driven by fakes.

## Implementation notes

### What was built

- **Callback authentication:** Slack callbacks are verified with HMAC v0 and a 5-minute window; Discord callbacks with Ed25519. Replays are refused.
- **Identity and binding:** the provider user is mapped to an allow-listed owner; the decision is bound to the Core-computed `request_hash`; tokens are single-use and expiring; **Allow goes through a confirm step**. The audit actor is `chat:<provider>:<user>`.
- **Per-project switch:** "approve from chat" is **off by default** and is checked both when the card is created and when it is pressed.
- **Teams:** notify-only with a signed deep link; there is no inbound approval.
- **Secrets** are read through `ctx.secret`.
- Documentation: [chat-approvals.md](../chat-approvals.md).

### Deviations

- This phase does **not** use the Phase 87 relay; provider callbacks are authenticated by the provider's own signature scheme instead.
- One capability package covers all three providers instead of three packages.

### Security review

A static read-only review by tools (not a human audit) found that the audit row stored raw agent text; it now records the sanitised tool name (fixed, with a test).

### What was not built

Teams inbound approval, DM digests, a Windows/Linux `phoenix://` handler, a UI for the digest schedule and a UI to enter the secrets. The macOS handler opens only the fixed approvals panel route and was never exercised with a real macOS URL open; the digest was never sent to a real workspace. Wiring status: `POST /api/chat-approvals/callback/:provider` (public, authenticated by the provider signature; 503 while the capability is disabled or the kill switch is on; no redirects, https POST only to slack.com, hooks.slack.com, discord.com and Teams webhook hosts, 15 s timeout, 64 KiB response cap) and the bus subscription on `security.confirmation.requested` / `agent.approval.requested` now exist.

### What was not run

Anything against a real Slack, Discord or Teams workspace, or with a real agent request. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.
- Approve from chat can be turned off per project for sensitive repos.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
