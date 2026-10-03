# Phase 33 — AI Evaluation Harness & v0.4 Release

| Field | Value |
|---|---|
| Stage | Stage 4 — Fawkes Becomes an Agent (v0.4) |
| Release target | v0.4 |
| Priority | High |
| Status | ⬜ Not started |
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

- [ ] Offline benchmark tasks + regression suite in CI
- [ ] Adversarial tests: prompt injection in docs, malicious tool output, conflicting context, stale memory, unauthorised deploy request, permission escalation, hallucination, partial capability failure
- [ ] AI observability: model, prompt/context version, sources, tool calls, permission decisions, latency, cost, outcome
- [ ] Release-gate policy doc (ADR-010)
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

---
Back to [TRACKER](TRACKER.md)
