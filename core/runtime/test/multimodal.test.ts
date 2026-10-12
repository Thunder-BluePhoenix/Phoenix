// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { afterEach, describe, expect, it, vi } from "vitest";
import { startCore, type TestCore } from "./helpers";

let core: TestCore | undefined;
afterEach(async () => {
  await core?.runtime.stop();
  core = undefined;
});

const statusPath = "/api/multimodal/status";

describe("real Core multimodal status boundary", () => {
  it("requires the session token, reports absent local models and never accepts HTTP capture bytes", async () => {
    const fetchModel = vi.fn(() => {
      throw new Error("Unconfigured models must not probe the network");
    });
    core = await startCore({}, { runtime: { fetch: fetchModel } });
    expect((await core.api("GET", statusPath, undefined, { authorization: "" })).status).toBe(401);
    expect(
      (await core.api("GET", statusPath, undefined, { authorization: "Bearer wrong" })).status,
    ).toBe(401);
    expect((await core.api("GET", statusPath)).json).toEqual({
      kill_switch_engaged: false,
      speech: { available: false, detail: "Local Whisper model not configured" },
      vision: { available: false, detail: "Local vision model not configured" },
      capture: {
        available: false,
        detail: "Enable a device capability and install its local model before capture",
      },
    });
    expect(
      (await core.api("POST", "/api/multimodal/authorize", { kind: "microphone" })).status,
    ).toBe(404);
    expect((await core.api("POST", "/api/multimodal/capture", { bytes: "aGVsbG8=" })).status).toBe(
      404,
    );
    expect(fetchModel).not.toHaveBeenCalled();
  });

  it("checks a selected but absent model file and blocks probes under the kill switch", async () => {
    const fetchModel = vi.fn(() => {
      throw new Error("No vision model was selected");
    });
    core = await startCore(
      {},
      {
        runtime: {
          whisperModelPath: "/nonexistent/phoenix-multimodal-test-model.bin",
          fetch: fetchModel,
        },
      },
    );
    expect((await core.api("GET", statusPath)).json).toEqual({
      kill_switch_engaged: false,
      speech: {
        available: false,
        detail: "Local Whisper model is not installed or readable",
        provider: "whisper.cpp",
        locality: "local",
        model: "/nonexistent/phoenix-multimodal-test-model.bin",
      },
      vision: { available: false, detail: "Local vision model not configured" },
      capture: {
        available: false,
        detail: "Enable a device capability and install its local model before capture",
      },
    });
    core.runtime.permissions.engageKillSwitch("user");
    expect((await core.api("GET", statusPath)).json).toEqual({
      kill_switch_engaged: true,
      speech: { available: false, detail: "Kill switch engaged" },
      vision: { available: false, detail: "Kill switch engaged" },
      capture: {
        available: false,
        detail: "Kill switch engaged",
      },
    });
    expect(fetchModel).not.toHaveBeenCalled();
  });

  it("does not report text-only or cloud-backed Ollama models as local vision", async () => {
    const fetchModel = vi.fn(async (url: string) =>
      url.endsWith("/api/tags")
        ? new Response(
            JSON.stringify({ models: [{ name: "llava:latest", remote_host: "example.com" }] }),
          )
        : new Response(JSON.stringify({ capabilities: ["vision"] })),
    );
    core = await startCore({}, { runtime: { visionModel: "llava", fetch: fetchModel } });
    expect((await core.api("GET", statusPath)).json.vision.available).toBe(false);
    expect(fetchModel).toHaveBeenCalledTimes(1);
  });
});
