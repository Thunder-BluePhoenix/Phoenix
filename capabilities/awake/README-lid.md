# Lid-close actions (Phase 74)

While a keep-awake session runs and the lid closes, Phoenix saves power and quiets the computer.
When the lid opens, the session ends, the capability is disabled, the kill switch fires or Core
exits, every action is undone. Config key `lid_actions`; code in `src/lid-actions/`.

**Status: tested as a SIMULATION only.** The real Awake capability, the real Recovery module
(journal, lock, reconcile) and these actions run on a fake machine (processes are a table, a signal
is a log line, audio and `defaults` are maps). No lid was ever closed, no process was frozen, no
volume, brightness or `defaults` value was changed, and no root path ran. The exit criterion "each
action is undone on lid open and by the backstop; tested with a lid simulation" is met **as a
simulation** (see "Undo paths" for what "the backstop" means here).

## Actions

| id              | Default                               | What it does                                                                                         | Journal kind                      |
| --------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------- |
| `display`       | on                                    | `pmset displaysleepnow`; brightness set to 0 and restored if the free `brightness` tool is installed | `lid.display`                     |
| `freeze_apps`   | on (Slack, WhatsApp, Discord)         | `SIGSTOP`, later `SIGCONT`                                                                           | `lid.freeze`                      |
| `mute`          | on                                    | mutes the output(s), restores each as it was                                                         | `lid.mute`                        |
| `low_power`     | on, only when the helper is installed | `sudo -n pmset -a lowpowermode 1` through Recovery's helper client                                   | `pmset.lowpowermode` (Recovery's) |
| `docker_freeze` | **off**                               | `SIGSTOP` Docker Desktop's own processes while no container runs                                     | `lid.docker_freeze`               |
| `app_nap`       | **off**                               | `defaults write <bundle id> NSAppSleepDisabled -bool YES` per listed app                             | `lid.app_nap`                     |

Config: `enabled` (master), `display`, `freeze_apps`, `freeze_apps_list` (keys `slack`, `whatsapp`,
`discord`), `mute`, `low_power`, `docker_freeze`, `app_nap`, `app_nap_apps` (bundle ids, strict
pattern, at most 16), `protected_extra` (names, at most 64). Everything is validated; invalid
entries are dropped and counted. Everything disabled or unsupported means **zero Runner calls**.

