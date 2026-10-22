#!/usr/bin/env -S npx tsx
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { setTimeout as delay } from "node:timers/promises";
import { run } from "./cli";

const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());

async function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^y(es)?$/i.test((await rl.question(prompt)).trim());
  } finally {
    rl.close();
  }
}

const code = await run({
  argv: process.argv.slice(2),
  env: process.env,
  cwd: process.cwd(),
  home: homedir(),
  platform: process.platform,
  fetch,
  now: Date.now,
  sleep: (ms, signal) => delay(ms, undefined, { signal }),
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
  ...(process.stdin.isTTY && process.stderr.isTTY ? { confirm } : {}),
  signal: controller.signal,
});
process.exitCode = code;
