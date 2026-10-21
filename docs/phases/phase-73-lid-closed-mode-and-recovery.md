# Phase 73 — Lid-Closed Mode, Recovery & Power Floors

| Field | Value |
|---|---|
| Stage | Stage 13 — Insomnia parity and beyond (keep awake) |
| Release target | Post-v2.0 track |
| Priority | High |
| Status | 🟨 Built and tested as a simulation only: the helper scripts, the sudoers rule, the launchd job and `pmset` were never installed or run; the quit veto is not wired to the desktop shell; the backstop may watch a different journal than Phoenix writes; the sudoers rule is account-wide; both exit criteria are unmet |
| Depends on | [Phase 72 — Keep-Awake Sessions (No Root)](phase-72-keep-awake-sessions.md) |
| Unblocks | [Phase 74 — Lid-Close Actions](phase-74-lid-close-actions.md), [Phase 90 — Scheduled Awake Windows & Power-Aware Scheduling](phase-90-scheduled-awake-and-power-aware.md) |

## Goal

Keep a laptop working with the lid closed, and always undo what was changed.

## Tasks — parity with Insomnia

- [ ] `pmset -a disablesleep` during a session through an opt-in privileged helper. The allow-list, the sudoers text, the launchd plist and the install and uninstall scripts are built and tested against fakes and with the touch-nothing `--print-plan`, `--print-sudoers`, `--print-plist` and `--dry-run` modes (`capabilities/awake/test/power/scripts.test.ts`, `helper-client.test.ts`). Unticked because **the helper was never installed and `sudo`, `pmset` and `launchd` never ran**.
- [ ] Recovery journal written before every change; reconcile at launch; launchd backstop every minute; recovery lock. The journal (checksummed JSONL, mode 0600), `RecoveryManager` reconcile, the lock file (pid and start time) and the backstop script `capabilities/awake/helper/phoenix-awake-backstop.mjs` are built and tested with fakes (`reconcile.test.ts`, `backstop.test.ts`, `module.test.ts`). Unticked because the backstop was never loaded by `launchd`, and Core does not hand capabilities a data directory, so the journal path (`PHOENIX_DATA_DIR`, else `~/.phoenix/<env>`, `dev` by default) can differ from the one the backstop watches.
- [ ] Lid observer. Built over `ioreg` with fakes (`lid.test.ts`). Unticked because **`ioreg` output with the lid closed was never observed**.
- [ ] Battery floors (Low Power Mode below 40 %, end below 10 %) and heat rules (Low Power Mode at serious, end at critical), on by default. Built and tested with fake battery and thermal readers (`floors.test.ts`); the thresholds are the implementing agent's choice and the `CPU_Speed_Limit` mapping is a documented choice, not Apple's definition. Not run on real hardware.
- [ ] Quit refuses while a change still needs undoing. `RecoveryManager.canQuit()` exists and is tested, but it is **not wired to the Tauri shell or to Core's shutdown path**, so the desktop's Quit does not consult it.

## Tasks — Phoenix improvements

- [ ] The helper exposes only the two settings it needs; Phoenix's runtime never holds root; install and uninstall scripts the user runs and can read. `validateHelperCommand` accepts four literal lines (`/usr/bin/pmset -a disablesleep|lowpowermode 1|0`); the runtime calls only `sudo -n` with those lines and never runs as root; the installer writes only the sudoers rule as root. Unticked because the sudoers rule is **per account**: any process of the same user, including an agent with a shell, can run those four lines without Phoenix knowing (documented in the script, the UI and [awake-helper.md](../awake-helper.md)), and nothing was run as root.
- [ ] Safety warning (ventilation, bag) before the first lid-closed session. The `safety.acknowledge` gate is built (`power/safety.ts`, tests in `module.test.ts`; the input must carry the SHA-256 of the warning text). Unticked because the SDK gives command handlers no actor, so Core **cannot require that a person rather than an agent approved it**: an approved agent call could still record the acknowledgement (open; see the notes).
- [ ] Every privileged change is in the audit log. Each change and undo publishes an `awake.privileged.apply` or `awake.privileged.undo` event (the capability README calls these the audit trail) and the commands that start a change are confirmed through the permission gateway; `recovery.discard` is confirmed and audited. Tested with fakes only. Unticked because nothing checked that every privileged change, including the backstop's out-of-process undo, leaves a row in Core's audit log, and nothing ran for real.

## Deliverables

