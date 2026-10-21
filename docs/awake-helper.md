# Keep-awake helper, recovery journal and power floors (Phase 73)

Lid-closed mode keeps a Mac awake with the lid shut (`pmset -a disablesleep 1`). That needs root.
Phoenix does not run as root, so this is **opt-in** and **installed by you** from a script you read.

> **Warning.** A closed laptop that stays awake can overheat. Never carry it in a bag, case or any
> closed space while lid-closed mode is on, and keep the vents clear. Phoenix asks you to
> acknowledge this once (`safety.acknowledge`) before the first lid-closed session, and it keeps
> battery and heat floors on by default.

## What you install

See `capabilities/awake/helper/README.md`. In short: one sudoers rule allowing exactly
`/usr/bin/pmset -a disablesleep 1|0` and `/usr/bin/pmset -a lowpowermode 1|0`, plus a user-level
launchd job (every 60 s) that undoes a leftover change if Phoenix died.

```
./scripts/awake/install-helper.sh --print-plan
sudo ./scripts/awake/install-helper.sh --yes
sudo ./scripts/awake/uninstall-helper.sh --yes
```

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
5. `canQuit()` (see GAP below) says no while anything still needs undoing; `awake.recovery.pending`
   (severity warning, Fawkes WARNING) fires when an undo fails.

A journal line that does not parse or whose checksum is wrong is counted and shown, never acted on.

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
