// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The Docker API can start, stop and delete containers, so "read-only" has to be a property of
// the code, not of good behaviour. These tests pin it three ways: what actually goes over the
// socket, what the single request function accepts, and what the source is allowed to contain.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHarness, type Harness } from "@phoenix/sdk-testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDockerCapability, dockerGet, DockerError } from "../src";
import { startMockDocker, type MockDocker } from "../testing/mock-docker";

let h: Harness | undefined;
let docker: MockDocker | undefined;
afterEach(async () => {
  await h?.close();
  await docker?.close();
  h = docker = undefined;
});

const SRC = join(import.meta.dirname, "../src");

describe("Phoenix never sends a mutating request to Docker", () => {
  it("a full life of the capability (poll, crash, inspect, command) sends only allow-listed GETs", async () => {
    docker = await startMockDocker();
    docker.add({ name: "web" });
    h = createHarness({ modules: [createDockerCapability()] });
    h.manager.configure("docker", { socket_path: docker.socketPath, poll_ms: 250 });
    await h.enable("docker");
    await vi.waitFor(() => expect(docker!.requests.length).toBeGreaterThan(1), { timeout: 5_000 });
    docker.update("web", { state: "exited", status: "Exited (1) 1 second ago", exitCode: 1 });
    await vi.waitFor(() => expect(h!.types("docker")).toContain("docker.container.died"), {
      timeout: 5_000,
    });
    await h.run("docker", "containers");

    expect(docker.requests.length).toBeGreaterThan(2);
    for (const r of docker.requests) {
      expect(r.method).toBe("GET");
      expect(r.url).toMatch(
        /^\/containers\/json\?all=true$|^\/containers\/[0-9a-f]{64}\/json$|^\/_ping$/,
      );
    }
    // the exit-code lookup happened, and as a GET
    expect(docker.requests.some((r) => /^\/containers\/[0-9a-f]{64}\/json$/.test(r.url))).toBe(
      true,
    );
  });

  it("the request function refuses everything that is not an allow-listed read, before connecting", async () => {
    docker = await startMockDocker();
    const sock = docker.socketPath;
    for (const path of [
      "/containers/abcdef012345/start",
      "/containers/abcdef012345/stop",
      "/containers/abcdef012345/kill",
      "/containers/abcdef012345",
      "/containers/abcdef012345/json/../start",
      "/containers/create",
      "/containers/prune",
      "/images/prune",
      "/images/nginx",
      "/build",
      "/exec/abc/start",
      "/containers/abcdef012345/json?x=1",
      "/events",
      "http://evil/containers/json?all=true",
      "",
    ]) {
      await expect(dockerGet(sock, path), path).rejects.toMatchObject({ kind: "refused" });
    }
    expect(docker.requests).toEqual([]);
    await expect(dockerGet(sock, "/_ping")).resolves.toBe("OK");
    expect(docker.requests).toEqual([{ method: "GET", url: "/_ping" }]);
  });

  it("dockerGet has no parameter that could change the method", () => {
    expect(dockerGet.length).toBe(2); // (socketPath, path, options?) - options carry no method
    expect(new DockerError("refused", "x")).toBeInstanceOf(Error);
  });
});

describe("source audit: a mutating method cannot be introduced unnoticed", () => {
  const files = readdirSync(SRC)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => ({ name: f, code: readFileSync(join(SRC, f), "utf8") }));
  /** Comments may talk about POST; code may not use it. */
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("the only place that opens a connection is engine.ts, with the literal GET method", () => {
    const users = files.filter(
      (f) =>
        /\b(request|get|fetch|connect|createConnection)\s*\(/.test(code(f.code)) &&
        /node:(http|https|net)|\bfetch\(/.test(code(f.code)),
    );
    expect(users.map((f) => f.name)).toEqual(["engine.ts"]);
    const engine = code(files.find((f) => f.name === "engine.ts")!.code);
    expect([...engine.matchAll(/method:\s*([^,}\s]+)/g)].map((m) => m[1])).toEqual(['"GET"']);
    expect(engine.match(/\brequest\(/g)).toHaveLength(1);
  });

  it("no source file mentions a mutating HTTP method or a mutating Docker endpoint in code", () => {
    for (const f of files) {
      expect(code(f.code), f.name).not.toMatch(
        /["'`](POST|PUT|DELETE|PATCH)["'`]|\/(start|stop|kill|restart|pause|unpause|prune|create|exec|build|rename|update)\b|\.write\(|\.end\([^)]/,
      );
    }
  });

  it("the capability declares no write-ish permission and no command with a side effect", () => {
    const { manifest } = createDockerCapability();
    expect(manifest.permissions).toEqual(["container_access"]);
    for (const c of manifest.commands) expect(["none", "read"]).toContain(c.side_effect);
  });
});
