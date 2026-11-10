// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 70: every built-in capability, and every configuration field the Settings form renders for
// one, must have an English entry in apps/web/src/i18n/en/capability-labels.ts. A new capability or
// field fails here until its label is added (the nine other languages are then required by tsc).
import { afterEach, describe, expect, it } from "vitest";
import { capabilityLabels } from "../../../apps/web/src/i18n/en/capability-labels";
import { builtinCapabilities } from "../src/builtins";
import { startCore } from "./helpers";

interface Schema {
  type?: string;
  items?: { type?: string };
  properties?: Record<string, Schema>;
}
interface Row {
  id: string;
  kind: string;
  config_schema?: Schema;
}

/** The fields the Settings form renders (same rule as `fieldsOf` in Settings.tsx). */
const renderedFields = (schema: Schema | undefined) =>
  Object.entries(schema?.properties ?? {})
    .filter(
      ([, p]) =>
        ["string", "integer", "number", "boolean"].includes(p.type ?? "") ||
        (p.type === "array" && p.items?.type === "string"),
    )
    .map(([key]) => key);

const labels = capabilityLabels as Record<string, string>;
let stop: (() => Promise<void>) | undefined;
afterEach(async () => {
  await stop?.();
  stop = undefined;
});

async function builtins(): Promise<Row[]> {
  const core = await startCore({}, { capabilities: builtinCapabilities("dev") });
  stop = () => core.runtime.stop();
  const listed = (await core.api("GET", "/api/capabilities")).json.capabilities as Row[];
  return listed.filter((c) => c.kind === "builtin");
}

describe("built-in capability labels (Phase 70)", () => {
  it("has a name and a description for every built-in capability", async () => {
    const rows = await builtins();
    expect(rows.length).toBeGreaterThan(25);
    const missing = rows.flatMap((c) =>
      ["name", "description"]
        .map((part) => `capabilityLabels.${c.id}.${part}`)
        .filter((key) => !labels[key]),
    );
    expect(
      missing,
      `Add these to en/capability-labels.ts and all nine locales:\n${missing}`,
    ).toEqual([]);
  });

  it("has a label for every rendered schema field of every built-in capability", async () => {
    const rows = await builtins();
    const missing = rows.flatMap((c) =>
      renderedFields(c.config_schema)
        .filter(
          (f) =>
            !labels[`capabilityLabels.field.${c.id}.${f}`] &&
            !labels[`capabilityLabels.field.${f}`],
        )
        .map((f) => `${c.id}.${f}`),
    );
    expect(
      missing,
      `Add a capabilityLabels.field.<field> (or .<id>.<field>) entry:\n${missing}`,
    ).toEqual([]);
  });

  it("carries no entry for a capability that is not built in", async () => {
    const ids = new Set((await builtins()).map((c) => c.id));
    const stale = Object.keys(labels)
      .map((k) => /^capabilityLabels\.([^.]+)\.(name|description)$/.exec(k)?.[1])
      .filter((id): id is string => id !== undefined && id !== "field" && !ids.has(id));
    expect(stale).toEqual([]);
  });
});
