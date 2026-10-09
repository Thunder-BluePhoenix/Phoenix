# Phase 31 — Agent Runtime & First Vertical Slice

| Field | Value |
|---|---|
| Stage | Stage 4 — Fawkes Becomes an Agent (v0.4) |
| Release target | v0.4 |
| Priority | Critical |
| Status | ✅ Built; real GitHub, git and Ollama runs done (see Implementation notes) |
| Depends on | [Phase 30 — Policy Gateway & Tool Gateway](phase-30-policy-and-tool-gateway.md) |
| Unblocks | [Phase 32 — Fawkes Chat & Approval UX](phase-32-fawkes-chat-and-approval-ux.md), [Phase 33 — AI Evaluation Harness & v0.4 Release](phase-33-ai-evaluation-harness.md) |

## Goal

Build the AI orchestrator and a single bounded agent, proving the full loop end-to-end.

## Scope

**In scope**

- AI Orchestrator, Intent/Task manager
- Agent object model + states
- Observe → Understand → Propose → Approve → Execute → Verify
- CI-failure use case

**Out of scope**

- Multi-agent (Phase 47)

## Tasks

- [x] Implement request lifecycle: classify → retrieve context → plan → policy check → execute → verify → respond → audit
- [x] Agent/Task/Plan/ToolRequest/Result/Verification objects
- [x] Agent states: CREATED → READY → RUNNING → WAITING_APPROVAL → VERIFYING → COMPLETED/FAILED/CANCELLED
- [x] First agent: CI failure → read logs → check recent commits → likely cause → propose fix
- [x] Cancel / disable active automation
- [x] Vertical slice: Fawkes click → task → context → plan → permission → capability → verify → audit → Fawkes

## Deliverables

- ai/orchestrator
- ai/agents
- Vertical slice demo

## Exit criteria

- [x] Vertical slice works end-to-end and is fully auditable

## Notes & risks

- Tech Spec: complete this slice before building many isolated features.

## Implementation notes

**Where things are**

- `protocol/src/agent.ts` + `protocol/schemas/agent-task-v1.schema.json`: Task, Agent, AgentRun, Plan/PlanStep, ToolRequest/ToolResult, Evidence, Verification, Diagnosis, their validators (Ajv, every object rejects unknown fields) and the run state machine. `RUN_TRANSITIONS` is the whole table; `COMPLETED` is reachable only from `VERIFYING`; terminal states have no exits. A Plan has no risk field: risk comes from the policy engine when a tool is called.
- `ai/orchestrator`: `Orchestrator` (lifecycle `classify → retrieve → plan → policy_check → execute → verify → respond → audit`, one audit record per stage), `checkPlan` (plans are untrusted), `EvidenceBook`, `AgentStore` (migration 8), `approvalFeed`, run events. It never imports the capability manager (a test scans the sources).
- `ai/agents`: the CI-failure agent (`ci-failure.ts`), tool-output parsers (`ci-data.ts`) and the grounding rules (`grounding.ts`).
- `core/runtime/src/agents.ts` (`runtime.agents`) and `core/api/src/agent-routes.ts`: wiring and HTTP.
- New read-only commands: `github.ci.failure_details` (`capabilities/github`) and `git.recent_commits` (`capabilities/git`, optional `ref`: only the ancestors of a given commit; each commit also carries `committer_date`).
- `ai/orchestrator` `AgentDefinition.prepareInput` lets an agent fill a step's input from what an earlier step observed (code only; the gateway still validates it against the tool's schema).
- `scripts/demo-vertical-slice.ts`: the end-to-end demo against a real running Core.
- Migration 8: `agent_tasks`, `agent_runs`, `agent_steps`, `agent_evidence`, plus triggers that blank evidence copied from a memory when that memory is forgotten, edited or deleted.
- `ToolGateway` gained `preview(call)` (policy decision, nothing recorded) and `ToolGatewayError.auditId`, so even a denied or failed call names the audit row of its policy decision.

**Rules enforced in code**

