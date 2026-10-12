# Phase 50 — AI Capability Ecosystem

| Field | Value |
|---|---|
| Stage | Stage 11 — AI Evolution (v1.1 → v2.0) |
| Release target | v1.6 |
| Priority | Medium |
| Status | 🟨 Optional AI tool/context manifest metadata, version-bound user disclosure and local provider interfaces built; external/cloud AI activation and third-party install fail closed; v1.6 not released |
| Depends on | [Phase 49 — Controlled Autonomous Agents](phase-49-controlled-autonomy.md) |
| Unblocks | [Phase 51 — Agent-to-Agent Collaboration](phase-51-agent-to-agent-collaboration.md) |

## Goal

Let capabilities expose AI tools, context sources and skills, with declared data access.

## Scope

**In scope**

- Manifest: context_sources, ai_tools
- Permissions understandable before activation

## Tasks

- [x] Additive manifest v1 + SDK declarations for AI tools/context sources with data categories, sensitivity, locality/provider and permissions.
- [x] Before enabling an AI capability, Settings shows access disclosures and requires exact manifest-version acknowledgment; Core refuses undisclosed, cloud and external AI activation.
- [x] SDK model-provider and embedding-provider interfaces (local-only implementations require user configuration; no new cloud forwarding).

## Deliverables

- v1.6 release

## Exit criteria

- [ ] Third-party AI capabilities install with clear permissions

## Source documents

- AI Evolution v1.0→v2.0 §10

## Implementation notes

The capability manager validates declaration/permission consistency and refuses external AI until an audited OS sandbox exists. It also refuses every cloud AI declaration until runtime data-class isolation exists; metadata alone cannot prevent sensitive data forwarding. Local first-party AI declarations require user review of the exact version before enable or restart. The registry's executable third-party install endpoint still refuses, so the phase exit criterion is not met and no v1.6 release is claimed.

---
Back to [TRACKER](TRACKER.md)
