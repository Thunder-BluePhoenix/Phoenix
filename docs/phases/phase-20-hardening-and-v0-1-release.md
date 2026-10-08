# Phase 20 — Hardening, E2E, Observability & v0.1 Release

| Field | Value |
|---|---|
| Stage | Stage 1 — MVP Foundation |
| Release target | v0.1 |
| Priority | Critical |
| Status | 🟨 In progress |
| Depends on | [Phase 14 — Floating Desktop Fawkes](phase-14-floating-desktop-fawkes.md), [Phase 16 — Meetings UI & Recording Indicator](phase-16-meetings-ui.md), [Phase 17 — Git Capability](phase-17-git-capability.md), [Phase 18 — Terminal / Process Capability](phase-18-terminal-process-capability.md), [Phase 19 — Settings & Privacy Controls](phase-19-settings-and-privacy.md), [Phase 10 — Animation System & P0 States](phase-10-animation-system-p0-states.md) |
| Unblocks | [Phase 21 — Post-MVP Stabilisation](phase-21-post-mvp-stabilization.md) |

## Goal

Prove the MVP is safe and reliable, then package and release Phoenix v0.1.

## Scope

**In scope**

- Security review + threat model check
- E2E suite
- Observability
- Packaging + release notes
- Licence compliance

**Out of scope**

- New features

## Tasks

- [x] Walk the threat model (PRD §18) and verify each mitigation ([docs/security-review.md](../security-review.md): 13 threats, each with its proving test or a stated gap)
- [x] E2E: meeting start → transcript → summary → approved action (`core/runtime/test/e2e-meeting.test.ts`: approve, decline, emergency stop kills the capture process, Kage outage)
- [x] Failure tests: broken capability cannot crash core (existing `manager.test.ts` init/command failure tests, plus the new unregistered-source regression test)
- [ ] Observability: structured logs, capability health, event latency/failure, active tasks, Kage duration, WS reconnects (all present in `/api/health` and `/api/diagnostics`; Kage duration is derived from event timestamps, so it is only as accurate as the capability's clock; none of it is shown in the UI)
- [x] Diagnostic export without secrets or raw meeting content (`GET /api/diagnostics`)
- [ ] Package web + desktop builds with licence notices (not started)
- [x] Update dependency/asset licence inventory (npm production and dev packages, all 458 Rust crates, and the app icon; scanned 2026-10-08, plus `pnpm audit` and `cargo audit`)
- [ ] Verify v0.1 Definition of Done checklist; tag release (checklist done above: 12 of 14 hold, 2 partial; no tag)

## Deliverables

- Phoenix v0.1 release
- Security review notes
- E2E suite in CI

## Exit criteria

- [ ] Every item in PRD v2.0 §30 Definition of Done is checked (see the checklist below: 12 of 14 hold, 2 are partial)
- [ ] MVP success: a developer installs Phoenix, sees Fawkes react to real events, runs a Kage meeting and gets a summary (the workflow is covered by `e2e-meeting.test.ts` against a Kage test double; it has not been run against a real Kage server)

## PRD v2.0 §30 Definition of Done, status

| Item | Status | Evidence |
| --- | --- | --- |
| Phoenix/Fawkes naming is consistent | ✅ | README, docs, UI use "Phoenix is the platform. Fawkes is the pet." |
| GPL-3.0 included | ✅ | `LICENSE`, license-header check in `pnpm lint` |
| Navbar and Pet Panel work | ✅ | `app.test.tsx`, `panel.test.tsx` |
| Core state machine has automated tests | ✅ | `core/state-engine/test/engine.test.ts` |
| Event protocol is documented/versioned | ✅ | `docs/protocol/events-v1.md`, `protocol/schemas` |
| Capability manager handles registration and permissions | ✅ | `manager.test.ts` |
| Floating desktop prototype works | 🟨 | Works on macOS (Phase 14); Linux and Windows not built |
| Kage meeting workflow works end-to-end | 🟨 | `e2e-meeting.test.ts` passes against a test double; not run against real Kage |
| Recording status is visible | ✅ | `e2e-meeting.test.ts`, `floating.test.tsx`, `engine.test.ts` |
| Transcript and summary are retrievable | ✅ | `e2e-meeting.test.ts`, `meetings.test.ts` |
| Core survives Kage outage | ✅ | `e2e-meeting.test.ts`, `kage.test.ts` |
| Security/privacy controls cover sensitive capabilities | ✅ | [docs/security-review.md](../security-review.md) (with 9 known gaps) |
| CI runs build/lint/test | ✅ | `.github/workflows/ci.yml` (the new macOS desktop job has not yet run on GitHub) |
| Capability development guide exists | ✅ | `docs/capabilities/getting-started.md` |

## Notes & risks

- Gate MVP → v0.2: core event/state/pet loop is stable.
- Found by this phase: any holder of the session token could crash Core by posting a meeting-shaped event from an unregistered source (unhandled promise rejection). Fixed in `core/runtime/src/meetings.ts` with a regression test. Details in the security review.
- `GET /api/diagnostics` is the diagnostic export. It lists structure and counts only; the test seeds a real secret, meeting title, participants, transcript and summary and asserts none appear.
- Not done: packaging (signed web + desktop bundles with licence notices), bundling third-party licence texts into release artefacts, and the release tag. Packaging needs decisions that are not mine to make: signing identities, which OSes ship in v0.1, and whether Windows ships without OS secret storage.
- Dependency scan done 2026-10-08: no known vulnerabilities in npm or Rust dependencies; every licence is GPL-3.0 compatible (see `docs/licenses/INVENTORY.md`). Clearing 2 critical and 2 moderate advisories in Vitest needed the 3 → 4.1.11 upgrade; the suite passed unchanged. CI now has an `audit` job.

## Source documents

- Full System PRD v2.0 §18, §20, §21, §24, §30
- Fawkes PRD v1.0 §16, §24

---
Back to [TRACKER](TRACKER.md)
