// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Runs scenarios against a REAL Docker Engine and WRITES to it: it creates, starts, stops and
// removes containers. It is therefore opt-in twice over, and skipped unless BOTH are set:
//
//   PHOENIX_REAL_DOCKER=1 PHOENIX_REAL_DOCKER_WRITE=1 \
//     npx vitest run capabilities/docker/test/real-docker-scenarios.test.ts --testTimeout=120000
//
// (test/real-docker.test.ts stays read-only and needs only PHOENIX_REAL_DOCKER.)
//
// Rules the test keeps:
//  - It only uses images that are already present locally (`--pull never`; it never pulls).
//  - Every container it creates is named `phoenix-real-<random>-<scenario>` and labelled
//    `phoenix-real-test=1`. A startup sweep removes only leftover containers carrying that label,
//    each scenario removes its own containers in a `finally`, and afterAll sweeps again and checks
//    by label that none remain. No other container is stopped, removed or inspected, and no other
//    container name is ever recorded or printed (only counts).
//  - Memory-limited containers use a 32 MiB limit with swap disabled.
//  - The CAPABILITY under test only sends GETs. They go through a recording proxy socket so the
//    test can assert the methods and paths it used. The test itself (not the capability) uses the
//    `docker` CLI to create and remove containers and `docker inspect` as ground truth.
//
// Each scenario is driven through the real createDockerCapability on the test harness, polling
// the real socket every 250 ms (the capability's minimum), and records every docker.* event and
// the Fawkes state/explanation. The observations are written as JSON to the file named by
// PHOENIX_REAL_DOCKER_RAW_OUT (if set). Assertions are structural only: what a scenario shows
// (an alarm, no alarm, a missed event) is evidence, not something the test asserts.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, connect, type Server, type Socket } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createDockerCapability,
  dockerJson,
  findSocket,
  MAX_EVENTS_PER_POLL,
  socketCandidates,
} from "../src";
// Real wall-clock waits are deliberate: this drives a real Docker daemon (container start, health
// intervals, restart back-off, OOM) whose timing fake timers cannot control.

const ENABLED = Boolean(process.env.PHOENIX_REAL_DOCKER && process.env.PHOENIX_REAL_DOCKER_WRITE);
const LABEL = "phoenix-real-test=1";
const UBUNTU = "ubuntu:24.04";
const PYTHON = "python:3.12-slim-bookworm";
const POLL_MS = 250;
const execFileAsync = promisify(execFile);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const suffix = randomBytes(4).toString("hex");

interface Observation {
  scenario: string;
  description: string;
  dockerRunArgs: string[];
  /** ms since the container was created. */
  timeline: { t: number; marker: string }[];
  events: { t: number; event: Record<string, unknown> }[];
  fawkes: { t: number; state: string; explanation: string; conditions: number }[];
  /** `GET /containers/json` as Docker served it for this scenario's containers, on change. */
  dockerStatus: { t: number; state: string; status: string }[];
  /** `docker inspect` State fields, on change (ground truth). */
  dockerInspect: { t: number; state: Record<string, unknown> }[];
  /** Normalised distinct Status strings Docker served (digits replaced by N). */
  distinctStatuses: string[];
  finalInspect: Record<string, unknown> | null;
  finalFawkes: { state: string; explanation: string; conditions: number };
  eventTypeCounts: Record<string, number>;
  maxEventsInOneSecond: number;
  eventsFromOtherContainers: number;
}

const observations: Observation[] = [];
const proxied: { method: string; path: string }[] = [];
let socket = "";
let proxy: Server | undefined;
let proxyDir = "";
let proxyPath = "";
const versions: Record<string, string> = {};
const counts: Record<string, number> = {};

function cli(args: string[], timeout = 90_000): Promise<string> {
  return execFileAsync("docker", args, {
    env: { ...process.env, DOCKER_HOST: `unix://${socket}` },
    timeout,
  }).then((r) => r.stdout.trim());
}

/** Ids of the containers THIS test labels (never any other). */
async function labelled(): Promise<string[]> {
  const out = await cli(["ps", "-aq", "--filter", `label=${LABEL}`]);
  return out ? out.split("\n") : [];
}

