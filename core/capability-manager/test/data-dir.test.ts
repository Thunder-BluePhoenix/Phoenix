// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// ctx.dataDir: the private directory Core owns for each built-in capability.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventBus } from "@phoenix/event-bus";
import { PermissionGateway } from "@phoenix/permissions";
import { EventStore, openDatabase } from "@phoenix/persistence";
import type { CapabilityManifest } from "@phoenix/protocol";
import { StateEngine } from "@phoenix/state-engine";
import { afterEach, describe, expect, it } from "vitest";
import {
  CapabilityManager,
  capabilityDataPath,
  ensureCapabilityDataDir,
  type CapabilityContext,
  type CapabilityManagerOptions,
} from "../src";

const managers: CapabilityManager[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const m of managers.splice(0)) await m.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const tempDir = (): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "zz-capdir-")));
  dirs.push(d);
  return d;
};

function setup(options: Partial<CapabilityManagerOptions> = {}) {
  const db = openDatabase(":memory:");
  const events = new EventStore(db);
  const bus = new EventBus({ store: events, retryDelayMs: 0 });
  const state = new StateEngine();
  const permissions = new PermissionGateway({ db, publish: (e) => void bus.publish(e) });
  const manager = new CapabilityManager({
    db,
    bus,
    events,
    permissions,
    state,
    callTimeoutMs: 300,
    defaultHealthIntervalMs: 60_000,
    ...options,
  });
  managers.push(manager);
  return manager;
}

const manifest = (id: string): CapabilityManifest => ({
  id,
  name: id,
  version: "1.0.0",
  description: "Test capability",
  license: "GPL-3.0-or-later",
  events: [],
  permissions: [],
  commands: [
    { name: "where", description: "Reports its directory", side_effect: "none", permissions: [] },
  ],
});

/** A built-in that keeps the context it was started with and the one a command got. */
function probe(id: string) {
  const seen: { init?: CapabilityContext; command?: CapabilityContext } = {};
  return {
    seen,
    module: {
      manifest: manifest(id),
      init(ctx: CapabilityContext) {
        seen.init = ctx;
      },
      commands: {
        where(_input: unknown, ctx: CapabilityContext) {
          seen.command = ctx;
          return { dir: ctx.dataDir };
        },
      },
    },
  };
}

const mode = (path: string): number => statSync(path).mode & 0o777;

