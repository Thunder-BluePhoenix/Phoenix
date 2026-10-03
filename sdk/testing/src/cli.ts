#!/usr/bin/env -S npx tsx
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phoenix event simulator.
//   pnpm simulate list
//   pnpm simulate <scenario> [--speed 2]
//   pnpm simulate event <type> [--source terminal] [--severity info] [--subject s]
//                              [--correlation id] [--requires-action] [--payload '{"k":1}']
import { parseArgs } from "node:util";
import { DEFAULT_CORE_URL, resolveSessionToken } from "@phoenix/sdk";
import { SCENARIOS, type EventInput } from "@phoenix/sdk-events";
import { publish, simulate } from "./simulator";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    speed: { type: "string", default: "1" },
    source: { type: "string", default: "simulator" },
    severity: { type: "string", default: "info" },
    subject: { type: "string" },
    correlation: { type: "string" },
    "requires-action": { type: "boolean", default: false },
    payload: { type: "string", default: "{}" },
    core: { type: "string", default: process.env.PHOENIX_CORE_URL ?? DEFAULT_CORE_URL },
  },
});

// Exit quietly when output is piped into something that closes early (e.g. `| head`).
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") process.exit(0);
  throw err;
});

async function main(): Promise<void> {
  const [command, arg] = positionals;
  if (!command || command === "list" || command === "help") {
    console.log("Scenarios:");
    for (const [name, s] of Object.entries(SCENARIOS))
      console.log(`  ${name.padEnd(16)} ${s.description}`);
    console.log("\nUsage: pnpm simulate <scenario> [--speed 2]");
    console.log(
      "       pnpm simulate event <type> [--source s] [--severity info|success|warning|error] [--payload JSON]",
    );
    return;
  }
  const core = { url: values.core!, token: resolveSessionToken() };

  if (command === "event") {
    if (!arg) throw new Error("Usage: pnpm simulate event <type>");
    const input: EventInput = {
      event_type: arg,
      severity: values.severity as EventInput["severity"],
      payload: JSON.parse(values.payload!) as Record<string, unknown>,
      ...(values.subject ? { subject: values.subject } : {}),
      ...(values.correlation ? { correlation_id: values.correlation } : {}),
      ...(values["requires-action"] ? { requires_action: true } : {}),
    };
    const id = await publish(core, values.source!, input);
    console.log(`published ${arg} (${id})`);
    return;
  }

  const sent = await simulate(core, command, { speed: Number(values.speed), log: console.log });
  console.log(`done: ${sent} events`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
