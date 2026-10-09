// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { afterEach, describe, expect, it } from "vitest";
import { builtinCapabilities } from "../src/builtins";
import { startCore } from "./helpers";

let stop: (() => Promise<void>) | undefined;
afterEach(async () => {
  await stop?.();
  stop = undefined;
});

interface CapabilityRow {
  id: string;
  status: string;
}

describe("built-in capabilities", () => {
  it("registers every first-party capability, installed and not enabled", async () => {
    const core = await startCore({}, { capabilities: builtinCapabilities("dev") });
    stop = () => core.runtime.stop();
    const listed = (await core.api("GET", "/api/capabilities")).json
      .capabilities as CapabilityRow[];
    const ids = listed.map((c) => c.id).sort();
    expect(ids).toEqual(
      ["agents", "docker", "frappe", "git", "github", "issues", "kage", "mock", "terminal"].sort(),
    );
    expect(listed.every((c) => c.status === "installed")).toBe(true);
  });

  it("leaves the demo capability out of production", () => {
    const ids = builtinCapabilities("prod").map((m) => m.manifest.id);
    expect(ids).not.toContain("mock");
    expect(ids).toEqual(expect.arrayContaining(["docker", "frappe", "agents", "issues", "github"]));
  });
});
