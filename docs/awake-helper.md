# Keep-awake helper, recovery journal and power floors (Phase 73)

Lid-closed mode keeps a Mac awake with the lid shut (`pmset -a disablesleep 1`). That needs root.
Phoenix does not run as root, so this is **opt-in** and **installed by you** from a script you read.

> **Warning.** A closed laptop that stays awake can overheat. Never carry it in a bag, case or any
> closed space while lid-closed mode is on, and keep the vents clear. Phoenix asks you to
> acknowledge this once (`safety.acknowledge`) before the first lid-closed session, and it keeps
> battery and heat floors on by default.

> **The sudoers rule is account-wide.** It is a rule for _your account_, not for Phoenix. Any process
> that runs as you (a terminal, a script, a browser extension host, an AI agent with a shell) can run
> the four `pmset` lines below with no password and without Phoenix knowing, for example to keep the
> Mac awake with the lid closed. Phoenix's approvals and audit log cover only what Phoenix does. If
> you do not accept that, do not install the helper. `recovery.status` reports
> `sleep_disabled_unjournaled: true` when `pmset -g` says sleep is disabled although the journal
> has no matching entry (a best-effort read-only check; [INFERENCE] it relies on the key name
> `SleepDisabled` that macOS prints).

## What you install

See `capabilities/awake/helper/README.md`. In short: one sudoers rule allowing exactly
`/usr/bin/pmset -a disablesleep 1|0` and `/usr/bin/pmset -a lowpowermode 1|0`, plus a user-level
launchd job (every 60 s) that undoes a leftover change if Phoenix died.

```
./scripts/awake/install-helper.sh --print-plan
sudo ./scripts/awake/install-helper.sh --yes
sudo ./scripts/awake/uninstall-helper.sh --yes
```

### How the installer treats your home folder

The installer runs as root but creates every folder and file under your home (`Library/Application
Support/Phoenix`, `Library/LaunchAgents`, `Library/Logs`, the script, the plist) **as you**
(`sudo -u <you> install ...`), never as root, and writes only the sudoers file as root. Before it
touches anything it refuses, with a plain message and a non-zero exit, when any component of those
paths under your home is a symbolic link or is not owned by you; the uninstaller applies the same
checks before removing anything (and removes as you). The reason: BSD `install -o`/`chown` may follow a
symlink, so a symlink planted by another process of yours (for example to `/etc/sudoers.d`) could
otherwise have made root hand a system folder to you. [INFERENCE] This was found by static review; the
macOS behaviour was not reproduced, so the defence is deliberately belt and braces.
`PHOENIX_SUDOERS_DIR` (a test seam) is ignored in real mode and honoured only by `--print-*` and
`--dry-run`. `--dry-run` runs the real checks and prints every step as `RUN root: ...` or
`RUN <you>: ...` without executing any.

### Which journal the backstop watches (`--data-dir`)

The launchd job watches **one** journal: `<data-dir>/awake/recovery-journal.jsonl`, where `--data-dir`
(absolute; default `~/.phoenix/prod`) is given at install time. Phoenix itself uses `PHOENIX_DATA_DIR`,
else `~/.phoenix/<PHOENIX_ENV>`, and **`dev` when `PHOENIX_ENV` is unset** (Core does not hand
capabilities its data folder yet, and a `dataDir` in the config is ignored). If the two differ the
backstop watches a journal Phoenix never writes and protects nothing. Check before you rely on it:

```
./scripts/awake/install-helper.sh --print-plan --data-dir "$HOME/.phoenix/dev"   # see the WATCH line
```

then compare it with `journal_path` in the Keep awake recovery status (shown in the UI under the
journal). Re-run the installer with the right `--data-dir` if they differ.

Without the rule, `lid_closed.start` fails with "helper not installed", the session continues, and
Low Power Mode from the floors is reported unavailable.

## How undo is guaranteed

1. Every system change is written to the recovery journal (`<data dir>/awake/recovery-journal.jsonl`,
   mode 0600, directory 0700, one checksummed JSON line, fsync per append) **before** it is made. If
   the write fails the change is not made.
