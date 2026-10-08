// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, defaults, loadConfig } from "@phoenix/config";
import { silentLogger } from "@phoenix/logging";
import { openDatabase } from "@phoenix/persistence";
import { describe, expect, it } from "vitest";
import { PhoenixRuntime } from "../src";
import { explainStartupError } from "../src/startup-errors";

const scratch = () => mkdtempSync(join(tmpdir(), "phoenix-startup-"));

/** The error a real failing call throws, so the test breaks if Node changes its error shape. */
function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected the call to throw");
}

describe("explainStartupError", () => {
  it("says a damaged database is damaged, and how to start fresh without losing it", () => {
    const dir = scratch();
    writeFileSync(join(dir, "phoenix.sqlite"), Buffer.alloc(4096, 0x61));
    const text = explainStartupError(
      thrownBy(() => openDatabase(join(dir, "phoenix.sqlite"))),
      { dataDir: dir },
    );
    expect(text).toContain(`database in ${dir} is damaged`);
    expect(text).toContain("Move phoenix.sqlite out of that folder");
  });

  it("names the data folder when it cannot be used", () => {
    const dir = scratch();
    const notAFolder = join(dir, "file");
    writeFileSync(notAFolder, "x");
    const text = explainStartupError(
      thrownBy(() => new PhoenixRuntime(runtimeOptions(notAFolder))),
      { dataDir: notAFolder },
    );
    expect(text).toContain(`cannot use ${notAFolder}`);
    expect(text).toContain("PHOENIX_DATA_DIR");
  });

  it("names the port when another process holds it", async () => {
    const holder = createServer();
    await new Promise<void>((resolve) => holder.listen(0, "127.0.0.1", resolve));
    const { port } = holder.address() as { port: number };
    const second = createServer();
    const failure = await new Promise<unknown>((resolve) => {
      second.once("error", resolve);
      second.listen(port, "127.0.0.1");
    });
    holder.close();
    expect(explainStartupError(failure, { port })).toContain(`Port ${port} is already in use`);
  });

  it("passes configuration mistakes through in the user's own terms", () => {
    const err = thrownBy(() => loadConfig({ env: { PHOENIX_PORT: "abc" } }));
    expect(err).toBeInstanceOf(ConfigError);
    expect(explainStartupError(err)).toBe('PHOENIX_PORT must be an integer, got "abc"');
  });

  it("leaves anything it does not recognise alone, so its detail is still printed", () => {
    expect(explainStartupError(new TypeError("boom"))).toBeUndefined();
    expect(explainStartupError(undefined)).toBeUndefined();
    expect(explainStartupError("a string")).toBeUndefined();
  });
});

function runtimeOptions(dataDir: string) {
  mkdirSync(dataDir, { recursive: true });
  return {
    config: { ...defaults("dev"), port: 0, dataDir },
    logger: silentLogger,
    capabilities: [],
  };
}
