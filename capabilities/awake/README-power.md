# Awake: recovery, lid-closed mode and floors (Phase 73)

Code: `src/power/` (module `recoveryModule`), `helper/`, `scripts/awake/`. User guide:
`docs/awake-helper.md`.

## Commands

| Command              | Side effect           | Notes                                                                       |
| -------------------- | --------------------- | --------------------------------------------------------------------------- |
| `lid_closed.start`   | execute (always asks) | needs the safety acknowledgement, a running session, the helper, macOS      |
| `lid_closed.end`     | execute               | restores sleep, keeps the session                                           |
| `recovery.status`    | read                  | journal, lid, floors, helper, safety                                        |
| `recovery.undo_now`  | execute               | undoes everything the journal still lists                                   |
| `safety.acknowledge` | write                 | `{acknowledge: true, version: 1}`, stored in `<data dir>/awake/safety.json` |

## Events

`awake.lid.closed|opened`, `awake.lid_closed.started|ended`, `awake.privileged.apply|undo` (audit),
`awake.recovery.pending` (warning; Fawkes WARNING) / `reconciled` / `quit_refused`,
`awake.safety.acknowledged`, `awake.floor.low_power_on|off|low_power_unavailable|ended`.

## Config

`floors_enabled` (default true), `floor_low_power_percent` (40), `floor_end_percent` (10),
`floor_thermal_low_power` (serious), `floor_thermal_end` (critical). Invalid or inconsistent values
fall back to the defaults.

## For other modules (Lid74)

`powerServices(deps)` returns `{ recovery, lid, helper, registerReverter, canQuit, tick }`. Journal
a change with `recovery.change(kind, apply, undo, doApply, sessionId)`; register how to undo it with
`registerReverter(kind, fn)` in your `init` (reconcile runs after every module's init). Throw
`NotAppliedError` from `doApply` when nothing changed. The launchd backstop only undoes the pmset
kinds; other kinds are undone at the next Phoenix launch.

## Known limits

- The data dir is `PHOENIX_DATA_DIR`, else `~/.phoenix/<env>` (Core does not pass it to capabilities).
- Quit veto: Core shutdown has no veto hook and the Tauri shell was not edited. `canQuit()` and the
  `awake.recovery.quit_refused` event exist; nothing consults them yet.
- A privileged change cannot be undone synchronously (sudo is async). Disable marks the session ended
  in the journal and starts the undo; the backstop and next launch are the net.
- Never run for real: the helper, sudoers rule, launchd job, `pmset`, `ioreg` and `pmset -g therm` output
  parsing on a hot machine.
