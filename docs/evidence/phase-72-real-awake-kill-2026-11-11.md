# Phase 72: real `caffeinate -w` and release paths, observed through Phoenix's own code (2026-11-11)

A measurement on one Mac, one run. It is NOT the Phase 72 exit criterion (see "What stays unverified").
Raw record: `phase-72-real-awake-kill-2026-11-11-raw.json` (written by the test, not by hand).

## Setup

- Date: 2026-11-11. Machine: macOS 27.0.1, arm64, on battery power (42%, discharging) with the lid open. Node v22.19.0, vitest 4.1.12.
- Command (the only run; no case was retuned after seeing a result):
  `PHOENIX_REAL_AWAKE=1 PHOENIX_REAL_AWAKE_EVIDENCE=<tmp file> /Users/bluephoenix/.nvm/versions/node/v22.19.0/bin/node ./node_modules/vitest/vitest.mjs run capabilities/awake/test/real-awake-kill.test.ts --testTimeout=60000`
  (a `./node_modules/.bin/vitest` invocation with Node 22 first on PATH was used; same Node). Result: 1 file, 12 tests passed, 14.6 s.
- Test: `capabilities/awake/test/real-awake-kill.test.ts` (gated `PHOENIX_REAL_AWAKE=1`, macOS only) plus its child script `capabilities/awake/test/support/real-awake-child.ts`.
- Method: the parent bundles the child script with esbuild into a temp dir and spawns it as its own Node process. The child runs the production `SessionController` and `createInhibitor(realEnv())`, so `env.pid` is the child's own pid and the real `caffeinate` is started by production `realSpawner` with the production argv. The parent reads the caffeinate pid from the child, requires a power assertion owned by that pid in `pmset -g assertions` (read-only; matched on the caffeinate pid, not on the machine-wide count), checks the argv with `ps -o command= -p <pid>` (`-w` must name the child's pid), then ends the child or the session and polls every 50 ms, up to 5 s, for (a) the caffeinate process gone (`kill -0`) and (b) the assertion gone. Only "both gone within 5 s" is asserted; the times are recorded.
- Orphan check: `pgrep -x caffeinate` before the file's first case: none; after the last case (and after the test killed its own control process): none. Also none before and after in a separate shell check.
- No prompt was sent to any model or agent; no user config of `claude`, `gemini` or `codex` was touched. Throwaway dir under the OS temp dir, removed in `afterAll`.

## Production hold as observed

`caffeinate -d -i -s -t 300 -w <child pid>` (child pid and caffeinate pid differ in every case). While held, `pmset -g assertions` showed three types owned by the caffeinate pid: `PreventSystemSleep`, `PreventUserIdleDisplaySleep`, `PreventUserIdleSystemSleep`.

## Results (ms from the end event; one run)

| Case                                                                              | Ended by                                                        | Caffeinate process gone (ms) | Assertion gone (ms) |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------- | ------------------- |
| SIGKILL, rep 1                                                                    | `kill -KILL` of the owning process (no handler can run)         | 53                           | 8                   |
| SIGKILL, rep 2                                                                    | same                                                            | 53                           | 9                   |
| SIGKILL, rep 3                                                                    | same                                                            | 53                           | 8                   |
| SIGKILL, rep 4                                                                    | same                                                            | 51                           | 8                   |
| SIGKILL, rep 5                                                                    | same                                                            | 53                           | 8                   |
| SIGTERM                                                                           | `kill -TERM` of the owning process (no handler installed)       | 53                           | 7                   |
| Release of the production hold                                                    | `InhibitHandle.release()` (SIGTERM to the child)                | 24                           | 32                  |
| Cancel                                                                            | `SessionController.end("cancelled")`; emitted `ended:cancelled` | 24                           | 34                  |
| Quit (shutdown)                                                                   | `SessionController.shutdown()`; emitted `ended:shutdown`        | 23                           | 31                  |
| Expiry of a 2 s hold                                                              | `caffeinate -t 2` ran out on its own (time from start of hold)  | 2104                         | 2037                |
| Session expiry                                                                    | see caveat 2; emitted `ended:expired` (time from session start) | 4973                         | 5004                |
| Control (NOT production): `caffeinate -d -i -t 30` without `-w`, parent SIGKILLed | shows the check can see a leak                                  | still alive at 5 s           | still held at 5 s   |

SIGKILL repetitions: process gone 51 to 53 ms, assertion gone 7 to 9 ms. Every production case was gone within the 5 s limit; the no-`-w` control was not.

## Caveats on reading the numbers

1. Resolution. The process is polled every 50 ms, so "53 ms" means "dead at the second poll", not a measured 53 ms. The assertion check costs a `pmset` call (about 8 ms), so its first poll already saw the assertion gone in the SIGKILL and SIGTERM cases: read those as "within about 10 ms", and the ordering assertion-before-process as a polling artefact, not a finding. The measured claim is only: gone well inside 5 s, on this Mac, five out of five.
2. "Session expiry" is not a real-time 1 minute session. The controller's minimum is 1 minute, so the child used the real controller with a 5 minute session and a clock wrapper that runs the controller's timers 60 times faster (5 s). It exercises the production `armDeadline` to `end("expired")` to `release()` path, but not a real 5 minute wait. The separate 2 s case exercises the hold's own `-t` timer for real.
3. "Cancel" is `SessionController.end("cancelled")`, which is what the `end` command calls. It was not driven through Core's HTTP route, the confirmation prompt or the web UI. "Quit" is `SessionController.shutdown()`, not a real Phoenix.app or Core quit.
4. "Core" here is a stand-in Node process, not the real Core process or the Tauri shell. `-w` was observed with the child's own pid exactly as `realEnv()` gives it to Core; whether the real Core, started by the desktop shell, passes its own pid the same way is code reading, not a run.
5. SIGTERM: the child had no handler, so it died without `shutdown()`; the hold was freed by `-w` (and not by `process.once("exit")`, which does not run on signal death).
6. One Mac, one OS version, one run, 5 repetitions; no load, no sleep or wake in between.

## What stays unverified

- The exit criterion "a session keeps a real Mac awake and always releases when it ends, is cancelled, or Phoenix quits" is still NOT met: the hold was never started through the app (UI, Core route, desktop shell), the Mac was never left idle to see it stay awake, and a real quit of Phoenix.app was not run.
- Lid closed (a lid close sleeps the machine regardless of `caffeinate -s` on battery); battery floor with a real drain; AC versus battery behaviour.
- Linux (`systemd-inhibit`) and Windows (PowerShell `SetThreadExecutionState`) holds: not run; on those platforms nothing ties the hold to Core, so up to 30 minutes of hold can remain after a SIGKILL.
- The sudoers helper (`docs/awake-helper.md`), `agents_grace` with a real coding agent, scheduled wake.
- Core being killed by the operating system under memory pressure, a crash, or the machine being suspended while the parent dies.
