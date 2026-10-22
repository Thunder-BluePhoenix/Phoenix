// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The ONLY test that reads the real machine: the real collector, read-only (lsof / ss / netstat),
// against a loopback server this test opens itself. Skipped unless PHOENIX_REAL_PORTS=1. It never
// stops or signals anything: `realEnv().kill` is replaced by a function that throws.
import { createServer, type AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS } from "../src/policy";
import { realEnv } from "../src/real";
import { buildSnapshot } from "../src/snapshot";

const enabled = process.env.PHOENIX_REAL_PORTS === "1";

describe.skipIf(!enabled)("real collector (PHOENIX_REAL_PORTS=1, read-only)", () => {
  it("lists a loopback server opened by this test with the right port and this process's pid", async () => {
    const server = createServer();
    const listening = Promise.withResolvers<void>();
    server.listen(0, "127.0.0.1", () => listening.resolve());
    await listening.promise;
    try {
      const port = (server.address() as AddressInfo).port;
      const env = {
        ...realEnv(),
        kill: () => {
          throw new Error("the real-collector test must never signal a process");
        },
      };
      const snapshot = await buildSnapshot(env, DEFAULT_THRESHOLDS);
      const mine = snapshot.ports.find((p) => p.port === port);
      console.log(
        "real collector:",
        snapshot.platform,
        snapshot.collector,
        `${snapshot.ports.length} listening ports; mine:`,
        JSON.stringify(mine === undefined ? null : { ...mine, command: "<omitted>" }),
      );
      expect(mine).toBeDefined();
      expect(mine?.pid).toBe(process.pid);
      expect(mine?.exposure).toBe("loopback");
      expect(mine?.url).toBe(`http://127.0.0.1:${port}/`);
      // Core's own listener must never be offered for stopping.
      expect(mine?.stoppable).toBe(false);
      expect(mine?.refusal).toBe("self");
      expect(mine?.is_core).toBe(true);
    } finally {
      server.close();
    }
  });
});
