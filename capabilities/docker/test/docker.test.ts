// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createServer, type AddressInfo, type Server } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDockerCapability, type DockerCapabilityOptions } from "../src";
import {
  SECRET_COMMAND,
  SECRET_ENV,
  SECRET_LABEL,
  SECRET_MOUNT,
  SECRET_TOKEN_ENV,
  startMockDocker,
  type MockDocker,
} from "../testing/mock-docker";

interface ContainersResult {
  containers: Record<string, unknown>[];
}

let h: Harness | undefined;
let docker: MockDocker | undefined;
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  await h?.close();
  await docker?.close();
  h = docker = undefined;
  for (const c of cleanups.splice(0)) await c();
});

/** Docker mock + harness + enabled capability. Containers added before this are the baseline. */
async function ready(
  seed: (d: MockDocker) => void = () => {},
  options: DockerCapabilityOptions = {},
  config: Record<string, unknown> = {},
) {
  docker = await startMockDocker();
  seed(docker);
  h = createHarness({ modules: [createDockerCapability(options)] });
  h.manager.configure("docker", { socket_path: docker.socketPath, poll_ms: 250, ...config });
  await h.enable("docker");
  return { h, docker };
}

const WAIT = { timeout: 5_000 };
const fawkes = () => h!.state.snapshot();
const events = (type: string): Harness["events"] =>
  h!.events.filter((e) => e.source === "docker" && e.event_type === type);
/** Waits until `count` events of `type` exist (default 1). */
const has = (type: string, count = 1) =>
  vi.waitFor(() => expect(events(type)).toHaveLength(count), WAIT);
/** Waits for a poll that completed after `docker` was last changed. */
const settled = async () => {
  const before = docker!.requests.length;
  await vi.waitFor(() => expect(docker!.requests.length).toBeGreaterThan(before + 1), WAIT);
  await h!.drain();
};
const health = async () => (await h!.manager.checkHealth("docker")).health;

describe("manifest", () => {
  it("asks only for container_access and offers a single read-only command", () => {
    const { manifest } = createDockerCapability();
    expect(manifest.permissions).toEqual(["container_access"]);
    expect(manifest.commands).toEqual([
      expect.objectContaining({ name: "containers", side_effect: "read" }),
    ]);
    expect(manifest.events).toEqual(["docker.*"]);
  });
});

describe("Docker is not running", () => {
  it("degrades health with an actionable message, emits nothing, and keeps polling quietly", async () => {
    docker = await startMockDocker();
    const missing = join(docker.socketPath, "..", "nothing-here.sock");
    h = createHarness({ modules: [createDockerCapability()] });
    h.manager.configure("docker", { socket_path: missing, poll_ms: 250 });
    await h.enable("docker");
    await vi.waitFor(async () => {
      expect(await health()).toMatchObject({
        status: "degraded",
        message: expect.stringMatching(/^Docker is not running/),
      });
    }, WAIT);
    // degraded, not unhealthy: no "Docker is unavailable" warning is raised at Fawkes
    expect(fawkes().state).toBe("IDLE");
    expect(h.types("docker")).toEqual([]);
    expect(h.manager.get("docker").status).toBe("enabled");

    const op = await h.run("docker", "containers");
    expect(op).toMatchObject({
      status: "failed",
      error: { code: "CAPABILITY_UNAVAILABLE", message: expect.stringMatching(/not running/) },
    });
  });

  it("starts working once Docker appears (the socket does not have to exist at enable time)", async () => {
    docker = await startMockDocker();
    const late = join(docker.socketPath, "..", "late.sock");
    h = createHarness({ modules: [createDockerCapability()] });
    h.manager.configure("docker", { socket_path: late, poll_ms: 250 });
    await h.enable("docker");
    await vi.waitFor(async () => expect((await health()).status).toBe("degraded"), WAIT);
    await docker.close();
    docker = await startMockDocker(late);
    docker.add({ name: "web" });
    await vi.waitFor(async () => {
      expect(await health()).toMatchObject({ status: "healthy", message: /1 containers/ });
    }, WAIT);
  });
});

describe("baseline", () => {
  it("does not replay containers that already exist, except ones that are unhealthy now", async () => {
    await ready((d) => {
      d.add({ name: "db" });
      d.add({ name: "old-job", state: "exited", status: "Exited (1) 2 days ago", exitCode: 1 });
      d.add({ name: "api", status: "Up 3 minutes (unhealthy)" });
    });
    await has("docker.container.unhealthy");
    await settled();
    expect(h!.types("docker")).toEqual(["docker.container.unhealthy"]);
    expect(events("docker.container.unhealthy")[0]).toMatchObject({ subject: "api" });
    expect(fawkes()).toMatchObject({ state: "WARNING", explanation: "Container api is unhealthy" });
  });
});

