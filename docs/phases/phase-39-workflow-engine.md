# Phase 39 — Workflow Engine

| Field | Value |
|---|---|
| Stage | Stage 8 — Automation & Workflows (v0.8) |
| Release target | v0.8 |
| Priority | High |
| Status | 🟨 Engine built and tested in-process (real SQLite, PermissionGateway, CapabilityManager, ToolGateway, EventBus; one real run with Ollama `llama3.2`); not wired into Core and no UI yet (see [gaps register](../gaps.md)) |
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
- [ ] Workflow UI: list, run history, status

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
- Not done: Core wiring, API routes and the workflow UI (list, run history, status). See the gaps register and the shared edits listed in the hand-off.

## Source documents

- Post-MVP Roadmap v1.0 §10

---
Back to [TRACKER](TRACKER.md)
