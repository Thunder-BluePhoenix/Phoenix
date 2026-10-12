# Capability SDK API and compatibility

The stable **capability contract v1** is the manifest schema, event protocol major 1, and the `@phoenix/sdk` entry point. The current workspace package is `0.1.0` and private: this is a contract freeze for the v0.9 release, **not** a claim that the npm package has already been published as 1.0. Until publication, consume the workspace package from this monorepo.

## Public TypeScript surface

| Export                                                     | Contract                                                                                                                                                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defineCapability(module)`                                 | Validate a trusted builtin manifest and ensure every declared command has a handler. Register the returned module with `new PhoenixRuntime({ ..., capabilities: [module] })`.                                                   |
| `runExternalCapability(options)`                           | Validate manifest, bind a loopback server, register with Core and return an `ExternalCapability` with `endpoint`, `id`, `config`, `enabled`, `emit(event)` and async `close()`.                                                 |
| `events`                                                   | Namespace of typed event builders (`build`, `test`, `agent`, `command`, `deploy`, `git`, `kage`, `frappe`, scenarios). Builders produce event inputs; Core assigns the source.                                                  |
| `resolveSessionToken(explicit?, env?)`, `DEFAULT_CORE_URL` | Development token lookup and default `http://127.0.0.1:4870`. Lookup uses explicit token, `PHOENIX_SESSION_TOKEN`, `$PHOENIX_DATA_DIR/session.token`, `./.phoenix/$PHOENIX_ENV/session.token`, then home directory.             |
| `CAPABILITY_MANIFEST_VERSION`, `CAPABILITY_PROTOCOL_MAJOR` | Literal strings `"1"`; use these when declaring explicit v1 compatibility.                                                                                                                                                      |
| Types                                                      | `CapabilityManifest`, `CommandSpec`, `Permission`, `SideEffect`, `CapabilityContext`, `CapabilityModule`, `CommandHandler`, `HealthResult`, `ExternalContext`, `ExternalCapabilityOptions`, `ExternalCapability`, `EmitResult`. |

`ExternalCapabilityOptions` accepts `manifest`, optional command handlers `(input, ctx, { operationId })`, `health(ctx)`, `onEnable(ctx)`, `onDisable(ctx)`, `coreUrl`, `sessionToken` (literal or getter) and `port` (default ephemeral). `ExternalContext.config` is the latest Core-supplied configuration; `enabled` changes at lifecycle callbacks. `emit` resolves to `{ ok: true, eventId }` or `{ ok: false, code, message }`; check the result. Registration failures reject startup. The returned `close()` stops the SDK server; call it on process shutdown. Tokens can rotate on Core restart; pass a getter rather than a fixed token if managing tokens yourself.

The SDK does **not** make arbitrary handler code secure: external code owns its own credentials and network calls. External commands receive validated input from Core; do not bypass Core by exposing your callback endpoint publicly. `defineCapability` is for trusted first-party code only. `@phoenix/sdk-testing` provides `createHarness` for builtin tests; external capabilities should use the real-Core walkthrough below.

## Version rules

There are three independent versions: manifest `manifest_version` (`"1"`), event protocol major `compatibility.protocol` (`"1"`, current wire `version` `"1.1"`), and your own capability `version` (SemVer, e.g. `"1.2.3"`). Omitting either manifest field retains legacy v1 semantics. Explicit unsupported versions fail manifest validation; an unknown manifest property also fails. Capability `version` identifies _your_ release, not the SDK version. Do not infer compatibility from it. Additive fields/event minor revisions within protocol major 1 may be introduced without invalidating old v1 manifests; incompatible schema, wire, or SDK public API changes require a new respective major and documented migration. Before a published 1.0 SDK, package semver remains 0.x; after publication the SDK will follow SemVer: patch for compatible fixes, minor for additive API, major for breaks. A protocol major change is not automatically an SDK package major change and vice versa.

The canonical schema and actual cross-field checks are [`protocol/schemas/capability-manifest-v1.schema.json`](../../protocol/schemas/capability-manifest-v1.schema.json) and `validateManifest` in [`protocol/src/manifest.ts`](../../protocol/src/manifest.ts). See [migration](migration.md) for existing manifests.

## Executable examples and smoke

The three adapters are local in-memory fixtures, **not** GitLab, Slack or PostgreSQL clients; no remote write, credential, database, or external model is used. They implement real SDK registration and Core command callbacks, and can be swapped for authenticated adapters only after updating declared permissions and security review.

| Capability | Entrypoint                                                                 | Command and fixture input                     |
| ---------- | -------------------------------------------------------------------------- | --------------------------------------------- |
| GitLab     | [`phoenix-gitlab.ts`](../../sdk/capability/examples/phoenix-gitlab.ts)     | `issues.list` `{ "project": "phoenix/demo" }` |
| Slack      | [`phoenix-slack.ts`](../../sdk/capability/examples/phoenix-slack.ts)       | `messages.list` `{ "channel": "demo" }`       |
| Postgres   | [`phoenix-postgres.ts`](../../sdk/capability/examples/phoenix-postgres.ts) | `tables.list` `{ "schema": "public" }`        |

Run from the repository root after `pnpm install` (Node >=22.13):

```sh
pnpm tsx docs/capabilities/smoke.ts
```

This script starts an actual ephemeral Phoenix Core with a temporary data directory; for **each** capability it registers via SDK HTTP, checks installed status, enables via Core, dispatches its declared command through `invokeAndWait`, checks the exact result and cleans up. It exits nonzero if anything fails. No live service account is needed. To explore one process manually, run `pnpm dev:core`, then `pnpm tsx sdk/capability/examples/phoenix-gitlab.ts` in another terminal; enable it in the UI and call `issues.list` with the documented input. See [getting started](getting-started.md) and [security](security.md).
