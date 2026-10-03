# Phase 01 — Repository & Open-Source Foundation

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | Critical |
| Status | ⬜ Not started |
| Depends on | [Phase 00 — Pre-Coding Decisions & ADRs](phase-00-decisions-and-adrs.md) |
| Unblocks | [Phase 02 — Event Protocol v1](phase-02-event-protocol-v1.md) |

## Goal

Create the monorepo skeleton, licensing and contribution files, and a CI pipeline that builds, lints and tests every package.

## Scope

**In scope**

- Monorepo layout from PRD v2.0 §8
- GPL-3.0 LICENSE and file headers
- CONTRIBUTING, CODE_OF_CONDUCT, SECURITY
- CI build/lint/test
- Dependency + asset licence inventory

**Out of scope**

- Any runtime functionality

## Tasks

- [ ] Create layout: apps/{web,desktop}, core/{event-bus,state-engine,capability-manager,permissions,config,persistence}, pet/{runtime,states,animations,assets,interaction}, capabilities/{kage,git,terminal}, sdk/{capability,events,testing}, protocol/{schemas,versions}, docs/, tests/
- [ ] Add LICENSE (GPL-3.0) and a GPL header template + header check in CI
- [ ] Add CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md
- [ ] Add docs/licenses/INVENTORY.md for dependencies and art/audio provenance
- [ ] Set up workspace tooling (package manager, formatter, linter, test runner)
- [ ] Configure CI: build all packages, lint, unit tests, schema validation, licence-header check
- [ ] Separate dev / staging / prod config folders; add secret-scanning to CI

## Deliverables

- Monorepo skeleton
- Green CI pipeline
- Open-source governance files

## Exit criteria

- [ ] `build + schema pass` (PRD v2.0 Phase 0 exit)
- [ ] CI fails on a missing licence header or committed secret

## Notes & risks

- Keep packages empty but buildable — real code starts in Phase 02.

## Source documents

- Full System PRD v2.0 §8, §22 (Phase 0), §24, §25
- Technical Spec Suite 04–14 §14 milestone 1, §15

---
Back to [TRACKER](TRACKER.md)
