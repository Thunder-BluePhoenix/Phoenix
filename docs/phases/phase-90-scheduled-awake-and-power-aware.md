# Phase 90 — Scheduled Awake Windows & Power-Aware Scheduling

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | 🟨 Built as code and wired into Core (`ScheduledAwakeService`, `/api/scheduled-awake` routes, settings-backed schedules, a power source that reads the Phase 72 battery reader and, on macOS, `pmset -g`); every check is simulated. **Not done:** `WakeScheduler` (no OS wake), any real `caffeinate` or `pmset` run, keep-awake from the phone. No real machine was kept awake or released; the exit criterion is not met |
| Depends on | [Phase 73 — Lid-Closed Mode, Recovery & Power Floors](phase-73-lid-closed-mode-and-recovery.md) |
| Unblocks | — |

## Goal

Plan when the machine stays awake and when heavy work runs.

## Tasks

- [ ] Scheduled awake windows (e.g. 23:00–07:00) for overnight agent runs. Opt-in schedules (5 min–12 h windows, at most 16 schedules, overlap merge capped at 24 h), DST-safe local time via `Intl`, skip and cancel. Wired into Core with routes and persistence. Simulated. Unticked: no real machine was held awake.
- [ ] Wake on a schedule to start a job (`pmset schedule` on macOS, RTC wake on Linux, Task Scheduler on Windows). **Not built, and blocked on an owner decision:** no `WakeScheduler`; `wake: true` is stored and the status says `wakeAvailable: false`. The Phase 73 root path (four literal `pmset -a` lines, journal and backstop with two undoable kinds) cannot express `pmset schedule wake`; building it needs a new root-run command or a wider sudoers rule, which was not done silently. See [scheduled-awake.md](../scheduled-awake.md#why-no-wakescheduler-ships).
- [ ] Power-aware queue: heavy agent or batch jobs wait for the charger. A `PowerQueue` and a battery / Low Power Mode policy (fail closed on an unreadable battery) are built. Core's `SystemPowerSource` reads the Phase 72 battery reader and, on macOS only, `lowpowermode` from `pmset -g` (parsing unit-tested; the real command was not run). Simulated. Unticked.
- [ ] Keep awake from the phone (Phase 71). Not built.

## Deliverables

- `core/runtime/src/scheduled-awake`: schedules, DST-safe time, power policy, `PowerQueue`, a controller driver over the Phase 72 `SessionController`; `service.ts` (`ScheduledAwakeService`) and `system-power.ts` (`SystemPowerSource`) wire it into Core. The awake capability gained an `onSession` hook (`capabilities/awake/src/index.ts`) so Core binds the live `SessionController`. See [scheduled-awake.md](../scheduled-awake.md).
- Routes in `core/api/src/scheduled-awake-routes.ts` (session token only): `GET/PUT /api/scheduled-awake` (`{enabled}`), `POST /api/scheduled-awake/schedules`, `DELETE …/schedules/:id`, `POST …/skips`, `DELETE …/skips/:key`, `POST …/cancel-current`.
- Schedules persist in settings key `scheduled-awake.state` (re-validated on load). Privacy row `scheduled_awake`.
- Test: `core/runtime/test/scheduled-awake-wiring.test.ts` (13; fake machine and clock from `capabilities/awake/testing/fakes.ts`).
- Not built: `WakeScheduler`, any real `caffeinate`/`pmset` run, keep-awake from the phone. Settings section: see `apps/web/src/components/ScheduledAwakeSettings.tsx`.

## Exit criteria

- [ ] A scheduled overnight window keeps a real machine awake and releases it on time. **Unmet.** Only an injected controller and clock were used; no real machine was involved.

## Implementation notes

### What was built

- Opt-in schedules with 5 min–12 h windows, at most 16 schedules, and overlap merging capped at 24 h; skip and cancel.
- DST-safe local time through `Intl`; tested zones: New York, Kolkata, Auckland, plus London, Lord Howe (30-minute DST), Kathmandu (+05:45), Santiago, St. John's, São Paulo, Pago Pago, Kiritimati and Apia (a skipped calendar day), including gaps and overlaps. Checked only against this runtime's ICU.
- An injected power source drives a battery / Low Power Mode policy and **fails closed** if the battery cannot be read.
- An injected controller over the Phase 72 `SessionController`; a `PowerQueue` for heavy jobs.
- 94 scheduler tests (10 added for the further zones) plus allow-list tests pinning that `pmset schedule`/`repeat` are refused by the Phase 73 helper. Documentation: [scheduled-awake.md](../scheduled-awake.md).

### Deviations

- The scheduler code lives in `core/runtime/src/scheduled-awake`, not in `capabilities/awake` as the deliverable said; the awake capability only gained the `onSession` hook.

### How the runtime wires it

- Turning scheduling **on** and saving a schedule each go through the permission gateway and ask the user. The HTTP request blocks until answered (default confirmation timeout 5 minutes). The hold a schedule later starts does not ask again.
- Turning off, deleting, skipping, unskipping and cancel-current only shorten awake time; they are audited (`scheduled_awake.<change>`) and never ask.
- The emergency stop turns scheduling off (bus hook); a start guard refuses to start a hold while it is engaged, and turning scheduling on is refused (403) while it is engaged.
- If the keep-awake capability is disabled, a window waits with reason `start_failed` and status `awakeAvailable: false`.

### What was not built

A `WakeScheduler` (blocked on an owner decision about a new root rule), any real `caffeinate`/`pmset` run, and phone-initiated keep awake.

### What was not run

Any real machine kept awake or released, any OS wake scheduling, any real battery reading, and the real `pmset -g` command. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
