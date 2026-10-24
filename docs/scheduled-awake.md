<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 Phoenix contributors -->

# Scheduled awake windows and power-aware scheduling (Phase 90)

Code: `core/runtime/src/scheduled-awake/` (scheduler, `service.ts`, `system-power.ts`). Tests: `core/runtime/test/scheduled-awake.test.ts` (scheduler) and `core/runtime/test/scheduled-awake-wiring.test.ts` (13, through a real running Core with a fake machine and clock from `capabilities/awake/testing/fakes.ts`).

**Status: simulated.** Everything runs against injected fakes (clock, power source, awake controller, wake scheduler, store). Nothing here has held a real machine awake, called `pmset`, `caffeinate`, `launchctl`, `rtcwake` or `schtasks`, read a real battery, or registered an OS wake. The Phase 90 exit criterion ("a scheduled overnight window keeps a real machine awake and releases it on time") is **unmet**. The module is now wired into Core (see "Host wiring"); that wiring is exercised only with fakes.

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

Times are resolved per calendar date in the schedule's own zone (`time.ts`, `Intl` only, no date library, never the system zone). A 23:00 to 07:00 window therefore stays at 23:00 and 07:00 local across a clock change, and its **real length changes** (7 or 9 hours on the night of a change in New York). A wall time that does not exist (02:30 on spring-forward night) resolves to the same reading after the gap (03:30); a wall time that happens twice (01:30 on fall-back night) resolves to the first, earlier instant. Half-hour zones work.

