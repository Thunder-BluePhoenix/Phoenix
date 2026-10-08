// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaults } from "@phoenix/config";
import { silentLogger } from "@phoenix/logging";
import { MIGRATIONS } from "@phoenix/persistence";
import { createEvent, PROTOCOL_VERSION } from "@phoenix/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { PhoenixRuntime, SESSION_TOKEN_FILE } from "../src";
import { startCore, TOKEN } from "./helpers";

let runtime: PhoenixRuntime | undefined;
afterEach(async () => {
  await runtime?.stop();
  runtime = undefined;
});

describe("PhoenixRuntime", () => {
  it("serves /api/health without authentication", async () => {
    const core = await startCore();
    runtime = core.runtime;
    const res = await fetch(`${core.base}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "ok",
      protocol: PROTOCOL_VERSION,
      schema_version: MIGRATIONS.at(-1)!.version,
      pet: { state: "IDLE", recording: false },
      kill_switch: false,
    });
  });

  it("routes events through the bus into the state engine and history", async () => {
    const core = await startCore();
    runtime = core.runtime;
    const rt = core.runtime;
    const changes: string[] = [];
    rt.bus.subscribe(
      "test",
      "pet.state.changed",
      (e) => void changes.push(String(e.payload.state)),
    );

    rt.bus.publish(
      createEvent({ event_type: "build.started", source: "terminal", severity: "info" }),
    );
    await rt.bus.drain();
    rt.bus.publish(
      createEvent({ event_type: "build.failed", source: "terminal", severity: "error" }),
    );
    await rt.bus.drain();

    expect(rt.state.snapshot().state).toBe("ERROR");
    expect(changes).toEqual(["WORKING", "ERROR"]);
    // pet.state.changed is ephemeral and not stored.
    expect(rt.events.recent().map((r) => r.event.event_type)).toEqual([
      "build.failed",
      "build.started",
      "system.online",
    ]);
  });

  it("writes a private session token file and removes it on stop", async () => {
    const core = await startCore({}, { writeTokenFile: true });
    const path = join(core.dataDir, SESSION_TOKEN_FILE);
    expect(readFileSync(path, "utf8").trim()).toBe(TOKEN);
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
    await core.runtime.stop();
    expect(existsSync(path)).toBe(false);
  });

  it("stop is graceful and idempotent", async () => {
    const core = await startCore();
    await Promise.all([core.runtime.stop(), core.runtime.stop()]);
  });

  it("refuses to start a second Core on the same data directory, and does not touch the first", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "phoenix-two-"));
    const options = {
      config: { ...defaults("dev"), port: 0, dataDir },
      logger: silentLogger,
      token: TOKEN,
      capabilities: [],
    };
    const first = new PhoenixRuntime(options);
    runtime = first;
    const { port } = await first.start();
    const tokenFile = join(dataDir, SESSION_TOKEN_FILE);
    const before = readFileSync(tokenFile, "utf8");

    expect(() => new PhoenixRuntime({ ...options, token: "another-token-0123456789" })).toThrow(
      /Another Phoenix Core is already using/,
    );
    // The refused Core must not replace the running one's session token.
    expect(readFileSync(tokenFile, "utf8")).toBe(before);
    const res = await fetch(`http://127.0.0.1:${port}/api/pet/state`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);

    // Once the first Core stops, the folder is free for the next one.
    await first.stop();
    const next = new PhoenixRuntime(options);
    await next.start();
    await next.stop();
  });
});
