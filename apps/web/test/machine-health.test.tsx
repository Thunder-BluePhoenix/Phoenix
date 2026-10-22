// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MachineHealth } from "../src/components/MachineHealth";
import { PhoenixClient } from "../src/core/client";
import { CoreProvider } from "../src/core/context";
import { readMachineModels, readMachineSnapshot } from "../src/core/machine";
import { I18nProvider } from "../src/i18n";
import { resetActive } from "../src/i18n/store";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";
import { capability } from "./views-harness";

beforeEach(() => FakeWebSocket.reset());
afterEach(() => {
  cleanup();
  resetActive();
});
const reading = {
  platform: "linux",
  reading: {
    diskFreeBytes: 1024,
    diskTotalBytes: 2048,
    memoryFreeBytes: 30,
    memoryTotalBytes: 60,
    cpuPercent: 40,
    batteryPercent: null,
    charging: null,
    temperatureCelsius: null,
  },
  warnings: ["disk"],
};
function mount(opts: { enabled?: boolean; fit?: unknown } = {}) {
  const api = fakeApi({
    "GET /api/capabilities": () => ({
      capabilities: [capability("machine", opts.enabled === false ? "disabled" : "enabled")],
    }),
    "POST /api/capabilities/machine/commands/*": (_body, url) => ({
      id: `op-${url.pathname.split("/").at(-1)}`,
    }),
    "GET /api/operations/op-health_snapshot": () => ({ status: "succeeded", result: reading }),
    "GET /api/operations/op-list_models": () => ({
      status: "succeeded",
      result: [
        { provider: "ollama", name: "library/model:latest", sizeBytes: 4096, loaded: false },
      ],
    }),
    "GET /api/operations/op-check_fit": () => ({
      status: "succeeded",
      result: opts.fit ?? { fits: false, reason: "disk" },
    }),
    "GET /api/operations/op-remove_model": () => ({ status: "succeeded", result: {} }),
    "GET /api/operations/op-download_model": () => ({ status: "succeeded", result: {} }),
  });
  const client = new PhoenixClient({
    token: "tok",
    baseUrl: "http://127.0.0.1:4870",
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  render(
    <CoreProvider client={client}>
      <I18nProvider forceLocale="en">
        <MachineHealth />
      </I18nProvider>
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
  return api;
}
describe("machine response validation", () => {
  it("accepts complete readings and warns on malformed response", () => {
    expect(readMachineSnapshot(reading)?.warnings).toEqual(["disk"]);
    expect(readMachineSnapshot({ platform: "linux", reading: {}, warnings: [] })).toBeNull();
  });
  it("rejects model entries with untrusted shapes", () => {
    expect(
      readMachineModels([
        { provider: "ollama", name: "local:latest", sizeBytes: 200, loaded: false },
      ]),
    ).toHaveLength(1);
    expect(
      readMachineModels([
        { provider: "ollama", name: "local:latest", sizeBytes: -1, loaded: false },
      ]),
    ).toBeNull();
  });
});
describe("machine UI gateway", () => {
  it("shows simulated low disk warning and installed models", async () => {
    const api = mount();
    fireEvent.click(await screen.findByRole("button", { name: "Check health" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Free disk");
    fireEvent.click(screen.getByRole("button", { name: "List models" }));
    expect(await screen.findByText(/library\/model:latest/)).toBeTruthy();
    expect(api.posts("/api/capabilities/machine/commands/list_models")).toHaveLength(1);
  });
  it("prevents downloads on failed fit and sends a separate remove confirmation", async () => {
    const api = mount();
    fireEvent.change(await screen.findByRole("textbox", { name: "Model identifier" }), {
      target: { value: "library/model:latest" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check fit" }));
    expect(await screen.findByText("Not enough free disk.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Download…" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "List models" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove…" }));
    expect(api.posts("/api/capabilities/machine/commands/remove_model")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Approve remove/ }));
    await waitFor(() =>
      expect(api.posts("/api/capabilities/machine/commands/remove_model")).toHaveLength(1),
    );
  });
  it("disables the panel when capability is disabled", async () => {
    mount({ enabled: false });
    expect(await screen.findByText("Enable Machine health to use this panel.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Check health" })).toBeNull();
  });
});