Zones covered by tests (all with the runtime's own ICU, Node 25.2.1 here; expected instants were derived from the zone rules, and a different ICU release that disagrees about a rule would fail the tests): New York, Kolkata and Auckland (original), plus Europe/London (gap and overlap), Australia/Lord_Howe (30-minute DST shift: nights of 7.5 h and 8.5 h, gap 02:15, overlap 01:45, and the wake registered from the real half-hour start), Asia/Kathmandu (+05:45, a hold at 17:15Z released exactly eight hours later), America/Santiago (southern-hemisphere DST that changes at midnight, so a night is 7 h or 9 h), America/St_Johns (negative half-hour offset with DST), America/Sao_Paulo (negative, DST in 2018/2019 and none since), Pacific/Pago_Pago (-11) and Pacific/Kiritimati (+14) with a weekday filter that follows each zone, and Pacific/Apia (the calendar day 2011-12-30 never existed: no window is invented for it and the surrounding nights stay 8 h). **Not covered:** zones with a transition at a time that is not a whole minute, historical zones before 1970, zones that changed rules after this ICU was built, and any other runtime's ICU. The "skip" key can mismatch if a rule change moves the date of an already-skipped occurrence (see Known limits).

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

For `wake: true` schedules the scheduler asks an injected `WakeScheduler` to wake the machine 2 minutes before each upcoming occurrence (at most 8 pending). Wakes are cancelled when the window is skipped, the schedule changes or is removed, the scheduler is turned off, or it stops. A failed registration emits `wake.failed`, never blocks holding, and is retried after 10 minutes; a failed cancel is remembered and retried on the next reconcile. **No `WakeScheduler` implementation ships**; without one, `wake: true` is stored and reported (`wakeAvailable: false`) and nothing is registered. The scheduler-side behaviour above is tested with a fake `WakeScheduler`; no real OS wake exists. See "Why no WakeScheduler ships" below.

#### Why no WakeScheduler ships

A real wake on macOS is `pmset schedule wake "<date>"`, which needs root. The Phase 73 privilege path **cannot express it**: the sudoers rule is four literal lines (`/usr/bin/pmset -a disablesleep 1|0`, `-a lowpowermode 1|0`), `validateHelperCommand` (`capabilities/awake/src/power/helper-client.ts`) accepts only those four argv, and the recovery journal and backstop know only two undoable kinds, each with a fixed literal OFF line. A wake has an argument that varies (a date), so it cannot be a fourth/fifth literal line, and it has a different undo (`pmset schedule cancel ...` with the same date). Adding it means a **new root-run command** and a wider account-wide sudoers rule, which is a privilege escalation, so it was **not built** and nothing in the installer, the sudoers text or the allow-list changed. `capabilities/awake/test/power/helper-client.test.ts` now pins that `pmset schedule wake|shutdown|cancel|cancelall` and `pmset repeat wake` are all refused by the allow-list.

What the owner would be approving (not implemented; `decision` row in the gap register). Everything below about `pmset schedule` syntax is [INFERENCE] from the man page and was not run:

1. A new sudoers line for the account, either `/usr/bin/pmset schedule wake *` plus `/usr/bin/pmset schedule cancel wake *` (sudoers `*` matches any text, spaces included, so the argument is **not** constrained by sudoers: any process running as the account could wake the Mac at any time, any number of times, with no password and without Phoenix knowing), or a root-owned helper script at a fixed path that takes one epoch value, validates it (future, within 7 days, at most 8 pending) and runs fixed argv itself (smaller blast radius, but it is **new root-run code** that needs its own review, install and uninstall path).
2. A new journal kind `wake` (applied entry = the exact date string; undo = `pmset schedule cancel wake <same date>`), a new reverter in `power/`, a backstop change, and installer/uninstaller changes so a left-over wake is cancelled with the schedule and uninstall leaves none behind.
3. A wake date is local time in the **system** zone (`MM/dd/yy HH:mm:ss`), not the schedule's zone, so the conversion from the schedule's instant must use the system zone at that instant (the DST tests above cover the schedule side only).
4. Linux (RTC wake) and Windows (Task Scheduler) are separate designs that were not attempted.

### Power-aware queue

`PowerQueue` holds **heavy** jobs until the machine is on mains power (and not in Low Power Mode, and power is readable); light jobs run at once. Bounded (64 jobs, concurrency default 1, `maxWaitMs` 1 minute to 7 days, default 24 hours, then the job is dropped as `expired` and never run). It never runs anything itself: the injected `run(job, signal)` is where the host puts the gateway check and audit row. `cancel` drops a waiting job or aborts a running one; `stop` aborts all; `pump()` re-checks after a charger event; it re-checks every minute otherwise.

### Persistence

The optional `ScheduleStore` gets `{ version: 1, enabled, schedules, skips }` after each accepted change and its `load()` result is treated as untrusted: every schedule is re-validated, invalid or oversized entries are dropped and reported (`store.dropped`), a wrong version or unreadable store starts empty and off, a failing save is reported (`store.error`) and the scheduler keeps working in memory. Core's store is the settings key `scheduled-awake.state` (privacy row `scheduled_awake`), re-validated on load.

### Audit events

`emit(ScheduleEvent)` receives `enabled`, `disabled`, `schedule.saved`, `schedule.removed`, `window.skipped`, `window.unskipped`, `hold.started`, `hold.extended`, `hold.released`, `hold.waiting`, `wake.scheduled`, `wake.cancelled`, `wake.failed`, `store.error`, `store.dropped`. The detail holds only ids, counts, reason codes and times: never labels or error messages. A sink that throws is ignored.

## Host wiring

`ScheduledAwakeService` (`core/runtime/src/scheduled-awake/service.ts`) wraps the scheduler for Core. The awake capability gained an `onSession` hook (`capabilities/awake/src/index.ts`), and `core/runtime/src/main.ts` passes it through `builtinCapabilities` so Core binds the live Phase 72 `SessionController`. If the keep-awake capability is disabled, a window waits with reason `start_failed` and the status says `awakeAvailable: false`.

Routes (`core/api/src/scheduled-awake-routes.ts`, session token only): `GET/PUT /api/scheduled-awake` (`{enabled}`), `POST /api/scheduled-awake/schedules`, `DELETE /api/scheduled-awake/schedules/:id`, `POST /api/scheduled-awake/skips`, `DELETE /api/scheduled-awake/skips/:key`, `POST /api/scheduled-awake/cancel-current`.

- **What asks.** Turning scheduling **on** and saving a schedule each go through the permission gateway and ask the user. The HTTP request blocks until the user answers (default confirmation timeout 5 minutes). The hold that a schedule later starts does **not** ask again.
- **What never asks.** Turning off, deleting a schedule, skipping, unskipping and cancel-current only shorten awake time. They are audited as `scheduled_awake.<change>` and never ask.
- **Emergency stop.** It turns scheduling off (bus hook). A start guard refuses to start a hold while it is engaged, and turning scheduling back on is refused (403) while it is engaged.
- **Persistence.** Schedules are in settings key `scheduled-awake.state`, re-validated on load.
- **Power source.** `SystemPowerSource` reads the Phase 72 battery reader and, on macOS only, `lowpowermode` from `pmset -g`. The parsing is unit-tested; **the real `pmset` command was not run for this phase**. Elsewhere, or on failure, Low Power Mode is "unknown", which never blocks.
- **Settings section:** see `apps/web/src/components/ScheduledAwakeSettings.tsx`.

**Still not done:**

- A `WakeScheduler`: no OS wake is registered; `wake: true` is stored and the status says `wakeAvailable: false`. Blocked on an owner decision about a new root rule (see "Why no WakeScheduler ships").
- Any real `caffeinate` or `pmset` run.
- "Keep awake from the phone" (Phase 71). It would call the same gateway-guarded commands.

## Known limits

- All evidence is simulated; see the status line.
- The scheduler holds through a Phase 72 session, so the Phase 72 battery floor and the 7-day session cap still apply, and Closing the lid still sleeps the machine unless Phase 73 lid mode is on; this module does not turn that on.
- Occurrence keys use the local start date: if a zone rule change moves the date of an already-skipped occurrence, the skip may not match.
- A schedule's window can cover a time the machine is asleep; the scheduler can only start a hold once the process runs (hence `wake`).
- Windows are never longer than 12 hours each and chains are capped at 24 hours; there is no unbounded mode.
