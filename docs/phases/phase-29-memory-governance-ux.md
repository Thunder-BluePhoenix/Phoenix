# Phase 29 — Memory Governance & Inspection UX

| Field | Value |
|---|---|
| Stage | Stage 3 — Memory & Context (v0.3) |
| Release target | v0.3 |
| Priority | High |
| Status | 🟨 Memory browser, retention, deletion and the sensitive-data opt-in built and checked in a real browser against a real Core; v0.3 not released (see [gaps register](../gaps.md)) |
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

- [x] Memory / context controls panel: browse, search, delete (API here; UI in `apps/web`)
- [x] Retention policies per memory class; deletion propagates to indexes
- [x] Block sensitive data from external AI unless opted in
- [x] Tests for permission-scoped retrieval
- [ ] Release v0.3

## Deliverables

- Memory UI
- v0.3 release

## Exit criteria

- [x] Memory scoped + permission-aware
- [ ] Users can inspect and delete
- [ ] Gate v0.3 → v0.4 met

## Starting point from Phase 28

- Already in place: tombstone deletes (`MemoryStore.forget`, text/provenance purged, index row removed, dedupe key kept so the source cannot re-add it), `expires_at` enforced at read time plus `expire()` to tombstone, `retention_days` per item (defaults per layer in `DEFAULT_RETENTION_DAYS`), `sensitivity` on every item, `Viewer`/`ScopeGrant` filtering inside retrieval (hidden items never appear, even in counts), and the privacy class of a model request set to the maximum sensitivity of its context (the `ai-models` router already refuses cloud for sensitive data).
- Phase 29 still has to: expose browse/search/delete (use `MemoryStore.list/search/forget`, which are not permission-filtered, so filter with `canView`), make retention a user setting and run `expire()` on a schedule, back `allowSensitive` of `createDefaultPolicy` with a setting, decide whether redacted sensitive content may go to the cloud (`SENSITIVE_DATA_MAY_USE_CLOUD` in `ai/models/src/gate.ts`), add memory to `PrivacyService` data classes, and revisit transcripts (not stored as memory in Phase 28).

## Implementation notes

- **Wiring** (`core/runtime`): `MemoryRuntime` (`memory.ts`) owns the store, pipeline, git subscription, meeting hook and docs sync; `AiRuntime` (`ai.ts`) owns `AiService`, AI settings, the grant and the key; `builtins.ts` lists the capabilities (docker, frappe, agents, issues added; github is not registered yet). `runtime.toolGateway` is built over the real capability manager; `PolicyAdmin` is private and no route reaches it.
- **Routes** (`core/api/src/memory-routes.ts`): `GET /api/memory`, `/api/memory/search`, `/api/memory/settings`; `POST /api/memory/settings`, `/ask`, `/delete`, `/:id/forget`; `GET /api/ai/status`; `POST /api/ai/settings`, `/api/ai/external-processing`, `/api/ai/secret`; `DELETE /api/ai/secret`. All need the session token. Every parameter is bounded and unknown keys are rejected. Delete needs a literal `confirm: true`. Forget and delete are audited as `memory.forgotten` / `memory.deleted` with counts only.
- **Permission model**: browse, search, ask, forget and delete all go through `canView` with the runtime's viewer (the device owner). `MemoryStore.browse` applies the filter to every candidate before counting, so `total` and `counts` never include a hidden item; a hidden id answers 404 exactly like a missing one.
- **Retention**: per layer (`working` 1 day, others until deleted by default), validated 1-3650 or null. A change re-stamps `retention_days`/`expires_at` of live items of that layer and applies to later captures; `MemoryStore.expire()` runs at startup, hourly with the privacy pruner, and on every settings change; expired items are hidden at read time before they are swept. `PrivacyService` lists "memory" with its count and the longest layer retention, and its delete-all clears the index through the same store method.
- **Sensitive rule**: see `docs/security-review.md`. Sensitive data to the cloud needs the grant + `cloud_opt_in.sensitive` + an allowed purpose, and every send is audited by counts. `CloudOptIn` gained `sensitive`; `checkGate` gained a `purpose` argument; `AiService` takes `auditCloudSend` and refuses a sensitive cloud send without it.
- **Meetings**: stored as memory only when `allow_sensitive_meetings` is on (default off); turning it off removes meeting memories. The hook is `MeetingStore.onChange`, fired after a summary is stored, a meeting is archived or deleted.
- **Verified for real** (not only in tests): a Core on a fresh data directory, 40 of this repo's commits sent as `git.commit.created` events, the 50 files in `docs/phases` set through `POST /api/memory/settings` (449 chunks), every route exercised with curl, then AI enabled with real Ollama (`llama3.2`): `POST /api/memory/ask` returned 10 stored facts and an interpretation with `processed_by` "Ollama (this device) · llama3.2 · on this device". The Anthropic path was only run against a counting fake; `api.anthropic.com` was never contacted.
- **Not done**: the v0.3 release; transcripts are still not stored as memory; the live Kage hook has not seen a real Kage meeting.

## Source documents

- Post-MVP Roadmap v1.0 §5.4
- Technical Spec Suite 04–14 §08, §10
- AI Evolution v1.0→v2.0 §23

---
Back to [TRACKER](TRACKER.md)
