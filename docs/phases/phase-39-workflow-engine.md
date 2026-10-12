# Phase 39 — Workflow Engine

| Field | Value |
|---|---|
| Stage | Stage 8 — Automation & Workflows (v0.8) |
| Release target | v0.8 |
| Priority | High |
| Status | 🟨 Engine built and tested in-process (real SQLite, PermissionGateway, CapabilityManager, ToolGateway, EventBus; one real run with Ollama `llama3.2`); wired into Core with user routes; web list, run history, status and authorisation UI built (no workflow authoring UI) (see [gaps register](../gaps.md)) |
| Depends on | [Phase 38 — Knowledge Graph & Provenance](phase-38-knowledge-graph-and-provenance.md) |
| Unblocks | [Phase 40 — Workflow Safety & v0.8 Release](phase-40-workflow-safety.md) |

## Goal

Let users define event-driven WHEN / IF / THEN workflows.

## Scope

**In scope**

- Primitives: trigger, condition, context lookup, AI step, capability action, approval gate, retry, timeout, compensation, result event

## Tasks

- [x] Workflow definition format + validation (declared permissions)
- [x] Engine executing steps with correlation IDs
- [x] Example: production deploy fails → inspect logs → diagnose → notify → recovery plan → wait for approval
- [x] Workflow UI: list, run history, status, JSON definition authoring and validation; create-only/expected-hash saves reject duplicate IDs and concurrent stale editors.

## Deliverables

- core/workflows

## Exit criteria

- [x] Example workflow runs end-to-end

## Implementation notes

- Package `core/workflows` (`@phoenix/workflows`); decisions in [ADR-0021](../adr/ADR-0021-workflow-engine.md). Migration 12 adds `workflow_definitions`, `workflow_runs` (definition snapshot, `UNIQUE (workflow_id, trigger_event_id)`) and `workflow_run_steps`.
- Definitions are JSON, closed-schema validated, with a small safe expression/template language (`src/expr.ts`; no `eval`, no calls, no prototype access). Step types: `condition`, `lookup`, `ai`, `action`, `approval`, `notify`, `result`; per-step `retry` (idempotent tools only), `timeout_ms`, `compensate`.
- Actions run only through `ToolGateway.call` as actor `system:workflow-<run id>`; the package never holds a `CapabilityManager` (a test scans imports). `correlation_id` = `workflow-<run id>` on events, audit actor and the run row.
- Approval uses `PermissionGateway.authorize` (capability id `workflows`), not a parallel mechanism.
- Only `WorkflowAdmin` (user actor, audited) writes definitions; the engine has a `WorkflowStore` with no such method.
- Run history API for a UI: `engine.listRuns`, `engine.getRun(runId)` (per-step status; inputs/outputs redacted and truncated), `engine.listWorkflows()`.
- Example workflow: `test/example.test.ts` (approve and reject paths, restart recovery) and `deployFailedWorkflow()` in `test/fixtures.ts`.
- Wired into Core: `core/runtime/src/workflows.ts` (`PhoenixRuntime.workflows`) and `core/api/src/workflow-routes.ts`; tests in `core/runtime/test/workflows.test.ts` and `core/workflows/test/manual.test.ts`. The engine gained `startManual` and `cancelRun` (user actor only, same gates as a trigger).
- **Web UI built**: `apps/web/src/components/Workflows.tsx` provides list, run history/detail, schema validation, user-reviewed JSON create/edit, run/cancel and authorisation controls. Core checks `create_only`/`expected_hash` atomically in the write transaction; a save never silently grants production authorisation.
- Run history can be deleted per terminal run or pruned in bounded batches; active runs and audit-protected evidence are retained unless the user explicitly confirms eligible deletion. Privacy delete-all removes terminal unprotected snapshots and steps.
- Workflow-run approval cards show only matching sanitized run/step identifiers from the workflow approval gate. Other capability tool-policy prompts remain in the global queue unless a trusted internal run binding exists; agent-supplied identifiers are never trusted.
- `ToolGateway.call` now forwards a per-call AbortSignal through policy confirmation and capability invocation; timeout/stop cancels only its own pending confirmation. Already-dispatched external writes cannot prove non-execution on abort and remain unknown/needs-attention with audit, not a false success or rollback.

## API contract

