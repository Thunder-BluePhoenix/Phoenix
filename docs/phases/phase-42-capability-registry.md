# Phase 42 — Capability Registry & v0.9 Release

| Field | Value |
|---|---|
| Stage | Stage 9 — Capability Ecosystem (v0.9) |
| Release target | v0.9 |
| Priority | High |
| Status | 🟨 Signed local index, verified metadata preview and GPL policy built; executable third-party installs fail closed without audited sandbox; v0.9 not released |
| Depends on | [Phase 41 — SDK Stabilisation & Developer Docs](phase-41-sdk-stabilization-and-docs.md) |
| Unblocks | [Phase 43 — Developer Preview Programme](phase-43-developer-preview-program.md) |

## Goal

Provide a registry that treats security, permissions, provenance and licences as first-class — not a blind marketplace.

## Scope

**In scope**

- Manifest validation
- Version compatibility
- Permission + licence metadata
- Health + security reporting

**Out of scope**

- Monetised marketplace

## Tasks

- [x] Registry index format + signed validation pipeline (explicit Ed25519 trust file; no remote index).
- [x] Show permissions + data categories before install (Settings preview; installation unavailable).
- [x] Licence metadata + conservative GPL compatibility allowlist (redistribution still needs review).
- [x] Security reporting process for capabilities (`docs/capabilities/registry.md`).
- [ ] Audited OS sandbox policy implemented for third-party execution (current policy refuses install).
- [ ] Release v0.9

## Deliverables

- Capability registry
- v0.9 release

## Exit criteria

- [ ] SDK and core stable for external users (gate v0.9 → v1.0)

## Source documents

- Post-MVP Roadmap v1.0 §11.2–11.3
- Technical Spec Suite 04–14 §14 P3

## Implementation notes

`@phoenix/registry` validates a host-provisioned Ed25519-signed local index and an artifact digest without loading code. Core reads paired `PHOENIX_REGISTRY_TRUSTED_KEY_FILE` and `PHOENIX_REGISTRY_INDEX_FILE`, then serves authenticated browse/preview routes. There is no default trusted signer, remote marketplace, automatic update or executable installation. `POST /api/registry/:id/:version/install` refuses; a signed index is provenance metadata, not an OS sandbox or permission grant. The Settings panel displays permissions, data categories, licence and security contact before any installation could be considered. The v0.9 release gate is not met.

---
Back to [TRACKER](TRACKER.md)
