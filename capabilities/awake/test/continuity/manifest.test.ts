// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { compileSchema } from "../../../../protocol/src/manifest";
import { describe, expect, it } from "vitest";
import { createAwakeCapability } from "../../src";
import { continuityModule } from "../../src/continuity";
import { continuityRig } from "./rig";

/** The real capability with the real MODULES list: defineCapability validates the manifest. */
const capability = createAwakeCapability();
const manifest = capability.manifest;

describe("the composed manifest", () => {
  it("includes the continuity module (registered in MODULES) and is valid", () => {
    const names = manifest.commands.map((c) => c.name);
    for (const name of [
      "hotspot.join_now",
      "hotspot.rejoin_previous",
      "throttle.relaunch",
      "throttle.status",
      "continuity.status",
    ]) {
      expect(names).toContain(name);
    }
    expect(manifest.events).toEqual(
      expect.arrayContaining(["awake.network.down", "awake.network.up"]),
    );
    expect(manifest.permissions).toContain("network");
    expect(manifest.secrets?.map((s) => s.name)).toContain("hotspot_password");
    expect(continuityModule.commandSpecs.every((s) => names.includes(s.name))).toBe(true);
  });

  it("every side-effecting continuity command asks the user (execute)", () => {
    const sides = Object.fromEntries(manifest.commands.map((c) => [c.name, c.side_effect]));
    expect(sides["hotspot.join_now"]).toBe("execute");
    expect(sides["hotspot.rejoin_previous"]).toBe("execute");
    expect(sides["throttle.relaunch"]).toBe("execute");
    expect(sides["throttle.status"]).toBe("read");
    expect(sides["continuity.status"]).toBe("read");
  });

  it("the config schema refuses a malformed pane id, host, SSID length, delay and unknown keys", () => {
    const validate = compileSchema(manifest.config_schema ?? {});
    expect(validate({})).toEqual([]);
    expect(
      validate({ continuity: { nudge: { enabled: true, panes: ["%12"], after_seconds: 30 } } }),
    ).toEqual([]);
    const bad: Record<string, unknown>[] = [
      { continuity: { nudge: { panes: ["%1; rm"] } } },
      { continuity: { nudge: { panes: ["$(x)"] } } },
      { continuity: { nudge: { after_seconds: 29 } } },
      { continuity: { nudge: { allowed_commands: ["a b"] } } },
      { continuity: { network_watch: { hosts: ["a b"] } } },
      { continuity: { hotspot: { ssid: "x".repeat(33) } } },
      { continuity: { hotspot: { password: "nope" } } },
      { continuity: { surprise: true } },
    ];
    for (const config of bad)
      expect(validate(config).length, JSON.stringify(config)).toBeGreaterThan(0);
  });

  it("the relaunch command's schema refuses a bundle id outside the table", () => {
    const spec = manifest.commands.find((c) => c.name === "throttle.relaunch");
    const validate = compileSchema(spec?.input_schema ?? {});
    expect(validate({ bundle_id: "com.google.Chrome" })).toEqual([]);
    expect(validate({ bundle_id: "com.apple.Safari" }).length).toBeGreaterThan(0);
    expect(validate({}).length).toBeGreaterThan(0);
  });

  it("with nothing configured the capability is inert: zero Runner calls over a long time", async () => {
    // continuityRig drives the module directly; this checks the default module instance too.
    const r = await continuityRig({ config: {} });
    r.net.up = false;
    await r.tick(100);
    await r.call("continuity.status");
    await r.call("throttle.status");
    expect(r.sys.runs).toEqual([]);
    r.shutdown();
  });
});
