# Phase 80 — Port & Process Radar

| Field | Value |
|---|---|
| Stage | Stage 14 — Phoenix originals |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | 🟨 Built; macOS read-only listing checked once on a real Mac (guarded `PHOENIX_REAL_PORTS=1` test), everything else simulated: Linux and Windows collectors were written from documented formats and never run on those systems, and no real process was ever signalled; `restart_process` and the Phoenix-browser open are not built; the Linux and Windows listing criterion and the real-stop criterion are not met |
| Depends on | [Phase 18 — Terminal / Process Capability](phase-18-terminal-process-capability.md) |
| Unblocks | — |

## Goal

Know which dev servers and processes are running, and stop the forgotten ones.

## Tasks

- [ ] List listening ports with process, project and age (macOS, Linux, Windows). Built behind an injected `Runner`: macOS and Linux `lsof -nP -iTCP -sTCP:LISTEN -F pcnL`, a Linux `ss -ltnpH` fallback, Windows `netstat -ano -p TCP` plus `tasklist /FO CSV /NH`; `ps` runs with `TZ=UTC LC_ALL=C`; the project is the name of the nearest `.git` folder (name only) (`capabilities/ports/src/collect.ts`, `parse.ts`, `project.ts`; `capabilities/ports/test/parse.test.ts`, `snapshot.test.ts`). The macOS read was run once for real (see the exit criteria). Unticked because the **Linux and Windows collectors were never run** (their fixtures come from documented formats, not captures), and on Windows ages, projects and stopping are unavailable by design.
- [ ] Flag forgotten servers (no activity, old) and heavy processes. Forgotten = age over 8 hours, inside a project and stoppable; heavy = `ps` CPU or resident memory at or above a configurable threshold; both have documented definitions (`snapshot.ts`, `capabilities/ports/test/snapshot.test.ts`, [port-radar.md](../port-radar.md)). Fakes only. Unticked because **"no activity" is not measured**: Phoenix cannot see whether traffic still reaches the port, so "forgotten" means only "old and in a project".
- [ ] Stop or restart a process with approval; never system processes. `stop_process` (SIGTERM, `execute`) and `force_stop` (SIGKILL, only after an approved SIGTERM record for the same pid and start time, valid 10 minutes) go through the real permission gateway; the proof re-reads pid, start time, command and uid, same uid only, never pid 1 or below, never Core's own pid, parent, process group or ancestors, protected names and system prefixes are refused (`stop.ts`, `policy.ts`, `capabilities/ports/test/stop.test.ts`, `capability.test.ts`). Tested with a fake signaler: **no real process was ever signalled.** Unticked because **`restart_process` is not built** and nothing real was stopped.
- [ ] Open a local server's page in the Phoenix browser (Phase 93). **Not built.** Phoenix has no browser of its own (Phase 93 is not built) and no desktop open-URL path was found; the page offers a plain link `http://127.0.0.1:<port>/`, shown only for a wildcard or exactly 127.0.0.1 bind.

## Deliverables

- capabilities/ports: built (`@phoenix/capability-ports`, `capabilities/ports/**`, `apps/web/src/components/PortRadar.tsx` in Settings, `apps/web/src/core/ports.ts`, [port-radar.md](../port-radar.md), [README](../../capabilities/ports/README.md)); macOS read-only run once, the rest simulated.

## Exit criteria

- [ ] Ports listed match `lsof`/`ss`/`netstat` on each OS. **Met for macOS only, and only once:** the guarded `PHOENIX_REAL_PORTS=1` test (`capabilities/ports/test/real-ports.test.ts`) ran the read-only collector on this Mac, listed 49 ports and found the test's own loopback server with the right port and pid; nothing was signalled. **Linux and Windows are unmet.**
- [ ] Stopping a process requires approval and is audited. **Simulated only.** A fake signaler behind the real permission gateway showed the approval requirement and the audit row; no real process was signalled.

## Implementation notes

### What was built

- **Commands**: `list` (read), `stop_process` (execute, SIGTERM) and `force_stop` (execute, SIGKILL, only after an approved SIGTERM record for the same pid and start, TTL 10 minutes).
- **Collectors** behind an injected `Runner`, with strict parsing (duplicate pids dropped, a single-pid proof); `ps` pinned to `TZ=UTC LC_ALL=C`.
- **Flags and project**: forgotten (age over 8 hours, in a project, stoppable) and heavy, with documented definitions; project is the nearest `.git` folder name only.
- **Polling** is off by default and runs only while the page is watched.
- **Stop rules**: proof of pid, start time, command and uid re-read; same uid only; never pid 1 or below; Core's pid, parent, process group and ancestors refused; `ollama`, `colima`, `limactl`, `dockerd`, `docker` and `phoenix` protected by name and Core's descendants refused; protected names, system prefixes and dev-tool rules; an injected `Signaler`.
- **Web and docs**: `PortRadar.tsx` in Settings, `ports.*` interface strings (non-English text machine-generated and unreviewed), [port-radar.md](../port-radar.md). The new workspace package `capabilities/ports` adds a lockfile link only, no new dependency.

### Deviations

- `restart_process` is not built (documented in [port-radar.md](../port-radar.md)).
- The "open in the Phoenix browser" task is a plain loopback link, because Phase 93 does not exist.
- Windows ages, projects and stopping are unavailable by design.

### Security review

An independent static review (read-only, not a human audit) was followed by fixes, each with tests: a newline in a process name could inject fake `ps` or `ss` rows (strict parsing, duplicate pids dropped, single-pid proof); the time-of-check window was shortened (listeners first, `ps -p` right before the kill) and the document corrected; bidi and format characters are stripped from names and projects and such rows are non-stoppable; the approval card shows the tail of long commands; `ollama`, `colima`, `limactl`, `dockerd`, `docker` and `phoenix` are protected by name and Core's descendants are refused; the open link is offered only for a wildcard or exactly 127.0.0.1 bind.

**Not fixed (open):** a time-of-check to time-of-use window remains between the final read and the signal; the protected list and the dev-tool rule are the implementing agent's choice, not a product decision.

### What was not built

`restart_process`; opening a server's page in the Phoenix browser; Windows ages, projects and stopping.

### What was not run

Linux (`lsof`, `ss`) and Windows (`netstat`, `tasklist`) collectors on real systems, and any real signal: no process was ever stopped. The only real run was the one read-only macOS test. Open items are in the [gap register](../gaps.md).


## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Phoenix originals & browser proposal: [phoenix-originals-and-browser.md](../audits/phoenix-originals-and-browser.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
