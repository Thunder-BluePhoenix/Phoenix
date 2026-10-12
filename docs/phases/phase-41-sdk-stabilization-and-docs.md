# Phase 41 — SDK Stabilisation & Developer Docs

| Field | Value |
|---|---|
| Stage | Stage 9 — Capability Ecosystem (v0.9) |
| Release target | v0.9 |
| Priority | High |
| Status | 🟨 Packaged SDK 0.1.0, isolated ESM/TypeScript consumer and local versioned docs built; independent third-party build, hosted docs and public release remain unverified |
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

- [x] Review and document manifest/protocol v1 and SDK semver policy; `@phoenix/sdk` 0.1.0 now builds a local packed ESM/TypeScript artifact, not a published 1.0 release.
- [x] Migration guide for manifest changes (`docs/capabilities/migration.md`).
- [x] Local-only runnable examples: phoenix-gitlab, phoenix-slack, phoenix-postgres.
- [x] In-repository protocol/SDK/security docs and local versioned static 0.1.0 pages (`docs/capabilities/site/0.1.0/`); not publicly hosted.
- [ ] Publish and verify a hosted versioned docs site for external users.

## Deliverables

- Stable SDK
- Docs + examples

## Exit criteria

- [ ] An independent third party builds a capability using only docs (the in-repo docs-only walkthrough passes, but its author was not independent).

## Implementation notes

`npx pnpm --filter @phoenix/sdk build` bundles a GPL-licensed SDK artifact; `check:artifact` packs/installs it into a disposable consumer without ambient Node types, checks ESM and TypeScript imports and exercises historical wire 1.0 versus current 1.1 plus manifest v1. No second actual SDK major pair, independent external developer or hosted docs has been verified.

## Source documents

- Post-MVP Roadmap v1.0 §11
- Full System PRD v2.0 §22 Phase 8

---
Back to [TRACKER](TRACKER.md)