1. An agent acts only through `ToolGateway.call` as `{ kind: "agent", id, trustedByUser: false }`. Environment, resource and data class come from `AgentDefinition.classify` (task kind + validated input), never from a plan or a model. For the CI agent: `local`, `repo:<owner/name>`, `internal`.
2. Plans are validated before step 1 runs: schema (no extra fields, so no `risk`, `environment` or `approved`), step budget, sequential indexes, the capability must be on the kind's allow-list, the tool on its tool list and in the registry, and the input must satisfy the tool's own input schema. A rejected plan is logged, fails the run with a reason, and executes nothing. `callTool` re-checks the allow-lists, so a hostile agent cannot bypass the plan.
3. Budgets: `maxSteps` 8, `maxToolCalls` 12 (the verifier's calls count), `maxWallMs` 10 minutes by the injected clock plus a timer that abandons an in-flight call, `maxActiveRuns` 4.
4. Cancellation: `cancel(taskId)` aborts the run at any stage; the in-flight tool call is abandoned (it may already have been decided and audited by the gateway; that record stands), a pending approval prompt is withdrawn, the run goes `CANCELLED` and nothing further executes. Turning automation off cancels every active run; engaging the kill switch cancels them at once (bus subscription) and also at every checkpoint, and new tasks are refused.
5. Automation is off by default (`agents.enabled`, ADR-0010).
6. Audit details hold ids, counts, tool names and decision ids only. Prompts, memory text and tool output are never in audit details (test: a sentinel string in tool output and in the conclusion appears nowhere in the audit log or the step rows). Evidence excerpts are redacted, hashed (SHA-256 of the full redacted text) and capped at 1500 characters; they are stored in `agent_evidence`.
7. A restart cannot resume a run (its tool calls are gone): a run found in a non-terminal state at startup is closed `FAILED` with the reason "Phoenix stopped while this run was in progress" and an `agent.stage.audit` record.
8. AI is optional. With AI off the CI agent returns the same evidence and a rule-based summary with `ai_used: false` and makes **zero** model calls (counting fake test; also a runtime test with a counting network). With AI on, the model only writes claims and one proposal; it never picks a tool.

**Grounding (the CI agent)**

- Every claim carries `evidence_ids`. A claim is `grounded` only if it cites at least one id, every cited id exists in this run's evidence, the evidence is not model output, and its text is non-empty. Invented ids are removed from the claim and noted; claims with no citation are kept but flagged `grounded: false` with a note.
- `evidence_coverage` = grounded claims / all claims, computed by Phoenix. The model's own words about its confidence are returned only as `model_reported_confidence` and are used for nothing.
- **Which commits may be cited (found by running the demo against the real failed run).** The first version read the newest commits of the LOCAL repository, so the demo called a commit authored six days AFTER the run "possibly related". That was a false causal story. Now, in code:
  1. The commit step starts from the run's own head commit: `git.recent_commits` takes an optional `ref` (7-40 hex characters only, so no option, revision expression or path can be injected) and lists only that commit and its ancestors. The agent passes the `head_sha` that `github.ci.failure_details` returned (`prepareInput` in the agent definition; code, not model output).
  2. If the head commit is not in the local repository (`git cat-file -e` fails) the tool answers `ref.found: false` and no commits. The agent records that as evidence, says so in a claim and in the summary ("the commit this run was built from is not in the local git repository, so no local commit can be tied to the failure"), and attributes nothing. Every claim it makes is then about the run itself.
  3. Second guard: any commit whose author date or committer date is later than the run's `created_at`, or whose date is missing or unreadable, is excluded and counted in the summary. It is never put in evidence, so it cannot be cited.
  4. The "possibly related" post-check now requires ancestry AND date order AND file overlap. A model statement naming a commit that fails ancestry or date order is replaced by "No commit in the evidence can be tied to the failure ..." (not even "possibly related", and the sha is dropped from the text).
- A statement that a commit caused the failure is rewritten to "possibly related; the evidence does not establish that it caused it" unless that commit's sha is in the evidence, it led to the run, it is not newer than the run, **and** it changed a file in the failing area (a path containing a word from the failed job/step names, or a path named by the log). Applied to model claims and to the proposal, after the model has answered (post-check, not prompt).
- The verifier fails the run (`FAILED`, not `COMPLETED`) when no failure was observed or no claim is grounded. Citation removal, reworded causal wording and ungrounded model claims are informational checks (`required: false`): they show in the trace but do not fail a run that still has a grounded diagnosis.
- Sensitive memories (meeting content) are never copied into an agent trace or put in a prompt.
- Model output is untrusted: it is parsed leniently, cut and flattened, and stored as `model` evidence, which cannot be cited.

**The "fix" is a proposal.** `github` is read-only (Phase 22 scope), so this phase has no write capability for CI. A proposal is advice (`advisory: true`) with a rationale and evidence ids, and the rationale says so. To prove Approve → Execute → Verify end to end anyway, the orchestrator's approval/verify path is exercised with a test capability that has a write tool, through the real `PermissionGateway` confirmations and `ToolGateway`: approve, reject, expire, cancel while waiting, a verification that re-reads state through a read tool and records pass/fail, and a failed verification marks the run `FAILED` (`ai/orchestrator/test/orchestrator.test.ts`, `core/runtime/test/agents.test.ts`).

**Approvals.** There is no second approval path. The agent's write waits in the existing `/api/confirmations` flow. The run shows `WAITING_APPROVAL` and Fawkes shows WAITING. `GET /api/confirmations` adds optional `task_id`, `risk`, `target`, `preview` and `evidence_ids` to a confirmation that belongs to an active run; every existing field is unchanged.

**Fawkes.** Events `agent_run.started|thinking|waiting|completed|failed|cancelled` (source `core`, not a reserved namespace, not `agent.*`), one correlation id per run. Mapping in `core/state-engine/src/default-mapping.ts`: started/thinking → THINKING, waiting → WAITING (`requires_action`), failed → ERROR, completed → SUCCESS (ttl 8 s), cancelled → clear.

## API contract

All routes need the session token (`Authorization: Bearer <token>`). Errors are `{ "code", "message", "details": string[] }` with the usual status for the code. Task ids are `task_` + 32 hex characters. Unknown fields in a request body are rejected (400).

### `POST /api/agent/settings` / `GET /api/agent/settings`

Request (POST): `{ "enabled": boolean }`. Response (both):

```json
{
  "enabled": false,
  "kinds": ["ci_failure"],
  "limits": { "max_steps": 8, "max_tool_calls": 12, "max_wall_ms": 600000, "max_active_runs": 4 },
  "active_runs": 0
}
```

Turning it off cancels every active run. Each change writes an `agents.settings.changed` audit entry.

### `POST /api/agent/tasks` → 202

Request: `{ "kind": "ci_failure", "input": { "repository": "owner/name", "run_id": 37145498780 } }` (`run_id` optional positive integer; without it the most recent failed run is used). Response:

```json
{ "task": { "id": "task_…", "kind": "ci_failure", "state": "CREATED", "title": "CI failure in owner/name",
            "requested_by": "user", "created_at": "ISO", "updated_at": "ISO", "failure_reason": null } }
```

Refusals: automation off → 409 `CAPABILITY_DISABLED` with `details: ["AGENTS_DISABLED"]`; kill switch → 403 `SECURITY_POLICY_BLOCKED`; bad kind/input/unknown fields → 400 `INVALID_REQUEST`; four runs already active → 503 `CAPABILITY_UNAVAILABLE` with `details: ["TOO_MANY_RUNS"]`. Nothing is stored for a refused task.

### `GET /api/agent/tasks?state=&limit=`

`state` (optional) is a run state, case-insensitive; `limit` 1-200 (default 50). Newest first. Response: `{ "tasks": [ <task summary as above> ] }`. `state` in a summary is the latest run state: `CREATED | READY | RUNNING | WAITING_APPROVAL | VERIFYING | COMPLETED | FAILED | CANCELLED`.

### `GET /api/agent/tasks/:id`

```json
{
  "task": { "id": "task_…", "kind": "ci_failure", "input": { "repository": "o/n", "run_id": 1 },
            "requested_by": "user", "created_at": "ISO", "correlation_id": "corr_…" },
  "run": { "id": "run_…", "state": "COMPLETED", "agent_id": "ci-failure", "agent_version": "1.0.0",
           "created_at": "ISO", "updated_at": "ISO", "failure_reason": null },
  "steps": [ { "seq": 1, "kind": "stage | tool_call", "name": "classify | github.ci.failure_details | …",
               "status": "ok | failed | rejected | cancelled | skipped | denied | abandoned",
               "detail": { }, "policy_audit_id": 8, "decision": "allow | require_approval | deny | null",
               "risk": "low | medium | high | critical | null", "stage_audit_id": null,
               "started_at": "ISO", "finished_at": "ISO" } ],
  "evidence": [ { "id": "E1", "kind": "tool_output | memory | commit | log | model", "source": "…",
                  "excerpt_hash": "sha256 hex", "excerpt": "…", "truncated": false } ],
  "summary": "string | null",
  "diagnosis": { "summary": "…", "evidence_coverage": 1,
                 "model_reported_confidence": "string | null", "ai_used": false,
                 "claims": [ { "text": "…", "evidence_ids": ["E1"], "grounded": true,
                               "origin": "rule | model", "note": "string | null" } ] },
  "proposals": [ { "text": "…", "rationale": "…", "evidence_ids": ["E2"], "advisory": true, "grounded": true } ],
  "ai_used": false, "processed_by": "string | null", "model_calls": 0,
  "verification": { "passed": true,
                    "checks": [ { "name": "…", "passed": true, "detail": "…", "required": true } ] },
  "audit_ids": [4, 5, 6]
}
```

`diagnosis`, `summary`, `verification` are `null` until the run has produced them (and stay `null` for a failed or cancelled run: an unverified conclusion is never stored). `steps` hold the eight stages (each with `stage_audit_id`) and every tool call (each with `policy_audit_id`). `audit_ids` lists every audit record the run wrote or caused; each resolves in `GET /api/audit`. 404 for an unknown id.

### `POST /api/agent/tasks/:id/cancel`

Body `{}`. Response `{ "cancelled": true, "state": "CANCELLED" }`; for a run that already finished `{ "cancelled": false, "state": "<final state>" }`. 404 for an unknown id.

### Approvals: existing `GET /api/confirmations`, `POST /api/confirmations/:id`

Unchanged, plus these **optional** fields on a confirmation raised by an active agent run: `task_id`, `risk` (`low|medium|high|critical`, from the policy engine), `target` (the trusted resource, for example `repo:owner/name`), `preview` (what the tool does and its redacted input, at most 300 characters) and `evidence_ids` (evidence the run holds so far).

### Fawkes events

`agent_run.started`, `agent_run.thinking`, `agent_run.waiting` (`requires_action: true`), `agent_run.completed`, `agent_run.failed`, `agent_run.cancelled`. Source `core`, `correlation_id` = the task's `correlation_id`, payload `{ task_id, run_id, kind, title, stage?, reason? }`.

## Source documents

- Technical Spec Suite 04–14 §04, §07, §14 vertical slice, §17
- Post-MVP Roadmap v1.0 §6

---
Back to [TRACKER](TRACKER.md)
