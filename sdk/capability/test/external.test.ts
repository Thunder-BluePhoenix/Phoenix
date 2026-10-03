// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaults } from "@phoenix/config";
import { silentLogger } from "@phoenix/logging";
import { PhoenixRuntime } from "@phoenix/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { defineCapability, events, runExternalCapability, type ExternalCapability } from "../src";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});

const manifest = {
  id: "hello",
  name: "Hello",
  version: "0.1.0",
  description: "SDK sample",
  license: "GPL-3.0-or-later",
  events: ["build.*"],
  permissions: [],
  commands: [{ name: "greet", description: "Say hello", side_effect: "none" as const }],
};

async function startCore(dataDir: string, port = 0) {
  const runtime = new PhoenixRuntime({
    config: { ...defaults("dev"), port, dataDir },
    logger: silentLogger,
    writeTokenFile: false,
  });
  const { port: actual } = await runtime.start();
  return { runtime, url: `http://127.0.0.1:${actual}`, port: actual };
}

async function waitFor(check: () => boolean | Promise<boolean>, ms = 2000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("defineCapability", () => {
  it("rejects invalid manifests and missing handlers early", () => {
    expect(() =>
      defineCapability({ manifest: { ...manifest, id: "core" }, commands: { greet: () => 1 } }),
    ).toThrow(/reserved/);
    expect(() => defineCapability({ manifest, commands: {} })).toThrow(/no handler for: greet/);
  });
});

describe("runExternalCapability (US-08)", () => {
  it("registers, gets enabled, emits events and handles commands against a real core", async () => {
    const core = await startCore(mkdtempSync(join(tmpdir(), "phoenix-sdk-")));
    cleanup.push(() => core.runtime.stop());
    const enabled: string[] = [];
    const cap: ExternalCapability = await runExternalCapability({
      manifest,
      coreUrl: core.url,
      sessionToken: core.runtime.token,
      commands: { greet: (input) => `Hello, ${(input as { name: string }).name}!` },
      onEnable: (ctx) => void enabled.push(ctx.id),
    });
    cleanup.push(() => cap.close());

    expect(core.runtime.capabilities.get("hello")).toMatchObject({
      kind: "external",
      status: "installed",
    });
    expect((await cap.emit(events.build.started())).ok).toBe(false); // not enabled yet

    await core.runtime.capabilities.enable("hello");
    expect(enabled).toEqual(["hello"]);
    expect(cap.enabled).toBe(true);

    expect(await cap.emit(events.build.started("make"))).toMatchObject({ ok: true });
    await core.runtime.bus.drain();
    expect(core.runtime.state.snapshot().state).toBe("WORKING");

    const undeclared = await cap.emit({
      event_type: "deploy.started",
      severity: "info",
      payload: {},
    });
    expect(undeclared).toMatchObject({ ok: false, code: "SECURITY_POLICY_BLOCKED" });

    const op = await core.runtime.capabilities.invokeAndWait("hello", "greet", { name: "Fawkes" });
    expect(op).toMatchObject({ status: "succeeded", result: "Hello, Fawkes!" });
  });

  it("rejects calls that do not carry its capability token", async () => {
    const core = await startCore(mkdtempSync(join(tmpdir(), "phoenix-sdk-")));
    cleanup.push(() => core.runtime.stop());
    const cap = await runExternalCapability({
      manifest,
      coreUrl: core.url,
      sessionToken: core.runtime.token,
      commands: { greet: () => "hi" },
    });
    cleanup.push(() => cap.close());
    const res = await fetch(`${cap.endpoint}/commands/greet`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });

  it("re-registers transparently after Phoenix Core restarts", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "phoenix-sdk-"));
    let core = await startCore(dataDir);
    const port = core.port;
    const cap = await runExternalCapability({
      manifest,
      coreUrl: core.url,
      sessionToken: () => core.runtime.token,
      commands: { greet: () => "hi" },
    });
    cleanup.push(() => cap.close());
    await core.runtime.capabilities.enable("hello");

    await core.runtime.stop();
    core = await startCore(dataDir, port); // new process: new session + capability tokens
    cleanup.push(() => core.runtime.stop());
    expect(core.runtime.capabilities.get("hello").status).toBe("disconnected");

    expect(await cap.emit(events.build.started())).toMatchObject({ ok: true });
    expect(core.runtime.capabilities.get("hello").status).toBe("enabled");
    await waitFor(async () => {
      await core.runtime.bus.drain();
      return core.runtime.state.snapshot().state === "WORKING";
    });
  });
});
