# ADR-0008: Typed agent task protocol

**Status:** Accepted  
**Date:** 2026-10-03 (accepted 2026-10-09, Phase 31)

## Context

Agents must exchange structured objects, not free text (Tech Spec §07). A model's output is text from an untrusted party; anything that can lead to an action has to be a typed object that code validates before it is used.

## Decision

Task, Agent, AgentRun, Plan/PlanStep, ToolRequest, ToolResult, Evidence, Verification and Diagnosis are JSON-schema typed in `protocol/` (`protocol/schemas/agent-task-v1.schema.json`, validators in `protocol/src/agent.ts`). Every object rejects unknown fields.

What was built (Phase 31):

- **Run states** `CREATED → READY → RUNNING → WAITING_APPROVAL → VERIFYING → COMPLETED | FAILED | CANCELLED`, with the legal moves in one table (`RUN_TRANSITIONS`). `COMPLETED` is reachable only from `VERIFYING`. Terminal states are final. Every one of the 64 (from, to) pairs is tested.
- **A plan has no risk field.** Risk, and whether a call needs approval, come from the policy engine when the tool gateway is called. A plan that carries extra fields (risk, environment, approved) is rejected.
- **Plans from a model are untrusted data**: validated against the tool registry, the task kind's capability and tool allow-lists, and each tool's own input schema before the first step runs.
- **Evidence** (`E1`, `E2`, …) carries a kind, a source reference, the SHA-256 of the full text and a short redacted excerpt. A diagnosis cites evidence ids; the verifier checks them in code.
- **Environment, resource and data class** of every tool call are fixed by the task kind and its validated input, never by a plan or a model.
- The trace is persisted (migration 8) so a run can be replayed and audited after a restart.

## Consequences

- A new agent kind is an `AgentDefinition` (classify, plan, conclude, verify, allow-lists). It cannot reach a capability except through the orchestrator's `RunContext`, which calls the `ToolGateway`.
- Adding a state or changing a transition means changing the table and its all-pairs test together.
- The protocol is version 1 of the agent objects; additive fields only until a v2.
- Multi-agent coordination (Phase 47) will need task hand-off objects that this ADR does not define.