All routes need the session token and are **user routes**: they are the only way to change a workflow, and nothing an agent, a workflow step, a model or a capability can call reaches them (the tool registry lists no `workflows.*` tool). Bodies are JSON objects with **exact keys** (an unknown field is 400). Errors are `{code, message, details}`; for a `WorkflowError` `details` is its code (`INVALID_DEFINITION`, `VERSION_CONFLICT`, `LIMIT_REACHED`) followed by the problems, except that `INVALID_REQUEST` errors carry only their own marker (`WORKFLOW_DISABLED`, `RUN_NOT_ACTIVE`, `HASH_MISMATCH`): 400 invalid request or definition, 403 `SECURITY_POLICY_BLOCKED` (a refused start, emergency stop engaged), 404 unknown workflow or run, 401 no token. JSON is snake_case; timestamps are ISO strings.

**Workflow** (`WorkflowView`):

```json
{ "id": "deploy-failed", "name": "…", "enabled": true, "environment": "dev | staging | production | local",
  "version": 1, "hash": "<sha-256 of the behaviour-defining content>",
  "trigger": { "event": "deploy.failed", "where": "event.payload.x == \"y\"" },
  "authorisation_reasons": ["environment is \"production\""], "authorised": true,
  "problems": [] }
```

`authorised` is true when no authorisation is needed or a live one matches `hash` (see phase 40). `problems` are why the stored definition cannot run right now (invalid, or it names a tool that is not available because its capability is disabled): show them and do not offer "Run". A row that cannot even be read has `enabled: false`, `version: 0`, `hash: ""` and `problems`.

**Run summary** (`WorkflowRunSummaryView`): `{ "id", "workflow_id", "workflow_name", "status": "queued|running|waiting_approval|compensating|succeeded|rejected|failed|failed_needs_attention|cancelled|interrupted|refused", "terminal": bool, "correlation_id": "workflow-<run id>", "trigger_event_id", "chain_depth", "current_step": string|null, "reason": string|null, "created_at", "started_at": string|null, "finished_at": string|null }`. **Run** (`WorkflowRunView`) = summary + `{ "trigger": "<redacted, truncated JSON text>", "steps": [{ "seq", "step_id", "phase": "step|compensation", "type", "status": "running|waiting|succeeded|failed|timed_out|rejected|expired|unknown", "attempts", "destructive": bool, "tool": string|null, "input": string|null, "output": string|null, "error": string|null, "started_at", "finished_at": string|null }] }`. `input`/`output` are redacted and cut to 600 characters. `reason` says why a run ended (`failed_needs_attention` names the steps whose outcome is unknown or that were not undone: show it prominently).

| Route | Body / query | Success |
|---|---|---|
| `GET /api/workflows` | | 200 `{ "workflows": Workflow[] }` |
| `GET /api/workflows/:id` | | 200 `{ "workflow": Workflow, "definition": Definition \| null, "authorisations": Authorisation[], "created_by", "created_at", "updated_by", "updated_at" }`. `definition` is the stored JSON (the `WorkflowDefinition` of `core/workflows/src/types.ts`, already snake_case) and is `null` when the row cannot be read. `Authorisation` is in phase 40. 404 unknown. |
| `POST /api/workflows/validate` | `{ "definition": {…} }` | 200 `{ "valid": bool, "problems": string[], "hash": string \| null, "authorisation": { "required": bool, "reasons": string[] } \| null }`. A dry run against the live tool catalog: **nothing is stored and nothing runs**. `hash`/`authorisation` are null when invalid. At most 30 problems, each a JSON-pointer style path and a sentence. |
| `POST /api/workflows` | `{ "definition": {…} }` | **201** when new, **200** when it replaced an existing id: `{ "workflow": Workflow, "stored_enabled": bool, "authorisation_required": bool, "authorisation_reasons": string[] }`. Validates like `validate`; 400 `INVALID_DEFINITION` + problems when invalid; 400 `VERSION_CONFLICT` when the behaviour changed without raising `version`; 400 `LIMIT_REACHED` past 100 workflows. A **new** workflow that needs authorisation is stored **disabled** (`stored_enabled: false`); changing the behaviour of an existing one ends its authorisations (the `hash` changes). Audited (`workflow.created` / `workflow.updated`). |
| `POST /api/workflows/:id/enabled` | `{ "enabled": bool }` | 200 `{ "workflow": Workflow }`. Enabling does not authorise: an unauthorised production workflow is enabled but every trigger is recorded as a `refused` run. 404 unknown. Audited. |
| `GET /api/workflows/runs?workflow_id=&status=&limit=` | `status` one of the run statuses, `limit` 1-200 (default 50); unknown value → 400 | 200 `{ "runs": RunSummary[] }`, newest first. |
| `GET /api/workflows/runs/:id` | | 200 `Run` with its step history; 404 unknown. Poll it while a run is non-`terminal`. |
| `POST /api/workflows/:id/runs` | `{ "payload"?: {…} }` (the data the trigger event would have carried; default `{}`; at most 20 keys, 6 levels) | **202** `{ "run": RunSummary }`: the run is queued and executes asynchronously. A **manual start applies exactly the gates of a bus trigger** (workflow exists and is enabled; kill switch; rate limit; definition valid against the live tools; production authorisation bound to the hash): 404 unknown, 400 `WORKFLOW_DISABLED` for a disabled one, and where a trigger would be refused it is **403 `SECURITY_POLICY_BLOCKED`** with `details: ["RUN_REFUSED", "<run id>", "<reason>"]`; the refused run is recorded and listed like a refused trigger. The run's actor is `system:workflow-<run id>`; separately an audit record `workflow.run.started_by_user` names the user. The synthetic trigger is `event_id: "manual_<uuid>"`, `source: "user"`, `event_type: "workflow.manual"`; `trigger.where` is **not** evaluated (the user supplied the payload). |
| `POST /api/workflows/runs/:id/cancel` | `{}` | **202** `{ "cancelled": true, "status": "<status now>" }`: the run is told to stop and ends `cancelled` asynchronously (poll it). A cancel **does not run declared undo steps** (see "Gaps" in phase 40); a run with succeeded steps that declared an undo ends `failed_needs_attention` naming them. A pending approval of that run is withdrawn. 404 unknown run; **400 `RUN_NOT_ACTIVE`** when the run already finished or is not running in this process. Audited (`workflow.run.cancelled_by_user`). |

