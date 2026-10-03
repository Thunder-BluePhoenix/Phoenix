# Phase 05 — Fawkes State Engine

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | Critical |
| Status | ✅ Done |
| Depends on | [Phase 04 — Local Event Bus](phase-04-event-bus.md) |
| Unblocks | [Phase 06 — Core API — HTTP & WebSocket](phase-06-core-api-http-websocket.md), [Phase 07 — Fawkes Pet Runtime & Placeholder Character](phase-07-fawkes-pet-runtime.md) |

## Goal

Compute the single current Fawkes state deterministically from events and active tasks, using the agreed priority order.

## Scope

**In scope**

- State set + priority from Phase 00
- Event→state mapping table (Appendix A)
- Transient expiry, heartbeat/timeout for long states
- Active task tracking
- pet.state.changed events

**Out of scope**

- Animation rendering

## Tasks

- [x] Implement priority resolver: ERROR > USER_ACTION_REQUIRED/WAITING > RECORDING > DEPLOYING > THINKING > WORKING > SUCCESS > IDLE (plus WARNING/SLEEPING/OFFLINE placement from ADR)
- [x] Implement declarative mapping config (no app-specific logic in animation layer)
- [x] Track tasks by correlation_id with progress + heartbeat; time out stale tasks
- [x] Expire transient states (SUCCESS, WARNING) after TTL
- [x] Unknown events never crash the engine — log and ignore
- [x] Publish pet.state.changed with human-readable explanation text
- [x] Full transition-matrix tests + timeout tests

## Deliverables

- core/state-engine package
- Transition matrix test suite

## Exit criteria

- [x] All transitions deterministic and covered by tests
- [x] Every state carries explanatory text (animation is never the only signal)

## Progress log

- 2026-10-03: core/state-engine — ADR-0019 priority, keyed conditions, TTL + timeout→WARNING, heartbeats/progress, sleep mode, recording flag, declarative default mapping. 106 tests incl. full pairwise priority matrix.

## Source documents

- Full System PRD v2.0 §6, Appendix A
- Fawkes PRD v1.0 §6
- Technical Spec Suite 04–14 §10

---
Back to [TRACKER](TRACKER.md)
