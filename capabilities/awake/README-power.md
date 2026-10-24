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
| `safety.acknowledge` | write                 | `{acknowledge: true, version: 1, text_sha256}` (hash of the warning text, from `recovery.status`), stored in `<capability dir>/safety.json` |

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

- **Where the files are.** Core hands the capability its own directory, `ctx.dataDir` =
  `<Core data dir>/capabilities/awake` (mode 0700, made on first use; the Core data dir is the `dataDir`
  Core really runs with, so a `dataDir` in `config/<env>.json` counts). The journal, the recovery lock and
  `safety.json` are in it; `journal_path` in `recovery.status` is the full path. Only without a Core
  (`ctx.dataDir` absent: a harness) does the module fall back to the old rule, `PHOENIX_DATA_DIR`, else
  `~/.phoenix/<env>` (`dev` when `PHOENIX_ENV` is unset), plus `/awake/`.
- **Journals an older Phoenix wrote.** Before this, the journal was `<old data dir>/awake/recovery-journal.jsonl`.
  When the module starts with a Core directory and that old file holds pending entries, they are copied
  into the new journal in one atomic replace (the new journal's own entries stay first, so the undo, which
  goes newest first, takes the old ones first), read back and compared, and only then is the old file renamed
  to `recovery-journal.jsonl.adopted-<ms>` (kept; never read again). Entries already in the new journal (same
  change id, from a crash between the two steps) are not added twice. If any step fails (unreadable file,
  full budget, no rename), nothing is dropped: the module keeps using the OLD directory for that run, logs a
  warning, and tries again at the next start. An old journal with nothing pending is left alone. The
  acknowledgement in the old `safety.json` is not moved: you are asked once more (fail closed).
- The launchd backstop watches one path, given to it at install time. `install-helper.sh` computes it with
  Core's own rule (`--data-dir`, else an absolute `PHOENIX_DATA_DIR`, else `~/.phoenix/<PHOENIX_ENV>`, `dev` when
  unset) and watches `<data dir>/capabilities/awake/recovery-journal.jsonl`; `--print-plan` shows the path, where
  the data dir came from and whether a journal exists there. It cannot see a `dataDir` set in
  `config/<env>.json`, and `sudo` usually clears `PHOENIX_DATA_DIR` / `PHOENIX_ENV`: pass `--data-dir` and
  compare the `WATCH` line with `journal_path`.
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
