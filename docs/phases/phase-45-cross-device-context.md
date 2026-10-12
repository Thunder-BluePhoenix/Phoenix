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
- [x] Owner and scope on every encrypted item; recovery-key-derived device identity.
- [x] Conflict detection with explicit choice (except old-valid-envelope replay to a fresh device; see gaps).
- [x] Offline queue, automatic retry after opt-in and manual sync.
- [x] Inspect staged records and queue encrypted deletion markers (not guaranteed relay erasure).

## Deliverables

- v1.1 release

## Exit criteria

- [ ] Sync is opt-in, encrypted and inspectable

## Source documents

- AI Evolution v1.0→v2.0 §5

## Implementation notes

`@phoenix/sync` encrypts selected records with AES-256-GCM before an authenticated HTTPS relay sees them. The recovery key and relay bearer token are stored in OS secret storage; no relay is bundled. `GET /api/sync` inspects local staged items, while `POST /api/sync/configure`, `/exclusions`, `/items`, `/run`, `/items/resolve`, `/items/delete` and `/disable` are session-token routes. The Settings panel makes opt-in, exclusions, conflict choices and deletion explicit. Sync does **not** automatically export/apply existing pet or memory preferences; a compatible hosted/user-run relay and credential provisioning are needed for a real cross-device run. A malicious relay can replay an old valid encrypted record to a freshly restored device because there is no independent monotonic checkpoint. Encrypted tombstones do not prove physical erasure by the relay. The v1.1 exit criterion is therefore not met.

---
Back to [TRACKER](TRACKER.md)
