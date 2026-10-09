# Phase 40 — Workflow Safety & v0.8 Release

| Field | Value |
|---|---|
| Stage | Stage 8 — Automation & Workflows (v0.8) |
| Release target | v0.8 |
| Priority | High |
| Status | 🟨 Safety layer built and tested in-process (seeded stress run, mutation checks) and wired into Core (routes below); release v0.8 not cut, gate not marked (see [gaps register](../gaps.md)) |
| Depends on | [Phase 39 — Workflow Engine](phase-39-workflow-engine.md) |
| Unblocks | [Phase 41 — SDK Stabilisation & Developer Docs](phase-41-sdk-stabilization-and-docs.md) |

## Goal

Make workflows stop safely, require authorisation for production, and roll back where possible.

## Scope

**In scope**

- Approval gates
- Rollback/compensation
- Kill switch
- Failure handling

## Tasks

- [x] Production workflows require explicit authorisation
- [x] Failed workflows stop safely; compensation where supported
- [x] Destructive steps require confirmation
- [x] Workflow reliability metrics
- [ ] Release v0.8

## Deliverables

- Workflow safety layer
- v0.8 release

## Exit criteria

- [ ] Workflow execution reliable and safe (gate v0.8 → v0.9)

## Implementation notes

- Same package (`core/workflows`); decisions in [ADR-0021](../adr/ADR-0021-workflow-engine.md). Migration 13 adds `workflow_authorisations` and `workflow_counters`.
- Production authorisation: `WorkflowAdmin.authorise` (hash-bound, optional expiry, revocable, audited); required for production environment or any production/critical/unknown tool. Unauthorised triggers are recorded as `refused` runs with a `workflow.run.refused` event and an audit record.
- Destructive steps: decided from the tool contract; validation rejects a destructive action reachable before an approval step; the runner refuses it again until an approval step succeeded in the run.
- Failure: stop, undo in reverse order (once each, never retried), undo failures and unknown outcomes end `failed_needs_attention`; step timeout abandons the call.
- Kill switch: running runs cancelled, no undo attempted (calls are blocked), waiting approvals rejected, new runs refused.
- Metrics: `engine.metrics()` (counts by outcome, step failure rate, p50/p90/p99 duration, approvals waiting/approved/rejected/expired); counters persist in the same transactions as state changes.
- Reliability: `test/stress.test.ts` (seeded; 700+ runs, 7 simulated crashes by closing and reopening the SQLite file, kill-switch toggles, tool errors, timeouts) asserts the invariants from the roadmap.
- Not done: the v0.8 release itself and the gate checkbox.

## API contract

Same conventions as the [phase 39 contract](phase-39-workflow-engine.md#api-contract) (session token, user routes only, exact keys, snake_case, `{code, message, details}` errors). **Authorising and revoking are user-only**: `WorkflowAdmin` is built by the API layer for requests that carry the session token; the engine, the tool gateway and agents hold none, and no tool or capability command reaches it.

**Authorisation** (`WorkflowAuthorisationView`): `{ "id": "wfa_…", "workflow_id", "definition_hash", "authorised_by": "user:owner", "authorised_at": ISO, "expires_at": ISO|null, "revoked_at": ISO|null, "revoked_by": string|null, "live": bool }`. `live` is true when it is not revoked, not expired **and** `definition_hash` equals the workflow's current hash.

**Metrics** (`WorkflowMetricsView`, per workflow id): `{ "runs_started", "runs_succeeded", "runs_failed", "runs_cancelled", "runs_rejected", "runs_interrupted", "runs_refused", "runs_compensated", "runs_needing_attention", "steps_succeeded", "steps_failed", "step_failure_rate": 0-1, "duration": null | { "p50", "p90", "p99", "samples" } (milliseconds), "approvals_waiting", "approvals_approved", "approvals_rejected", "approvals_expired" }`.

| Route | Body / query | Success |
|---|---|---|
| `POST /api/workflows/:id/authorise` | `{ "hash": "<Workflow.hash the user reviewed>", "expires_at"?: ISO string }` | 200 `{ "authorisation": Authorisation, "workflow": Workflow }`. **The authorisation covers exactly the content with that hash.** 400 `HASH_MISMATCH` when `hash` is not the stored definition's current hash ("the definition changed; review it again"), 400 `INVALID_REQUEST` when `expires_at` is not in the future or is more than 90 days away, 400 `INVALID_DEFINITION` when the stored definition no longer validates, 404 unknown. Audited (`workflow.authorised`: hash, reasons, expiry; `workflow.authorise.refused` for any non-user caller). Allowed for any workflow, required only where `authorisation_reasons` is non-empty. |
| `POST /api/workflows/:id/revoke` | `{}` | 200 `{ "revoked": <count of live authorisations ended>, "workflow": Workflow }`. Runs already in flight stop at their next step (`reason: "the user's authorisation was revoked…"`, status `cancelled`). Audited (`workflow.authorisation.revoked`). |
| `GET /api/workflows/metrics` | | 200 `{ "metrics": { "<workflow id>": Metrics } }`; a workflow that never ran has no entry. |
| `GET /api/workflows/:id` | | (phase 39) lists `authorisations` newest first, each with `live`. |

**What the kill switch does to the routes.** While the emergency stop is engaged: `POST /api/workflows/:id/runs` answers 403 `SECURITY_POLICY_BLOCKED` (`RUN_REFUSED`, reason "Emergency stop is engaged") and records a `refused` run; every active run is cancelled with no undo attempt (a run with succeeded steps that declared an undo ends `failed_needs_attention`); waiting approvals are rejected; bus triggers are refused. Engaging it is `POST /api/security/kill-switch`.

**Restart.** Starting Core runs `engine.recover()` before the engine listens: every run a previous process left `queued`, `running`, `waiting_approval` or `compensating` becomes `interrupted` (nothing to undo) or `failed_needs_attention` (a call's outcome is unknown, or a declared undo was still owed), with a `workflow.result` event and an audit record `workflow.run.recovered`. Nothing is resumed and no tool is called at startup. `PhoenixRuntime.stop()` stops the engine (abandons running work, writes nothing more) before the database closes.

**Gaps recorded by the wiring** (also in the gaps register): a user cancel does not run declared undo steps (it is handled like the kill switch: safest, nothing invented); `ToolGateway.call` takes no cancellation signal, so a cancelled call may still complete in the capability and is then recorded as unknown.

## Source documents

- Post-MVP Roadmap v1.0 §10.2

---
Back to [TRACKER](TRACKER.md)