- Privileged helper + install/uninstall scripts: built (`scripts/awake/install-helper.sh`, `uninstall-helper.sh`, `capabilities/awake/helper/`, [awake-helper.md](../awake-helper.md)); never run in real mode.
- Recovery journal and backstop: built (`capabilities/awake/src/power/`, `PowerRecovery.tsx`); simulation only.

## Exit criteria

- [ ] Killing Phoenix mid-session still restores sleep within a minute of the session end. **Unmet.** The backstop and reconcile logic are tested with a simulated clock and fake `pmset`; nothing was installed, killed or timed on a Mac.
- [ ] Uninstall leaves no root rule behind. **Unmet.** The uninstaller's plan and `--dry-run` were tested with fakes; it was never run as root.

## Implementation notes

### What was built

- **Recovery** (`capabilities/awake/src/power`): `RecoveryJournal` (checksummed JSONL, mode 0600, directory 0700, one fsync per append, a change is made only after its line is written), `RecoveryManager` (reconcile at launch, idempotent undo, `canQuit()`), lock file with pid and process start time (`ps lstart` pinned to `TZ=UTC LC_ALL=C`; a lock dated more than 60 s in the future is stale), lid observer (`ioreg`), floors (Low Power Mode at 40 %, end below 10 %, thermal serious and critical), safety acknowledgement gate, helper client (`validateHelperCommand`), backstop `phoenix-awake-backstop.mjs`, `renderSudoers`, `renderLaunchdPlist`, `PowerRecovery.tsx`.
- **Scripts**: `scripts/awake/install-helper.sh` and `uninstall-helper.sh` with `--print-plan`, `--print-sudoers`, `--print-plist` and `--dry-run`; real mode needs root and `--yes`. They write only the sudoers rule as root; every path under the user's home is created as the user and refused when a component is a symlink or not owned by the user (that BSD `install` follows symlinks is an **inference**; the scripts were never run as root). `--data-dir` must be absolute; `--print-plan` prints the `WATCH <journal>` line; `PHOENIX_SUDOERS_DIR` is honoured only in print and dry-run modes.
- **Recovery behaviour added after review**: a held recovery lock reports `restored: false` with the WARNING `awake.recovery.pending`; `change()` and `undo()` share one queue so ON cannot be overtaken by OFF at shutdown; shutdown is awaited for at most 10 s; `recovery.status` shows `journal_path` and `sleep_disabled_unjournaled` (the `SleepDisabled` key name is an **inference**); `recovery.discard` (confirmed, audited) clears an entry of an unknown kind; entries whose undo was refused are closed only after a read-only `pmset -g` check.

### Decisions

- The warning about an **account-wide sudoers rule** is shown in the script, the UI and [awake-helper.md](../awake-helper.md). Whether that rule is acceptable at all is an owner decision.
- Floor thresholds (40 %, 10 %, thermal levels) are the implementing agent's choice, not a product decision.

### Security review

A static review (read-only, not a human audit) found the following; each was **fixed** with failing-before tests: root-run installer steps that could follow a user-planted symlink (user-owned paths are now created as the user and refused on symlinks); a held lock reported as restored; future-dated locks that could hold off recovery; ON overtaken by OFF at shutdown; timezone-dependent `ps lstart` parsing; an undefined data-directory contract (`--data-dir`, `WATCH`, `journal_path`).

**Not fixed (open):** the per-account sudoers rule; the unkeyed journal checksum (a forged journal can cause a premature OFF, suppress an undo, fill the 1 MB cap or add an entry of an unknown kind; `recovery.discard` only bounds the last case); `safety.acknowledge` cannot be limited to a person, because the SDK gives handlers no actor, so an approved agent call could still record it; the backstop covers only the `pmset` kinds; the lock acquire has a remove-then-create race between two instances (harmless: OFF is idempotent).

### What was not built or wired

The quit veto is not connected to the Tauri shell or Core shutdown; Core does not give capabilities a data directory (the backstop may watch a different journal than Phoenix writes; check `--print-plan` against `journal_path`); the backstop covers only the `pmset` kinds.

### What was not run

The installer and uninstaller as root, `sudo -n -l` probe behaviour, the sudoers rule, `launchd` loading, `pmset -a disablesleep` and `lowpowermode`, `ioreg` with the lid closed, a real crash and the one-minute restore, and uninstalling. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.
- Phoenix does not install the helper itself; the user runs the reviewed script.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
