# Keep awake (`awake`)

Keeps the computer awake for a **bounded** time, without root. There is no indefinite mode: a session
always has an end (at most 7 days), and it is always released.

Installed, never auto-enabled. Permission: `shell_command` (plus whatever later modules declare).

## Commands

| Command  | Side effect | Input                                                                           | Notes                                                                                                                                                                                         |
| -------- | ----------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start`  | `execute`   | `{ minutes: 1..10080, reason?: string ≤ 80, mode?: "timed" \| "agents_grace" }` | Refused if a session runs, or the battery is below the floor. `reason` is shown to the user only; control, bidi and zero-width characters are rejected.                                       |
| `extend` | `execute`   | `{ minutes: 1..10080 }`                                                         | Timed sessions only; the time left may never exceed 10080 min.                                                                                                                                |
| `end`    | `execute`   | `{}`                                                                            | Idempotent. The web button asks for a 1.5 s hold (or Space/Enter held).                                                                                                                       |
| `status` | `read`      | `{}`                                                                            | `{ active, session?: { id, mode, label?, started_at, ends_at, remaining_seconds, agents_working?, grace_minutes? }, battery_floor_percent, min_minutes, max_minutes }`. No pid, argv or path. |

`start`, `extend` and `end` always ask for confirmation (gateway) and are audited.

## What holds the machine awake

| Platform | Child process                                                                             | Verified                                            |
| -------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------- |
| macOS    | `caffeinate -d -i -s -t <seconds>`                                                        | Yes, on one Mac (`PHOENIX_REAL_AWAKE=1`, see below) |
| Linux    | `systemd-inhibit --what=idle:sleep --who=Phoenix --why=… sleep <seconds>`                 | **No** (fake runner only)                           |
| Windows  | `powershell.exe` running a constant script that calls `SetThreadExecutionState` in a loop | **No, UNVERIFIED** (never run on Windows)           |

Every child bounds itself (`-t`, `sleep N`, the script's loop), so it expires even if Phoenix is
killed. Argv arrays only; no shell. The Windows script is a constant; the only variable is the
validated integer passed as a separate argv element and bound to an `[int]` parameter.

The hold is released exactly once on: `end`, expiry, capability disable, the emergency stop, Core
exit (`shutdown()` and the capability signal), the battery floor, and a hold that dies or cannot be
renewed. A hold that cannot start refuses the `start`.

## Battery floor

Config `battery_floor_percent` (1..90, default 10). A session ends (`reason: battery`) when the
machine is **on battery** and below the floor; `start` is refused in the same state. Read through
`pmset -g batt` (macOS), `/sys/class/power_supply/BAT*` (Linux), `Get-CimInstance Win32_Battery`
(Windows, unverified), polled every 60 s. A machine with no battery never trips the rule. If the
level cannot be read, that is "unknown": the session ends only after **3 consecutive** unknown reads
(the unreadable read at `start` counts as the first).

## Stay awake while agents work (`mode: "agents_grace"`)

`minutes` is the grace period. The session subscribes to the bus (`agent.*`): while any agent is
`working` (or reports `progress`) the machine is held and `ends_at` is `null`; when the last one
finishes, completes, fails, ends, waits or goes idle, a countdown of `minutes` starts and the session
ends with `reason: agents_done`. An agent silent for 1 hour stops counting. The hold is renewed every
15 minutes in 30-minute pieces, so a crashed Phoenix never leaves a long hold. Requires Core's bus
(`createAwakeCapability({ feed })`; `builtins.ts` passes the agents capability's `services().events`);
without it `agents_grace` is refused.

## Events

`awake.session.started`, `awake.session.extended`, `awake.session.ended`. Payload:
`{ session_id, mode, label?, minutes, ends_at (ISO|null), remaining_seconds, reason? }`;
`reason` (ended only) is `expired | cancelled | battery | thermal | shutdown | disabled | kill_switch | agents_done | inhibitor_lost`.
`correlation_id` is the session id. No tick event: the UI counts down from `ends_at`.

Fawkes' state is **not** changed (no `state_rules`): WORKING while only a timer runs would be wrong,
and states are fixed. The "awake" indicator is the countdown pill in the island, floating Fawkes and
the Overview.

## Adding a module (Phases 73-75)

Export an `AwakeModule` (`src/system.ts`) and append it to `MODULES` in `src/index.ts`.
`composeAwake` merges commands, specs, events, state rules, config properties, secrets and
permissions, and fails fast on a duplicate command, config key or secret. A module's `init(ctx, deps)`
gets `deps.session` (`active()`, `end(reason)`), `deps.env`, `deps.battery`, `deps.feed`.

## Tests

`pnpm vitest run capabilities/awake/test` uses recording fakes (`testing/`): no real process, timer
or command runs. `test/real-awake.test.ts` is skipped unless `PHOENIX_REAL_AWAKE=1` on macOS: it
starts a real `caffeinate -t 20`, checks `pmset -g assertions` (read-only) for an assertion owned by
that pid, releases it, and checks the process and assertion are gone.

## Known limits

- Closing the lid still sleeps the machine (that needs Phase 73).
- On disable, the emergency stop and Core exit the manager aborts the capability's signal first, and
  an aborted context cannot publish, so those paths release the hold but do **not** publish
  `awake.session.ended` (`capability.disabled` records the reason). `end`, expiry, battery,
  agents_done and a lost hold publish normally.
- No tray countdown: the tray menu is Rust (Tauri) and was not touched.
- Linux and Windows are untested on real machines.
