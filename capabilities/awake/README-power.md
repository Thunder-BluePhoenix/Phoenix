# Awake: recovery, lid-closed mode and floors (Phase 73)

Code: `src/power/` (module `recoveryModule`), `helper/`, `scripts/awake/`. User guide:
`docs/awake-helper.md`.

## Commands

| Command              | Side effect           | Notes                                                                                                                                       |
| -------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `lid_closed.start`   | execute (always asks) | needs the safety acknowledgement, a running session, the helper, macOS                                                                      |
| `lid_closed.end`     | execute               | restores sleep, keeps the session                                                                                                           |
| `recovery.status`    | read                  | journal, `journal_path`, `recovery_lock`, lid, floors, helper, safety, unjournaled-sleep check                                              |
| `recovery.undo_now`  | execute               | undoes everything the journal still lists                                                                                                   |
| `recovery.discard`   | write                 | `{id}`: drops ONE pending entry whose kind has no reverter (unknown/forged); audited                                                        |
| `safety.acknowledge` | write                 | `{acknowledge: true, version: 1, text_sha256}` (hash of the warning text, from `recovery.status`), stored in `<data dir>/awake/safety.json` |

## Events

`awake.lid.closed|opened`, `awake.lid_closed.started|ended`, `awake.privileged.apply|undo` (audit),
`awake.recovery.pending` (warning; Fawkes WARNING; also fired, with `locked: true`, when the recovery lock is held and nothing could be undone) / `reconciled` / `discarded` / `quit_refused`,
`awake.safety.acknowledged`, `awake.floor.low_power_on|off|low_power_unavailable|ended`.

## Config

`floors_enabled` (default true), `floor_low_power_percent` (40), `floor_end_percent` (10),
`floor_thermal_low_power` (serious), `floor_thermal_end` (critical). Invalid or inconsistent values
fall back to the defaults.

## For other modules (Lid74)

`powerServices(deps)` returns `{ recovery, lid, helper, registerReverter, canQuit, tick }` (`canQuit` also feeds `GET /api/awake/quit-check` through `onQuitCheck`). Journal
a change with `recovery.change(kind, apply, undo, doApply, sessionId)`; register how to undo it with
`registerReverter(kind, fn)` in your `init` (reconcile runs after every module's init). Throw
`NotAppliedError` from `doApply` when nothing changed. The launchd backstop only undoes the pmset
kinds; other kinds are undone at the next Phoenix launch. `change()` and `undo()` run on one queue: an
undo requested while a change is in flight waits for it, so `doApply` must never call `undo()` itself
(it would wait for itself). Module `shutdown()` returns a promise that resolves when the undo is done or
after `SHUTDOWN_WAIT_MS` (10 s).

## Known limits

- The data dir is `PHOENIX_DATA_DIR`, else `~/.phoenix/<env>` (Core does not pass it to capabilities;
  config `dataDir` is ignored, and `<env>` is `dev` when `PHOENIX_ENV` is unset). The launchd backstop
  watches the journal given to `install-helper.sh --data-dir` (default `~/.phoenix/prod`): compare it with
  `journal_path` in `recovery.status`.
- `safety.acknowledge` is an ordinary approvable command: command handlers receive no actor, so Core's
  approval cannot tell a person from an agent. The command text and the `text_sha256` binding are the
  only distinction.
- Quit veto: Core exposes `canQuit()` read-only as `GET /api/awake/quit-check` (session token; kinds and
  times only; wired through the `onQuitCheck` option of `createAwakeCapability`, not cleared when the
  capability stops), and the desktop shell's Quit asks it and shows a Cancel / Quit anyway dialog while a
  change is pending. Core's own shutdown by a signal is not vetoed. The dialog never ran on a real desktop.
- A privileged change cannot be undone synchronously (sudo is async). Disable marks the session ended
  in the journal and starts the undo; the backstop and next launch are the net.
- Never run for real: the helper, sudoers rule, launchd job, `pmset`, `ioreg` and `pmset -g therm` output
  parsing on a hot machine.