describe("unhealthy containers (Phase 24 exit criterion)", () => {
  it("shows a WARNING naming the container and clears it when the container recovers", async () => {
    await ready((d) => d.add({ name: "web", status: "Up 10 minutes (healthy)" }));
    await settled();
    expect(fawkes().state).toBe("IDLE");

    docker!.update("web", { status: "Up 10 minutes (unhealthy)" });
    await has("docker.container.unhealthy");
    await vi.waitFor(() => expect(fawkes().state).toBe("WARNING"), WAIT);
    expect(fawkes().explanation).toBe("Container web is unhealthy");
    expect(events("docker.container.unhealthy")[0]).toMatchObject({
      severity: "warning",
      subject: "web",
      payload: { name: "web", image: "nginx:1.27" },
    });

    // Still unhealthy on later polls: one event, not one per poll.
    await settled();
    expect(events("docker.container.unhealthy")).toHaveLength(1);

    docker!.update("web", { status: "Up 11 minutes (healthy)" });
    await has("docker.container.healthy");
    await vi.waitFor(() => expect(fawkes().state).toBe("IDLE"), WAIT);
  });

  it("keeps the warning through a restart (health 'starting') until the container is healthy", async () => {
    await ready((d) => d.add({ name: "web", status: "Up 1 minute (unhealthy)" }));
    await has("docker.container.unhealthy");
    docker!.update("web", { status: "Up 2 seconds (health: starting)" });
    await settled();
    expect(fawkes().state).toBe("WARNING");
    docker!.update("web", { status: "Up 20 seconds (healthy)" });
    await vi.waitFor(() => expect(fawkes().state).toBe("IDLE"), WAIT);
  });

  it("two unhealthy containers are two separate warnings; one recovering leaves the other", async () => {
    await ready((d) => {
      d.add({ name: "a", status: "Up 1 minute (unhealthy)" });
      d.add({ name: "b", status: "Up 1 minute (unhealthy)" });
    });
    await has("docker.container.unhealthy", 2);
    expect(fawkes().conditions).toHaveLength(2);
    docker!.update("a", { status: "Up 1 minute (healthy)" });
    await has("docker.container.healthy");
    await vi.waitFor(() => expect(fawkes().conditions).toHaveLength(1), WAIT);
    expect(fawkes().explanation).toBe("Container b is unhealthy");
  });
});