async function sweep(): Promise<number> {
  const ids = await labelled();
  if (ids.length) await cli(["rm", "-f", ...ids]);
  return ids.length;
}

async function totalContainers(): Promise<number> {
  const out = await cli(["ps", "-aq"]);
  return out ? out.split("\n").length : 0;
}

/** Forwards to the real socket and records the method and path of each request the capability sends. */
function startProxy(upstream: string, listenPath: string): Promise<Server> {
  const server = createServer((client: Socket) => {
    const up = connect(upstream);
    client.on("data", (chunk) => {
      for (const m of chunk.toString("latin1").matchAll(/^([A-Z]+) (\S+) HTTP\/1\.[01]\r$/gm)) {
        proxied.push({ method: m[1]!, path: m[2]!.replace(/[0-9a-f]{12,64}/g, "<id>") });
      }
      up.write(chunk);
    });
    client.on("end", () => up.end());
    client.on("error", () => up.destroy());
    up.on("error", () => client.destroy());
    up.pipe(client);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenPath, () => resolve(server));
  });
}

const INSPECT_TEMPLATE =
  '{"Status":"{{.State.Status}}","Running":{{.State.Running}},"Restarting":{{.State.Restarting}},' +
  '"OOMKilled":{{.State.OOMKilled}},"ExitCode":{{.State.ExitCode}},"RestartCount":{{.RestartCount}}' +
  '{{if .State.Health}},"Health":"{{.State.Health.Status}}"{{end}}}';

async function inspectState(name: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await cli(["inspect", "-f", INSPECT_TEMPLATE, name], 15_000)) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

