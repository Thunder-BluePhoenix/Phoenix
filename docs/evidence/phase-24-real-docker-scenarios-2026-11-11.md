# Phase 24: Docker capability against a real daemon, five scenarios (2026-11-11)

What this is: `createDockerCapability` on the SDK test harness, polling a **real** Docker Engine, while throwaway containers were created, stopped and crashed. For each scenario the test recorded every `docker.*` event, the Fawkes state/explanation (state engine `onChange`), the Status string Docker served in `GET /containers/json`, and `docker inspect` State fields as ground truth.

What this is NOT: no Docker Desktop, OrbStack or Podman socket was available, so those stay unverified. One daemon, one VM, one run per scenario (twice for the whole suite, see "Run 1 and the fix"). Nothing here is a statistical result; the timing-dependent rows (4a, 3a) differed between the two runs.

## Setup

- Machine: macOS 27.0.1 arm64, Node v22.19.0. Daemon: Colima 0.10.3 VM (`Ubuntu 24.04.4 LTS`, kernel 6.8.0-117-generic, aarch64, cgroup v2), Docker Engine **29.5.2**, `docker` CLI 29.6.1, socket `/Users/bluephoenix/.colima/default/docker.sock`.
- Test: `capabilities/docker/test/real-docker-scenarios.test.ts`. Opt-in because it WRITES: `PHOENIX_REAL_DOCKER=1 PHOENIX_REAL_DOCKER_WRITE=1 PHOENIX_REAL_DOCKER_RAW_OUT=<file> vitest run capabilities/docker/test/real-docker-scenarios.test.ts --testTimeout=120000`. `test/real-docker.test.ts` is unchanged and still read-only.
- Capability poll interval: **250 ms** (`poll_ms`, the minimum; the default is 3000 ms, which would see even less of the fast scenarios). The capability talks to a recording proxy socket in front of the real one; the proxy saw only `GET /containers/json?all=true` (234 requests) and `GET /containers/<id>/json` (10 requests), no other method or path (asserted).
- Containers: `docker run -d --pull never --name phoenix-real-<random>-<scenario> --label phoenix-real-test=1 ...`, images `ubuntu:24.04` and `python:3.12-slim-bookworm` already present locally (nothing pulled). A startup sweep removes only containers with that label (0 found), each scenario `docker rm -f`s its own in a `finally`, and `afterAll` sweeps again and lists by label.
- Containers outside the test were never stopped, removed or inspected, and their names are not recorded: `docker ps -a` showed **7 before and 7 after**, labelled phoenix-real containers remaining: **0**.
- Raw data: `phase-24-real-docker-scenarios-2026-11-11-raw.json` (run 2, after the fix) and `...-run1-before-fix-raw.json`. Container names there are `phoenix-real-<random>-...`.
- Times `t` are ms since `docker run` started. Event payloads below drop `container_id`, `name` and `image` (always the test container; no `Env`, `Mounts`, `Cmd`, `Labels` or any other field appeared in any event).

## Run 1 and the fix (read this first)

Run 1 showed an obvious defect in `exitEvent`: for a container under a restart policy, the capability inspected **after** Docker had already begun the next run, and `State.ExitCode` was then `0` (running), so the exit it had just seen as `Restarting (1)` was reported as `docker.container.stopped` with `exit_code: 0`, i.e. no alarm for a crashing container (scenario 4b, event at t=1268). Ground truth `docker inspect` in the same run: `restarting/ExitCode 1` at t=1148, `running/ExitCode 0` at t=2232.

