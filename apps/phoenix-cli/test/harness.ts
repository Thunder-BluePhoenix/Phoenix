// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, type CliEnvironment } from "../src/cli";

export interface Outcome {
  code: number;
  out: string;
  err: string;
}

export interface Harness {
  dataDir: string;
  /** The whole command line's streams joined, to search for leaked secrets. */
  everything: (o: Outcome) => string;
  cli: (args: string[], overrides?: Partial<CliEnvironment>) => Promise<Outcome>;
  cleanup: () => void;
}

/** Runs the real CLI against a data dir holding a token file; time and sleeping are injected. */
export function makeHarness(
  token: string,
  coreUrl: string,
  now = () => Date.parse("2026-10-22T12:00:00Z"),
): Harness {
  const root = mkdtempSync(join(tmpdir(), "phoenix-cli-test-"));
  const dataDir = join(root, "data");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, "session.token"), `${token}\n`, { mode: 0o600 });
  return {
    dataDir,
    everything: (o) => o.out + o.err,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    cli: async (args, overrides = {}) => {
      let out = "";
      let err = "";
      const code = await run({
        argv: ["--url", coreUrl, "--data-dir", dataDir, ...args],
        env: {},
        cwd: root,
        home: root,
        platform: process.platform,
        fetch,
        now,
        sleep: async () => {},
        stdout: (t) => void (out += t),
        stderr: (t) => void (err += t),
        signal: new AbortController().signal,
        ...overrides,
      });
      return { code, out, err };
    },
  };
}
