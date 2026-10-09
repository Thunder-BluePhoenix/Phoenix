# Phase 33 — AI Evaluation Harness & v0.4 Release

| Field | Value |
|---|---|
| Stage | Stage 4 — Fawkes Becomes an Agent (v0.4) |
| Release target | v0.4 |
| Priority | High |
| Status | 🟨 Harness, adversarial suite and gate built; v0.4 gate FAILS on 3 documented quality defects; release not cut |
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

- [ ] Agent actions controlled and auditable (gate v0.4 → v0.5)
- [ ] Adversarial suite green

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

**Result.** Offline: 62 of 62 scenarios without a known defect pass; 0 unauthorised side effects, 0 leaks, 0 policy
bypasses, 0 cloud calls. Four scenarios expose three defects of the agent runtime (D1 stale memory is citable and
unmarked; D2 grounded is not supported; D3 a succeeded run is summarised as a failure; all quality, none unsafe), so
the v0.4 gate verdict is **FAILED** until they are fixed or accepted by the owner. Real `llama3.2` on categories a, b, g:
23 of 23 pass the model-independent checks, 4 deviate from the scripted behaviour (details in the release-gates doc).

Not done: the release itself (not cut, boxes below not ticked); the `observation` API route; wiring observations into
the runtime; a human-labelled evaluation set; real-model runs of the other categories. See `docs/gaps.md`.

---
Back to [TRACKER](TRACKER.md)
