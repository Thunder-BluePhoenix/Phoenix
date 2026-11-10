# Phase 33 — AI Evaluation Harness & v0.4 Release

| Field | Value |
|---|---|
| Stage | Stage 4 — Fawkes Becomes an Agent (v0.4) |
| Release target | v0.4 |
| Priority | High |
| Status | 🟨 Harness, adversarial suite and gate built; v0.4 gate PASSES offline after fixing 3 quality defects it found; release not cut |
| Depends on | [Phase 31 — Agent Runtime & First Vertical Slice](phase-31-agent-runtime-first-vertical-slice.md) |
| Unblocks | [Phase 34 — Coding-Agent Orchestration](phase-34-coding-agent-orchestration.md), [Phase 35 — Kage Decisions & Action-Item Extraction](phase-35-kage-decisions-and-action-items.md) |

## Goal

Make AI quality and safety measurable before any increase in autonomy, then release v0.4.

## Scope

**In scope**

- Metrics: correctness, grounding, relevance, safety, reliability, latency, cost, recovery, acceptance
- Adversarial suite
- Release gate

## Tasks

- [x] Offline benchmark tasks + regression suite in CI
- [x] Adversarial tests: prompt injection in docs, malicious tool output, conflicting context, stale memory, unauthorised deploy request, permission escalation, hallucination, partial capability failure
- [x] AI observability: model, prompt/context version, sources, tool calls, permission decisions, latency, cost, outcome
- [x] Release-gate policy doc (ADR-010)
- [ ] Release v0.4

## Deliverables

- ai/evaluation
- Adversarial suite
- v0.4 release

## Exit criteria

- [ ] Agent actions controlled and auditable (gate v0.4 → v0.5) — unchecked pending owner sign-off; the offline v0.4 gate passes, observation history is persisted and redacted, and the real-model quality check is a failing proposal (see the gap register)
- [ ] Adversarial suite green — the offline suite is green (66 of 66) and in CI; unchecked because release-level adversarial evidence and owner sign-off are still pending

## Source documents

- Technical Spec Suite 04–14 §12
- AI Evolution v1.0→v2.0 §21, §22

## Implementation notes

Everything is in `ai/evaluation` (package `@phoenix/ai-evaluation`); policy and metric definitions are in
[../release-gates.md](../release-gates.md), the decision in [ADR-0010](../adr/ADR-0010-ai-evaluation-required-for-autonomy-progression.md).

- **Scenarios** (`src/scenarios/*.ts`): 66, typed data. 10 benchmark and 56 adversarial in eight categories
  (prompt injection, malicious tool output, conflicting context, stale memory, unauthorised deploy,
  permission escalation, hallucination, partial capability failure), at least 3 each and a unicode variant in every
  category but stale memory (zero-width, full-width, RTL override, Cyrillic homoglyph).
- **World** (`src/world.ts`): the real orchestrator, tool gateway, policy engine, permission gateway, audit log,
  capability manager and `AiService` (router + privacy gate); fake leaves only (counting capabilities with the real
  `github`/`git` manifests, an `ops` capability with read/write/execute/external/production tools, a scripted model, a
  cloud-class provider that must get zero calls, a simulated user who approves or rejects every prompt).
- **Agents under attack** (`src/agents.ts`): the real CI-failure agent, an `ops_task` agent where a model plans and
  may ask for follow-up tool calls (the shape prompt injection targets; the shipped agent never lets a model choose a
  tool), and attacker code that calls out-of-list tools and policy admin.
- **Oracles** (`src/oracles.ts`) and **metrics** (`src/metrics.ts`): see the release-gates doc.
- **Report, golden file, gate, CLI** (`src/report.ts`, `golden/offline-report.json`, `src/gate.ts`, `src/cli.ts`).
- **Observability** (`src/observation.ts`, `src/store.ts`, migration 14 `eval_runs`/`eval_results`).
- **CI**: job `ai-evaluation` in `.github/workflows/ci.yml` runs the suite and prints the gate.

**Result.** Offline: 66 of 66 scenarios pass; 0 unauthorised side effects, 0 leaks, 0 policy bypasses, 0 cloud calls.
The suite first found three defects of the agent runtime (D1 stale memory was citable and unmarked; D2 grounded
meant only that the cited id exists; D3 a succeeded run was summarised as a failure; all quality, none unsafe), the
gate FAILED, and they were fixed in `ai/agents`; see the release-gates doc. Real `llama3.2` on categories a, b, g:
23 of 23 pass the model-independent checks, 4 deviate from the scripted behaviour (details in the release-gates doc).

**Observation routes (wired into Core).** `GET /api/agent/tasks/:id/observation` and the user-only observation-history/detail routes project append-only migration-22 snapshots: ids, hashes, provider/model identifiers, counts and usage only, never prompts, model input, evidence excerpts or tool text. The CI agent supplies its actual prompt version/hash and model provenance. Unknown provider token usage and cloud cost remain `unknown`; no price is fabricated. Forgetting a task deletes its observations through a foreign-key cascade. No owner-approved age-based retention period exists.

**Repeat runs and acceptance from records.** `cli.ts run --repeat N` (also `real --repeat N`; N is an integer from 1 to 20, default 1, anything else exits 2) runs every case N times in fresh worlds against the SAME provider instance and feeds `reliabilityOf` into the optional `reliability` field of each scenario verdict, with a per-category mean and a top-level `repeat`. The fields are absent for `--repeat 1`, so that output is unchanged byte for byte. The reliability outcome compares the end state and the pass/fail vector of every expectation, so a real model that deviates from the scripted behaviour counts as unstable. The wall clock that times a real provider is injectable (`WorldOptions.now`), which makes repeat output deterministic in tests. A repeat report refuses `--update-golden`. Core adds `GET /api/evaluation/acceptance` (session token, read-only, `core/runtime/src/evaluation.ts`): accepted/rejected/expired counts per kind from `meeting_items` review decisions (accepted includes edited; proposed is not a decision; no expiry exists for items) and from resolved `agent_approval.resolved` audit rows (allow = accepted, deny and terminal = rejected, timeout = expired; cancellations are not counted), plus `acceptanceFromReviews` over them. The query selects kind, status/outcome and COUNT only, so no text, command, path, owner or id can reach the response. Evidence is simulated: the repeat tests use a fake provider (and the scripted suite, which is stable at 1.0 by construction), the acceptance tests use seeded rows and the real approval routes; no real model has been repeated and no real reviewer's decisions have been counted. Latency stays virtual time offline.

Not done: v0.4 release sign-off/tag, an independent human-labelled set, real-model runs of remaining categories, verified cloud price/usage policy, and a retention duration decision. See `docs/gaps.md`.

---
Back to [TRACKER](TRACKER.md)