describe("container lifecycle", () => {
  it("reports started, then a crash (non-zero exit of a running container) as ERROR", async () => {
    await ready();
    await settled();
    docker!.add({ name: "worker", image: "acme/worker:2" });
    await has("docker.container.started");
    expect(events("docker.container.started")[0]).toMatchObject({
      severity: "info",
      subject: "worker",
      payload: { container_id: expect.stringMatching(/^[0-9a-f]{12}$/), image: "acme/worker:2" },
    });
    expect(fawkes().state).toBe("IDLE");

    docker!.update("worker", { state: "exited", status: "Exited (1) 2 seconds ago", exitCode: 1 });
    await has("docker.container.died");
    await vi.waitFor(() => expect(fawkes().state).toBe("ERROR"), WAIT);
    expect(fawkes().explanation).toBe("Container worker exited with code 1");
    expect(events("docker.container.died")[0]).toMatchObject({
      severity: "error",
      payload: { exit_code: 1, oom_killed: false },
    });

    // It comes back (restart policy / user): the error clears.
    docker!.update("worker", { state: "running", status: "Up 2 seconds" });
    await has("docker.container.started", 2);
    await vi.waitFor(() => expect(fawkes().state).toBe("IDLE"), WAIT);
  });

  it("does not alarm for a clean exit or for `docker stop` (exit 143 / 137)", async () => {
    await ready((d) => {
      d.add({ name: "job" });
      d.add({ name: "svc" });
      d.add({ name: "killed" });
    });
    await settled();
    docker!.update("job", { state: "exited", status: "Exited (0) 1 second ago", exitCode: 0 });
    docker!.update("svc", { state: "exited", status: "Exited (143) 1 second ago", exitCode: 143 });
    docker!.update("killed", {
      state: "exited",
      status: "Exited (137) 1 second ago",
      exitCode: 137,
    });
    await has("docker.container.stopped", 3);
    await settled();
    expect(events("docker.container.died")).toEqual([]);
    expect(fawkes().state).toBe("IDLE");
  });

  it("an out-of-memory kill (137 + OOMKilled) is a crash, not a stop", async () => {
    await ready((d) => d.add({ name: "hog" }));
    await settled();
    docker!.update("hog", {
      state: "exited",
      status: "Exited (137) 1 second ago",
      exitCode: 137,
      oomKilled: true,
    });
    await has("docker.container.died");
    expect(events("docker.container.died")[0]!.payload).toMatchObject({
      exit_code: 137,
      oom_killed: true,
    });
    await vi.waitFor(() => expect(fawkes().state).toBe("ERROR"), WAIT);
  });

  it("a container that was already stopped (or failed) before Phoenix looked is not an error", async () => {
    await ready((d) =>
      d.add({
        name: "crashed-yesterday",
        state: "exited",
        status: "Exited (2) 1 day ago",
        exitCode: 2,
      }),
    );
    await settled();
    expect(h!.types("docker")).toEqual([]);
    expect(fawkes().state).toBe("IDLE");
  });

  it("a removed running container is reported as stopped and clears its warning", async () => {
    await ready((d) => d.add({ name: "tmp", status: "Up 1 minute (unhealthy)" }));
    await has("docker.container.unhealthy");
    docker!.remove("tmp");
    await has("docker.container.stopped");
    expect(events("docker.container.stopped")[0]!.payload).toMatchObject({ removed: true });
    await vi.waitFor(() => expect(fawkes().state).toBe("IDLE"), WAIT);
  });

  it("falls back to the Status text when inspect fails (container removed in between)", async () => {
    await ready((d) => d.add({ name: "gone" }));
    await settled();
    docker!.setOverride((req, res) => {
      const ok = (body: unknown) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.url?.includes("/containers/json")) {
        return ok([
          {
            Id: "01".repeat(32),
            Names: ["/gone"],
            Image: "nginx",
            State: "exited",
            Status: "Exited (3) 1 second ago",
          },
        ]);
      }
      res.writeHead(404);
      res.end("{}");
    });
    await has("docker.container.died");
    expect(events("docker.container.died")[0]!.payload).toMatchObject({ exit_code: 3 });
  });
});

describe("Docker daemon restarts", () => {
  it("degrades while the daemon is down, invents no events, and diffs against what it saw before", async () => {
    await ready((d) => d.add({ name: "web" }));
    await vi.waitFor(async () => expect((await health()).status).toBe("healthy"), WAIT);
    docker!.setDown(true);
    await vi.waitFor(async () => expect((await health()).status).toBe("degraded"), WAIT);
    expect(h!.types("docker")).toEqual([]);
    expect(fawkes().state).toBe("IDLE");

    docker!.update("web", { status: "Up 1 second (unhealthy)" });
    docker!.setDown(false);
    await has("docker.container.unhealthy");
    expect((await health()).status).toBe("healthy");
  });
});

describe("containers command", () => {
  it("lists names, images, state and health, and nothing else", async () => {
    await ready((d) => {
      d.add({ name: "web", status: "Up 1 minute (healthy)" });
      d.add({ name: "old", state: "exited", status: "Exited (0) 1 hour ago" });
    });
    const op = await h!.run("docker", "containers");
    expect(op.status).toBe("succeeded");
    const { containers } = op.result as ContainersResult;
    expect(op.result).toEqual({
      containers: [
        expect.objectContaining({
          name: "web",
          image: "nginx:1.27",
          state: "running",
          health: "healthy",
        }),
        expect.objectContaining({ name: "old", state: "exited", health: null, exit_code: 0 }),
      ],
    });
    expect(Object.keys(containers[0]!).sort()).toEqual(
      ["container_id", "exit_code", "health", "image", "name", "state"].sort(),
    );
  });
});

describe("secrets never leave Docker", () => {
  it("environment variables, labels, command lines and mounts appear nowhere Phoenix can see", async () => {
    await ready((d) => {
      d.add({
        name: "web",
        status: "Up 1 minute (unhealthy)",
        labels: { "com.docker.compose.project": "shop", "com.docker.compose.service": "web" },
      });
      d.add({ name: "worker" });
    });
    await has("docker.container.unhealthy");
    docker!.update("worker", { state: "exited", status: "Exited (1) 1 second ago", exitCode: 1 });
    await has("docker.container.died");
    docker!.update("web", { status: "Up 2 minutes (healthy)" });
    await has("docker.container.healthy");
    await settled();
    const op = await h!.run("docker", "containers");
    const view = h!.manager.get("docker");

    // the allow-listed labels do come through ...
    expect(events("docker.container.unhealthy")[0]!.payload).toMatchObject({
      compose_project: "shop",
      compose_service: "web",
    });
    // ... and nothing else the Engine told us does.
    const everything = JSON.stringify({
      events: h!.events,
      state: fawkes(),
      command: op,
      view,
      stored: h!.db.prepare("SELECT * FROM events").all(),
    });
    for (const secret of [
      SECRET_ENV,
      SECRET_TOKEN_ENV,
      "hunter2",
      "tok_live",
      SECRET_LABEL,
      SECRET_COMMAND,
      "s3cr3t-cmdline",
      SECRET_MOUNT,
      "DB_PASSWORD",
    ]) {
      expect(everything, secret).not.toContain(secret);
    }
    // sanity: the scan above covered real traffic
    expect(h!.types("docker").length).toBeGreaterThanOrEqual(3);
  });
});