Fix (`capabilities/docker/src/monitor.ts`, `exitEvent`): prefer the exit code from the Status text of the list reply that showed the exit (`Exited (N)` / `Restarting (N)`) over the later inspect; inspect still supplies `OOMKilled` and the code when Status has none. Unit test `test/units.test.ts` "prefers the code in the Status text over a later inspect" fails with the old line and passes with the new one (checked by reverting the line). The scenarios were then re-run once unchanged; the tables below are run 2 (the first run's differing rows are noted).

## Scenario 1: health check (starting, healthy, unhealthy)

Docker's own Status strings, in order, for the same container:

| container                                                    | Docker `Status`                                                                      | `docker inspect` Health                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------- |
| `--health-cmd true --health-interval 1s`                     | `Up Less than a second (health: starting)` (t=305), `Up 1 second (healthy)` (t=1383) | `starting` (t=1116), `healthy` (t=2195) |
| `--health-cmd false --health-retries 1 --health-interval 1s` | `Up Less than a second (health: starting)`, `Up 1 second (unhealthy)` (t=1383)       | `unhealthy` (t=1122)                    |

`(health: starting)` is therefore the real wording and the capability's `HEALTH` regex matched it (the healthy event only fires from a seen `starting`/`unhealthy`, and it did).

| scenario     | t (ms)                              | event                        | severity | payload extras  | Fawkes                                                           |
| ------------ | ----------------------------------- | ---------------------------- | -------- | --------------- | ---------------------------------------------------------------- |
| 1a healthy   | 186                                 | `docker.container.started`   | info     |                 | no change (IDLE)                                                 |
|              | 1250                                | `docker.container.healthy`   | info     |                 | no change (IDLE, "All quiet")                                    |
| 1b unhealthy | 172                                 | `docker.container.started`   | info     |                 | IDLE                                                             |
|              | 1240                                | `docker.container.unhealthy` | warning  |                 | **WARNING** "Container phoenix-real-<r>-health-bad is unhealthy" |
|              | 3372 (after `docker rm -f` at 3114) | `docker.container.stopped`   | info     | `removed: true` | IDLE "All quiet"                                                 |

Observation: while `health: starting` there is no event and no warning, which is what the code claims. Detection latency from Docker's own health flip to event: about 120-130 ms (inspect at t=1122, event at 1240).

## Scenario 2: `docker stop` of a running healthy container

| scenario                                                                        | exit | t (ms)                                                                               | events    | Fawkes                          | `docker inspect` State at the end                       |
| ------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------ | --------- | ------------------------------- | ------------------------------------------------------- |
| 2a `sleep 600` as PID 1 (ignores SIGTERM), `docker stop -t 2`, returned at 4698 | 137  | 183 started, 1250 healthy, **4721 `docker.container.stopped` info `exit_code: 137`** | no `died` | never left IDLE (0 transitions) | `exited`, ExitCode 137, OOMKilled false, RestartCount 0 |
| 2b shell traps SIGTERM and `exit 143`, `docker stop -t 5`, returned at 2676     | 143  | 174 started, 1241 healthy, **2851 `docker.container.stopped` info `exit_code: 143`** | no `died` | never left IDLE                 | `exited`, ExitCode 143, OOMKilled false                 |

Result: **no alarm** for `docker stop`, both for the SIGKILL path (137) and the SIGTERM path (143), as the code claims. The `stopped` event carries the exit code. Docker's Status was `Exited (137)` / `Exited (143)`. (Docker keeps `Health: unhealthy` in the stopped container's inspect; it is not part of any event.)

## Scenario 3: non-zero exit (`sh -c 'exit 3'`)

| scenario                     | events                                                                              | Fawkes                                                                                      | Docker                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 3a `sh -c 'exit 3'`          | **none**                                                                            | IDLE, no transition                                                                         | Status `Exited (3) Less than a second ago` first seen at t=305; inspect ExitCode 3 |
| 3b `sh -c 'sleep 2; exit 3'` | 176 started; 2339 `docker.container.died` error `{exit_code: 3, oom_killed: false}` | ERROR "Container phoenix-real-<r>-exit3-slow exited with code 3" (stays until acknowledged) | `exited`, ExitCode 3                                                               |

