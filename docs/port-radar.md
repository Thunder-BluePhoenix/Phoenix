# Port & process radar (`ports`, Phase 80)

Lists the TCP ports listening on this computer with their program, project folder and age, flags forgotten dev servers and heavy
processes, and can stop one after you approve. Package `capabilities/ports`, capability id `ports`, UI `PortRadar` in Settings.

Installed, never auto-enabled. Permissions: `shell_command` (the read tools and the signals) and `filesystem_read` (the `.git` walk).
Nothing here was run against a real Linux or Windows machine; see [What is verified](#what-is-verified).

## Commands

| Command           | Side effect | Input                                        | Notes                                                                                                                                                                                                                                                                             |
| ----------------- | ----------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list`            | `read`      | `{}`                                         | The snapshot below. Read-only.                                                                                                                                                                                                                                                    |
| `stop_process`    | `execute`   | `{ pid, port, start, command, uid }`         | Asks every time (the prompt names `pid`, `port`, `command`). Sends **SIGTERM only**, then waits up to 3 s for it to exit.                                                                                                                                                         |
| `force_stop`      | `execute`   | the same fields                              | A **second command with its own confirmation**. Sends SIGKILL. Refused unless a `stop_process` SIGTERM went to the same process at least 5 s earlier and it still runs.                                                                                                           |
| `restart_process` | `execute`   | the same fields plus `{ recipe, argv, cwd }` | Asks every time (the prompt names pid, port, command, recipe, **the exact argv** and **the folder**). Stops with the `stop_process` path (SIGTERM only), then starts the **owner's recipe** only if the program exited. See [Restarting](#restarting-owner-written-recipes-only). |

`restart_process` exists **only for recipes the owner writes in the configuration**; Phoenix never rebuilds a command from `ps` or
`lsof` output. Analysis and rules: [Restarting](#restarting-owner-written-recipes-only).

Events: `ports.process.signalled` (pid, port, executable file name, signal, outcome, exited; never the full command path) after
each signal, `ports.process.restarted` (pid, port, file name, recipe name, exited, started, new pid, spawn_failed; never argv or folder) after each restart attempt that stopped the program, and `ports.radar.changed` (counts only, ephemeral) when background refresh is on and the list changed.
Config: `watch` (default off), `poll_ms` (5 s to 10 min, default 15 s), `forgotten_after_hours` (default 8), `heavy_cpu_percent`
(default 80), `heavy_memory_mb` (default 1024), `restart_roots` and `restart_recipes` (below; no restart exists without them).

## How ports are read

All reads go through an injected `Runner` (argv array, absolute path, no shell). Parsers are pure functions in `src/parse.ts`.

| Platform | Listeners                                                                                  | Names / processes                                               | Verified                                          |
| -------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------- |
| macOS    | `/usr/sbin/lsof -nP -iTCP -sTCP:LISTEN -F pcnL` (field output)                             | `ps -axo pid=,ppid=,pgid=,uid=,pcpu=,rss=,etime=,lstart=,comm=` | Yes, on one Mac (guarded real test, below)        |
| Linux    | `/usr/bin/lsof` (same flags), else `ss -ltnpH` (`/usr/bin/ss`, `/usr/sbin/ss`, `/sbin/ss`) | the same `ps` line                                              | **No**: fixtures from the documented formats only |
| Windows  | `%SystemRoot%\System32\netstat.exe -ano -p TCP`                                            | `%SystemRoot%\System32\tasklist.exe /FO CSV /NH` (names only)   | **No**: fixtures from the documented formats only |

- `ps` runs as `env TZ=UTC LC_ALL=C /bin/ps ...` so `lstart` does not change with the time zone; that string is the process's start
  time and half of its identity.
- `SystemRoot` comes from the injected environment and is used only if it looks like a plain drive path; otherwise `C:\Windows`.
- lsof exit code 1 with empty stderr means "nothing listed" and is an empty answer. A failure of every collector is `unavailable`,
  never an empty list.
- Linux `ps` gives only the executable name in `comm`, not a path (macOS gives the path). Names only means fewer processes pass the
  "dev tool" rule; it never makes stopping looser.
- An unreadable process table still lists ports (names from lsof) but ages are unknown, the flags are off and **nothing is
  stoppable**.
- Windows: ports and names only. No age (no start-time source), no project (no cwd), no stopping (`uid` is unknown, so the stop
  rules fail closed).
- The `lsof -d cwd` call reads each listening process's working directory. A process of another user simply has none, so it has no
  project.

### Which interfaces a port accepts

`exposure`: `all` (wildcard `*`, `0.0.0.0`, `::`), `loopback` (only `127.x`, `::1`) or `interface` (one specific address).
This is what the socket is bound to, not a firewall verdict.

## Project mapping

The nearest ancestor directory of the process's working directory that contains `.git` (file or directory), found through an
injected filesystem seam (`exists`). The user's home directory itself and `/` never count (a dotfiles repository in `~` would claim
everything). **Only the folder name** is returned to the web; the capability keeps the path. No cwd (other user's process, Windows)
means "no project". This is not limited to the user's configured repositories: any directory with a `.git` counts, decided because
the radar is about what is running, and the name alone is shown.

## Flags (definitions)

- **Maybe forgotten**: the process listens on a port, has run longer than `forgotten_after_hours` (default 8), sits in a project
  folder, and is one Phoenix would be allowed to stop (so never a system process, someone else's, or Phoenix itself). Phoenix
  **cannot** see whether traffic still reaches the port; there is no cheap, reliable measure of that. So "forgotten" means only
  "old and in a project", and the UI says so ("Phoenix cannot see whether anyone still uses it").
- **Heavy**: `ps` `pcpu` at or above `heavy_cpu_percent` (default 80) or resident memory at or above `heavy_memory_mb` (default
  1024 MB). `pcpu` is an average over the process's life (Linux) or a decaying average (macOS), not a live reading: a spike that
  just ended can show, a short burst can be missed. Applies to any listed process.
- Age comes from `etime` (falling back to `now - lstart`). Windows: unknown.

## Stopping a process: the rules

`stop_process` and `force_stop` do all of this before any signal, on a **fresh** read of the process table and the listeners:

1. **Proof.** The call must carry the `{pid, start, command, uid}` the user saw in the list. The fresh row must match all four
   exactly (a reused pid has another start time; a swapped binary has another command). Mismatch → `changed`, no signal. This is the
   same pid + start-time + command pattern as the Awake lid actions (`freeze-core.ts`).
2. **Port.** The pid must still be listening on the `port` named in the prompt.
3. **Stop rules** (`stopRefusal`, the first failing rule is reported):
   1. never pid <= 1;
   2. never Core: not its pid, its parent, any ancestor, **any descendant (a process Core started)**, or any process in Core's process group; if Core's own row is missing the
      answer is "unknown" and nothing is stopped;
   3. Core's uid must be known (not Windows) and must not be root; the process must have **the same uid**;
   4. not a protected name (launchd, loginwindow, Dock, Finder, WindowServer, sshd, systemd, init, cron and similar; list in
      `src/policy.ts`);
   5. not under `/System`, `/usr/libexec`, `/usr/sbin`, `/sbin`, `/Library/Apple`, unless it is a dev interpreter;
   6. must be a dev tool: executable under the user's home, `/opt/homebrew` or `/usr/local`, or an interpreter named node, python,
      ruby, deno, bun, java or go run by the same user. `..` path segments are refused.
   7. the protected list also holds `ollama`, `colima`, `limactl`, `dockerd`, `com.docker.*` and every executable whose name starts with `phoenix` (rule 4).
4. **SIGTERM first.** `stop_process` sends only SIGTERM through the injected `Signaler` and waits (injected sleep) up to 3 s. If the
   process is still there the result says `can_force: true`.
5. **SIGKILL only by the second explicit command.** `force_stop` needs its own confirmation, only works for a process this capability
   sent SIGTERM to (in memory; a restart or disable forgets it), at least 5 s after that SIGTERM, and repeats steps 1-3. A
   permission error from the OS (EPERM) is reported as a refusal, never as success.
6. The real signaler (`src/real.ts`, the only `process.kill` in the package) also refuses pid < 2 and Core's own pid whatever the
   caller decided. Only `SIGTERM` and `SIGKILL` exist in the type.

Every attempt goes through the permission gateway: a confirmation request (naming pid, port and the command), approve/deny, and an
audit trail (`confirmation.requested`, `confirmation.approved`, `action.authorized`, `action.succeeded` or `failed`). Only one stop
runs at a time.

### Not covered

- A shell wrapper (`sh -c "node server.js"`) is the process in the process table; only the one the user picks is signalled, and its
  children are not (Phoenix signals a pid, never a group).
- An interpreter run by the user that is not a dev server (a `python` running a long job that happens to listen) is stoppable; the
  user decides in the prompt.
- Time-of-check/time-of-use: the kernel can in theory reuse a pid between the identity read and the signal. `prove()` shrinks the window as far as it can: it collects the listeners FIRST, reads the process table (for the ancestry rules) next, and reads the one target with `ps -p <pid>` LAST, immediately before the signal. What remains is the time of one `ps` process exit plus one function return and the `kill` call: **milliseconds, not zero**. There is no atomic "signal this exact process" call without a pidfd (Linux 5.3+, not used here). The start-time proof makes a reused pid very unlikely, and a signal needs the same uid anyway.
- A process name may contain a line break, which makes `ps` or `ss` print a second, forged row. The parsers are strict: a line that does not parse completely is dropped and counted in `parse_warnings` (shown in the UI), and a pid claimed by two rows is dropped from the table entirely (neither first nor last wins). The identity proof reads only the target (`ps -p <pid>`) and requires exactly one line that parses and names that pid. A name carrying a format, line or paragraph separator (bidi override, zero-width) is dropped the same way, so that process is not stoppable. Display names and project folder names are cleaned of control and format characters.

## Restarting: owner-written recipes only

**The analysis.** Re-running a command line read back from `ps` or `lsof` would execute attacker-influenceable data: any local
process can set its own argv and title, so "restart what is listening on 3000" built from process data would start whatever that
process claims to be. It would also lose the environment and could not know about a supervisor or `launchd` job that restarts the
program by itself. **Phoenix therefore never reconstructs a command from a process.** What it builds instead is much narrower.

**Restart recipes** are written by the owner in this capability's configuration (`POST /api/capabilities/ports/config`; nothing in
the UI writes them):

```json
{
  "restart_roots": ["/Users/ada/code"],
  "restart_recipes": {
    "shop": {
      "argv": ["/Users/ada/bin/serve", "--port", "3000"],
      "cwd": "/Users/ada/code/shop",
      "ports": [3000]
    }
  }
}
```

- A recipe is `{ argv[], cwd, ports[] }`. `argv[0]` is a normalised absolute path to a program (**a shell is refused**: `sh`, `bash`,
  `zsh`, `dash`, `fish`, `ksh`, `csh`, `tcsh`, `ash`, `busybox`, `cmd`, `powershell`, `pwsh`; use a script file instead). Arguments are fixed text
  without control or invisible characters; the argv as JSON and `cwd` are at most 80 characters each, so the approval prompt never clips what will run.
- `cwd` must be a normalised absolute path inside one of `restart_roots` (never `/`, no wildcards); `ports` are 1 to 8 integers from
  1024 to 65535 and one port belongs to one recipe. At most 8 recipes, 8 roots, 16 arguments. Unknown fields (an `env`, a `shell`) are
  refused by the schema; a recipe that fails any check is **not usable** (never offered, never started), the others still work.
- **Matching is by the owner-declared port only.** The list shows a `restart` offer (recipe name, argv as JSON, folder) for a
  listening process **that Phoenix may stop** and whose port a recipe declares. Nothing in the process's own name, argv or cwd takes part.
- The approval prompt shows the pid, port, command, **recipe name, exact argv and folder**. The call must carry the same text; a
  config edited since the list was read is refused as `changed` and nothing happens.
- **Stop** is the existing guarded path (`Stopper.stop`): pid, start time, command and uid re-proven, same uid, never Core, never a
  protected or system process, never root, SIGTERM only. A restart never sends SIGKILL; a program that ignores SIGTERM is **not
  restarted** (its port is still in use) and the answer says it is still running, with `force_stop` as the separate next step.
- **Before** anything is stopped, the recipe is checked on the real file system: Core is not root and not on Windows, the program
  exists (symlinks resolved; **the real path is what runs**), is a regular executable file, is not writable by everyone, does not sit in a
  world-writable folder without the sticky bit, and the folder exists and (symlinks resolved) is inside a real `restart_roots` folder.
  A recipe that cannot start stops nothing. The same checks run again right before the start.
- **Start** is argv-only (`spawn`, `shell: false`), detached, no stdin or output, in the checked folder, with a **minimal
  environment**: `PATH`, `HOME`, `USER`, `LANG`, `LC_ALL`, `TMPDIR` copied from Core plus `TERM=dumb` and `NO_COLOR=1`; no token,
  no `PHOENIX_*`, nothing else is inherited. `realSpawner` (`src/real.ts`) is the only place the package starts a program.
- **A failed start after the stop is reported honestly**: the operation fails with "The program was stopped, but the recipe could
  not be started … The program is no longer running", a `ports.process.restarted` event with `spawn_failed: true` is sent, and the page
  reads the list again. Phoenix does not retry and does not claim a restart.
- Every restart goes through the permission gateway (confirmation, audit rows), like a stop. Success means **the OS started the
  process**, not that it listens again: the page says so and asks for another scan.

**Still not covered.** A supervisor or `launchd`/`systemd` job that restarts the program itself can race a restart (the old program
exits, the supervisor starts one, then the recipe starts a second); Phoenix cannot see supervisors. The recipe is the owner's
description of how to start the program; if it differs from how the program was really started, the owner chose that. The new
process is detached and unmonitored. Nothing here has run against a real process: every test uses a fake process table and a fake
spawner (plus two real-seam tests that start nothing).

## Opening a local server's page

`PortRadar` shows **Open in browser** only for a socket that a connection to `127.0.0.1` reaches: a wildcard bind (`*`, `0.0.0.0`, `::`) or exactly `127.0.0.1` (not `127.0.0.2` or another `127.x` address, not `::1`-only, not a single LAN address). The link is built in the web code from the port **number** alone: `http://127.0.0.1:<port>/`, `target=_blank`
with `rel=noopener noreferrer`. Nothing a process, project name or Core says can change the address. It is a plain link the browser
or Tauri shell opens in the system default browser (no new desktop open-url path was added). **Phoenix has no browser of its own
yet (Phase 93)**, and the UI says so.

## Polling

Off by default. With config `watch: true` the capability reads every `poll_ms` (default 15 s) but only while something watches Core
(`ctx.untilWatched()`), and announces `ports.radar.changed` only when the set of listeners or flags changed. The UI's "Refresh
automatically" switch writes that config; the **Scan now** button works with it off.

## What is verified

- Parsers, collectors, project mapping, flags, stop rules and the capability through the real permission gateway: unit tests with a
  fake machine (`capabilities/ports/test`, `capabilities/ports/testing/fakes.ts`). **Simulated**: no real process is ever signalled.
- The Linux (`ss`, `lsof` on Linux) and Windows (`netstat`, `tasklist`) fixtures are written from the tools' documented formats,
  **not** from a real capture on those systems.
- One guarded real test (`PHOENIX_REAL_PORTS=1 ./node_modules/.bin/vitest run capabilities/ports/test/real-ports.test.ts`) runs the
  real, read-only collector on this machine against a loopback server the test itself opens, and asserts the port and the test
  process's pid. It never signals anything. Run once on macOS only.
- Exit criterion "Ports listed match `lsof`/`ss`/`netstat` on each OS": **unmet** except the macOS guarded test above.
- Exit criterion "Stopping a process requires approval and is audited": covered **in simulation** (gateway, fake signaler).
- Restart recipes (`recipes.ts`, `restart.ts`, `restart.test.ts`, the restart block of `capability.test.ts`, the web tests): **simulated only** (fake process table, fake spawner and file system). Two real-seam tests exercise `realSpawner` (a missing program and folder; nothing starts) and `realInspect` (symlinks in a temp folder). No restart ran against a real process, and no real supervisor was involved.
