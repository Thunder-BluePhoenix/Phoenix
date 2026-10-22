# Phase 86 — Approvals in Slack, Discord & Teams

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | High |
| Status | 🟨 Built as code with injected fakes; every check is simulated. **Not wired:** no runtime route for provider callbacks, no live host adapter, nothing calls `postPending`, no `phoenix://` handler. No real Slack, Discord or Teams workspace was contacted; the exit criterion is not met |
| Depends on | [Phase 56 — Agent Approvals & Questions from Fawkes](phase-56-agent-approvals-from-fawkes.md), [Phase 87 — Remote Access Relay](phase-87-remote-access-relay.md) |
| Unblocks | — |

## Goal

Answer an agent or Phoenix approval from the chat tool you are already in.

## Tasks

- [ ] Slack, Discord and Teams apps that post approval cards with Allow / Deny. Slack and Discord cards are built; **Teams is notify-only** (a signed deep link, no inbound approval). Simulated. Unticked: no real workspace, and nothing calls `postPending`.
- [ ] Decisions go through the same audited path as Phase 56 and are bound to the exact request. Decisions are bound to the Core-computed `request_hash`; the audit actor is `chat:<provider>:<user>`. Simulated. Unticked: no runtime route delivers callbacks to it.
- [ ] Notifications and digests to a channel or DM (opt-in). Only the Teams notify-only deep link exists; no channel or DM digest was built.
- [ ] Bot tokens in the OS keychain; least-privilege scopes. Secrets are read through `ctx.secret`; no real token or scope was exercised. Unticked.

## Deliverables

- `capabilities/chat-approvals` (`@phoenix/capability-chat-approvals`): Slack and Discord approval cards and callback verification, Teams notify-only link. Built, not wired; simulated evidence only. See [chat-approvals.md](../chat-approvals.md).
- Not built: `capabilities/slack`, `discord` and `teams` as separate packages, a live host adapter, a runtime route for callbacks.

## Exit criteria

- [ ] A real agent request is approved from Slack. **Unmet.** Nothing was sent to or received from a real Slack workspace, and the capability is not reachable from the running app.

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

A runtime route for provider callbacks, a live host adapter, any caller of `postPending`, a `phoenix://` handler, and Teams inbound approval.

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
