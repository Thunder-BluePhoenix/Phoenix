# Phase 45 — Cross-Device Context & Sync

| Field | Value |
|---|---|
| Stage | Stage 11 — AI Evolution (v1.1 → v2.0) |
| Release target | v1.1 |
| Priority | Medium |
| Status | ⬜ Not started |
| Depends on | [Phase 44 — v1.0 — Developer Operating Layer Release](phase-44-v1-0-operating-layer-release.md) |
| Unblocks | [Phase 46 — Personal Knowledge Engine](phase-46-personal-knowledge-engine.md) |

## Goal

Make Phoenix's context persistent across devices while staying local-first.

## Scope

**In scope**

- Encrypted sync of selected preferences + context metadata
- Project context profiles
- Cross-device Fawkes identity
- Freshness + conflict detection
- Offline then sync

## Tasks

- [ ] End-to-end encrypted sync service (optional)
- [ ] Per-project / per-data-class sync exclusions
- [ ] Owner/scope on every synced item
- [ ] Conflict detection (never silent overwrite)
- [ ] Inspect + delete synced context

## Deliverables

- v1.1 release

## Exit criteria

- [ ] Sync is opt-in, encrypted and inspectable

## Source documents

- AI Evolution v1.0→v2.0 §5

---
Back to [TRACKER](TRACKER.md)
