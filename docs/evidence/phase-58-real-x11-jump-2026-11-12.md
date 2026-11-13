# Phase 58: "Jump to terminal" on a real X11 desktop (Linux), 2026-11-12

Status: **observation, not an exit criterion.** One real run on one X server with one window manager. macOS Terminal.app / iTerm2 and Windows were not run and stay unverified. Phase 58 stays "built, exit criteria not met".

## What ran

- The production `focuserFor("linux", execFocus)` from `capabilities/agents/src/terminal-focus.ts` (`LinuxTerminalFocuser` with the real `execFocus`), bundled with esbuild (`--target=node22`) and run with Node v22.19.0 (linux-arm64 tarball from nodejs.org, not apt's Node 18) inside a throwaway `ubuntu:24.04` container (aarch64, Colima VM).
- Entry: `capabilities/agents/test/real-x11/jump-entry.ts` (wraps `execFocus` only to record each call, exit code and stdout). Harness: `capabilities/agents/test/real-x11/run-in-container.sh` + `inner.sh` (stdin-free: files `docker cp`'d into a `--label phoenix-real-test=1 --rm` container that is force-removed on exit; no image built, no pull).
- Packages (apt, Ubuntu 24.04): Xvfb 2:21.1.12-1ubuntu1.9, openbox 3.6.1-12build5 (EWMH, 4 desktops, supports `_NET_ACTIVE_WINDOW`), wmctrl 1.07-7ubuntu3, xdotool 1:3.20160805.1-5build1, xterm 390-1ubuntu3, x11-utils 7.7+6build2.
- Xvfb :99 (1280x800x24), openbox, 19 xterm windows with distinct titles (`-T`). For every jump the harness first activates `baseline-xterm`, runs the focuser, then checks independently with `xdotool getactivewindow getwindowname` and `xprop -root _NET_ACTIVE_WINDOW` and `xdotool get_desktop`.
- Raw data: `docs/evidence/phase-58-real-x11-jump-2026-11-12-raw.json` (`runs.afterFix` = the final run, `runs.beforeFix` = the first run). One run each; timings are single samples.

## Findings

### 1. Defect found and fixed: `execFocus` dropped `DISPLAY` (every jump failed)

First run (production code unchanged): all 20 jumps with both tools installed failed with the "Could not focus a window" message, including the matching titles. Calls were `wmctrl -a phoenix-test-A` and `xdotool search ...`, both exit 1. Cause (reproduced separately in a container): `execFocus` passed only `PATH` and `HOME`, so `wmctrl`/`xdotool` printed "Cannot open display". On a real Linux desktop Phoenix would therefore never have focused anything. Fix: `execFocus` forwards `DISPLAY` and `XAUTHORITY` when set (never invents one). Failing-first tests: `terminal-focus.test.ts` "execFocus (real child process)" (the first one failed before the fix: `expected '<unset>' to be ':77'`).

### 2. Defect found and fixed: xdotool matches `--name` as a regex

`wmctrl -a` is a plain case-insensitive substring match; `xdotool search --name` is a regular expression. With wmctrl removed (xdotool path, before the fix): title `x+y` (literal window exists) did not match; `foo(` (invalid regex) did not match; `a.*b` matched an unrelated window `aXXb`; `c.*d` activated decoy `cXXd` instead of the literal `c.*d`; `$(id>pwned)` did not match its own window. Fix: the title is regex-escaped before `xdotool search`. Failing-first test: "xdotool matches --name as a regex, so regex metacharacters in the title are escaped" (failed before the fix). After the fix the same xdotool-only run activated `c.*d`, `x+y`, `foo(`, `$(id>pwned)`, `;id>pwned2` correctly, and `a.*b` (no literal window, only the decoy `aXXb`) correctly matched nothing.

### 3. Final run (after both fixes), wmctrl + xdotool installed

| Case                                               | Result                                                                    | Window that became active (independent check)                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| titles A, B, C, A again                            | method `wmctrl`, 3-10 ms                                                  | exactly the requested window; `xprop -root _NET_ACTIVE_WINDOW` agreed (A = 0xc0000c)              |
| no window matches (`nomatch-zzz`)                  | fails, 36 ms (both tools ran, exit 1)                                     | unchanged (`baseline-xterm`)                                                                      |
| two windows match (`dup-` -> `dup-one`, `dup-two`) | wmctrl succeeded                                                          | `dup-one` (first in wmctrl's list)                                                                |
| three match (`phoenix-test`)                       | wmctrl                                                                    | `phoenix-test-A`                                                                                  |
| `proj` with `proj-extra` created earlier           | wmctrl                                                                    | **`proj-extra`**, the wrong window (substring match)                                              |
| upper-case `PHOENIX-TEST-A`                        | wmctrl                                                                    | `phoenix-test-A` (wmctrl is case-insensitive)                                                     |
| `my project`, `-dash`, `x+y`, `foo(`, `c.*d`       | wmctrl                                                                    | the literal window each time                                                                      |
| `$(id>pwned)`, `;id>pwned2`                        | wmctrl                                                                    | the literal window; no file `pwned`/`pwned2` was created in `/work` or `/` (argv array, no shell) |
| `a.*b` (only decoy `aXXb` exists)                  | wmctrl exit 1, xdotool search finds nothing, fails                        | unchanged (before the fix: the decoy was activated)                                               |
| `--help` (no such window)                          | fails cleanly; `--` before the title in xdotool means it is not an option | unchanged                                                                                         |
| minimised window (`xdotool windowminimize`)        | wmctrl                                                                    | raised and active (de-iconified)                                                                  |
| window on desktop 1 while desktop 0 current        | wmctrl                                                                    | raised and active, **desktop switched to 1**                                                      |

### 4. wmctrl removed (xdotool path only), after the fix

All the literal-title cases above succeeded with method `xdotool`, 32-38 ms each (about 8x slower than wmctrl, each of `search` and `windowactivate` being a process). Two windows: `dup-` -> `dup-two`, `phoenix-test` -> `phoenix-test-B` (so wmctrl and xdotool choose different windows for an ambiguous title); `proj` -> `proj` (xdotool's order differs from wmctrl's). **A minimised window and a window on another desktop are not found by the xdotool path** (it uses `--onlyvisible`, and openbox unmaps both): both jumps failed with the generic message and nothing was raised. This only matters when wmctrl is absent.

### 5. No tool, no X, Wayland-style

- Both tools removed: calls `wmctrl ... => 1`, `xdotool ... => 1` (the runner collapses a missing binary to code 1), error text is exactly: `Could not focus a window: needs wmctrl or xdotool on an X11 desktop (Wayland does not allow it)`.
- No `DISPLAY`; `WAYLAND_DISPLAY=wayland-0 XDG_SESSION_TYPE=wayland` with no `DISPLAY`; `DISPLAY=:98` (no server): identical text, nothing activated. A real Wayland compositor (with XWayland) was not run; this is only the "no X server reachable" environment.
- The message is the same for all failures (no match, tool missing, no display), so the user cannot tell "your terminal title does not contain the project folder name" from "install wmctrl".

## Limitations recorded, not fixed

- `wmctrl -a <name>` is a case-insensitive substring match on the whole title, so the project folder `proj` can raise another window whose title merely contains `proj` (observed: `proj-extra`). With several matches the choice is the tool's (wmctrl: first in its list; xdotool: a different one). Exact-title matching would need a window-id listing step; not an obvious fix, so left.
- The window title is the project folder name; a terminal that does not put that in its title (most shells' default is `user@host: cwd`, which usually contains it, but custom titles may not) fails with the generic text. Only xterm titles set with `-T` were tried. gnome-terminal, kitty, alacritty, tmux titles, and the Tauri-managed tty path were not tried.
- One window manager (openbox), one X server (Xvfb), no real focus-stealing prevention policy. Mutter/KWin/xfwm4 can refuse or only flash the taskbar for `_NET_ACTIVE_WINDOW` requests from a client without a user-time stamp; not observed here.
- Xvfb has no real display, keyboard focus owner or input: "active" here is the window manager's `_NET_ACTIVE_WINDOW` / X input focus, not what a person sees.
- The Core route (`POST /api/agent/sessions/:id/focus-terminal`, confirmation first) was not exercised: this run covers `LinuxTerminalFocuser` + `execFocus` only. The real Core process environment (does it have `DISPLAY` when launched from the Tauri app, a systemd unit or autostart?) was not checked.
- Timings are single samples on a 2-CPU VM.

## Cleanup

No `phoenix-real` container left from this task (a separate `phoenix-real-x11dict-*` container belongs to another agent), docker image count 17 (unchanged), 7 spectrum containers untouched.
