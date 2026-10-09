# Phase 36 — Action Items → Engineering Tasks

| Field | Value |
|---|---|
| Stage | Stage 6 — Meeting → Engineering (v0.6) |
| Release target | v0.6 |
| Priority | High |
| Status | 🟨 Library built and tested against local mocks; not wired into Core or the web app; never run against a real GitHub or Frappe |
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

- [ ] Approved action items become tasks linked to source meeting (gate v0.6 → v0.7) — met by the library against mocks; open until Core routes and the web approval panel exist and a creation has been tried against a real GitHub repository and a real Frappe site by the user

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

### Wiring still to do (parent)

Construct `PlanService` in the runtime with the real `ToolGateway` and `AiService` (`generate: () => generateWith(ai)`), call `plans.recover()` at startup, add routes (suggested: `POST /api/meetings/items/:id/plan`, `GET /api/plans/:id`, `PATCH /api/plans/:id`, `POST /api/plans/:id/propose|approve|create|cancel`, `GET /api/plans/:id/preview`, `GET /api/meetings/:id/links`, `GET /api/task-links?system=&id=`), and a web approval panel that shows the plan with each statement's basis, the exact `preview` of what will be sent and the policy decision, a **default-off** "name the meeting in the created tasks" checkbox, and the per-task result. Set the write token and `api` URL in the capability settings; neither is set by default, so the commands are inert until the user sets them.

## Source documents

- Post-MVP Roadmap v1.0 §8
- Fawkes PRD v1.0 Appendix A

---
Back to [TRACKER](TRACKER.md)
