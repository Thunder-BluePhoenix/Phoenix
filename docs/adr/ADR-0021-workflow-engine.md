# ADR-0021: Workflow engine — data-only workflows over the tool gateway

**Status:** Accepted  
**Date:** 2026-10-09

## Context

Phases 39–40 add event-driven WHEN / IF / THEN workflows ("production deploy fails → read logs →
diagnose → notify → recovery plan → wait for approval"). A workflow engine is a second way, next to
agents, for software to cause actions on the user's machine and accounts. It must not become a way
around ADR-0006 (permission gateway), ADR-0008 (typed agent protocol) or ADR-0010 (autonomy needs
evidence), and the text a workflow handles (logs, events, model answers) is written by third parties.

## Decision

1. **Workflows are data.** A definition is JSON (`core/workflows/src/types.ts`), checked by a
   closed JSON Schema (unknown fields are errors, every string and list is capped) and by rules a
   schema cannot express: step references, no cycles (workflows only move forward), at most 32 steps
   and 24 steps on the longest path, templates and expressions parsed at load time, `steps.<id>`
   reads only from steps that run before the reader. There is no code in a definition and nothing
   evaluates JavaScript: conditions and `{{ }}` templates use a small language implemented in
   `expr.ts` (paths into `event`, `steps`, `run`; comparisons, `and/or/not`, `in`, `contains`; no
   calls, no arithmetic, no regex from data, own-property reads of plain data only, `__proto__` and
   `constructor` rejected at parse time and unreachable at run time).
2. **Declared permissions, enforced twice.** `declares.tools` lists every tool the workflow may call;
   an `action` (or `compensate`) naming another tool fails validation, and the runner checks again
   against the definition snapshot a run started with. A declared tool no step uses is also an error.
3. **Only the tool gateway reaches capabilities.** The engine is constructed with a
   `WorkflowToolGateway` (`call`, `tools`) and never imports or holds a `CapabilityManager`; a test
   scans the package's imports. Actor: `{ kind: "system", id: "workflow-<run id>" }`.
   `trustedByUser` is true only when the action's input contains no placeholders (the author wrote
   it); an input built from event, tool or model data is "not directly asked for by the user", so the
   policy engine asks for approval. The correlation id `workflow-<run id>` is the audit actor id,
   the event `correlation_id`, and is stored on the run.
4. **AI output is untrusted data.** The instruction is fixed text from the author; run data is
   quoted as JSON lines between nonce markers; the answer is parsed and checked field by field
   against the declared output schema and unknown fields are dropped. It can be rendered into a
   notification or shown in an approval prompt but never chooses a tool, step or workflow, and is
   never rendered as a template. Default privacy class is `sensitive` (on-device models only).
5. **Approval reuses the confirmation flow** (`PermissionGateway.authorize` under capability id
   `workflows`, command `approve.<run>.<step>`): same prompt, audit, expiry and kill-switch rejection
   as every other confirmation. A run waiting for a human releases its concurrency slot.
6. **Destructive means "the tool contract says so".** Write, execute, external and production side
   effects, or the `production_action` permission, are destructive; the workflow cannot claim
   otherwise (there is no field for it). A destructive action that can run on any path before an
   approval step fails validation, and the runner refuses it at run time until an approval step in
   the same run has succeeded. The gateway/manager confirmation still applies on top.
7. **Production needs the user.** A workflow needs a `WorkflowAdmin.authorise` when its environment is
   production or any tool it can call is critical risk, a production action, or unknown. The
   authorisation is bound to a SHA-256 of the behaviour-defining content (`enabled` and `version`
   excluded), has who/when, an optional expiry (at most 90 days), is revocable and audited. Saving a
   changed definition revokes it; a row edited behind the admin's back fails its hash check and does
   not run. Saving a new production workflow stores it disabled. Runs re-check authorisation before
   each step, so revoking stops a run at its next step.
8. **Only the user changes workflows.** `WorkflowAdmin` (create/update/enable/delete/authorise/
   revoke) is a capability object the API layer builds for requests on the authenticated user
   channel. The engine, the tool gateway and agents hold none, and the store split
   (`WorkflowStore` vs `WorkflowAdminStore`) means the engine has no write method for definitions
   or authorisations. Every method also refuses non-user actors and audits the refusal.
9. **Failure is safe.** A failed step stops the run. Steps that succeeded and declared `compensate`
   are undone in reverse order, each at most once, never retried; an undo failure is recorded, the
   rest still run and the run ends `failed_needs_attention`. A call whose outcome is unknown (step
   timeout, or cancelled mid-call) is not undone automatically and also ends `failed_needs_attention`
   naming the step. A step timeout abandons the call and counts as a failure. Retries (count and
   linear back-off, at most 5) apply only to tools the contract marks idempotent.
10. **Kill switch.** On `security.kill_switch.engaged` every active run is cancelled and no further
    tool call is made, including undos (the switch blocks all calls); runs with succeeded steps that
    declared an undo end `failed_needs_attention` listing them. Pending confirmations are rejected by
    the PermissionGateway, new triggers are refused while it is engaged.
11. **Loop protection.** Events a workflow emits are `source: "workflows"` with
    `metadata.workflow_depth`; a run started by such an event has depth+1; past `maxChainDepth`
    (3) the trigger is recorded as `refused`. A workflow is never triggered by its own events,
    refusal notices trigger nothing, each workflow has a rate limit, and `(workflow, trigger event
id)` is `UNIQUE`, so the same delivery never starts two runs. An event claiming to be from
    `workflows` without a depth counts as maximally deep.
12. **Restart.** Nothing is resumed. `recover()` finishes every non-terminal run: `interrupted` when
    nothing needs a human, `failed_needs_attention` when a call's outcome is unknown or a declared
    undo was still owed. A waiting approval is `interrupted` because its prompt died with the process.
    Counters are bumped in the same transaction as the state change they count.

## Consequences

- Workflows cannot do anything an agent cannot, and cannot be made to by the text they process.
- Edits to a production workflow always need a fresh user authorisation, by design.
- `ToolGateway.call` takes no cancellation signal, so an abandoned call may still complete in the
  capability; the outcome is recorded as unknown (see the gaps register).
- Workflows are linear/DAG only: no loops, parallel branches or sub-workflows.

Implemented in Phases 39 (engine) and 40 (safety layer); package `core/workflows`.
