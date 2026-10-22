<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Phoenix contributors -->

# Scheduled awake windows and power-aware scheduling (Phase 90)

Code: `core/runtime/src/scheduled-awake/`. Tests: `core/runtime/test/scheduled-awake.test.ts`.

**Status: simulated.** Everything runs against injected fakes (clock, power source, awake controller, wake scheduler, store). Nothing here has held a real machine awake, called `pmset`, `caffeinate`, `launchctl`, `rtcwake` or `schtasks`, read a real battery, or registered an OS wake. The Phase 90 exit criterion ("a scheduled overnight window keeps a real machine awake and releases it on time") is **unmet**. The module is also not wired into Core yet (see "Host wiring").

## What it does

`ScheduledAwake` keeps the machine awake during user-defined windows (for example 23:00 to 07:00) by driving an injected `AwakeController`. It is **opt-in**: a new scheduler is off, saved schedules do nothing until `setEnabled(true)`, and turning it off releases the hold and cancels registered wakes. A persisted `enabled` flag is honoured only when it is exactly `true`.

### Schedules

`parseScheduleInput` validates untrusted input (a person, a saved file, a phone). Unknown fields are refused and error messages never echo the offending value.

| Field               | Rule                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `id`                | `^[a-z0-9][a-z0-9-]{0,39}$`                                                                     |
| `label`             | optional, 1 to 80 characters, no control, bidi or zero-width characters (same rule as Phase 72) |
| `timeZone`          | IANA name known to the runtime's ICU, at most 64 characters                                     |
| `start`, `end`      | `HH:MM`, 24 hour, in `timeZone`. `end <= start` means the window ends the next day              |
| window length       | 5 minutes to 12 hours of wall-clock time; `start == end` is refused                             |
| `days` or `date`    | weekdays 0 (Sunday) to 6, **of the day the window starts on**; or one real `YYYY-MM-DD`         |
| `wake`              | default false; ask the OS to wake the machine shortly before the window                         |
| `requireCharger`    | default false                                                                                   |
| `minBatteryPercent` | 5 to 90, default 20                                                                             |
| `allowLowPowerMode` | default false                                                                                   |
| `enabled`           | default true                                                                                    |

At most 16 schedules.

### DST-safe local time

Times are resolved per calendar date in the schedule's own zone (`time.ts`, `Intl` only, no date library, never the system zone). A 23:00 to 07:00 window therefore stays at 23:00 and 07:00 local across a clock change, and its **real length changes** (7 or 9 hours on the night of a change in New York). A wall time that does not exist (02:30 on spring-forward night) resolves to the same reading after the gap (03:30); a wall time that happens twice (01:30 on fall-back night) resolves to the first, earlier instant. Half-hour zones work. Zones with unusual transitions (Lord Howe's 30-minute shift, or a zone abolishing DST) are handled by the same offset probing but are **only covered by New York, Kolkata and Auckland cases in tests**.

### Overlap and merge

All occurrences within an 8-day horizon are expanded, then **overlapping or touching** windows are merged into one continuous window. The machine is held once and not released between them; the merged window lists every contributing schedule and occurrence key. A set of schedules that would chain into more than 24 hours of continuous awake time is refused when it is saved or loaded (`limit`). A single controller hold is at most 24 hours; longer chains are extended as they run.

### Power awareness

