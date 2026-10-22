// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../../../sdk/testing/src/index";
import { createMachineCapability, type MachineProbe } from "../src";
import { createLocalModelClient, type ModelClient } from "../src/models";
import { createMachineProbe, type ProbeEffects } from "../src/probes";

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
const GIB = 1024 ** 3;
function rig(size: number | null = 2 * GIB, free = 100 * GIB) {
  const calls: string[] = [];
  let installed = false;
  const probe: MachineProbe = {
    platform: "linux",
    sample: async () => ({
      diskFreeBytes: free,
      diskTotalBytes: 200 * GIB,
      memoryFreeBytes: 16 * GIB,
      memoryTotalBytes: 32 * GIB,
      cpuPercent: 5,
      batteryPercent: null,
      charging: null,
      temperatureCelsius: null,
    }),
  };
  const client: ModelClient = {
    request: async (provider, method, path, body) => {
      calls.push(`${provider}:${method}:${path}`);
      if (path === "/api/tags")
        return { models: installed ? [{ name: "library/model:latest", size: 2 * GIB }] : [] };
      if (path === "/api/ps") return { models: [] };
      if (path === "/api/v1/models")
        return {
          models: installed
            ? [{ key: "library/model", size_bytes: 2 * GIB, loaded_instances: [] }]
            : [],
        };
      if (path === "/api/pull" || path === "/api/v1/models/download") {
        installed = true;
        return { status: "completed", body };
      }
      if (path === "/api/delete") {
        installed = false;
        return {};
      }
      return { status: "loaded" };
    },
  };
  h = createHarness({
    modules: [createMachineCapability({ probe, client, catalogSize: async () => size })],
  });
  return calls;
}
async function ready(size: number | null = 2 * GIB, free = 100 * GIB) {
  const calls = rig(size, free);
  await h!.enable("machine");
  return calls;
}
const target = { provider: "ollama", name: "library/model:latest" };

describe("machine through permission gateway", () => {
  it("emits WARNING on simulated low disk and clears on recovery", async () => {
    let free = GIB;
    const probe: MachineProbe = {
      platform: "darwin",
      sample: async () => ({
        diskFreeBytes: free,
        diskTotalBytes: 100 * GIB,
        memoryFreeBytes: 8 * GIB,
        memoryTotalBytes: 16 * GIB,
        cpuPercent: 4,
        batteryPercent: null,
        charging: null,
        temperatureCelsius: null,
      }),
    };
    h = createHarness({
      modules: [
        createMachineCapability({ probe, client: { request: async () => ({ models: [] }) } }),
      ],
    });
    await h.enable("machine");
    const first = await h.run("machine", "health_snapshot");
    expect(first.result).toMatchObject({ warnings: ["disk"] });
    expect(h.types("machine")).toContain("machine.health.warning");
    expect(createMachineCapability({ probe }).manifest.state_rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          match: "machine.health.warning",
          effect: expect.objectContaining({ state: "WARNING" }),
        }),
      ]),
    );
    free = 50 * GIB;
    await h.run("machine", "health_snapshot");
    expect(h.types("machine")).toContain("machine.health.recovered");
  });
  it("refuses low disk and unknown catalog size without contacting model server", async () => {
    const calls = await ready(2 * GIB, GIB);
    const denied = await h!.run("machine", "download_model", target);
    expect(denied.status).toBe("failed");
    expect(calls).toEqual([]);
    await h!.close();
    h = undefined;
    const unknownCalls = await ready(null);
    expect((await h!.run("machine", "download_model", target)).status).toBe("failed");
    expect(unknownCalls).toEqual([]);
  });
  it("downloads, lists, runs and removes through injected local service; denial has no effects", async () => {
    const calls = await ready();
    expect((await h!.run("machine", "download_model", target, false)).status).toBe("failed");
    expect(calls).toEqual([]);
    expect((await h!.run("machine", "check_fit", target)).result).toMatchObject({ fits: true });
    expect((await h!.run("machine", "download_model", target)).status).toBe("succeeded");
    expect((await h!.run("machine", "list_models", { provider: "ollama" })).result).toMatchObject([
      { name: target.name },
    ]);
    expect((await h!.run("machine", "run_model", target)).status).toBe("succeeded");
    expect((await h!.run("machine", "remove_model", target)).status).toBe("succeeded");
    expect(calls).toContain("ollama:POST:/api/pull");
    expect(calls).toContain("ollama:POST:/api/generate");
    expect(calls).toContain("ollama:DELETE:/api/delete");
    expect(
      h!.db.prepare("SELECT action FROM audit_log WHERE capability_id = 'machine'").all(),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "confirmation.approved" })]),
    );
  });
  it("downloads and loads a verified LM Studio model through the fake local service", async () => {
    const calls = await ready();
    const model = { provider: "lmstudio", name: "library/model" };
    expect((await h!.run("machine", "check_fit", model)).result).toMatchObject({ fits: true });
    expect((await h!.run("machine", "download_model", model)).status).toBe("succeeded");
    expect((await h!.run("machine", "list_models", { provider: "lmstudio" })).result).toMatchObject(
      [{ name: model.name }],
    );
    expect((await h!.run("machine", "run_model", model)).status).toBe("succeeded");
    expect(calls).toContain("lmstudio:POST:/api/v1/models/download");
    expect(calls).toContain("lmstudio:POST:/api/v1/models/load");
  });
  it("refuses unsupported LM Studio deletion without contacting local service", async () => {
    const calls = await ready();
    expect(
      (await h!.run("machine", "remove_model", { provider: "lmstudio", name: "library/model" }))
        .status,
    ).toBe("failed");
    expect(calls).toEqual([]);
  });
});

