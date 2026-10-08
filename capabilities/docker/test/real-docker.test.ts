// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Runs against a REAL Docker Engine. Skipped unless PHOENIX_REAL_DOCKER is set:
//
//   PHOENIX_REAL_DOCKER=1 npx vitest run capabilities/docker/test/real-docker.test.ts
//
// It discovers the socket exactly as the capability does ($DOCKER_HOST unix://, /var/run,
// Docker Desktop, Colima, OrbStack), then only lists containers (GET /containers/json). It
// creates, starts and stops nothing, and it prints only counts, never names, images or ids.
// Start a daemon first, e.g. `colima start`. (Not run when this file was written: no Docker
// daemon was available on the development machine.)
import { homedir } from "node:os";
import { createHarness } from "@phoenix/sdk-testing";
import { describe, expect, it } from "vitest";
import {
  createDockerCapability,
  dockerJson,
  findSocket,
  parseContainerList,
  socketCandidates,
} from "../src";

describe.skipIf(!process.env.PHOENIX_REAL_DOCKER)("real Docker Engine (read-only)", () => {
  const found = findSocket(socketCandidates(undefined, process.env, homedir()));

  it("finds a socket and parses the real /containers/json", async () => {
    expect(found.path, `no Docker socket among: ${found.tried.join(", ")}`).toBeDefined();
    const raw = await dockerJson(found.path!, "/containers/json?all=true");
    const containers = parseContainerList(raw);
    console.log(`real docker: ${containers.length} containers`);
    expect(Array.isArray(raw)).toBe(true);
    expect(containers.length).toBe((raw as unknown[]).length);
  });

  it("the capability enables, reports healthy, and lists containers through the command", async () => {
    const h = createHarness({ modules: [createDockerCapability()] });
    try {
      await h.enable("docker");
      const op = await h.run("docker", "containers");
      expect(op.status).toBe("succeeded");
      const health = (await h.manager.checkHealth("docker")).health;
      expect(health.status).toBe("healthy");
      // nothing the Engine holds beyond names, images and states may be in events
      expect(JSON.stringify(h.events)).not.toMatch(/"(Env|Mounts|Cmd|Labels)"/);
    } finally {
      await h.close();
    }
  });
});
