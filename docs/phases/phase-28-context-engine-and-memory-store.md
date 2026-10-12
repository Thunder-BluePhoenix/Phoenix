# Phase 28 — Context Engine & Basic Memory Store

| Field | Value |
|---|---|
| Stage | Stage 3 — Memory & Context (v0.3) |
| Release target | v0.3 |
| Priority | High |
| Status | 🟨 Built, tested and wired into Core with git, meeting and doc ingestion; ran against this repo's real history and real Ollama (see [gaps register](../gaps.md)) |
| Depends on | [Phase 27 — Model Adapter & Router](phase-27-model-adapter-and-router.md) |
| Unblocks | [Phase 29 — Memory Governance & Inspection UX](phase-29-memory-governance-ux.md) |

## Goal

Give Phoenix persistent, scoped, provenance-tagged memory and a context engine that retrieves across domains.

## Scope

**In scope**

- Memory layers: working, episodic, project, preference
- Git, meeting and project memory domains
- Required metadata
- Simple (lexical) retrieval

**Out of scope**

- Vector/graph retrieval (Phases 37–38)

## Tasks

- [x] Memory schema with source, owner, scope, timestamp, freshness, sensitivity, provenance, confidence, retention
- [x] Capture pipeline: capture → classify → permission-check → store → index
- [x] Domain ingestors: Git commits, meeting summaries/decisions, project docs
- [x] Context engine assembling task context from ≥2 domains
- [x] Answers distinguish stored facts vs generated interpretation
- [x] Fawkes question flow: 'what did we decide about X yesterday?'

## Deliverables

- ai/context
- ai/memory

## Exit criteria

- [x] Context retrieval works across ≥2 domains with sources (proved at package level on this repository's real git history and phase docs plus Kage-shaped meetings; now wired into Core through `MemoryRuntime` and the memory API, see notes)

## Implementation notes

- **Schema**: migration 7 (`memory_items`, `memory_sources`, FTS5 `memory_fts`). Required metadata: `source`/`source_ref`, `owner`, `scope` (`repo:<name>`, `meeting:<id>`, `path:<abs>`), `layer`, `domain`, `kind` (`fact` | `interpretation`), `observed_at`, `last_confirmed_at` + `freshness_ttl_days` (freshness is derived, never stored), `sensitivity`, `provenance` (JSON), `confidence`, `retention_days` + `expires_at`, `deleted_at` tombstone. The FTS table is contentless with `contentless_delete`, `porter unicode61`, ranked by bm25; triggers remove index rows on hard delete and on tombstone, and `insert()` writes row and index entry in one transaction. Tests assert index size equals live item count after insert, purge, forget and expire.
- **Pipeline** (`ai/memory/src/pipeline.ts`): capture → classify → permission-check → store+index as typed stages. Store and index are deliberately one atomic step. Classification is a table keyed by content type: meetings and transcripts are `sensitive`, commits and docs `internal`, unknown `internal`. Secret-shaped text is **redacted** (`redact()` from `@phoenix/logging`, also over provenance) and the item is marked `redacted`; private-key blocks are **rejected** because redacting the header would leave the key body. Every refusal (policy) and rejection (validation) is returned with a reason and counted. `createDefaultPolicy` allows public/internal from enabled sources and requires an explicit per-source-and-domain allow for sensitive data.
- **Ingestors**: Git (events and `git log` backfill, key `git:<repo>:<sha>`), Meetings (summary text, each decision and each action item as separate `fact`s with `provenance.meeting_id`; **transcripts are not stored as memory**: they are the most sensitive text Phoenix holds and too large to be useful in a lexical index; the summary carries what was decided; Phase 29/35 revisit), Project docs (explicit absolute `.md` paths, ≤1 MB, chunked by heading, content-hash skip, removed/dropped files' memories removed). Re-ingesting stores nothing new. A deleted memory leaves a tombstone with its dedupe key so the same fact is not captured again.
- **Large meeting histories:** `MeetingStore.list()` keeps its 500-item UI page cap; `listAll()` uses deterministic id-keyset pages. Memory ingestion enumerates every active and archived page before reconciling missing records, preventing accidental deletion when either group exceeds 500. Review and graph imports use the exhaustive path; tests exercise more than 1,000 meetings and tied timestamps.
- **Context engine** (`ai/context`): `ContextEngine.assemble` parses the question (topic + time window), searches per domain with the permission filter applied inside the search (so hidden items never take a slot and never appear in `omitted`, which can only say `limit`, `token_budget` or `near_duplicate`), drops near-identical items across domains, gives each domain an equal share of `limit` first, then fills by score within `tokenBudget` (≈4 chars/token estimate). `ask()` puts memory text in a nonce-delimited, one-JSON-object-per-line block, tells the model it is untrusted data, and sets the request `privacy` to the maximum sensitivity of the included items; `ask()` takes a `GenerateFn` (`generateWith(aiService)`), so the `ai-models` router decides which provider may run. If AI is off, unavailable or not allowed for the data, the facts are returned with `interpretation: null` and a reason.
- **Question flow**: `parseQuestion` handles yesterday, today, this/last week (Monday–Sunday), "on/last <weekday>" (most recent such day before today), "in the last N days" (N calendar days before today plus today), with an injected clock and IANA time zone (DST-length days covered by tests). The memory search/ask API and web memory panel were built later (Phases 29/32).
- **Verified for real** (not in the repo tests): 54 commits of this repository's git history + 57 `docs/phases/*.md` files (490 chunks) in a SQLite file; repeat ingest stored 0; delete removed the item from index and results; a real `ask()` through `AiService` with an Ollama-only registry (`llama3.2`) returned facts and a separately labelled interpretation ("processed by Ollama (this device) · llama3.2 · on this device") with request privacy `sensitive`, and with AI disabled the same facts came back with no interpretation.
- **Built since this phase's package work / limits**: `MemoryRuntime` constructs the stores, subscribes to `git.commit.created`, syncs selected doc paths and hooks meeting changes; memory search/ask/settings/delete routes and a web memory panel are built. Retrieval can now use the Phase 37 hybrid path when enabled, while the default lexical path can still miss differently worded questions. Real Kage meeting data was not available in this phase's run; meetings used mock-Kage shapes. Per-layer user retention settings and scheduled `expire()` were built in Phase 29.

## Source documents

- Post-MVP Roadmap v1.0 §5
- Technical Spec Suite 04–14 §08, §14 milestones 9–10

---
Back to [TRACKER](TRACKER.md)
