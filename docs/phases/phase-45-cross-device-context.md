# Phase 45 — Cross-Device Context & Sync

| Field | Value |
|---|---|
| Stage | Stage 11 — AI Evolution (v1.1 → v2.0) |
| Release target | v1.1 |
| Priority | Medium |
| Status | 🟨 Optional encrypted staged-metadata sync, Core API and Settings UI built; no deployed relay, automatic preference/context integration or rollback-resistant freshness; v1.1 not released |
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

- [x] Optional end-to-end encrypted staged-record sync with HTTPS CAS transport (no hosted relay).
- [x] Per-project / per-data-class exclusions for selected staged records.
- [x] Owner and scope on every encrypted item; recovery-key-derived account identity, not separately revocable device credentials.
- [x] Conflict detection with explicit choice (except old-valid-envelope replay to a fresh device; see gaps).
- [x] Offline queue, automatic retry after opt-in and manual sync.
- [x] Inspect staged records and queue encrypted deletion markers (not guaranteed relay erasure).

## Deliverables

- v1.1 release

## Exit criteria

- [ ] Sync is opt-in, encrypted and inspectable on two real devices using a deployed relay with rollback-resistant freshness; local staged-record and preference-adapter tests pass, but the cross-device release gate remains open.

## Source documents

- AI Evolution v1.0→v2.0 §5

## Implementation notes

`@phoenix/sync` encrypts selected records with AES-256-GCM before an authenticated HTTPS relay sees them. The recovery key and relay bearer token live in OS secret storage; no relay is bundled. `GET /api/sync` inspects staged records. User routes stage/refresh only the explicitly selected `pet.settings.reduced_motion` and `retrieval.settings.k` metadata via `POST /api/sync/adapter`; applying a remote value via `/api/sync/adapter/apply` requires a reviewed revision and exact current-value comparison. Raw memories, meetings and full preferences do not sync. The Settings panel makes consent, exclusions, conflict resolution and deletion explicit. A deployed relay, device-specific revoke/provisioning and a real two-device run are absent. A malicious relay can replay a valid old envelope to a freshly restored device without an independent monotonic checkpoint; tombstones do not prove relay erasure. v1.1 remains NO-GO.

---
Back to [TRACKER](TRACKER.md)
