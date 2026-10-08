// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  byId,
  diffContainers,
  dockerGet,
  exitEvent,
  findSocket,
  MAX_CONTAINERS,
  MAX_EVENTS_PER_POLL,
  parseContainerList,
  parseExitDetails,
  socketCandidates,
  type ContainerSnapshot,
} from "../src";

function snap(over: Partial<ContainerSnapshot> = {}): ContainerSnapshot {
  return {
    id: "aaaaaaaaaaaa",
    fullId: "a".repeat(64),
    name: "web",
    image: "nginx",
    state: "running",
    health: null,
    exitCode: null,
    ...over,
  };
}

describe("parseContainerList", () => {
  it("reads the Engine's /containers/json shape", () => {
    const [c] = parseContainerList([
      {
        Id: "0123456789abcdef".repeat(4),
        Names: ["/shop-db-1"],
        Image: "postgres:16",
        State: "running",
        Status: "Up 4 minutes (unhealthy)",
        Labels: {
          "com.docker.compose.project": "shop",
          "com.docker.compose.service": "db",
          other: "ignored",
        },
      },
    ]);
    expect(c).toEqual({
      id: "0123456789ab",
      fullId: "0123456789abcdef".repeat(4),
      name: "shop-db-1",
      image: "postgres:16",
      state: "running",
      health: "unhealthy",
      exitCode: null,
      composeProject: "shop",
      composeService: "db",
    });
  });

  it.each([
    ["Up 2 hours (healthy)", "healthy", null],
    ["Up 2 hours (unhealthy)", "unhealthy", null],
    ["Up 3 seconds (health: starting)", "starting", null],
    ["Up 2 hours", null, null],
    ["Exited (137) 5 minutes ago", null, 137],
    ["Exited (0) About an hour ago", null, 0],
    ["Restarting (1) 4 seconds ago", null, 1],
  ])("Status %j → health %s, exit %s", (status, health, exitCode) => {
    const [c] = parseContainerList([{ Id: "ab".repeat(32), Status: status, State: "running" }]);
    expect(c).toMatchObject({ health, exitCode });
  });

  it("rejects a non-list and skips malformed entries instead of throwing", () => {
    expect(() => parseContainerList({ message: "oops" })).toThrow(/unexpected format/);
    expect(
      parseContainerList([null, "x", [], { Id: 1 }, { Id: "zz" }, { Id: "AB".repeat(32) }]),
    ).toEqual([]);
  });

  it("falls back to the short id when there is no usable name, and bounds the list", () => {
    const [c] = parseContainerList([{ Id: "ab".repeat(32), Names: [] }]);
    expect(c!.name).toBe("abababababab");
    const many = Array.from({ length: MAX_CONTAINERS + 50 }, (_, i) => ({
      Id: i.toString(16).padStart(12, "0"),
    }));
    expect(parseContainerList(many)).toHaveLength(MAX_CONTAINERS);
  });
});

describe("parseExitDetails", () => {
  it("reads State.ExitCode and OOMKilled only", () => {
    expect(parseExitDetails({ State: { ExitCode: 137, OOMKilled: true, Error: "x" } })).toEqual({
      exitCode: 137,
      oomKilled: true,
    });
    expect(parseExitDetails({ State: { ExitCode: 0 } })).toEqual({ exitCode: 0, oomKilled: false });
  });
  it.each([
    [null],
    [{}],
    [{ State: null }],
    [{ State: { ExitCode: "1" } }],
    [{ State: { ExitCode: 1.5 } }],
  ])("returns null for %j", (raw) => expect(parseExitDetails(raw)).toBeNull());
});

describe("exitEvent", () => {
  it.each([
    [0, "docker.container.stopped"],
    [143, "docker.container.stopped"],
    [137, "docker.container.stopped"],
    [1, "docker.container.died"],
    [125, "docker.container.died"],
    [255, "docker.container.died"],
  ])("exit code %i → %s", (code, type) => {
    expect(exitEvent(snap(), { exitCode: code, oomKilled: false }).event_type).toBe(type);
  });
  it("OOM kill is a crash even with a signal exit; unknown exit code is never an alarm", () => {
    expect(exitEvent(snap(), { exitCode: 137, oomKilled: true }).event_type).toBe(
      "docker.container.died",
    );
    expect(exitEvent(snap(), undefined).event_type).toBe("docker.container.stopped");
  });
  it("uses the Status text's code when inspect gave none", () => {
    expect(exitEvent(snap({ exitCode: 2 }), undefined).event_type).toBe("docker.container.died");
  });
});

