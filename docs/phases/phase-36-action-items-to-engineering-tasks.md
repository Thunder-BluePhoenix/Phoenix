# Phase 36 — Action Items → Engineering Tasks

| Field | Value |
|---|---|
| Stage | Stage 6 — Meeting → Engineering (v0.6) |
| Release target | v0.6 |
| Priority | High |
| Status | 🟨 Library built and tested against local mocks; wired into Core (routes below, tested through the HTTP API against the local mock GitHub and mock Frappe); the web panel is built (`#/plans/<id>`); never run against a real GitHub or Frappe |
| Depends on | [Phase 35 — Kage Decisions & Action-Item Extraction](phase-35-kage-decisions-and-action-items.md), [Phase 22 — GitHub & CI/CD Capability](phase-22-github-and-cicd-capability.md), [Phase 23 — Frappe / ERPNext Capability](phase-23-frappe-erpnext-capability.md) |
| Unblocks | [Phase 37 — Hybrid Retrieval (Lexical + Vector + Rerank)](phase-37-hybrid-retrieval.md) |

## Goal

Convert approved action items into structured engineering tasks (GitHub / Frappe) with traceability back to the meeting.

## Scope

**In scope**

- Engineering plan generation
- Task creation after approval
- Back-links to meeting

**Out of scope**

- Silent task creation

## Tasks

- [x] Generate engineering plan from requirement (e.g. Vendor Approval DocType example)
- [x] Approval → create GitHub issue / Frappe task via capability (mock servers only; see "Never run against a real service")
- [x] Store links meeting ↔ decision ↔ task
- [x] E2E: meeting → summary → decision → approved task created (in process, mock GitHub and mock Frappe)
- [ ] Release v0.6

## Deliverables

- Meeting-to-task pipeline
- v0.6 release

## Exit criteria

- [ ] Approved action items become tasks linked to source meeting (gate v0.6 → v0.7) — library, Core routes and web approval panel built and checked against local mocks; open until the user tries creation against a real GitHub repository and a real Frappe site

## Implementation notes

Package `ai/planning` (`@phoenix/ai-planning`), migration version 16 (`plans`, `plan_task_runs`, `plan_links`), plus two new **write** commands: `github.issue.create` and `frappe.task.create`.

### Never run against a real service

**The creation commands were never run against a real GitHub repository or a real Frappe site.** Every test, demo and verification used a local mock server on `127.0.0.1` (`capabilities/github/testing/mock-github.ts`, `capabilities/frappe/testing/mock-frappe.ts`). That the mocks behave like the real services is an assumption: GitHub's search tokenisation of the idempotency marker, its rate limits for creating issues, Frappe's HTML sanitising of the description and the exact `417` validation body were not observed. The only real service used was local Ollama (`llama3.2`) for plan generation, which creates nothing.

### The two creation commands

| | `github.issue.create` | `frappe.task.create` |
|---|---|---|
| side effect / permissions | `external`; `network`, `external_api` | `external`; `network`, `external_api` |
| credential | secret `write_token` (a token that may create issues) | secret `write_token` as `api_key:api_secret` |
| where it writes | `api_url` (default `https://api.github.com`), repository from the input | the URL under config `api[<site>]` only, never `host_name`, bench files or the polling `sites` overrides |
| input (all with caps) | `repository`, `title` ≤256, `body` ≤10 000, `labels` ≤10×50, `idempotency_key` | `site`, `subject` ≤140, `description` ≤10 000, `priority`, `exp_end_date`, `project`, `idempotency_key` |
| marker | `<!-- phoenix-ref:KEY -->` at the end of the body | visible last line `Phoenix ref: KEY` in the description (Frappe may sanitise HTML comments away) |
| duplicate check | newest 30 issues of the repository, then GitHub search | `GET /api/resource/Task` filtered on the key |
| output | `{status: created\|existing, repository, number, url, idempotency_key}` | `{status, site, name, url, idempotency_key}` |

