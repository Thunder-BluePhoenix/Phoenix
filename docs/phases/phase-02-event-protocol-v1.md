# Phase 02 — Event Protocol v1

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | Critical |
| Status | ✅ Done |
| Depends on | [Phase 01 — Repository & Open-Source Foundation](phase-01-repo-and-open-source-foundation.md) |
| Unblocks | [Phase 03 — Core Runtime Skeleton](phase-03-core-runtime-skeleton.md) |

## Goal

Freeze a versioned, schema-validated event envelope that every component and capability will use.

## Scope

**In scope**

- Envelope fields from PRD v2.0 §9 merged with Tech Spec §05 (subject, scope, causation, metadata, provenance, data classification)
- JSON Schemas in protocol/schemas
- Namespace conventions
- Standard error codes (Appendix B)

**Out of scope**

- Transport (Phase 04)
- Capability-specific payloads beyond the initial matrix

## Tasks

- [x] Define envelope: event_id, event_type, version, source, timestamp, severity, correlation_id, causation_id, subject, scope, requires_action, ttl_ms, data_classification, payload, metadata, provenance
- [x] Write JSON Schema + versioning policy (consumers must tolerate unknown fields)
- [x] Define namespaces: pet, system, agent, build, deploy, meeting/kage, frappe, security, workflow, ai
- [x] Encode Appendix A initial event matrix as example fixtures
- [x] Define standard error codes: CAPABILITY_DISABLED, CAPABILITY_UNAVAILABLE, PERMISSION_DENIED, INVALID_EVENT, EVENT_DUPLICATE, OPERATION_TIMEOUT, RESOURCE_NOT_FOUND, ACTION_REQUIRES_CONFIRMATION, SECURITY_POLICY_BLOCKED
- [x] Add rule + lint: no secrets in payloads (redaction field list)
- [x] Generate typed bindings for core language and web
- [x] Publish docs/protocol/events-v1.md

## Deliverables

- protocol/schemas/event-v1.json
- Error-code catalogue
- Fixture set + generated types
- Protocol documentation

## Exit criteria

- [x] Schema-compat tests pass in CI
- [x] Event schema v1 is frozen (ADR)

## Notes & risks

- Schema changes after freeze require a version bump and compatibility test.

## Progress log

- 2026-10-03: protocol/ package — JSON Schema v1, TS types, Ajv validator, no-secrets rule, error codes, canonical Fawkes states, Appendix A fixtures, docs/protocol/events-v1.md. 28 tests.

## Source documents

- Full System PRD v2.0 §9, Appendix A, Appendix B
- Fawkes PRD v1.0 §14, Appendix B
- Technical Spec Suite 04–14 §05

---
Back to [TRACKER](TRACKER.md)
