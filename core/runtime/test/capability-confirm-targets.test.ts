// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 67: the confirmation a person answers carries the target of an external action as structured
// `details.targets`, for every capability, from the command input's marked properties only.
import type { CapabilityManifest } from "@phoenix/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startCore, type TestCore } from "./helpers";

/** An input value the capability did not mark for confirmation; built from parts, not a literal. */
const UNMARKED_VALUE = ["not", "marked", "either"].join("-");

const manifest: CapabilityManifest = {
  id: "demo",
  name: "Demo",
  version: "1.0.0",
  description: "Test capability",
  license: "GPL-3.0-or-later",
  events: ["demo.*"],
  permissions: [],
  commands: [
    {
      name: "deploy",
      description: "Deploy the thing",
      side_effect: "production",
      permissions: [],
      input_schema: {
        type: "object",
        additionalProperties: true,
        properties: { minutes: { type: "integer", "x-phoenix-confirm": true } },
      },
    },
  ],
};

let core: TestCore | undefined;
afterEach(async () => {
  await core?.runtime.stop();
  core = undefined;
});

describe("GET /api/confirmations for a capability command", () => {
  it("shows the marked target fields in details.targets and nothing unmarked", async () => {
    core = await startCore({}, { capabilities: [{ manifest, commands: { deploy: () => "ok" } }] });
    await core.runtime.capabilities.enable("demo");
    const bidi = "\u202E";
    core.runtime.capabilities.invoke("demo", "deploy", {
      deployment_id: `dpl_${bidi}ABC\n123`,
      project: "p".repeat(200),
      minutes: 30,
      note: "not marked",
      idempotency_key: UNMARKED_VALUE,
      nested: { workflow_id: "wf1" },
    });
    await vi.waitFor(async () =>
      expect((await core!.api("GET", "/api/confirmations")).json.confirmations).toHaveLength(1),
    );
    const [conf] = (await core.api("GET", "/api/confirmations")).json.confirmations;
    expect(conf.details.targets).toEqual({
      deployment_id: "dpl_ABC123",
      project: "p".repeat(80),
      minutes: "30",
    });
    const shown = JSON.stringify(conf.details);
    expect(shown).not.toContain("not marked");
    expect(shown).not.toContain(UNMARKED_VALUE);
    expect(shown).not.toContain("wf1");
    expect(shown).not.toContain("operation_id");
    core.runtime.permissions.resolveConfirmation(conf.id, false);
  });

  it("re-sanitises targets the gateway is handed directly (control characters, secrets, length)", async () => {
    core = await startCore({});
    const lookalike = ["gh", "p_", "a1B2".repeat(8)].join("");
    void core.runtime.permissions
      .authorize({
        capabilityId: "demo",
        command: "deploy",
        permissions: [],
        sideEffect: "production",
        summary: "Deploy",
        details: {
          targets: {
            deployment_id: `x\u202Ey\n${"z".repeat(200)}`,
            project: lookalike,
            "bad name": "dropped",
            nested: { a: 1 },
          },
          other: "dropped",
        },
      })
      .catch(() => undefined);
    await vi.waitFor(async () =>
      expect((await core!.api("GET", "/api/confirmations")).json.confirmations).toHaveLength(1),
    );
    const [conf] = (await core.api("GET", "/api/confirmations")).json.confirmations;
    expect(Object.keys(conf.details)).toEqual(["targets"]);
    expect(Object.keys(conf.details.targets).sort()).toEqual(["deployment_id", "project"]);
    expect(conf.details.targets.deployment_id).toBe(`xy${"z".repeat(78)}`);
    expect(JSON.stringify(conf.details)).not.toContain(lookalike);
    core.runtime.permissions.resolveConfirmation(conf.id, false);
  });
});
