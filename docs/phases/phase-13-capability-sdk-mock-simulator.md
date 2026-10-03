# Phase 13 — Capability SDK, Mock Capability & Event Simulator

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | Critical |
| Status | ✅ Done |
| Depends on | [Phase 12 — Capability Manager & Manifest](phase-12-capability-manager.md) |
| Unblocks | [Phase 15 — Kage Adapter & Meeting Lifecycle](phase-15-kage-adapter-meeting-lifecycle.md), [Phase 17 — Git Capability](phase-17-git-capability.md), [Phase 18 — Terminal / Process Capability](phase-18-terminal-process-capability.md) |

## Goal

Make building a capability easy and prove the model with a mock capability and a developer event simulator.

## Scope

**In scope**

- sdk/capability, sdk/events, sdk/testing
- Mock capability
- Event simulator CLI
- Capability development guide

**Out of scope**

- Stable public SDK guarantees (Phase 41)

## Tasks

- [x] SDK helpers: manifest builder, emit event, register command, health handler
- [x] Testing kit: in-memory bus, fixtures, contract test helpers
- [x] Build mock capability that emits build/agent/deploy events and exposes a command
- [x] Build event simulator CLI to fire any Appendix A event
- [x] Write docs/capabilities/getting-started.md
- [x] Contract tests for capability API

## Deliverables

- sdk/ packages
- capabilities/mock
- Event simulator
- Capability guide

## Exit criteria

- [x] PRD Phase 4 exit: mock capability works
- [x] US-08: SDK sample registers, emits and handles a command

## Progress log

- 2026-10-03: sdk/events (`@phoenix/sdk-events`: typed builders for build/test/command/agent/deploy/git/kage/frappe + demo scenarios), sdk/capability (`@phoenix/sdk`: `defineCapability`, `runExternalCapability`), sdk/testing (`@phoenix/sdk-testing`: in-memory harness, simulator, `pnpm simulate` CLI), capabilities/mock (dev-only builtin playing scenarios). Guide: docs/capabilities/getting-started.md; example: sdk/capability/examples/hello-external.ts.
- US-08 verified against a real core: an SDK capability registers, is enabled, emits, handles commands, and survives a core restart (re-register + safe retry of the same event id).
- Found and fixed while testing: (1) re-registration raced core's resume call — credentials are now per direction (capability-chosen `callback_secret` for core → capability); (2) in-flight health checks touched the database after shutdown — bus, permissions and capability manager now have explicit `close()` and the runtime stops them in order.

## Source documents

- Full System PRD v2.0 §10, §22 Phase 4, US-08
- Fawkes PRD v1.0 §16 'event simulator'

---
Back to [TRACKER](TRACKER.md)
