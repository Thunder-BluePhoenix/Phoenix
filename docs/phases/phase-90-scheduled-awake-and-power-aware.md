# Phase 90 — Scheduled Awake Windows & Power-Aware Scheduling

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | 🟨 Built as code with injected power source and controller; every check is simulated. **Not wired:** no schedule store, wake scheduler or real power source, no routes or UI, and the awake capability does not expose `SessionController`. No real machine was kept awake or released; the exit criterion is not met |
| Depends on | [Phase 73 — Lid-Closed Mode, Recovery & Power Floors](phase-73-lid-closed-mode-and-recovery.md) |
| Unblocks | — |

## Goal

Plan when the machine stays awake and when heavy work runs.

## Tasks

- [ ] Scheduled awake windows (e.g. 23:00–07:00) for overnight agent runs. Opt-in schedules (5 min–12 h windows, at most 16 schedules, overlap merge capped at 24 h), DST-safe local time via `Intl`, skip and cancel. Simulated. Unticked: not wired.
- [ ] Wake on a schedule to start a job (`pmset schedule` on macOS, RTC wake on Linux, Task Scheduler on Windows). **Not built:** no `WakeScheduler`.
- [ ] Power-aware queue: heavy agent or batch jobs wait for the charger. A `PowerQueue` and a battery / Low Power Mode policy (fail closed on an unreadable battery) are built against an injected power source. Simulated. Unticked: no real power source.
- [ ] Keep awake from the phone (Phase 71). Not built.

## Deliverables

- `core/runtime/src/scheduled-awake`: schedules, DST-safe time, power policy, `PowerQueue`, a controller driver over the Phase 72 `SessionController`. Built, 84 tests, not wired. See [scheduled-awake.md](../scheduled-awake.md).
- Not built: `ScheduleStore`, `WakeScheduler`, a real `PowerSource`, routes and UI.

## Exit criteria

- [ ] A scheduled overnight window keeps a real machine awake and releases it on time. **Unmet.** Only an injected controller and clock were used; no real machine was involved.

## Implementation notes

### What was built

- Opt-in schedules with 5 min–12 h windows, at most 16 schedules, and overlap merging capped at 24 h; skip and cancel.
- DST-safe local time through `Intl`; tested zones are **New York, Kolkata and Auckland only**.
- An injected power source drives a battery / Low Power Mode policy and **fails closed** if the battery cannot be read.
- An injected controller over the Phase 72 `SessionController`; a `PowerQueue` for heavy jobs.
- 84 tests. Documentation: [scheduled-awake.md](../scheduled-awake.md).

### Deviations

- The code lives in `core/runtime/src/scheduled-awake`, not in `capabilities/awake` as the deliverable said; the awake capability does not expose `SessionController`.

### What was not built

A `ScheduleStore`, a `WakeScheduler`, a real `PowerSource`, routes, UI, and phone-initiated keep awake.

### What was not run

Any real machine kept awake or released, any OS wake scheduling, any real battery reading. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