describe("ctx.dataDir for built-in capabilities", () => {
  it("gives each built-in its own directory under <Core dir>/capabilities/<id>, mode 0700", async () => {
    const core = tempDir();
    const manager = setup({ dataDir: core });
    const a = probe("alpha");
    const b = probe("beta");
    manager.registerBuiltin(a.module);
    manager.registerBuiltin(b.module);
    await manager.enable("alpha");
    await manager.enable("beta");

    expect(a.seen.init?.dataDir).toBe(join(core, "capabilities", "alpha"));
    expect(b.seen.init?.dataDir).toBe(join(core, "capabilities", "beta"));
    expect(a.seen.init?.dataDir).not.toBe(b.seen.init?.dataDir);
    expect(mode(join(core, "capabilities", "alpha"))).toBe(0o700);
    expect(mode(join(core, "capabilities", "beta"))).toBe(0o700);
    expect(mode(join(core, "capabilities"))).toBe(0o700);
  });

  it("is created lazily, on first read, and not by copying or serialising the context", async () => {
    const core = tempDir();
    const manager = setup({ dataDir: core });
    const a = probe("alpha");
    manager.registerBuiltin(a.module);
    await manager.enable("alpha");
    const ctx = a.seen.init as CapabilityContext;

    JSON.stringify(ctx);
    void { ...ctx };
    expect(existsSync(join(core, "capabilities"))).toBe(false);

    expect(ctx.dataDir).toBe(join(core, "capabilities", "alpha"));
    expect(statSync(join(core, "capabilities", "alpha")).isDirectory()).toBe(true);
  });

  it("is read-only", async () => {
    const manager = setup({ dataDir: tempDir() });
    const a = probe("alpha");
    manager.registerBuiltin(a.module);
    await manager.enable("alpha");
    const ctx = a.seen.init as { dataDir?: string };
    expect(() => {
      ctx.dataDir = "/etc";
    }).toThrow();
    expect(() => Object.defineProperty(ctx, "dataDir", { value: "/etc" })).toThrow();
  });

  it("hands a command the same directory as init", async () => {
    const core = tempDir();
    const manager = setup({ dataDir: core });
    const a = probe("alpha");
    manager.registerBuiltin(a.module);
    await manager.enable("alpha");
    const op = await manager.invokeAndWait("alpha", "where");
    expect(op).toMatchObject({
      status: "succeeded",
      result: { dir: join(core, "capabilities", "alpha") },
    });
    expect(a.seen.command?.dataDir).toBe(a.seen.init?.dataDir);
  });

  it("gives an external capability no directory, and creates none for it", async () => {
    const core = tempDir();
    const manager = setup({ dataDir: core });
    await manager.registerExternal(manifest("outside"), "http://127.0.0.1:9");
    const entries = Reflect.get(manager, "entries") as Map<string, { ctx?: CapabilityContext }>;
    const entry = entries.get("outside");
    expect(entry).toBeDefined();
    // The context an external is given (built when it is enabled) has no data directory.
    const build = Reflect.get(manager, "context") as (
      e: unknown,
      s: AbortSignal,
    ) => CapabilityContext;
    const ctx = build.call(manager, entry, new AbortController().signal);
    expect(ctx.dataDir).toBeUndefined();
    expect(existsSync(join(core, "capabilities"))).toBe(false);
  });

  it("two capabilities cannot reach each other's directory through the context", async () => {
    const core = tempDir();
    const manager = setup({ dataDir: core });
    const a = probe("alpha");
    const b = probe("beta");
    manager.registerBuiltin(a.module);
    manager.registerBuiltin(b.module);
    await manager.enable("alpha");
    await manager.enable("beta");
    const dirA = a.seen.init?.dataDir as string;
    const dirB = b.seen.init?.dataDir as string;
    // Neither directory contains the other or the Core directory's own files, and the context
    // exposes nothing else that names a path.
    expect(dirA.startsWith(`${dirB}/`)).toBe(false);
    expect(dirB.startsWith(`${dirA}/`)).toBe(false);
    for (const ctx of [a.seen.init, b.seen.init]) {
      const text = JSON.stringify(
        Object.entries(ctx ?? {}).filter(([, v]) => typeof v === "string"),
      );
      expect(text).not.toContain(core);
    }
    expect(a.seen.init?.id).toBe("alpha");
    expect(b.seen.init?.id).toBe("beta");
  });

  it("without a Core data directory no context has one (a harness still works)", async () => {
    const manager = setup();
    const a = probe("alpha");
    manager.registerBuiltin(a.module);
    await manager.enable("alpha");
    expect(a.seen.init?.dataDir).toBeUndefined();
    expect(await manager.invokeAndWait("alpha", "where")).toMatchObject({
      status: "succeeded",
      result: {},
    });
  });

  it("refuses a relative Core data directory", () => {
    expect(() => setup({ dataDir: "relative/dir" })).toThrow(/absolute/);
  });

  it("refuses a capabilities folder that is a symbolic link, and creates nothing behind it", async () => {
    const core = tempDir();
    const elsewhere = tempDir();
    symlinkSync(elsewhere, join(core, "capabilities"));
    const manager = setup({ dataDir: core });
    const a = probe("alpha");
    manager.registerBuiltin(a.module);
    await manager.enable("alpha");
    expect(() => a.seen.init?.dataDir).toThrow(/not a plain directory/);
    expect(existsSync(join(elsewhere, "alpha"))).toBe(false);
  });

  it("refuses a capability folder that is a symbolic link to another capability's data", async () => {
    const core = tempDir();
    mkdirSync(join(core, "capabilities", "beta"), { recursive: true });
    symlinkSync(join(core, "capabilities", "beta"), join(core, "capabilities", "alpha"));
    const manager = setup({ dataDir: core });
    const a = probe("alpha");
    manager.registerBuiltin(a.module);
    await manager.enable("alpha");
    expect(() => a.seen.init?.dataDir).toThrow(/not a plain directory/);
  });

  it("tightens a folder an older build left wider than 0700", async () => {
    const core = tempDir();
    mkdirSync(join(core, "capabilities", "alpha"), { recursive: true, mode: 0o755 });
    chmodSync(join(core, "capabilities", "alpha"), 0o755);
    const manager = setup({ dataDir: core });
    const a = probe("alpha");
    manager.registerBuiltin(a.module);
    await manager.enable("alpha");
    expect(a.seen.init?.dataDir).toBe(join(core, "capabilities", "alpha"));
    expect(mode(join(core, "capabilities", "alpha"))).toBe(0o700);
  });

  it("a failure is not cached: the next read tries again", async () => {
    const core = tempDir();
    const elsewhere = tempDir();
    symlinkSync(elsewhere, join(core, "capabilities"));
    const manager = setup({ dataDir: core });
    const a = probe("alpha");
    manager.registerBuiltin(a.module);
    await manager.enable("alpha");
    expect(() => a.seen.init?.dataDir).toThrow();
    unlinkSync(join(core, "capabilities"));
    expect(a.seen.init?.dataDir).toBe(join(core, "capabilities", "alpha"));
  });
});

describe("capabilityDataPath / ensureCapabilityDataDir", () => {
  it("only accepts a plain capability id and an absolute Core directory", () => {
    for (const bad of ["", "a", "../x", "a/b", "A", ".hidden", "x".repeat(65), "a\0b", "a b"]) {
      expect(() => capabilityDataPath("/data", bad), JSON.stringify(bad)).toThrow();
    }
    expect(() => capabilityDataPath("data", "alpha")).toThrow(/absolute/);
    expect(capabilityDataPath("/data", "my-cap_2")).toBe("/data/capabilities/my-cap_2");
    expect(() => ensureCapabilityDataDir(tempDir(), "../escape")).toThrow();
  });

  it("is idempotent", () => {
    const core = tempDir();
    const first = ensureCapabilityDataDir(core, "alpha");
    expect(ensureCapabilityDataDir(core, "alpha")).toBe(first);
  });
});
