# Phase 30 — Policy Gateway & Tool Gateway

| Field | Value |
|---|---|
| Stage | Stage 4 — Fawkes Becomes an Agent (v0.4) |
| Release target | v0.4 |
| Priority | Critical |
| Status | 🟨 Built and tested in-process; not yet wired into Core |
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

- [x] Policy engine evaluating identity + scope + risk
- [x] Tool contract: typed input/output, declared side effects, permissions, timeout, idempotency, audit metadata
- [x] Tool gateway mediating all agent→capability calls
- [x] Environment isolation (local/dev/staging/production); production = High tier
- [x] Temporary approvals with expiry
- [x] Tests: agents cannot grant themselves permissions; untrusted content cannot change policy

## Deliverables

- core/policy
- ai/tool-gateway

## Exit criteria

- [x] No tool executes without a policy decision + audit event

## Implementation notes

- `core/policy`: risk table, rules (typed JSON, validated), `PolicyEngine`, `PolicyAdmin` (user-only), temporary approvals. Table and decision order: `core/policy/README.md`. Migration 6 adds `policy_rules` and `policy_approvals`.
- `ai/tool-gateway`: `ToolRegistry` (tools from manifests), `ToolGateway.call`, `approverFromPermissions` (approval goes through `PermissionGateway.authorize`).
- Verified in-process only: a real SQLite file (closed and reopened), real `PermissionGateway`, real `CapabilityManager`, the real git capability on a throwaway repo, and a mock write/production capability for approvals. No external service is involved.
- Not done: the runtime does not construct or expose the gateway yet (no API route; `core/runtime` is not part of this change), and nothing calls it until Phase 31. See `docs/gaps.md`.

## Source documents

- Technical Spec Suite 04–14 §06 tool contract, §09, §14 milestone 7

---
Back to [TRACKER](TRACKER.md)