describe("diffContainers", () => {
  const diff = (prev: ContainerSnapshot[] | undefined, next: ContainerSnapshot[]) =>
    diffContainers(prev && byId(prev), byId(next), {}).map((e) => e.event_type);

  it("uses one stable correlation id per container so its conditions replace each other", () => {
    const [e] = diffContainers(byId([snap()]), byId([snap({ health: "unhealthy" })]), {});
    expect(e).toMatchObject({ correlation_id: "docker-aaaaaaaaaaaa", subject: "web" });
  });
  it("first look reports only running+unhealthy containers", () => {
    expect(
      diff(undefined, [
        snap({ id: "111111111111", health: "unhealthy" }),
        snap({ id: "222222222222", state: "exited", health: "unhealthy" }),
        snap({ id: "333333333333" }),
      ]),
    ).toEqual(["docker.container.unhealthy"]);
  });
  it("detects start, pause is not a stop, restart loop is a crash", () => {
    expect(diff([], [snap()])).toEqual(["docker.container.started"]);
    expect(diff([snap()], [snap({ state: "paused" })])).toEqual([]);
    expect(diff([snap({ state: "paused" })], [snap()])).toEqual([]);
    expect(diff([snap()], [snap({ state: "restarting", exitCode: 1 })])).toEqual([
      "docker.container.died",
    ]);
    expect(diff([snap({ state: "restarting" })], [snap({ state: "restarting" })])).toEqual([]);
  });
  it("a created-but-never-started container is not 'started'", () => {
    expect(diff([], [snap({ state: "created" })])).toEqual([]);
  });
  it("removal of a stopped container is 'removed', of a running one 'stopped'", () => {
    expect(diff([snap({ state: "exited" })], [])).toEqual(["docker.container.removed"]);
    expect(diff([snap()], [])).toEqual(["docker.container.stopped"]);
  });
  it("an unhealthy container that dies reports the death; healthy/unhealthy flaps are single events", () => {
    expect(diff([snap({ health: "unhealthy" })], [snap({ state: "exited", exitCode: 1 })])).toEqual(
      ["docker.container.died"],
    );
    expect(diff([snap({ health: "healthy" })], [snap({ health: "unhealthy" })])).toEqual([
      "docker.container.unhealthy",
    ]);
    expect(diff([snap({ health: "unhealthy" })], [snap({ health: "unhealthy" })])).toEqual([]);
    expect(diff([snap({ health: "unhealthy" })], [snap({ health: "healthy" })])).toEqual([
      "docker.container.healthy",
    ]);
  });
  it("a mass restart cannot flood the bus", () => {
    const next = Array.from({ length: 300 }, (_, i) =>
      snap({ id: i.toString(16).padStart(12, "0") }),
    );
    expect(diff([], next)).toHaveLength(MAX_EVENTS_PER_POLL);
  });
});

describe("socket discovery", () => {
  const home = "/home/u";
  it("orders: setting, DOCKER_HOST, then the well-known locations", () => {
    expect(socketCandidates("/x.sock", { DOCKER_HOST: "unix:///y.sock" }, home).paths).toEqual([
      "/x.sock",
    ]);
    expect(socketCandidates(undefined, { DOCKER_HOST: "unix:///y.sock" }, home).paths).toEqual([
      "/y.sock",
      "/var/run/docker.sock",
      "/home/u/.docker/run/docker.sock",
      "/home/u/.colima/default/docker.sock",
      "/home/u/.orbstack/run/docker.sock",
    ]);
  });
  it.each([
    "tcp://10.0.0.5:2375",
    "ssh://me@box",
    "https://docker.example",
    "npipe:////./pipe/docker_engine",
  ])("refuses DOCKER_HOST=%s and explains why", (host) => {
    const c = socketCandidates(undefined, { DOCKER_HOST: host }, home);
    expect(c.paths.every((p) => p.startsWith("/"))).toBe(true);
    expect(c.paths).not.toContain(host);
    expect(c.notes.join(" ")).toMatch(/never sends Docker API traffic over the network/);
  });
  it("ignores a relative unix:// path", () => {
    const c = socketCandidates(undefined, { DOCKER_HOST: "unix://rel.sock" }, home);
    expect(c.paths).not.toContain("rel.sock");
    expect(c.notes).toHaveLength(1);
  });
  it("findSocket picks the first candidate that exists", () => {
    const c = socketCandidates(undefined, {}, home);
    const found = findSocket(c, (p) => p.includes("colima") || p.includes("orbstack"));
    expect(found.path).toBe("/home/u/.colima/default/docker.sock");
    expect(findSocket(c, () => false).path).toBeUndefined();
  });
});

describe("dockerGet limits", () => {
  let dir: string | undefined;
  let server: Server | undefined;
  afterEach(async () => {
    if (server) {
      const s = server;
      await new Promise<void>((r) => {
        s.close(() => r());
        s.closeAllConnections();
      });
    }
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = server = undefined;
  });
  async function serve(handler: Parameters<typeof createServer>[1]) {
    dir = mkdtempSync(join(tmpdir(), "pd-"));
    const path = join(dir, "d.sock");
    server = createServer(handler);
    await new Promise<void>((r) => server!.listen(path, r));
    return path;
  }

  it("cuts off a body past the cap (declared and undeclared)", async () => {
    const declared = await serve((_q, res) => {
      res.writeHead(200, { "content-length": String(10_000) });
      res.end("x".repeat(10_000));
    });
    await expect(dockerGet(declared, "/_ping", { maxBytes: 100 })).rejects.toMatchObject({
      kind: "too_large",
    });
    await server!.close();
    server = undefined;
    const chunked = await serve((_q, res) => {
      res.writeHead(200);
      res.write("x".repeat(60));
      res.write("x".repeat(60));
      res.end();
    });
    await expect(dockerGet(chunked, "/_ping", { maxBytes: 100 })).rejects.toMatchObject({
      kind: "too_large",
    });
  });

  it("times out on a daemon that accepts and never answers", async () => {
    const path = await serve(() => {});
    await expect(dockerGet(path, "/_ping", { timeoutMs: 100 })).rejects.toMatchObject({
      kind: "timeout",
    });
  });

  it("reports non-200 and a missing socket", async () => {
    const path = await serve((_q, res) => {
      res.writeHead(500);
      res.end("boom");
    });
    await expect(dockerGet(path, "/_ping")).rejects.toMatchObject({ kind: "http" });
    await expect(dockerGet(join(dir!, "missing.sock"), "/_ping")).rejects.toMatchObject({
      kind: "not_running",
      message: expect.stringMatching(/Docker is not running/),
    });
  });

  it("can be cancelled", async () => {
    const path = await serve(() => {});
    const ctl = new AbortController();
    const p = dockerGet(path, "/_ping", { signal: ctl.signal });
    ctl.abort();
    await expect(p).rejects.toMatchObject({ kind: "aborted" });
  });
});
