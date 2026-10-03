// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Example external capability. Start Phoenix Core (`pnpm dev:core`), then:
//   pnpm tsx sdk/capability/examples/hello-external.ts
// Enable "Hello" in the Pet Panel (or POST /api/capabilities/hello/enable)
// and watch Fawkes react every 10 seconds.
import { events, runExternalCapability } from "@phoenix/sdk";

const hello = await runExternalCapability({
  manifest: {
    id: "hello",
    name: "Hello",
    version: "0.1.0",
    description: "Example external capability that pretends to run builds.",
    license: "GPL-3.0-or-later",
    events: ["build.*"],
    permissions: [],
    commands: [
      {
        name: "greet",
        description: "Say hello",
        side_effect: "none",
        input_schema: { type: "object", properties: { name: { type: "string" } } },
      },
    ],
  },
  commands: {
    greet: (input) => `Hello, ${(input as { name?: string }).name ?? "Fawkes"}!`,
  },
  onEnable: () => console.log("enabled by the user"),
  onDisable: () => console.log("disabled"),
});

console.log(`hello capability listening on ${hello.endpoint}`);

setInterval(async () => {
  if (!hello.enabled) return;
  await hello.emit(events.build.started("hello build"));
  setTimeout(() => void hello.emit(events.build.passed()), 3000);
}, 10_000);
