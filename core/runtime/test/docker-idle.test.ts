// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 74 `DockerIdle`, fed by the real Docker capability inside a real Core. The Docker Engine is
// a mock on a unix socket (capabilities/docker/testing/mock-docker.ts); no Docker ran.
import { afterEach, describe, expect, it } from "vitest";
import { startMockDocker, type MockDocker } from "../../../capabilities/docker/testing/mock-docker";
import { builtinCapabilities } from "../src/builtins";
import { classifyContainers, dockerIdleFrom, DOCKER_LIST_LIMIT } from "../src/docker-idle";
import { startCore, type TestCore } from "./helpers";

const rows = (...states: unknown[]) => ({ containers: states.map((state) => ({ state })) });

describe("classifyContainers", () => {
  it("is idle only when every container is known to be stopped (or there are none)", () => {
    expect(classifyContainers(rows())).toBe("idle");
    expect(classifyContainers(rows("exited", "created", "dead"))).toBe("idle");
  });

  it.each(["running", "paused", "restarting"])("is busy when a container is %s", (state) => {
    expect(classifyContainers(rows("exited", state))).toBe("busy");
  });

  it("busy wins over an unknown state elsewhere in the list", () => {
    expect(classifyContainers(rows("weird", "running"))).toBe("busy");
  });

  it.each([
    ["an unknown state", rows("exited", "removing")],
    ["a missing state", { containers: [{}] }],
    ["a non-string state", rows(7)],
    ["a non-object row", { containers: [null] }],
    ["no containers field", {}],
    ["a non-object result", "nope"],
    ["null", null],
  ])("is unknown for %s", (_name, result) => {
    expect(classifyContainers(result)).toBe("unknown");
  });

  it("is unknown when the list may have been cut at the command's row limit", () => {
    const full = {
      containers: Array.from({ length: DOCKER_LIST_LIMIT }, () => ({ state: "exited" })),
    };
    expect(classifyContainers(full)).toBe("unknown");
    const under = {
      containers: Array.from({ length: DOCKER_LIST_LIMIT - 1 }, () => ({ state: "exited" })),
    };
    expect(classifyContainers(under)).toBe("idle");
  });
});

describe("dockerIdleFrom with a fake manager", () => {
  it("is unknown when the call throws, fails or never finishes", async () => {
    const throwing = dockerIdleFrom({
      invokeAndWait: () => Promise.reject(new Error("boom")),
    });
    expect(await throwing()).toBe("unknown");
    const failed = dockerIdleFrom({
      invokeAndWait: () => Promise.resolve({ status: "failed" } as never),
    });
    expect(await failed()).toBe("unknown");
    // The abort signal passed down is what bounds the wait.
    let signal: AbortSignal | undefined;
    const slow = dockerIdleFrom(
      {
        invokeAndWait: (_id, _command, _input, _actor, s) => {
          signal = s;
          return new Promise((_, reject) =>
            s?.addEventListener("abort", () => reject(new Error("x"))),
          );
        },
      },
      20,
    );
    expect(await slow()).toBe("unknown");
    expect(signal?.aborted).toBe(true);
  });

  it("asks the read-only containers command of the docker capability as `awake`", async () => {
    const calls: unknown[][] = [];
    const idle = dockerIdleFrom({
      invokeAndWait: (...args) => {
        calls.push(args.slice(0, 4));
        return Promise.resolve({ status: "succeeded", result: rows("exited") } as never);
      },
    });
    expect(await idle()).toBe("idle");
    expect(calls).toEqual([["docker", "containers", {}, "awake"]]);
  });
});

describe("dockerIdle through a real Core and the real Docker capability", () => {
  let docker: MockDocker | undefined;
  let core: TestCore | undefined;
  afterEach(async () => {
    await core?.runtime.stop();
    await docker?.close();
    core = docker = undefined;
  });

  async function boot() {
    docker = await startMockDocker();
    const holder: { core?: TestCore } = {};
    core = await startCore(
      {},
      {
        capabilities: builtinCapabilities("dev", undefined, undefined, {
          dockerIdle: dockerIdleFrom({
            invokeAndWait: (...args) => holder.core!.runtime.capabilities.invokeAndWait(...args),
          }),
        }),
      },
    );
    holder.core = core;
    const cfg = await core.api("POST", "/api/capabilities/docker/config", {
      config: { socket_path: docker.socketPath, poll_ms: 250 },
    });
    expect(cfg.status).toBe(200);
    const idle = dockerIdleFrom({
      invokeAndWait: (...args) => core!.runtime.capabilities.invokeAndWait(...args),
    });
    return { docker, core, idle };
  }

  it("is unknown while the Docker capability is not enabled (never a frozen Docker by default)", async () => {
    const { idle } = await boot();
    expect(await idle()).toBe("unknown");
  });

  it("is idle with only stopped containers, busy with a running one, and unknown with Docker down", async () => {
    const { docker, core, idle } = await boot();
    docker.add({ name: "old", state: "exited", status: "Exited (0) 1 hour ago" });
    expect((await core.api("POST", "/api/capabilities/docker/enable", {})).status).toBe(200);
    expect(await idle()).toBe("idle");

    docker.add({ name: "web", state: "running", status: "Up 5 minutes" });
    expect(await idle()).toBe("busy");

    docker.remove("web");
    expect(await idle()).toBe("idle");

    docker.setDown(true);
    expect(await idle()).toBe("unknown");
  });

  it("never raises a confirmation: reading containers is a read", async () => {
    const { docker, core, idle } = await boot();
    docker.add({ name: "old", state: "exited" });
    await core.api("POST", "/api/capabilities/docker/enable", {});
    await idle();
    const pending = (await core.api("GET", "/api/confirmations")).json.confirmations;
    expect(pending).toEqual([]);
    // Only reads reached the Engine.
    expect(docker.requests.every((r) => r.method === "GET")).toBe(true);
  });

  it("is unknown after the kill switch", async () => {
    const { docker, core, idle } = await boot();
    docker.add({ name: "old", state: "exited" });
    await core.api("POST", "/api/capabilities/docker/enable", {});
    expect(await idle()).toBe("idle");
    await core.api("POST", "/api/security/kill-switch", { engaged: true });
    expect(await idle()).toBe("unknown");
  });
});