describe("injected host probes", () => {
  const base: ProbeEffects = {
    platform: "linux",
    diskPath: "/fake",
    disk: async () => ({ free: 4, total: 8 }),
    memory: () => ({ free: 1, total: 10 }),
    cpu: () => 60,
    read: async () => null,
    run: async () => null,
  };
  it("reads Linux available memory, battery and millidegree temperature", async () => {
    const files: Record<string, string> = {
      "/proc/meminfo": "MemAvailable: 2048 kB",
      "/sys/class/power_supply/BAT0/capacity": "12",
      "/sys/class/power_supply/BAT0/status": "Discharging",
      "/sys/class/thermal/thermal_zone0/temp": "89000",
    };
    const reading = await createMachineProbe({
      ...base,
      read: async (path) => files[path] ?? null,
    }).sample();
    expect(reading).toMatchObject({
      memoryFreeBytes: 2 * 1024 ** 2,
      batteryPercent: 12,
      charging: false,
      temperatureCelsius: 89,
    });
  });
  it("parses macOS and Windows with missing temperature reported unavailable", async () => {
    const mac = await createMachineProbe({
      ...base,
      platform: "darwin",
      run: async (file) =>
        file === "pmset"
          ? "Battery Power; 24%; discharging"
          : "Mach Virtual Memory Statistics: (page size of 4096 bytes)\nPages free: 100.\nPages inactive: 200.\nPages speculative: 300.",
    }).sample();
    expect(mac).toMatchObject({
      batteryPercent: 24,
      charging: false,
      memoryFreeBytes: 600 * 4096,
      temperatureCelsius: null,
    });
    const win = await createMachineProbe({
      ...base,
      platform: "win32",
      run: async () => "79\r\n33\r\n",
    }).sample();
    expect(win).toMatchObject({ cpuPercent: 79, batteryPercent: 33, temperatureCelsius: null });
  });
});

describe("loopback client", () => {
  it("uses fixed loopback URLs and rejects redirect responses", async () => {
    const urls: string[] = [];
    const fetcher = async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ models: [] }), { status: 200 });
    };
    await createLocalModelClient(fetcher as typeof fetch).request("ollama", "GET", "/api/tags");
    expect(urls).toEqual(["http://127.0.0.1:11434/api/tags"]);
    await expect(
      createLocalModelClient(fetcher as typeof fetch).request("ollama", "GET", "//outside.test/"),
    ).rejects.toThrow();
  });

  it("fails closed on an oversized body without reading all of it", async () => {
    let pulls = 0;
    const chunk = new Uint8Array(512 * 1024).fill(32);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        if (pulls > 100) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const fetcher = async () => new Response(body, { status: 200 });
    await expect(
      createLocalModelClient(fetcher as typeof fetch).request("ollama", "GET", "/api/tags"),
    ).rejects.toThrow(/too large/);
    expect(pulls).toBeLessThan(20);
  });

  it("rejects a declared content-length over the cap before reading the body", async () => {
    let pulled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull() {
          pulled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const fetcher = async () =>
      new Response(body, { status: 200, headers: { "content-length": "50000000" } });
    await expect(
      createLocalModelClient(fetcher as typeof fetch).request("ollama", "GET", "/api/tags"),
    ).rejects.toThrow(/too large/);
    expect(pulled).toBe(false);
  });

  it("still parses multi-chunk bodies under the cap", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"models":'));
        controller.enqueue(encoder.encode("[1]}"));
        controller.close();
      },
    });
    const fetcher = async () => new Response(body, { status: 200 });
    await expect(
      createLocalModelClient(fetcher as typeof fetch).request("ollama", "GET", "/api/tags"),
    ).resolves.toEqual({ models: [1] });
  });
});
