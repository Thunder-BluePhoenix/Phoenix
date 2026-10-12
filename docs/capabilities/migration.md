# Capability manifest v1 migration

Existing manifests without a `manifest_version` or `compatibility` field **remain valid**: omission means manifest v1 and event protocol major 1. You can migrate explicitly without changing behavior:

```ts
import { CAPABILITY_MANIFEST_VERSION, CAPABILITY_PROTOCOL_MAJOR } from "@phoenix/sdk";

const manifest = {
  manifest_version: CAPABILITY_MANIFEST_VERSION,
  compatibility: { protocol: CAPABILITY_PROTOCOL_MAJOR },
  id: "my-capability",
  name: "My capability",
  version: "1.0.0",
  description: "A local example",
  license: "GPL-3.0-or-later",
  events: [],
  permissions: [],
  commands: [],
};
```

The only two actual event **wire** versions available for an executable same-major comparison in this checkout are historical `1.0` ([Appendix A fixtures](../../protocol/fixtures/appendix-a.events.json)) and current producer `1.1` ([event builder](../../protocol/src/event.ts)). `corepack pnpm --filter @phoenix/sdk build` followed by `corepack pnpm --filter @phoenix/sdk check:artifact` installs the built package into an isolated consumer, validates the historical fixtures using the current parser and checks a live emitted 1.1 envelope against that parser. Both omitted-version and explicit-v1 manifests are checked through the packed SDK. This is **not** a comparison between two independently released SDKs/Cores: only SDK `0.1.0`, manifest major `1` and protocol major `1` are known. Upgrade-pair evidence requires prior and candidate artifacts plus Core profiles and owner approval.

Keep `version` as _your capability's_ SemVer, independent of both protocol versions. `manifest_version: "2"` or `compatibility: { protocol: "2" }` is not forward-compatible with a v1-only Core: registration fails. Do not remove the explicit `permissions`, `commands` or `events` arrays even when empty. Unknown top-level keys fail schema validation; move arbitrary runtime settings to the `config_schema`-validated config passed by Core. Existing `defineCapability` and `runExternalCapability` callsites need no API rewrite.

If upgrading an older ad hoc integration to v1: choose a stable lowercase `id` (2–64 characters; not a reserved Core namespace), include `name`, `description`, `license` and SemVer `version`; enumerate every event, command, side effect and permission; ensure each command permission appears in top-level `permissions`, supply handlers for builtin commands and compile embedded JSON Schemas. `state_rules` must match declared event patterns. Validate through the SDK or `validateManifest` before registration. New permissions on an already-enabled capability require renewed user consent; do not reuse an existing id for a different trust domain. For an unsupported future major, use a Core/SDK that explicitly supports that major rather than silently dropping its fields. See [protocol](protocol.md), [SDK](sdk.md), [security](security.md).