2. Ending the session, the floors, disable and Core exit undo it.
3. At launch (capability init) any entry applied but not undone is undone, under a lock file
   (pid + process start time, so a reused pid is not trusted).
4. The launchd backstop undoes the two privileged kinds if their session ended or their owner died,
   within about a minute.
5. `canQuit()` says no while anything still needs undoing. The desktop shell's Quit asks Core
   (`GET /api/awake/quit-check`) and, while something is pending, holds the exit and tells you what is
   still in place with **Cancel** or **Quit anyway** (a native dialog that has not been run on a real
   desktop). Core's own shutdown by a signal is not vetoed: it starts the undo and the backstop and the
   next launch are the net;
   `awake.recovery.pending` (severity warning, Fawkes WARNING) fires when an undo fails.

A journal line that does not parse or whose checksum is wrong is counted and shown, never acted on.

### What the journal does and does not protect against

The checksum is **unkeyed** (a truncated SHA-256 of the record): it detects accidental corruption, not
tampering. Anything that can write the file (any process running as you) can append a valid line. A
forged journal can therefore: make the backstop or Phoenix switch `disablesleep`/`lowpowermode` OFF
early (a premature undo; the undo is always the literal OFF line of the entry's own setting, never an
arbitrary command), mark a real change `undone` so it is no longer undone, fill the 1 MB cap so new
changes are refused (fail closed), or add an entry of a kind Phoenix cannot undo, which keeps the
recovery warning on for ever. For the last case `recovery.discard {id}` (asks for confirmation, audited,
event `awake.recovery.discarded`) removes **one** pending entry whose kind has no reverter. It refuses
entries that can be undone and changes nothing on the computer. A forger who can write the journal
can already do all of the above; the aim is to bound the damage and keep it visible, not to defend a
compromised account.

A change whose "applied" mark never reached the journal (a crash between writing and applying) and
whose undo is refused (helper gone) is no longer closed blindly: Phoenix closes it only if a read-only
`pmset -g` shows the setting is off, and otherwise keeps it pending.

### A held recovery lock is not "restored"

When another process holds the recovery lock, an undo does nothing. That is reported as **not
restored** (`awake.lid_closed.ended` carries `restored: false`, severity warning), fires
`awake.recovery.pending` (`locked: true`), keeps the entry pending and is shown in `recovery.status`
as `recovery_lock.blocked`. A lock dated in the future (beyond one minute of skew), and a backstop lock
file with a future modification time, are stale and taken over: a forged lock cannot hold off recovery
for ever.

### Ending a session while a start is in flight

`change()` and `undo()` share one queue, so an undo (including the one Core's shutdown starts) waits for a
`lid_closed.start` that is still running its `sudo ... disablesleep 1`: the order is always ON then OFF,
and the entry is marked undone only after the OFF has run. Module shutdown waits for the undo for at
most 10 s; the backstop is the net beyond that.

### The safety acknowledgement

`safety.acknowledge` is an ordinary approvable command and command handlers receive no actor, so Core
cannot require that a person (not an agent) approved it. Instead the input must carry the SHA-256 of the
warning text (published in `recovery.status` as `safety.text_sha256`), and the approval prompt says
it is a safety acknowledgement made in your name that an agent or script must never approve.

## Floors (on by default)

Battery below 40 % (on battery power): Low Power Mode. Below 10 %: the session ends. Heat `serious`:
Low Power Mode; `critical`: the session ends. An unreadable battery or heat sensor ends a bounded
session after three reads in a row. Config: `floors_enabled`, `floor_low_power_percent`,
`floor_end_percent`, `floor_thermal_low_power`, `floor_thermal_end`.

## Not verified

No root path was ever run: the scripts, the sudoers rule, the launchd job and `pmset` were never
executed by the authors. "Killing Phoenix mid-session restores sleep within a minute" and "uninstall
leaves no root rule behind" are **unmet on a real Mac**; there is simulation evidence only. The heat
thresholds (`CPU_Speed_Limit` mapping) are a documented choice, not Apple's definition.
