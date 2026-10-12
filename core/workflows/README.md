# @phoenix/workflows

Event-driven WHEN / IF / THEN workflows (Phases 39–40). Design and decisions: [ADR-0021](../../docs/adr/ADR-0021-workflow-engine.md).

- `validate.ts` / `schema.ts`: definitions are JSON, closed-schema validated; declared tools, forward-only steps, destructive steps need an approval step before them.
- `expr.ts`: the safe expression and template language (no code execution).
- `engine.ts` + `executor.ts` + `runner.ts`: triggers, runs, retries, timeouts, compensation, kill switch, recovery. Capabilities are reached only through the injected `ToolGateway`.
- `admin.ts`: `WorkflowAdmin`, the only way to create, change, enable or authorise a workflow (user actor only).
- `store.ts`: SQLite (migrations 12–13). `WorkflowStore` for the engine, `WorkflowAdminStore` for the admin.

Phase 49 controlled autonomy does not reuse `startManual` (authenticated user only).
`startAutonomous(agent, id, level)` records an audited refusal without scheduling a run:
an audited OS sandbox is not available, so autonomous CI→patch→tests→approval→PR→verify
and autonomous compensation are not claimed. Existing user-authorised event/manual workflows
retain their existing approval, kill-switch, failure/compensation and restart semantics.
