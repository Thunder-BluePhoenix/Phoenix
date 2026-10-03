# Phase 13 — Capability SDK, Mock Capability & Event Simulator

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | Critical |
| Status | ⬜ Not started |
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

- [ ] SDK helpers: manifest builder, emit event, register command, health handler
- [ ] Testing kit: in-memory bus, fixtures, contract test helpers
- [ ] Build mock capability that emits build/agent/deploy events and exposes a command
- [ ] Build event simulator CLI to fire any Appendix A event
- [ ] Write docs/capabilities/getting-started.md
- [ ] Contract tests for capability API

## Deliverables

- sdk/ packages
- capabilities/mock
- Event simulator
- Capability guide

## Exit criteria

- [ ] PRD Phase 4 exit: mock capability works
- [ ] US-08: SDK sample registers, emits and handles a command

## Source documents

- Full System PRD v2.0 §10, §22 Phase 4, US-08
- Fawkes PRD v1.0 §16 'event simulator'

---
Back to [TRACKER](TRACKER.md)
