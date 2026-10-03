# Phase 30 — Policy Gateway & Tool Gateway

| Field | Value |
|---|---|
| Stage | Stage 4 — Fawkes Becomes an Agent (v0.4) |
| Release target | v0.4 |
| Priority | Critical |
| Status | ⬜ Not started |
| Depends on | [Phase 29 — Memory Governance & Inspection UX](phase-29-memory-governance-ux.md) |
| Unblocks | [Phase 31 — Agent Runtime & First Vertical Slice](phase-31-agent-runtime-first-vertical-slice.md) |

## Goal

Ensure every AI tool call passes through a policy engine with risk tiers before reaching a capability.

## Scope

**In scope**

- Permission dimensions: action, resource, environment, data, time, agent
- Risk tiers Low/Medium/High/Critical
- Typed tool contracts
- Audit of every tool call

## Tasks

- [ ] Policy engine evaluating identity + scope + risk
- [ ] Tool contract: typed input/output, declared side effects, permissions, timeout, idempotency, audit metadata
- [ ] Tool gateway mediating all agent→capability calls
- [ ] Environment isolation (local/dev/staging/production); production = High tier
- [ ] Temporary approvals with expiry
- [ ] Tests: agents cannot grant themselves permissions; untrusted content cannot change policy

## Deliverables

- core/policy
- ai/tool-gateway

## Exit criteria

- [ ] No tool executes without a policy decision + audit event

## Source documents

- Technical Spec Suite 04–14 §06 tool contract, §09, §14 milestone 7

---
Back to [TRACKER](TRACKER.md)
