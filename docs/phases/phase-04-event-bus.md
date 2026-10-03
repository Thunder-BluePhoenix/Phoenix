# Phase 04 — Local Event Bus

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | Critical |
| Status | ⬜ Not started |
| Depends on | [Phase 03 — Core Runtime Skeleton](phase-03-core-runtime-skeleton.md) |
| Unblocks | [Phase 05 — Fawkes State Engine](phase-05-state-engine.md), [Phase 11 — Permissions & Audit Primitives](phase-11-permissions-and-audit.md) |

## Goal

Implement publish/subscribe that validates, normalises, deduplicates and routes events, with failure isolation between consumers.

## Scope

**In scope**

- Publish/subscribe API
- Schema validation on ingest
- Dedup by event_id
- At-least-once delivery + idempotent consumers
- Durable vs ephemeral events
- Dead-letter queue
- Consumer isolation

**Out of scope**

- Remote/cross-device bus

## Tasks

- [ ] Implement in-process bus with typed subscribe by namespace/pattern
- [ ] Validate every event against schema; reject with INVALID_EVENT
- [ ] Dedup window keyed by event_id (EVENT_DUPLICATE)
- [ ] Persist durable events to SQLite; keep transient UI events ephemeral; honour ttl_ms
- [ ] Retry + dead-letter for failing durable consumers
- [ ] Wrap each consumer so a crash cannot take down the bus
- [ ] Emit metrics: event latency, failure counts
- [ ] Tests: routing, retry, dedup, isolation, unknown event types

## Deliverables

- core/event-bus package
- Bus test suite

## Exit criteria

- [ ] Routing, retry, dedup and isolation tests green
- [ ] A throwing consumer does not affect others

## Source documents

- Full System PRD v2.0 §7, §9, §20
- Technical Spec Suite 04–14 §05 delivery semantics

---
Back to [TRACKER](TRACKER.md)