Gates, in order: the capability must be enabled; a write credential must be in the secret store (a read-only token **cannot** enable writes: the secrets have different names and the read token is never used to write; a missing one fails before any request with a message naming `write_token`); the policy engine must allow the call (`external` is high risk; an agent would always need a fresh approval); and the capability manager asks the user to confirm every call. Redirects are refused, responses are size-capped and validated, titles and bodies are secret-redacted and stripped of control characters and of any marker the user typed, and the error text never contains the credential, the request or anything the remote side wrote.

**Idempotency and its limits.** Before posting, the command looks for the key. A retry after a timeout, a dropped connection or a crash therefore returns the existing resource instead of creating a second. The POST itself is never retried automatically; when its outcome is unknown the error says so and says that retrying with the same key is safe. **Eventual consistency (GitHub):** the recent-issues list is read-after-write; the search index lags by seconds to minutes. A retry made after the issue has fallen out of the newest 30 *and* before search has indexed it creates a duplicate (a test pins this documented limit). A failed lookup is an error, never a reason to create anyway. Frappe queries its database directly, so its lookup is strongly consistent.

### Plan generation (`generate.ts`)

`PlanService.generate(itemId, destination, actor)` accepts only an **accepted** decision, requirement or action item and stores an `EngineeringPlan` as a `draft`: title, summary, acceptance criteria, tasks (title, body, labels), risks, open questions, optionally a Frappe DocType proposal (fields with allow-listed types, workflow states, role permissions) and a snapshot of the source item. The destination (a repository or a Frappe site) is chosen by the user and cannot be changed by the model.

- The model call is an injected `GenerateFn` with `privacy: "sensitive"` and a purpose that is **not** in `SENSITIVE_CLOUD_PURPOSES`, so even a user who opted in to cloud AI for sensitive data does not get plan generation in the cloud. Tested through a real `AiService` with a counting fake `fetch`: AI off → zero requests; AI on, Ollama down → zero cloud requests; every opt-in combination → zero cloud requests.
- The reply is data. It is rebuilt from known keys (unknown keys are dropped and counted), every string is redacted, stripped of control characters and clipped, counts are capped (8 tasks, 12 criteria, 8 risks), and the item text sits between nonce markers.
- **Grounding.** A statement is marked `meeting` (with the item id and a verbatim quote) only if its quote really occurs in the text the model was shown (the item, its quote and a bounded transcript excerpt) *and* shares at least half of the statement's content words (so a real quote cannot support a made-up claim). Everything else is kept but marked `suggested by the model`, and the created task body says so. The model has no field with which to claim its own basis.
- **No AI**, no allowed provider, a failing provider or an unreadable reply: a deterministic skeleton built from the item text alone, labelled *Not AI generated*, with open questions for the owner and due date the meeting did not give. It invents nothing.
- **Examples.** *Frappe*: "we need a vendor approval flow" gives a plan for a `Vendor Approval` DocType (fields, workflow states Draft → Pending Approval → Approved/Rejected, roles with read/write/create) rendered into the first Task's description as "suggested by the model". *GitHub*: the same requirement gives labelled issues. Both are tests with a scripted model.

### Approval and creation (`service.ts`)

`draft → proposed → approved → creating → created | failed`, and `cancelled` (table `PLAN_TRANSITIONS`, all 49 pairs tested). `failed → creating` is the retry.

- **Approval is bound to the content.** `approve(planId, {hash, includeMeetingRef}, actor)` needs the SHA-256 of the exact content the person looked at (`contentHash`); a stale hash is refused. `create` re-checks that the stored approval hash equals a hash *recomputed from the stored content* before the first task and again before every task, so an edit (which always returns the plan to `draft` and clears the approval), or a row changed behind the service's back, cannot be created.
- **No silent creation.** Only `create` calls the gateway, only for an `approved` (or retried `failed`) plan; a counting fake gateway proves that generate, edit, propose, preview, list, recover and `create` on any other status make zero calls.
- **Actor.** Creation goes through `ToolGateway.call` with `actor = {kind: "user", id, trustedByUser: true}`: the user approving the plan is the human gate, and the plan service is only ever invoked from the user's own request. The gateway still evaluates policy and audits; the capability manager still asks the user to confirm each `external` call, so the user also sees a prompt per created task. A plan cannot be approved or created by an agent because agents have no path to these methods; the agent tool surface (Phase 30) does not expose them and must not.
- **One task at a time**, in order, recording each result, **stopping at the first failure**. Each task's idempotency key (`phx_<hash of plan id>_<index>`) is stored in `plan_task_runs` *before* its first attempt and reused on every retry. `recover()` (run at startup) turns a plan left `creating` by a crash into `failed`; the retry sends the same key and the capability finds what was already created.
- **Privacy default.** A created task carries only an opaque `Phoenix plan <id>` line. The meeting's title and id are written into the task **only if** the user ticked "name the meeting in the created tasks" when approving; the choice is part of the approval and editing resets it. Quotes from the transcript, people's names (other than an owner the user kept in the task text) and the meeting title never reach GitHub or Frappe by default. Meetings are sensitive and a GitHub issue may be public.

