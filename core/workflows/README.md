# @phoenix/workflows

Event-driven WHEN / IF / THEN workflows (Phases 39–40). Design and decisions: [ADR-0021](../../docs/adr/ADR-0021-workflow-engine.md).

- `validate.ts` / `schema.ts`: definitions are JSON, closed-schema validated; declared tools, forward-only steps, destructive steps need an approval step before them.
- `expr.ts`: the safe expression and template language (no code execution).
- `engine.ts` + `executor.ts` + `runner.ts`: triggers, runs, retries, timeouts, compensation, kill switch, recovery. Capabilities are reached only through the injected `ToolGateway`.
- `admin.ts`: `WorkflowAdmin`, the only way to create, change, enable or authorise a workflow (user actor only).
- `store.ts`: SQLite (migrations 12–13). `WorkflowStore` for the engine, `WorkflowAdminStore` for the admin.

Saving via authenticated `POST /api/workflows` accepts `{definition, create_only: true}`
for a new workflow or `{definition, expected_hash: hash}` for an edit. Both preconditions
are checked within the same SQLite write transaction as the definition and audit record;
a concurrent change returns `VERSION_CONFLICT` without overwriting it.

Run history can be removed through authenticated `POST /api/workflows/runs/:id/delete`
(`confirm_evidence: true` is required for destructive, uncertain, or needs-attention runs),
or pruned in bounded pages via `POST /api/workflows/runs/prune` with an ISO `before`,
`limit` (1–200), and optional `confirm_evidence`. Active runs cannot be removed;
ordinary retention and privacy deletion leave audit-relevant runs intact. A run's
definition/trigger snapshot and its step rows are erased together by the database's
run-step foreign-key cascade. Retention pruning preserves the one-minute rate-limit
window; privacy delete-all removes even recent terminal runs unless they contain protected evidence.

Phase 49 controlled autonomy does not reuse `startManual` (authenticated user only).
`startAutonomous(agent, id, level)` records an audited refusal without scheduling a run:
an audited OS sandbox is not available, so autonomous CI→patch→tests→approval→PR→verify
and autonomous compensation are not claimed. Existing user-authorised event/manual workflows
retain their existing approval, kill-switch, failure/compensation and restart semantics.