An injected `PowerSource` returns `{ battery: BatteryReading, lowPowerMode: boolean | null }` (the battery shape is Phase 72's). Per overlapping schedule, `judgePower` decides:

- Mains power, or a machine with no battery: allowed.
- On battery: blocked if `requireCharger` (`needs_charger`), or below `minBatteryPercent` (`battery_low`). After a `battery_low` pause the level must recover by a 5 point margin before that schedule holds again, so a battery hovering at the limit does not flap.
- Low Power Mode on: blocked unless `allowLowPowerMode`. Unknown Low Power Mode never blocks.
- Battery unreadable (or the reader throws): **fail closed**: nothing starts. A hold already running tolerates 2 unreadable reads in a row, then is released.

Only the allowed part of an overlapping chain is held; when the next schedule's policy disallows the current power state the hold is released at that boundary and resumes when power allows. Power is re-read every minute while holding or waiting and every 15 minutes otherwise. `waitingReason` in the status says why a window applies but is not holding (`needs_charger`, `battery_low`, `low_power_mode`, `power_unknown`, `busy`, `battery_floor`, `start_failed`).

### Cancel and skip

- `skipWindow("<id>@YYYY-MM-DD")` skips one running or upcoming occurrence (key = schedule id plus the local date the window starts); it releases the hold if that occurrence was the reason for it, and cancels its OS wake. `unskipWindow` reverses it. A skip is forgotten when its occurrence ends. At most 64 skips; unknown keys are refused.
- `cancelCurrent()` ends what is running and skips the covering occurrences. The next night still runs.
- If the user ends the hold some other way (the keep-awake End button, the Phase 72 battery floor), the scheduler does not restart the same window.
- `removeSchedule`, `upsertSchedule` and `setEnabled(false)` re-judge the hold at once (a shortened window releases at the new end, an extended one extends the running hold).

### Reconcile loop

Every reconcile reads the clock and the power source, computes which windows apply now, and makes the controller match (start, extend, release). Timers only choose **when** to reconcile (next boundary, or the recheck interval), so a timer that fires late because the machine slept, or a clock jump, cannot leave a hold in the wrong state: after sleeping through a window nothing is started, and a hold that is past its window is released. All commands and timers run through one queue, so there are no interleaved reconciles. `stop()` releases the hold **synchronously** before anything async, then cancels wakes.

### OS wake registration

For `wake: true` schedules the scheduler asks an injected `WakeScheduler` to wake the machine 2 minutes before each upcoming occurrence (at most 8 pending). Wakes are cancelled when the window is skipped, the schedule changes or is removed, the scheduler is turned off, or it stops. A failed registration emits `wake.failed`, never blocks holding, and is retried after 10 minutes; a failed cancel is remembered and retried on the next reconcile. **No `WakeScheduler` implementation ships**: `pmset schedule wake` needs root, RTC wake on Linux and Task Scheduler on Windows are separate designs, and none were run. Without one, `wake: true` is stored and reported (`wakeAvailable: false`) and nothing is registered.

### Power-aware queue

`PowerQueue` holds **heavy** jobs until the machine is on mains power (and not in Low Power Mode, and power is readable); light jobs run at once. Bounded (64 jobs, concurrency default 1, `maxWaitMs` 1 minute to 7 days, default 24 hours, then the job is dropped as `expired` and never run). It never runs anything itself: the injected `run(job, signal)` is where the host puts the gateway check and audit row. `cancel` drops a waiting job or aborts a running one; `stop` aborts all; `pump()` re-checks after a charger event; it re-checks every minute otherwise.

### Persistence

The optional `ScheduleStore` gets `{ version: 1, enabled, schedules, skips }` after each accepted change and its `load()` result is treated as untrusted: every schedule is re-validated, invalid or oversized entries are dropped and reported (`store.dropped`), a wrong version or unreadable store starts empty and off, a failing save is reported (`store.error`) and the scheduler keeps working in memory. No store implementation ships.

### Audit events

`emit(ScheduleEvent)` receives `enabled`, `disabled`, `schedule.saved`, `schedule.removed`, `window.skipped`, `window.unskipped`, `hold.started`, `hold.extended`, `hold.released`, `hold.waiting`, `wake.scheduled`, `wake.cancelled`, `wake.failed`, `store.error`, `store.dropped`. The detail holds only ids, counts, reason codes and times: never labels or error messages. A sink that throws is ignored.

## Host wiring (not done)

- `awakeControllerFromSession(sessionController)` adapts the Phase 72 `SessionController` (timed mode). It only ends or extends the session it started and yields (`busy`) when the user already has one. Core does not currently expose the capability's `SessionController` outside `createAwakeCapability`; the parent must expose it (or a port with the same four methods).
- Every command (`setEnabled`, `upsertSchedule`, `removeSchedule`, `skipWindow`, `unskipWindow`, `cancelCurrent`) is a side effect: the host must put the permission gateway and audit in front of it, as Phase 72 does for `start`. The scheduler's own `emit` is not a substitute for the gateway.
- A real `PowerSource` (reuse the Phase 72/73 battery readers and the Phase 73 Low Power Mode reading), a `ScheduleStore` in Core's data directory, an optional `WakeScheduler`, and a route/UI for schedules are not built. Call `refresh()` on wake-from-sleep and on power-source change events.
- "Keep awake from the phone" (Phase 71) is not built. It would call the same gateway-guarded commands.

## Known limits

- All evidence is simulated; see the status line.
- The scheduler holds through a Phase 72 session, so the Phase 72 battery floor and the 7-day session cap still apply, and Closing the lid still sleeps the machine unless Phase 73 lid mode is on; this module does not turn that on.
- Occurrence keys use the local start date: if a zone rule change moves the date of an already-skipped occurrence, the skip may not match.
- A schedule's window can cover a time the machine is asleep; the scheduler can only start a hold once the process runs (hence `wake`).
- Windows are never longer than 12 hours each and chains are capped at 24 hours; there is no unbounded mode.
