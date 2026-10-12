// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// Run from repository root: pnpm tsx docs/capabilities/smoke.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaults } from "../../core/config/src/index";
import { silentLogger } from "../../core/logging/src/index";
import { PhoenixRuntime } from "../../core/runtime/src/index";
import type { ExternalCapability } from "../../sdk/capability/src/index";
import { startGitLab } from "../../sdk/capability/examples/phoenix-gitlab";
import { startSlack } from "../../sdk/capability/examples/phoenix-slack";
import { startPostgres } from "../../sdk/capability/examples/phoenix-postgres";

const dataDir = mkdtempSync(join(tmpdir(), "phoenix-sdk-walkthrough-"));
const runtime = new PhoenixRuntime({
  config: { ...defaults("dev"), port: 0, dataDir },
  logger: silentLogger,
  writeTokenFile: false,
});
const capabilities: ExternalCapability[] = [];

async function check(
  id: string,
  start: (options: { coreUrl: string; sessionToken: string }) => Promise<ExternalCapability>,
  command: string,
  input: Record<string, string>,
  expected: unknown,
): Promise<void> {
  const capability = await start({ coreUrl, sessionToken: runtime.token });
  capabilities.push(capability);
  if (runtime.capabilities.get(id).status !== "installed") {
    throw new Error(`${id}: registration failed`);
  }
  await runtime.capabilities.enable(id);
  if (!capability.enabled) throw new Error(`${id}: enable callback did not run`);
  const operation = await runtime.capabilities.invokeAndWait(id, command, input);
  if (
    operation.status !== "succeeded" ||
    JSON.stringify(operation.result) !== JSON.stringify(expected)
  ) {
    throw new Error(`${id}: command failed: ${JSON.stringify(operation)}`);
  }
  console.log(
    `${id}: registered, enabled, ${command} returned ${JSON.stringify(operation.result)}`,
  );
}

let started = false;
let coreUrl = "";
try {
  const address = await runtime.start();
  started = true;
  coreUrl = `http://127.0.0.1:${address.port}`;
  await check(
    "phoenix-gitlab",
    startGitLab,
    "issues.list",
    { project: "phoenix/demo" },
    {
      project: "phoenix/demo",
      issues: [{ iid: 7, title: "Review local example", state: "opened" }],
    },
  );
  await check(
    "phoenix-slack",
    startSlack,
    "messages.list",
    { channel: "demo" },
    {
      channel: "demo",
      messages: [{ user: "phoenix", text: "Hello from a local fixture" }],
    },
  );
  await check(
    "phoenix-postgres",
    startPostgres,
    "tables.list",
    { schema: "public" },
    {
      schema: "public",
      tables: [{ name: "demo_events", rows: 2 }],
    },
  );
  console.log("Capability walkthrough passed against Phoenix Core");
} finally {
  for (const capability of capabilities.reverse()) await capability.close();
  if (started) await runtime.stop();
  rmSync(dataDir, { recursive: true, force: true });
}