describe("hostile Docker replies", () => {
  it("a reply that is not a container list degrades health without breaking Core", async () => {
    await ready((d) => d.add({ name: "web" }));
    await vi.waitFor(async () => expect((await health()).status).toBe("healthy"), WAIT);
    docker!.setOverride((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "surprise", Id: "x" }));
    });
    await vi.waitFor(async () => {
      expect(await health()).toMatchObject({
        status: "degraded",
        message: expect.stringMatching(/unexpected format/),
      });
    }, WAIT);
    expect(h!.types("docker")).toEqual([]);
  });

  it("garbage entries, hostile names and control characters are dropped or neutralised", async () => {
    await ready();
    await settled();
    docker!.setOverride((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify([
          null,
          42,
          { Id: 7 },
          { Id: "../../etc/passwd" },
          {
            Id: "ab".repeat(32),
            Names: [{ x: 1 }, "/evil\u001b[31m\nname" + "x".repeat(500)],
            Image: "user:hunter2@registry.example/app:1",
            State: "running",
            Status: "Up 1 second (unhealthy)",
          },
        ]),
      );
    });
    await has("docker.container.unhealthy");
    const e = events("docker.container.unhealthy")[0]!;
    expect(e.subject!.length).toBeLessThanOrEqual(100);
    expect(e.subject).not.toMatch(/[\u0000-\u001f]/);
    expect(JSON.stringify(e)).not.toContain("hunter2");
    expect(e.payload.image).toBe("registry.example/app:1");
  });
});

describe("socket discovery through the capability", () => {
  it("follows DOCKER_HOST=unix://… when socket_path is not set", async () => {
    docker = await startMockDocker();
    docker.add({ name: "web" });
    const home = mkdtempSync(join(tmpdir(), "pd-home-"));
    cleanups.push(() => rmSync(home, { recursive: true, force: true }));
    h = createHarness({
      modules: [
        createDockerCapability({ env: { DOCKER_HOST: `unix://${docker.socketPath}` }, home }),
      ],
    });
    h.manager.configure("docker", { poll_ms: 250 });
    await h.enable("docker");
    await vi.waitFor(async () => {
      expect(await health()).toMatchObject({ status: "healthy", message: /1 containers/ });
    }, WAIT);
  });

  it("never connects to a tcp:// DOCKER_HOST, and says why when nothing else is found", async () => {
    let connections = 0;
    const lure: Server = createServer((socket) => {
      connections++;
      socket.destroy();
    });
    await new Promise<void>((resolve) => lure.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => new Promise<void>((resolve) => lure.close(() => resolve())));
    const { port } = lure.address() as AddressInfo;
    const home = mkdtempSync(join(tmpdir(), "pd-home-"));
    cleanups.push(() => rmSync(home, { recursive: true, force: true }));
    h = createHarness({
      modules: [createDockerCapability({ env: { DOCKER_HOST: `tcp://127.0.0.1:${port}` }, home })],
    });
    h.manager.configure("docker", { poll_ms: 250 });
    await h.enable("docker");
    await vi.waitFor(async () => {
      expect((await health()).message).not.toBe("Connecting to Docker…");
    }, WAIT);
    await settled0();
    expect(connections).toBe(0);
    const message = (await health()).message ?? "";
    // /var/run/docker.sock may exist on a developer machine; if not, the reason is shown.
    if (!message.startsWith("Connected")) {
      expect(message).toMatch(/Docker is not running/);
      expect(message).toMatch(
        /DOCKER_HOST uses tcp:\/\/.*never sends Docker API traffic over the network/,
      );
    }
  });
});

/** One more health round-trip so a tcp connection attempt (if any) would have happened. */
async function settled0() {
  await h!.manager.checkHealth("docker");
  await h!.drain();
}