interface Scenario {
  h: Harness;
  /** Creates a container `phoenix-real-<random>-<suffix>` (never pulls) and returns its name. */
  start(nameSuffix: string, runArgs: string[], image: string, command: string[]): Promise<string>;
  mark(marker: string): void;
  t(): number;
  /** Waits for a condition (checked every 100 ms). */
  until(cond: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void>;
  eventsOfType(type: string): number;
}

async function scenario(
  id: string,
  description: string,
  body: (s: Scenario) => Promise<void>,
): Promise<void> {
  const names = new Set<string>();
  const obs: Observation = {
    scenario: id,
    description,
    dockerRunArgs: [],
    timeline: [],
    events: [],
    fawkes: [],
    dockerStatus: [],
    dockerInspect: [],
    distinctStatuses: [],
    finalInspect: null,
    finalFawkes: { state: "", explanation: "", conditions: 0 },
    eventTypeCounts: {},
    maxEventsInOneSecond: 0,
    eventsFromOtherContainers: 0,
  };
  const h = createHarness({ modules: [createDockerCapability()] });
  h.manager.configure("docker", { socket_path: proxyPath, poll_ms: POLL_MS });
  let t0 = Date.now();
  const t = () => Date.now() - t0;
  const mark = (marker: string) => obs.timeline.push({ t: t(), marker });
  h.bus.subscribe("real.recorder", "*", (e) => {
    if (e.source !== "docker") return;
    const subject = typeof e.subject === "string" ? e.subject : "";
    if (!names.has(subject)) obs.eventsFromOtherContainers++;
    else
      obs.events.push({ t: t(), event: JSON.parse(JSON.stringify(e)) as Record<string, unknown> });
  });
  h.state.onChange((s) =>
    obs.fawkes.push({
      t: t(),
      state: s.state,
      explanation: s.explanation,
      conditions: s.conditions.length,
    }),
  );

  let stop = false;
  let sampler: Promise<void> = Promise.resolve();
  const statusKeys = new Map<string, string>();
  const inspectKeys = new Map<string, string>();
  const distinct = new Set<string>();
  const sample = async () => {
    let tick = 0;
    while (!stop) {
      try {
        const raw = await dockerJson(socket, "/containers/json?all=true");
        for (const c of raw as Record<string, unknown>[]) {
          const name = String((c.Names as string[] | undefined)?.[0] ?? "").replace(/^\//, "");
          if (!names.has(name)) continue;
          const status = String(c.Status);
          const state = String(c.State);
          distinct.add(status.replace(/\d+/g, "N"));
          const key = `${state}|${/\((healthy|unhealthy|health: starting)\)/.exec(status)?.[1]}|${/^(?:Exited|Restarting) \((-?\d+)\)/.exec(status)?.[1]}`;
          if (statusKeys.get(name) !== key) {
            statusKeys.set(name, key);
            obs.dockerStatus.push({ t: t(), state, status });
          }
        }
        if (tick++ % 4 === 0) {
          for (const name of names) {
            const s = await inspectState(name);
            if (!s) continue;
            const key = JSON.stringify(s);
            if (inspectKeys.get(name) !== key) {
              inspectKeys.set(name, key);
              obs.dockerInspect.push({ t: t(), state: s });
            }
          }
        }
      } catch {
        // the sampler is evidence only; a failed GET is not a test failure
      }
      await sleep(POLL_MS);
    }
  };

  try {
    await h.enable("docker");
    await vi.waitFor(
      async () =>
        expect((await h.manager.checkHealth("docker")).health.message).toMatch(/containers/),
      { timeout: 10_000, interval: 100 },
    );
    const s: Scenario = {
      h,
      t,
      mark,
      async until(cond, timeoutMs) {
        await vi.waitFor(async () => expect(await cond()).toBe(true), {
          timeout: timeoutMs,
          interval: 100,
        });
      },
      eventsOfType: (type) => obs.events.filter((e) => e.event.event_type === type).length,
      async start(nameSuffix, runArgs, image, command) {
        const name = `phoenix-real-${suffix}-${nameSuffix}`;
        names.add(name);
        const args = [
          "run",
          "-d",
          "--pull",
          "never",
          "--name",
          name,
          "--label",
          LABEL,
          ...runArgs,
          image,
          ...command,
        ];
        obs.dockerRunArgs = args.filter((a) => a !== name);
        if (obs.timeline.length === 0) {
          t0 = Date.now();
          sampler = sample();
        }
        mark("docker run");
        await cli(args);
        mark("docker run returned");
        return name;
      },
    };
    await body(s);
    await sleep(POLL_MS * 4); // let the last poll land
    await h.drain();
    obs.finalInspect = names.size ? await inspectState([...names][0]!) : null;
    const snap = h.state.snapshot();
    obs.finalFawkes = {
      state: snap.state,
      explanation: snap.explanation,
      conditions: snap.conditions.length,
    };
    mark("final state read");
  } finally {
    stop = true;
    await sampler;
    for (const name of names) await cli(["rm", "-f", name]).catch(() => undefined);
    await h.close();
    for (const e of obs.events) {
      const type = String(e.event.event_type);
      obs.eventTypeCounts[type] = (obs.eventTypeCounts[type] ?? 0) + 1;
    }
    for (const e of obs.events) {
      const inWindow = obs.events.filter((o) => o.t >= e.t && o.t < e.t + 1000).length;
      obs.maxEventsInOneSecond = Math.max(obs.maxEventsInOneSecond, inWindow);
    }
    obs.distinctStatuses = [...distinct].sort();
    observations.push(obs);
  }
}

/** The structural rules every scenario must keep, whatever Docker did. */
function expectStructure(obs: Observation): void {
  const serialised = JSON.stringify(obs.events);
  expect(serialised).not.toMatch(/"(Env|Mounts|Cmd|Labels|Config|HostConfig)"/);
  expect(obs.eventsFromOtherContainers).toBe(0);
  const allowed = new Set([
    "container_id",
    "name",
    "image",
    "compose_project",
    "compose_service",
    "exit_code",
    "oom_killed",
    "removed",
  ]);
  for (const { event } of obs.events) {
    expect(String(event.event_type)).toMatch(/^docker\.container\./);
    for (const key of Object.keys(event.payload as Record<string, unknown>)) {
      expect(allowed.has(key), `unexpected payload field ${key}`).toBe(true);
    }
  }
  expect(obs.maxEventsInOneSecond).toBeLessThanOrEqual(MAX_EVENTS_PER_POLL * 4);
}

describe.skipIf(!ENABLED)(
  "real Docker Engine scenarios (WRITES: creates and removes containers)",
  () => {
    beforeAll(async () => {
      const found = findSocket(socketCandidates(undefined, process.env, homedir()));
      expect(found.path, `no Docker socket among: ${found.tried.join(", ")}`).toBeDefined();
      socket = found.path!;
      for (const image of [UBUNTU, PYTHON]) {
        // the test never pulls: a missing image fails here with a clear message
        await cli(["image", "inspect", "--format", "{{.Id}}", image]).catch(() => {
          throw new Error(`image ${image} is not present locally; this test never pulls`);
        });
      }
      versions.docker_server = await cli(["version", "--format", "{{.Server.Version}}"]);
      versions.docker_cli = await cli(["version", "--format", "{{.Client.Version}}"]);
      versions.os = await cli([
        "info",
        "--format",
        "{{.OperatingSystem}} | kernel {{.KernelVersion}} | {{.Architecture}} | cgroup v{{.CgroupVersion}}",
      ]);
      counts.removedLeftoversAtStartup = await sweep();
      counts.totalBefore = await totalContainers();
      proxyDir = mkdtempSync("/tmp/phx-real-");
      proxyPath = join(proxyDir, "d.sock");
      proxy = await startProxy(socket, proxyPath);
    }, 120_000);

    afterAll(async () => {
      await new Promise<void>((r) => (proxy ? proxy.close(() => r()) : r()));
      if (proxyDir) rmSync(proxyDir, { recursive: true, force: true });
      counts.removedBySweepAtEnd = await sweep();
      counts.labelledRemainingAtEnd = (await labelled()).length;
      counts.totalAfter = await totalContainers();
      const out = process.env.PHOENIX_REAL_DOCKER_RAW_OUT;
      if (out) {
        const requests: Record<string, number> = {};
        for (const r of proxied) {
          const key = `${r.method} ${r.path}`;
          requests[key] = (requests[key] ?? 0) + 1;
        }
        writeFileSync(
          out,
          JSON.stringify(
            {
              versions,
              counts,
              pollMs: POLL_MS,
              maxEventsPerPoll: MAX_EVENTS_PER_POLL,
              requests,
              observations,
            },
            null,
            2,
          ) + "\n",
        );
      }
      console.log(`real docker scenarios: ${JSON.stringify(counts)}`);
      expect(counts.labelledRemainingAtEnd).toBe(0);
      expect(counts.totalAfter).toBe(counts.totalBefore);
      // the capability sent only GETs, only on the allow-listed paths
      expect(proxied.length).toBeGreaterThan(0);
      expect(proxied.every((r) => r.method === "GET")).toBe(true);
      expect(
        proxied.every(
          (r) => r.path === "/containers/json?all=true" || r.path === "/containers/<id>/json",
        ),
      ).toBe(true);
    }, 120_000);

    const last = () => observations[observations.length - 1]!;

    it("1a. health check going starting -> healthy", async () => {
      await scenario(
        "1a-healthy",
        "health-cmd true, 1 s interval: starting -> healthy",
        async (s) => {
          const name = await s.start(
            "health-ok",
            ["--health-cmd", "true", "--health-interval", "1s"],
            UBUNTU,
            ["sleep", "600"],
          );
          await s.until(async () => (await inspectState(name))?.Health === "healthy", 30_000);
          s.mark("docker inspect says healthy");
          await sleep(2_000);
        },
      );
      expectStructure(last());
    }, 90_000);

    it("1b. health check going unhealthy", async () => {
      await scenario(
        "1b-unhealthy",
        "health-cmd false, retries 1, 1 s interval: starting -> unhealthy, then docker rm -f",
        async (s) => {
          const name = await s.start(
            "health-bad",
            ["--health-cmd", "false", "--health-retries", "1", "--health-interval", "1s"],
            UBUNTU,
            ["sleep", "600"],
          );
          await s.until(async () => (await inspectState(name))?.Health === "unhealthy", 30_000);
          s.mark("docker inspect says unhealthy");
          await sleep(2_000);
          s.mark("docker rm -f");
          await cli(["rm", "-f", name]);
          await sleep(1_500);
          s.mark("1.5 s after rm -f");
        },
      );
      expectStructure(last());
    }, 90_000);

    it("2a. docker stop of a running healthy container (SIGTERM ignored, SIGKILL -> 137)", async () => {
      await scenario(
        "2a-stop-137",
        "healthy container whose PID 1 ignores SIGTERM; docker stop -t 2 ends in SIGKILL",
        async (s) => {
          const name = await s.start(
            "stop-kill",
            ["--health-cmd", "true", "--health-interval", "1s"],
            UBUNTU,
            ["sleep", "600"],
          );
          await s.until(async () => (await inspectState(name))?.Health === "healthy", 30_000);
          await sleep(1_500);
          s.mark("docker stop -t 2");
          await cli(["stop", "-t", "2", name]);
          s.mark("docker stop returned");
          await s.until(async () => (await inspectState(name))?.Running === false, 15_000);
          await sleep(2_000);
        },
      );
      expectStructure(last());
    }, 90_000);

    it("2b. docker stop of a running healthy container (SIGTERM handled, exit 143)", async () => {
      await scenario(
        "2b-stop-143",
        "healthy container whose shell traps SIGTERM and exits 143; docker stop -t 5",
        async (s) => {
          const name = await s.start(
            "stop-term",
            ["--health-cmd", "true", "--health-interval", "1s"],
            UBUNTU,
            ["sh", "-c", 'trap "exit 143" TERM; sleep 600 & wait'],
          );
          await s.until(async () => (await inspectState(name))?.Health === "healthy", 30_000);
          await sleep(1_500);
          s.mark("docker stop -t 5");
          await cli(["stop", "-t", "5", name]);
          s.mark("docker stop returned");
          await s.until(async () => (await inspectState(name))?.Running === false, 15_000);
          await sleep(2_000);
        },
      );
      expectStructure(last());
    }, 90_000);

    it("3a. sh -c 'exit 3' (exits before the first poll can see it running)", async () => {
      await scenario(
        "3a-exit3-instant",
        "sh -c 'exit 3', created and exited within ~100 ms",
        async (s) => {
          const name = await s.start("exit3-fast", [], UBUNTU, ["sh", "-c", "exit 3"]);
          await s.until(async () => (await inspectState(name))?.Running === false, 15_000);
          await sleep(2_000);
        },
      );
      expectStructure(last());
    }, 90_000);

    it("3b. non-zero exit seen running first (sleep 2; exit 3)", async () => {
      await scenario("3b-exit3-after-sleep", "sh -c 'sleep 2; exit 3'", async (s) => {
        const name = await s.start("exit3-slow", [], UBUNTU, ["sh", "-c", "sleep 2; exit 3"]);
        await s.until(async () => (await inspectState(name))?.Running === false, 20_000);
        await sleep(2_000);
      });
      expectStructure(last());
    }, 90_000);

    it("4a. crash loop: --restart on-failure, exit 1 immediately, ~10 s", async () => {
      await scenario(
        "4a-crashloop-instant",
        "--restart on-failure, sh -c 'exit 1', watched 10 s",
        async (s) => {
          await s.start("loop-fast", ["--restart", "on-failure"], UBUNTU, ["sh", "-c", "exit 1"]);
          await sleep(10_000);
          s.mark("10 s elapsed");
        },
      );
      expectStructure(last());
    }, 90_000);

    it("4b. crash loop: --restart on-failure, runs 1 s then exit 1, ~10 s", async () => {
      await scenario(
        "4b-crashloop-1s",
        "--restart on-failure, sh -c 'sleep 1; exit 1', watched 10 s",
        async (s) => {
          await s.start("loop-slow", ["--restart", "on-failure"], UBUNTU, [
            "sh",
            "-c",
            "sleep 1; exit 1",
          ]);
          await sleep(10_000);
          s.mark("10 s elapsed");
        },
      );
      expectStructure(last());
    }, 90_000);

    it("5. OOM kill: python allocating until --memory 32m kills it", async () => {
      await scenario(
        "5-oom",
        "python allocates 1 MiB steps under --memory 32m --memory-swap 32m",
        async (s) => {
          const name = await s.start("oom", ["--memory", "32m", "--memory-swap", "32m"], PYTHON, [
            "python",
            "-c",
            'import time\nb=[]\ntime.sleep(1.5)\nwhile True:\n    b.append(bytearray(b"x")*(1024*1024))\n    time.sleep(0.02)',
          ]);
          await s.until(async () => (await inspectState(name))?.Running === false, 40_000);
          s.mark("docker inspect says not running");
          await sleep(2_000);
        },
      );
      expectStructure(last());
    }, 90_000);
  },
);
