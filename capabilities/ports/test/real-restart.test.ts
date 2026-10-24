// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The real restart seams, exercised only in ways that start no program: a spawn of a file that does
// not exist fails with the fixed text (never Node's message, which carries the command line), and
// `inspect` follows symlinks in a temporary folder.
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { realInspect, realSpawner } from "../src/real";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("realSpawner", () => {
  it("a program that does not exist rejects with the fixed text only", async () => {
    const missing = join(tmpdir(), "phoenix-no-such-program-0001");
    const err = await realSpawner({
      file: missing,
      args: ["--secret-arg"],
      cwd: tmpdir(),
      env: {},
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("spawn_failed");
  });

  it("a folder that does not exist rejects too, and starts nothing", async () => {
    const err = await realSpawner({
      file: process.execPath,
      args: ["-e", "process.exit(0)"],
      cwd: join(tmpdir(), "phoenix-no-such-folder-0001"),
      env: {},
    }).catch((e: unknown) => e);
    expect((err as Error).message).toBe("spawn_failed");
  });
});

describe("realInspect", () => {
  it("resolves symlinks and reports kind and mode; a missing path is undefined", async () => {
    const dir = mkdtempSync(join(tmpdir(), "phoenix-inspect-"));
    dirs.push(dir);
    const target = join(dir, "real.txt");
    writeFileSync(target, "x", { mode: 0o640 });
    const link = join(dir, "link");
    symlinkSync(target, link);
    const facts = await realInspect(link);
    expect(facts?.kind).toBe("file");
    expect(facts?.real.endsWith("real.txt")).toBe(true);
    expect(facts!.mode & 0o777).toBe(0o640);
    expect((await realInspect(dir))?.kind).toBe("directory");
    expect(await realInspect(join(dir, "missing"))).toBeUndefined();
  });
});
