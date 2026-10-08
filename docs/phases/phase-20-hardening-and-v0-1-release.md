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
- [ ] Observability: structured logs, capability health, event latency/failure, active tasks, Kage duration, WS reconnects (all present in `/api/health` and `/api/diagnostics`; Kage duration is derived from event timestamps, so it is only as accurate as the capability's clock; the numbers are readable in Settings → Support as the raw report, but there is no dashboard of them)
- [x] Diagnostic export without secrets or raw meeting content (`GET /api/diagnostics`; Settings → Support shows the full report in a read-only box before the user copies it. Checked in Chromium against a real Core: report loads, Copy puts exactly the box's text on the clipboard, no overflow at 360 px, no console errors)
- [ ] Package web + desktop builds with licence notices (licence notices are generated and checked in CI; the bundles themselves are not built: they need signing and OS decisions)
- [x] Update dependency/asset licence inventory (npm production and dev packages, all 458 Rust crates, and the app icon; scanned 2026-10-08, plus `pnpm audit` and `cargo audit`)
- [ ] Verify v0.1 Definition of Done checklist; tag release (checklist done above: 12 of 14 hold, 2 partial; no tag)

## Deliverables

- Phoenix v0.1 release
- Security review notes
- E2E suite in CI

## Exit criteria

- [ ] Every item in PRD v2.0 §30 Definition of Done is checked (see the checklist below: 12 of 14 hold, 2 are partial)
- [ ] MVP success: a developer installs Phoenix, sees Fawkes react to real events, runs a Kage meeting and gets a summary (done end to end except the live Google Meet capture; no AI summary was generated because there is no Anthropic key here)

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
| Kage meeting workflow works end-to-end | 🟨 | Everything after the capture was run against the real Kage backend (see "Real Kage run" below). The capture itself (Meet bot joining a call and recording) was not. `e2e-meeting.test.ts` covers the capture step against a test double. |
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
- Not done: signed web + desktop bundles, and the release tag. Those need decisions that are not mine to make: signing identities, which OSes ship in v0.1, and whether Windows ships without OS secret storage. The licence notices are generated (`THIRD_PARTY_NOTICES.md`, checked in CI) but not yet copied into any bundle, because there are no bundles.
- Dependency scan done 2026-10-08: no known vulnerabilities in npm or Rust dependencies; every licence is GPL-3.0 compatible (see `docs/licenses/INVENTORY.md`). Clearing 2 critical and 2 moderate advisories in Vitest needed the 3 → 4.1.11 upgrade; the suite passed unchanged. CI now has an `audit` job.

## Real Kage run (2026-10-08)

Phoenix Core was connected to the real Kage backend (`~/kage/backend`, FastAPI, commit `cffcd54`) running on a separate port with its database, storage and model cache under `/tmp`. Kage's own checkout and data were not touched. Credentials went to an in-memory secret store, not the Keychain.

Done:

- Registered a Kage user, got a real API key, and connected Phoenix's Kage capability (`healthy`).
- Uploaded a 7-second speech file the way the Kage extension and bot do (`POST /api/meetings`). Real Kage ran Whisper (`tiny` model, local) and TF-IDF keywords and extractive summary.
- Phoenix followed it: Fawkes went `WORKING "Transcribing meeting"` → `SUCCESS "Transcript ready: Release planning"`. Phoenix's meeting record matched Kage's exactly: title, participants, duration, recording reference, transcript (identical text), summary (`generated_by: "extractive"`, 8 topics).
- Uploaded a corrupt file. Kage set `failed` with a real error; Phoenix recorded `kage.meeting.failed` with that message, Fawkes showed ERROR, and the meeting appeared as `failed`.
- Stopped Kage while Phoenix was running. Within one health interval the capability went `unhealthy`, Fawkes showed WARNING "Kage is unavailable", Core stayed up (`/api/health` 200), and already-synced meetings and transcripts kept being served.
- Read Kage's source for every status it can set (`uploaded`, `transcribing`, `transcribed`, `failed`, `summarizing`, `summarized`). They match Phoenix's status map.

Not covered:

- **The Meet bot capture** (`meeting.start` against a live Google Meet). It needs Chrome, a Meet call, BlackHole audio routing and a Google account. The approval, recording indicator and emergency stop are tested against a fake bot only.
- **AI summaries.** With no `ANTHROPIC_API_KEY`, Kage never reaches `summarizing` or `summarized`, so Phoenix's `summary.started/ready` handling, AI decisions and action items were only exercised against the test double.
- **Speaker diarization and Postgres/Redis modes** in Kage.
- **A long meeting.** The audio was 7 seconds and the model was `tiny`.

Things observed:

- When Kage reached `transcribed`, Fawkes showed SUCCESS straight away, but Phoenix's copy of the transcript arrived about a second later, because Phoenix fetches it after the event. The Meetings detail page showed nothing for that gap, which looked like missing content. Fixed: it now says "Fetching the transcript from Kage…" while it retries (up to 5 times, one second apart) and shows an error if the transcript never arrives. Watched in a real browser against the real Kage: `Transcribing…` (0.8 s) → `Transcript ready` with "Fetching the transcript…" (1.8 s) → transcript shown (2.8 s), no console errors. Covered by three tests in `apps/web/test/meetings.test.tsx`; the first two fail without the change.
- Right after Kage went down, a check 5 s later still reported `healthy`; the next sample showed `unhealthy` with Fawkes in WARNING. Health is checked every 15 s, so detection can take that long.

## Source documents

- Full System PRD v2.0 §18, §20, §21, §24, §30
- Fawkes PRD v1.0 §16, §24

---
Back to [TRACKER](TRACKER.md)

