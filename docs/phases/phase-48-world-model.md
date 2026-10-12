# Phase 48 — Phoenix World Model

| Field | Value |
|---|---|
| Stage | Stage 11 — AI Evolution (v1.1 → v2.0) |
| Release target | v1.4 |
| Priority | Medium |
| Status | 🟨 Sourced temporal six-hop association traversal and Core/UI read path built; no automatic producer for full chain or historical snapshot guarantee; v1.4 not released |
| Depends on | [Phase 47 — Multi-Agent Runtime](phase-47-multi-agent-runtime.md) |
| Unblocks | [Phase 49 — Controlled Autonomous Agents](phase-49-controlled-autonomy.md) |

## Goal

Maintain a continuously updated model of the authorised engineering environment.

## Scope

**In scope**

- Entity resolution, relationships, temporal history, ownership, dependencies, state changes, provenance, confidence, freshness

## Tasks

- [x] Temporal graph read layer with append-only revisions of surviving provenance, historical/current viewer filters, freshness and bounded traversal; deleted sources purge historical detail.
- [x] Exact typed entity identity resolution; ambiguous display names never resolve automatically.
- [ ] Production failure → deployment → commit → service → issue → decision → meeting chain automatically ingested (route traverses only explicitly sourced existing edges; no complete producer pipeline).

## Deliverables

- v1.4 release

## Exit criteria

- [ ] Root-cause chains traverse the world model with provenance

## Source documents

- AI Evolution v1.0→v2.0 §8

## Implementation notes

`WorldModel.rootCauseChains` returns complete explicitly sourced six-hop trails with visible fresh evidence on every node/edge. The authenticated `GET /api/graph/world/failures/:key/chains` and Provenance UI say **documented association; causation not established**. Migration 20 adds `Failure`/`ASSOCIATED_WITH`; migration 23 records observation revisions for surviving provenance. `asOf` selects the revision valid at that time and also checks current viewer access; source deletion purges past content with only content-free numeric revocation metadata. Historical evidence from before migration 23 cannot be retroactively recovered or used to resurrect forgotten user content. No complete real incident producer chain, proven causal root cause or v1.4 release is claimed.

---
Back to [TRACKER](TRACKER.md)
