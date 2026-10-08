# Phase 29 — Memory Governance & Inspection UX

| Field | Value |
|---|---|
| Stage | Stage 3 — Memory & Context (v0.3) |
| Release target | v0.3 |
| Priority | High |
| Status | ⬜ Not started |
| Depends on | [Phase 28 — Context Engine & Basic Memory Store](phase-28-context-engine-and-memory-store.md) |
| Unblocks | [Phase 30 — Policy Gateway & Tool Gateway](phase-30-policy-and-tool-gateway.md) |

## Goal

Make memory inspectable, deletable and permission-aware, then release v0.3.

## Scope

**In scope**

- Memory browser in Pet Panel
- Delete / expire / retention
- Sensitive data rules

## Tasks

- [ ] Memory / context controls panel: browse, search, delete
- [ ] Retention policies per memory class; deletion propagates to indexes
- [ ] Block sensitive data from external AI unless opted in
- [ ] Tests for permission-scoped retrieval
- [ ] Release v0.3

## Deliverables

- Memory UI
- v0.3 release

## Exit criteria

- [ ] Memory scoped + permission-aware
- [ ] Users can inspect and delete
- [ ] Gate v0.3 → v0.4 met

## Starting point from Phase 28

- Already in place: tombstone deletes (`MemoryStore.forget`, text/provenance purged, index row removed, dedupe key kept so the source cannot re-add it), `expires_at` enforced at read time plus `expire()` to tombstone, `retention_days` per item (defaults per layer in `DEFAULT_RETENTION_DAYS`), `sensitivity` on every item, `Viewer`/`ScopeGrant` filtering inside retrieval (hidden items never appear, even in counts), and the privacy class of a model request set to the maximum sensitivity of its context (the `ai-models` router already refuses cloud for sensitive data).
- Phase 29 still has to: expose browse/search/delete (use `MemoryStore.list/search/forget`, which are not permission-filtered, so filter with `canView`), make retention a user setting and run `expire()` on a schedule, back `allowSensitive` of `createDefaultPolicy` with a setting, decide whether redacted sensitive content may go to the cloud (`SENSITIVE_DATA_MAY_USE_CLOUD` in `ai/models/src/gate.ts`), add memory to `PrivacyService` data classes, and revisit transcripts (not stored as memory in Phase 28).

## Source documents

- Post-MVP Roadmap v1.0 §5.4
- Technical Spec Suite 04–14 §08, §10
- AI Evolution v1.0→v2.0 §23

---
Back to [TRACKER](TRACKER.md)
