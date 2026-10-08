# Building a Capability

A capability connects Phoenix to something else — a build tool, a meeting system, a deployment pipeline. This guide walks through both kinds. Read [the capability model](model.md) for the rules Phoenix enforces.

## 1. Pick a kind

| Use…                                   | When                                                                                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **External** (`runExternalCapability`) | Almost always. Runs in its own process, any language (the SDK is TypeScript; the [HTTP contract](model.md#external-capability-http-contract) is all you need elsewhere). A crash never affects Phoenix. |
| **Builtin** (`defineCapability`)       | First-party code shipped inside Phoenix Core.                                                                                                                                                           |

## 2. Write the manifest

Everything your capability can do is declared up front:

```ts
const manifest = {
  id: "hello", // also the `source` of your events
  name: "Hello",
  version: "0.1.0",
  description: "Pretends to run builds.",
  license: "GPL-3.0-or-later",
  events: ["build.*"], // the only event types you may emit (not core/pet/system/security/phoenix/fawkes/capability/notification: those are Phoenix's own)
  permissions: [], // shown to the user before they enable you
  commands: [
    {
      name: "greet",
      description: "Say hello",
      side_effect: "none",
      input_schema: { type: "object", properties: { name: { type: "string" } } },
    },
  ],
};
```

`side_effect` decides whether a command needs the user's confirmation: `write`, `execute`, `external` and `production` always do.

## 3a. External capability

```ts
import { events, runExternalCapability } from "@phoenix/sdk";

const hello = await runExternalCapability({
  manifest,
  commands: { greet: (input) => `Hello, ${(input as { name?: string }).name ?? "Fawkes"}!` },
  health: () => ({ status: "healthy" }),
  onEnable: (ctx) => console.log("enabled with config", ctx.config),
});

await hello.emit(events.build.started("make"));
await hello.emit(events.build.passed());
```

The SDK:

- starts a server on `127.0.0.1` implementing the contract (`/health`, `/phoenix/lifecycle`, `/commands/:name`);
- registers with Phoenix Core using the session token from `.phoenix/dev/session.token` (or `PHOENIX_SESSION_TOKEN`);
- verifies every call from core with a secret it chose itself, and signs its own events with the token core issued;
- re-registers automatically after core restarts and retries a failed send (events are de-duplicated by id, so this is safe).

A complete example lives in [`sdk/capability/examples/hello-external.ts`](../../sdk/capability/examples/hello-external.ts):

```sh
pnpm dev:core                                         # terminal 1
pnpm tsx sdk/capability/examples/hello-external.ts    # terminal 2
```

Then enable **Hello** (Pet Panel, or `POST /api/capabilities/hello/enable`).

## 3b. Builtin capability

```ts
import { defineCapability, events } from "@phoenix/sdk";

export const hello = defineCapability({
  manifest,
  init(ctx) {
    ctx.emit(events.build.started());
  },
  commands: { greet: () => "hi" },
});
```

Register it by passing it in `capabilities` to `new PhoenixRuntime(...)`.

## 4. Test it

`@phoenix/sdk-testing` gives you an in-memory Phoenix:

```ts
import { createHarness } from "@phoenix/sdk-testing";

const h = createHarness({ modules: [hello] });
await h.enable("hello");
const op = await h.run("hello", "greet", { name: "Fawkes" }); // answers confirmations for you
expect(op.result).toBe("Hello, Fawkes!");
expect(h.state.snapshot().state).toBe("WORKING");
```

## 5. Try events without writing code

```sh
pnpm simulate list                       # scenarios: build-fail, deploy, meeting, …
pnpm simulate meeting --speed 2          # play one against a running core
pnpm simulate event agent.waiting --source codex --severity warning --requires-action --payload '{"agent":"Codex"}'
```

In development, Phoenix also includes a **Mock** capability: enable it and run its `simulate` command to play the same scenarios through the full capability path.

## Event builders

`events` (from `@phoenix/sdk`, or `@phoenix/sdk-events`) has typed builders for the event types Fawkes already understands: `build`, `test`, `command`, `agent`, `deploy`, `git`, `kage`, `frappe`. Use them where they fit; add your own `state_rules` for anything new.