**Limitation found (3a):** a container that is created and exits inside one poll interval is first seen as already `exited`, which the capability treats as pre-existing history (no event). A container that exits with code 3 immediately is invisible to Fawkes. This is the documented "starts and stops entirely between two polls" cost, but it applies to the instant failure most people mean by "container fails to start", so it is worth knowing. Not changed.

## Scenario 4: crash loop (`--restart on-failure`, exit 1), watched 10 s

Docker's restart back-off doubles from 100 ms, so a container that exits immediately spends almost all of its time in `restarting` and is `running` for only ~270 ms per cycle.

| scenario                     | events in 10 s                                                                                              | max events/s | Fawkes                                                                                                                                                                           | `docker inspect` (ground truth)                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 4a `sh -c 'exit 1'`          | **run 2: none. Run 1: 1 `started` (t=976) and 1 `died` code 1 (t=1247), then nothing for the other ~8.7 s** | 0 (run 1: 2) | run 2: **IDLE the whole time** while the container crash-looped (RestartCount 7 at 7.6 s, `Restarting: true`, ExitCode 1). Run 1: ERROR "exited with code 1" once, left in place | `restarting/1`, RestartCount 4 -> 7                       |
| 4b `sh -c 'sleep 1; exit 1'` | 12 = 6 `started` + 6 `died` (`exit_code: 1`, `oom_killed: false`)                                           | 2            | alternates **ERROR "exited with code 1" / IDLE** 11 times: ERROR at 1246, 2314, 3646, 5262, 7138, 9569; IDLE at each `started` (1511, 2581, 4179, 6069, 8751). Ends in ERROR     | `restarting/1` -> `running/0` -> ..., RestartCount 1 -> 6 |

Findings:

- **No flood and the 100-event cap is not near.** Worst case 12 events in 10 s (2 in any second).
- 4b flaps: every restart emits `started`, which clears the ERROR, and every crash raises it again, so Fawkes shows ERROR/IDLE about once per second. The `died` events are individually correct after the fix; the display is noisy. Run 1 (before the fix) additionally lost one crash as `stopped` exit 0 (see above).
- **Limitation found (4a):** a fast crash loop is mostly in `restarting`, and the diff only reports `started` from a sampled `running`. At a 250 ms poll the ~270 ms `running` windows were sampled in run 1 once and not at all in run 2; at the default 3 s poll they would essentially never be. `RestartCount` is not read by the capability (it only reads `State.ExitCode`/`OOMKilled` from inspect), so a crash loop that is mostly `restarting` can sit at IDLE. A fix would be to alarm on a container observed in `restarting` with a non-zero `Restarting (N)` Status, which is a design change, so it is reported not done.

## Scenario 5: OOM kill

`python:3.12-slim-bookworm`, `--memory 32m --memory-swap 32m`, allocating 1 MiB per 20 ms.

| t (ms) | event                           | payload                            | Fawkes                                                          |
| ------ | ------------------------------- | ---------------------------------- | --------------------------------------------------------------- |
| 176    | `docker.container.started`      |                                    | IDLE                                                            |
| 2309   | `docker.container.died` (error) | `exit_code: 137, oom_killed: true` | **ERROR** "Container phoenix-real-<r>-oom exited with code 137" |

Ground truth: `docker inspect` `OOMKilled: true`, `ExitCode: 137`, RestartCount 0 (inspect at t=2232, event at t=2309). Docker's Status was `Exited (137)`. OOM is detected and distinguished from `docker stop` (which also exits 137, scenario 2a, no alarm). The explanation says "exited with code 137"; it does not say "out of memory" (the flag is in the payload only).

## What this changes

Observed on a real daemon now: health `starting` wording, `docker stop` quiet (137 and 143), non-zero exit ERROR (after a seen `running`), restart-policy loop (one real defect fixed; flapping and an invisible-instant-loop limitation recorded), OOM kill detected. Still not observed: Docker Desktop, OrbStack, Podman sockets (not available here); a daemon restart; Compose labels; paused containers; image-build events; a container taking more than one poll to be created.