**Engine API added for these routes** (`core/workflows/src/engine.ts`): `startManual(by, workflowId, payload)` and `cancelRun(by, runId)`. Both refuse any actor that is not `kind: "user"` with `trustedByUser: true`, audit the user, and are held only by the runtime's user-route wrapper: the engine instance is never handed to the tool gateway, an agent or a workflow step.

**UI rules the contract implies.** List shows `enabled`, `environment`, `authorised` and `problems`; "Run now" opens a payload box and is disabled while `problems` is non-empty; a 403 from start shows the `reason` (it is in `details[2]`) and links to the refused run. Run history polls `GET /api/workflows/runs` and a run detail polls until `terminal`. A `waiting_approval` run has a pending confirmation in `/api/confirmations` (capability `workflows`, command `approve.<run>.<step>`): answer it there. `failed_needs_attention` and `interrupted` are not successes and must be shown as such.

## Web UI

`#/workflows` (list, nav link "Workflows"), `#/workflows/<id>` and `#/workflows/<id>/runs/<run id>` (`Workflows.tsx`). The list shows enabled/disabled, environment (PRODUCTION underlined and spelled out), authorised in words, the trigger, the problems that stop it running and a one-line run count. Detail: the definition as read-only formatted text in a scrolling `<pre>` with its version and hash, the tools it can call (a production or critical action is flagged, a declared undo named), "Check the definition" (`POST /api/workflows/validate`: problems with their paths, or the hash and whether authorisation is needed; nothing is stored), enable/disable, "Run now" (payload box, JSON object only; a 403 `RUN_REFUSED` shows the reason from `details[2]` and links to the refused run), recent runs (`failed`, `failed_needs_attention`, `interrupted` and `refused` are marked "needs a look"), and the numbers. A run page shows status and reason, the trigger, every step with input/output/error as plain text, steps that change state flagged "Changes state", the confirmation list when a step waits, and a cancel that needs a second click (a 400 `RUN_NOT_ACTIVE` is shown). It is re-read on `workflow.*` events and every 3 s while the run is not finished.

**Checked:** `apps/web/test/workflows.test.tsx` (32 cases, with phase 40's). Browser smoke against a real Core with a local test capability (`deploys.logs`, `deploys.rollback`, `deploys.undo_rollback`; no real service): a production workflow saved disabled; validate listed why it needs authorisation; a Run now before authorising was refused with "not authorised: environment is "production"; the user must authorise this exact definition" and linked to the refused run; after authorising, a double click on Run now made one POST; the run showed "Running · at step logs" and the policy confirmation for `deploys.logs` was answerable from the run page (found by the smoke, the page now shows the confirmation list for any unfinished run, not only `waiting_approval`); the workflow's own approval step followed (its `<b>` in the summary stayed text); a cancel (double click, one POST) ended `cancelled` with the approval withdrawn; a second run ran to the end through the `production_action` confirmation and showed `rollback` flagged "Changes state"; metrics showed 2 runs, 1 succeeded, 1 cancelled.

## Source documents

- Post-MVP Roadmap v1.0 §10

---
Back to [TRACKER](TRACKER.md)