### Traceability (migration 16)

`plan_links` stores meeting ↔ item ↔ plan ↔ task (`system`, `external_id`, `url`) with who approved and when. `linksForMeeting`, `linksForItem`, `linksForPlan` and `linksForTask(system, externalId)` read it both ways. Deleting a meeting (`MeetingStore.delete` / `deleteBefore`, which write a tombstone) deletes its plans, task state and links in the database through a trigger (tested, including with other meetings' plans left alone). **What was already created in GitHub or Frappe is not touched**; Phoenix simply forgets which meeting it came from. The plan content is itself derived from the meeting, which is why it is deleted rather than kept.

### Wired into Core

`core/runtime/src/planning.ts` (`PlanningRuntime`, exposed as `PhoenixRuntime.planning`; `recover()` runs at construction) builds `PlanService` with the real `ToolGateway` and `AiService`; `core/api/src/plan-routes.ts` exposes the plan and task-link routes in the API contract below. `apps/web/src/components/Plans.tsx` provides the web approval panel: each statement's basis, the exact preview and policy decision, a **default-off** "name the meeting in the created tasks" checkbox, and per-task results. Tests are in `core/runtime/test/plans.test.ts` and `apps/web/test/plans.test.tsx`. Set the write token and `api` URL in capability settings; neither is set by default, so the commands remain inert until the user configures them.

## API contract

All routes need the session token and are **user routes**: there is no tool, capability command or agent path to any of them (the tool registry lists no `plans.*` tool, and `approve`/`create` exist only as these HTTP handlers). Bodies are JSON objects with **exact keys** (an unknown field is 400). Errors are `{code, message, details}`: 400 invalid request (also: item not accepted, plan in the wrong status, stale hash), 404 unknown or not visible (indistinguishable), 409 `ACTION_REQUIRES_CONFIRMATION` (missing `confirm: true`) or `CAPABILITY_DISABLED` (planning is off, see below), 401 no token. JSON is snake_case.

**Off by default.** Generating and creating work only when **AI is on** *and* the destination is configured: the `github` capability enabled with its `write_token` set (GitHub), or the `frappe` capability enabled with `write_token` set and the chosen site listed under its `api` config (Frappe). Otherwise `POST .../plan` and `POST .../create` answer **409 `CAPABILITY_DISABLED`** with `details: ["PLANNING_OFF", ...reasons]` and nothing is generated or sent. Reading, editing, proposing and cancelling existing plans always work. `GET /api/plans/status` says which condition is missing.

**Plan** (`PlanView`):

```json
{
  "id": "plan_…", "meeting_id": "kage:7", "item_id": "mi_…",
  "target": "github | frappe",
  "destination": { "system": "github", "repository": "owner/name" } | { "system": "frappe", "site": "erp.localhost" },
  "status": "draft | proposed | approved | creating | created | failed | cancelled",
  "content_hash": "<sha-256 hex of the content shown>",
  "approved": { "hash": "…", "by": "owner", "at": "ISO" } | null,
  "include_meeting_ref": false,
  "title": "…", "generated_by": "rules | ai:<provider>/<model>", "not_ai_generated": true,
  "summary": Statement, "acceptance_criteria": Statement[], "risks": Statement[], "open_questions": string[],
  "tasks": [ { "title", "body", "labels": string[], "basis": "meeting|suggested|user", "item_id"?: string, "quote"?: string } ],
  "frappe": null | { "doctype", "fields": [{ "label", "fieldtype", "required" }], "workflow_states": string[], "permissions": [{ "role", "read", "write", "create" }] },
  "source": { "item_id", "meeting_id", "kind", "item_text", "owner": string|null, "due": string|null, "quote": string|null },
  "created_at": "ISO", "updated_at": "ISO"
}
```

`Statement` = `{ "text", "basis": "meeting|suggested|user", "item_id"?, "quote"? }`. `basis: "meeting"` carries the verbatim `quote`; **show the basis next to every statement** ("from the meeting" / "suggested by the model" / "written by you"). `content_hash` is what `approve` must echo back.

**Run** (`TaskRunView`): `{ "task_index", "idempotency_key", "status": "pending|attempting|created|failed", "attempts", "external_id": string|null, "url": string|null, "error": string|null, "updated_at" }`. **Link** (`PlanLinkView`): `{ "id", "meeting_id", "item_id", "plan_id", "task_index", "system": "github|frappe", "external_id", "url", "approved_by", "approved_at", "created_at" }`. **Detail** (`PlanDetailView`) = `{ "plan": Plan, "runs": Run[], "links": Link[] }`.

| Route | Body / query | Success |
|---|---|---|
| `GET /api/plans/status` | | 200 `{ "enabled": bool, "ai_enabled": bool, "reasons": string[], "destinations": { "github": { "capability_enabled": bool, "write_token_set": bool }, "frappe": { "capability_enabled": bool, "write_token_set": bool, "sites": string[] } } }`. `enabled` is true when AI is on and at least one destination is configured; `reasons` are sentences for the user when it is false. |
| `POST /api/meeting-items/:id/plan` | `{ "destination": { "system": "github", "repository": "owner/name" } \| { "system": "frappe", "site": "…" } }` | **201** `{ "plan": Plan, "generation": { "stats": { "proposed", "grounded", "suggested", "ignored_fields", "design_dropped" }, "unavailable": string \| null } }`. The plan is a `draft`. 400 for an item that is not accepted or a kind that cannot be planned (topics, project references), or a malformed destination. Can take a minute with a local model. |
| `GET /api/meetings/:id/plans` | | 200 `{ "meeting_id", "plans": [{ "id", "item_id", "target", "status", "title", "task_count", "created_at", "updated_at" }] }`, newest first. |
| `GET /api/meetings/:id/links` | | 200 `{ "meeting_id", "links": Link[] }`: every task created from the meeting. |
| `GET /api/task-links?system=&id=` | `system` ∈ github/frappe, `id` the issue number or Task name (1-200 chars) | 200 `{ "links": Link[] }`: the meeting, item and plan a task came from. Not meeting-scoped: it lists ids and urls only. |
| `GET /api/plans/:id` | | 200 `Detail`. |
| `GET /api/plans/:id/preview` | | 200 `{ "plan_id", "tasks": [{ "task_index", "tool": "github.issue.create \| frappe.task.create", "input": {…exactly what will be sent…}, "decision": { "effect", "risk", "reasons": string[], "matched": string[] } }] }`. Show it in the approval panel. |
| `POST /api/plans/:id/edit` | any of `{ "title", "summary", "acceptance_criteria": string[], "tasks": [{ "title", "body", "labels"?: string[] }], "risks": string[], "open_questions": string[], "destination" }` (at least one key) | 200 `Detail`. **Always returns the plan to `draft` and clears the approval.** A plan cannot move between GitHub and Frappe (400). 400 when `creating`, `created` or `cancelled`. |
| `POST /api/plans/:id/propose` | `{}` | 200 `Detail` (draft → proposed). |
| `POST /api/plans/:id/approve` | `{ "hash": "<content_hash>", "include_meeting_ref"?: bool (default false) }` | 200 `Detail` (proposed → approved). 400 when the hash is not the current `content_hash` ("review it again"). `include_meeting_ref` names the meeting in the created tasks; default off, part of the approval. Audit `plan.approved`. |
| `POST /api/plans/:id/create` | `{ "confirm": true }` | 200 `{ "plan", "runs", "links", "failure": null \| { "task_index", "message" } }`. Creates the tasks one at a time **as the user** through the tool gateway; stops at the first failure and leaves the plan `failed` (call again to retry with the same idempotency keys; a task that already exists is found by its key, not created twice). The request **stays open while each task waits for the user's confirmation** in `/api/confirmations` (capability `github`/`frappe`, command `issue.create`/`task.create`); do not block the UI on it. 409 `ACTION_REQUIRES_CONFIRMATION` without `confirm: true`. 400 when the plan is not `approved`/`failed` or its approval no longer matches its content. |
| `POST /api/plans/:id/cancel` | `{}` | 200 `Detail` (draft/proposed/approved/failed → cancelled). 400 while `creating`. |

**UI rules the contract implies.** Show the status gate (`/api/plans/status`) before offering "Make a plan". Show the basis of every statement and the `preview` (with the policy `decision`) before approval; the "name the meeting in the created tasks" box is **off** by default. Never offer approve for a plan whose hash changed; after any edit the plan is `draft` again. After `create`, show each run's `status`, `url` and `error`, and the links. The per-task confirmation prompts arrive through the normal confirmation flow.

## Web UI

"Make a plan…" sits on every accepted decision, action item and requirement of the meeting page (`Plans.tsx`, `MakePlan`); it asks for the destination (GitHub `owner/name`, Frappe site), validates it like the API, and shows every `reasons` sentence from `GET /api/plans/status` (or from a `PLANNING_OFF` refusal) when planning is off. The plan page is `#/plans/<id>`:

- **Reading.** Status in words, a "Rules-based draft" or "Model output (provider/model)" label, the destination, every statement with its basis ("from the meeting" with the stored quote, "suggested by the model", "written by you"), and the exact preview (`GET /api/plans/:id/preview`: tool, input, policy verdict) as plain text in a scrolling `<pre>`.
- **Editing** (title, summary, destination, tasks with title/body/labels, add/remove up to 8) validates with the service's rules and sends only what changed. Saving returns the plan to draft, as the API does.
- **Approve** sends the `content_hash` of the plan on screen (plus `include_meeting_ref`). If the plan changed, Core's refusal is shown and the plan is reloaded to what Core now holds.
- **Create** needs a tick ("I understand this creates N tasks in <destination>, as me") and sends `{confirm:true}`. The request is held open with no client timeout; while it is open the page says "Waiting for your approval of task N of M", shows the confirmation list (`Approvals`), keeps Create disabled and sends nothing on a second click. The per-task report, a failure ("stopped at task N", retry is safe), and the links created follow. External addresses are text, linked only if `https:`. The meeting page lists its plans (`GET /api/meetings/:id/plans`) and the tasks created (`/links`).

**Checked:** `apps/web/test/plans.test.tsx` (24 cases: happy path, planning off, errors, hostile text, double click on Approve, Draft, Create and Cancel, stale-hash refusal, the long-blocking create against a fake Core that holds the request open, http/javascript links as text). Mutations, each failing a test and restored: approve without the hash; Create enabled while pending; Create without the tick; any URL linked. Browser smoke against a real Core with a local GitHub mock (`capabilities/github/testing/mock-github`) and a fake model reply (see below): accept a decision, "Make a plan…" (one POST on a double click), propose, a plan edit made through the API behind the page, Approve refused with Core's message and the page reloaded to the new fingerprint, then approve, tick, double-click Create (one POST; "Waiting for your approval of task 1 of 2." appeared in 30 ms and stayed 8 s with no error), approve task 1 in the UI, the page moved to task 2 of 2, approve task 2, both tasks listed with https links and the same single `create` request returned.

**The mock saw the writes:** the rig that ran the plan flow closed with the mock GitHub having recorded 2 writes and 2 issues, one per approved task and no duplicate for the double click. **Not covered by the smoke:** a real model (the reply was a fixed JSON from the test double; local Ollama was not running) and Frappe (no Frappe mock was started).

## Source documents

- Post-MVP Roadmap v1.0 §8
- Fawkes PRD v1.0 Appendix A

---
Back to [TRACKER](TRACKER.md)
