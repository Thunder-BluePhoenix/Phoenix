# Phase 41 — SDK Stabilisation & Developer Docs

| Field | Value |
|---|---|
| Stage | Stage 9 — Capability Ecosystem (v0.9) |
| Release target | v0.9 |
| Priority | High |
| Status | 🟨 SDK v1 manifest/protocol boundary and examples documented; real-Core docs walkthrough passes; third-party independent docs-only build and public SDK publication remain unverified |
| Depends on | [Phase 40 — Workflow Safety & v0.8 Release](phase-40-workflow-safety.md) |
| Unblocks | [Phase 42 — Capability Registry & v0.9 Release](phase-42-capability-registry.md) |

## Goal

Freeze a stable Capability SDK with versioning guarantees, docs and examples.

## Scope

**In scope**

- SDK API freeze
- Compatibility/versioning
- Docs + example capabilities

## Tasks

- [x] Review and document the v1 manifest/protocol SDK surface and semantic-versioning policy (workspace SDK remains private 0.1.0; no published 1.0 artifact).
- [x] Migration guide for manifest changes (`docs/capabilities/migration.md`).
- [x] Local-only runnable examples: phoenix-gitlab, phoenix-slack, phoenix-postgres.
- [x] In-repository developer docs: protocol, SDK and security model (`docs/capabilities/`).
- [ ] Hosted full docs site for external users (not deployed).

## Deliverables

- Stable SDK
- Docs + examples

## Exit criteria

- [ ] An independent third party builds a capability using only docs (the in-repo docs-only walkthrough passes, but its author was not independent).

## Source documents

- Post-MVP Roadmap v1.0 §11
- Full System PRD v2.0 §22 Phase 8

---
Back to [TRACKER](TRACKER.md)