Each action is `{id, kind, plan(ctx) -> Planned | null, apply(planned), undo(undoData), support()}`.
`plan` only reads. The framework (`engine.ts`) then calls Recovery's `change(kind, apply, undo,
doApply, session)`, which **writes the journal entry first**, then runs `apply`. A journal that
cannot be written means the action is not run. Actions run independently: one failing never blocks
the others, or the undo of the others.

## Undo paths

- Lid opens (`awake.lid.opened` from Recovery's observer; the observer announces only a change
  between two KNOWN readings, so when the actions were applied for a real lid close and the next
  reading is `open` after an `unknown`, the engine's own 5 s check treats it as the open), session ends (event or a 5 s check),
  capability disabled, kill switch (`security.kill_switch.engaged`), shutdown: `engine.open()` →
  Recovery's `undo()` (newest first, idempotent, one failure never stops the rest; a failed undo
  stays pending and is retried by reconcile / `recovery.undo_now`, and blocks `canQuit`).
- A dead Phoenix: every kind is registered with Recovery (`registerReverter`) **even when its action
  is switched off**, and the undo data in each entry is self-sufficient (pids with start time and
  command, per-device mute state, prior `defaults` value, brightness per display). The next launch's
  reconcile undoes the leftovers from the file alone. Tested: a second instance on the same journal
  after the first "died" restores everything, including with every action OFF in its config.
- The launchd backstop (Phase 73) only knows `pmset.disablesleep` and `pmset.lowpowermode`
  (`PRIVILEGED_KINDS`), because it can only act through the sudo rule. So after a crash Low Power
  Mode is undone by the backstop within a minute; the user-level kinds (freeze, mute, display,
  App Nap, Docker) are undone by the next Phoenix launch. **A frozen app stays frozen until Phoenix
  starts again** if Phoenix is killed and never relaunched. GAP (needs a user-level backstop script).

## Freezing: the rules

- Targets come only from the process table read through the injected `ProcessLister` (`/usr/bin/env
TZ=UTC LC_ALL=C /bin/ps -axo pid=,ppid=,uid=,state=,lstart=,comm=`), matched by the executable
  path of a constant app table (`apps.ts`; paths assume a default `/Applications` install,
  UNVERIFIED on a real Mac). Only processes whose `uid` is Phoenix's own (`process.getuid()`) are
  targets, at plan, at apply and at undo; an unknown own uid means no target.
- `ps` runs with a fixed time zone and locale both when the start time is recorded and when it is
  checked, so a changed time zone cannot make the same process look different.
- `{pid, start, command}` of every target is journalled. SIGSTOP re-reads the table and re-checks
  identity, owner and protection at the last moment.
- **Calls are detected only through power/audio assertions.** Phoenix reads the read-only
  `/usr/bin/pmset -g assertions` (constant argv) and never freezes an app one of whose processes (or
  a process an assertion was created for) holds `PreventUserIdleSystemSleep`,
  `PreventUserIdleDisplaySleep` (or the older no-sleep names) or an audio-in/out resource: an app in
  a call or playing sound normally holds one. This is a heuristic: an in-app call that holds none of
  them is NOT detected (Phoenix has no other signal for Slack, WhatsApp or Discord calls). If the
  probe fails or its text is not an assertions listing, nothing is frozen (`assertions_unknown`,
  announced). The assertions are read at plan and again just before signalling. UNVERIFIED on a
  real Mac.
- SIGCONT is sent **only** if pid, start time, command **and** owner still equal the entry.
  - Another command (or a vanished pid): reported (`mismatched` / `gone`) and dropped.
  - The same command with another start time: maybe the same app relaunched: not signalled, the
    entry **stays pending** and the user is told (`retry_or_alert`).
  - Another user's process, or EPERM: classed `not_ours`, reported (a warning), **not** left pending.
- A failed undo is tried 3 times (pauses of 1 s and 3 s on the host clock's timer) before it stays
  pending for reconcile; `retry_or_alert` and `output_changed` are not retried in a loop. On
  shutdown the module awaits the undo for at most 10 s.
- A process that was already stopped by someone else (`ps` state `T`) is never a target.
- Signals go through the injected `Signaler`; `real.ts` is the only file that calls `process.kill`,
  and refuses pids below 2 and Phoenix's own pid.
- A meeting, recording or dictation (events `kage.*`, `notetaker.*`, `dictation.*`, `voice.*`)
  blocks the freeze, mute, display sleep and App Nap; **unknown state (no event feed) also blocks
  them**. It is read again at apply. Each activity is a set of live captures (by `session`, `title`
  or `meeting_id`): an end event removes only its own capture, so another running capture keeps it
  on. A meeting or recording **never expires by itself** (a lost end event keeps the actions off);
  dictation and voice, short by design, are forgotten after 3 hours.

## Protected list (`protected.ts`, pure `isProtected(proc, ctx)`)

Never frozen: Phoenix (own pid and its tree, ancestors and descendants), terminals (Terminal,
iTerm2, Ghostty, Alacritty, WezTerm, kitty, Warp), editors (VS Code, Cursor, Zed, JetBrains family,
Xcode, Sublime, Vim/Neovim and GUI forks), meeting/recording/dictation apps (Zoom, Teams, FaceTime,
Webex, QuickTime, OBS, ...), running coding agents (pids from `agent.*` events that carry a numeric
`pid`, plus the names `claude`, `codex`, `aider`, `gemini`), and anything under any of those
(ancestor walk). The user can only ADD names (`protected_extra`); there is no way to remove a
built-in. The freeze actions refuse to even plan a protected target (the journal never lists one).

## Mute

macOS has no stock per-device mute. The real adapter (`createOsascriptAudio`) uses constant
`osascript -e 'set volume output muted true|false'` strings and can address **only the current
default output**. The framework is written for per-device ids: the previous state is recorded per
device id, only for devices Phoenix mutes (an already-muted output is not unmuted).

The default output's **name** is read with the read-only `/usr/sbin/system_profiler SPAudioDataType
-json` (5 s limit) and recorded in the journal entry (`default_name`). It is only ever compared,
never put in a script. On undo, if the adapter can only address the default and the current
default's name differs, the user switched outputs while the lid was closed: the new default is
**not** unmuted, the entry stays pending and the user sees `output_changed` in plain text (it is
completed once the old output is the default again). If the name cannot be read, the undo goes by id
alone as before and the status says `output_identity_unknown`. **GAP:** real per-device mute needs
CoreAudio APIs.

## Display

`pmset displaysleepnow` is stock. Brightness has no stock command: the free third-party
`brightness` tool is used only if present at `/opt/homebrew/bin/brightness` or
`/usr/local/bin/brightness`, and only if that file is owned by root or the current user and is not
group- or world-writable (a read-only `stat`, checked at plan, apply and undo); otherwise only
`displaysleepnow` runs and the status says `brightness_tool_missing` (an untrusted file at undo time
is reported as `brightness_tool_untrusted` and not run). The keyboard
backlight needs private APIs or another third-party tool and is **not implemented**
(`keyboard_backlight_unsupported`). **GAP.** Phoenix installs nothing and adds no dependency.

## Docker

Idleness comes from the injected `DockerIdle` seam (`idle` / `busy` / `unknown`); `busy` and
`unknown` never freeze. **GAP:** no cross-capability call exists yet (the Docker capability only
publishes `docker.*` events and a `containers` command), so `createLidActionsModule` defaults the
seam to `unknown`: Docker is **never** frozen until a host supplies `dockerIdle`. Wiring it in
`core/runtime/src/builtins.ts` was out of this task's file ownership.

## App Nap

The prior value is read with `defaults read` (`absent` / `yes` / `no`) and journalled before the
write; undo deletes the key if it was absent, else writes the prior value. An already-`yes` app, or
one whose prior value cannot be read, is left alone. Bundle ids are checked against
`/^[A-Za-z0-9][A-Za-z0-9-]*(\.[A-Za-z0-9][A-Za-z0-9-]*)+$/` in config and again when the entry is
read back. macOS applies the setting when the app next launches.

## Commands and events

`lid_actions.status` (read): per-action `enabled`/`supported`/`reason`/`limits`, the protected
list, the last lid event. `lid_actions.simulate_close` / `simulate_open` exist **only** when the
module is created with `allowSimulation: true` (a test seam; the production module and manifest
never have them). Events `awake.lid_action.applied|undone|failed`: action id, counts, table keys
(`slack`, ...), fixed reason codes; never process names or paths.

## Not verified

Everything on a real Mac: process paths, `ps` output format on other macOS versions, `pmset
displaysleepnow` behaviour with the lid closed, `osascript` mute on devices without a mute control,
`brightness -l` output, SIGSTOP of Electron apps, and the lid observer itself (Phase 73). No real
signal, volume, brightness or `defaults` change was ever made.
