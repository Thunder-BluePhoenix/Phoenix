# Phase 03 — Core Runtime Skeleton

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | Critical |
| Status | ✅ Done |
| Depends on | [Phase 02 — Event Protocol v1](phase-02-event-protocol-v1.md) |
| Unblocks | [Phase 04 — Local Event Bus](phase-04-event-bus.md) |

## Goal

Stand up the Phoenix Core process with configuration, structured logging, local persistence and health reporting.

## Scope

**In scope**

- Core process lifecycle (start / stop / crash-safe)
- Config loading
- Structured logs with secret redaction
- SQLite persistence layer + migrations
- GET /api/health

**Out of scope**

- Event bus logic
- UI

## Tasks

- [x] Implement core process entrypoint and graceful shutdown
- [x] Implement config module (file + env, per-environment profiles)
- [x] Implement structured logger with redaction filter (never log secrets)
- [x] Implement persistence module (SQLite) with migrations for User, PetProfile, Capability, Event, Task, Notification
- [x] Implement credential store abstraction backed by OS secure storage (reference only in DB)
- [x] Expose minimal /api/health
- [x] Unit tests for config, logger redaction, migrations

## Deliverables

- Running core process
- Persistence + migration framework
- Health endpoint

## Exit criteria

- [x] Core starts, persists, restarts cleanly
- [x] Redaction test proves secrets never reach logs

## Notes & risks

- Data model reference: PRD v2.0 §13.

## Progress log

- 2026-10-03: core/config, core/logging (JSON + redaction), core/persistence (SQLite migrations, event store, dead letters), core/runtime (process, /api/health, graceful shutdown).
- SecretStore is an interface + in-memory implementation; the OS-keychain backend is deferred to the first capability that stores credentials (Phase 22), per ADR-0014.

## Source documents

- Full System PRD v2.0 §7, §13
- Technical Spec Suite 04–14 §14 milestone 2

---
Back to [TRACKER](TRACKER.md)
