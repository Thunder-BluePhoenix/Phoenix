// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreProvider } from "../src/core/context";
import { PhoenixClient } from "../src/core/client";
import { Multimodal } from "../src/components/Multimodal";
import { fakeApi } from "./fake-api";
import { FakeWebSocket } from "./fake-ws";
class CaptureSocket extends FakeWebSocket {
  readyState = 0;
  override send(data: string | Uint8Array) {
    if (typeof data === "string") super.send(data);
    else this.sent.push(new Uint8Array(data));
  }
  override open() {
    this.readyState = 1;
    super.open();
  }
  override close() {
    this.readyState = 3;
    super.close();
  }
}

const device = vi.hoisted(() => ({ start: vi.fn(), readFor: vi.fn(), stop: vi.fn() }));
vi.mock("@phoenix/ai-multimodal/browser", () => ({
  createBrowserCaptureSession: () => device,
}));

const status = {
  kill_switch_engaged: false,
  speech: {
    available: true,
    detail: "Whisper loaded",
    provider: "whisper.cpp",
    model: "tiny",
    locality: "local",
  },
  vision: {
    available: true,
    detail: "Ollama loaded",
    provider: "ollama",
    model: "llava",
    locality: "local",
  },
  capture: { available: true, detail: "Enabled" },
};
const capability = (id: string, granted = true) => ({
  id,
  name: id,
  version: "1",
  description: id,
  kind: "builtin",
  status: "enabled",
  health: { status: "healthy" },
  permissions: [{ permission: "device", description: "device", granted }],
  commands: [],
  data_categories: [],
  context_sources: [],
  ai_tools: [],
});

function mount(granted = true, coreStatus = status) {
  const api = fakeApi({
    "GET /api/multimodal/status": () => coreStatus,
    "GET /api/capabilities": () => ({
      capabilities: [
        capability("capture-microphone", granted),
        capability("capture-screen", granted),
      ],
    }),
  });
  const client = new PhoenixClient({
    token: "secret-session",
    baseUrl: window.location.origin,
    WebSocketImpl: CaptureSocket as unknown as typeof WebSocket,
    fetchImpl: api.fetchImpl,
  });
  const view = render(
    <CoreProvider client={client}>
      <Multimodal />
    </CoreProvider>,
  );
  act(() => FakeWebSocket.last.open());
  return { ...view, api };
}

const capture = async (kind: "microphone" | "screen" = "microphone") => {
  const button = await screen.findByRole("button", { name: `Capture ${kind}` });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  const socket = FakeWebSocket.last;
  act(() => socket.open());
  expect(socket.sent[0]).toEqual({ kind, agent_id: "user" });
  return socket;
};
const response = (socket: FakeWebSocket, payload: object) => {
  act(() => socket.onmessage?.({ data: JSON.stringify(payload) }));
};

beforeEach(() => {
  FakeWebSocket.reset();
  device.start.mockReset().mockResolvedValue(undefined);
  device.readFor.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
  device.stop.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("user device capture", () => {
  it("does not offer OS capture if the persisted grant or selected model is unavailable", async () => {
    mount(false);
    await screen.findByText(/Whisper loaded/);
    expect(
      (screen.getByRole("button", { name: "Capture microphone" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(device.start).not.toHaveBeenCalled();
  });

  it("keeps capture disabled when Core reports no local speech model", async () => {
    mount(true, {
      ...status,
      speech: { ...status.speech, available: false, detail: "No local speech model" },
    });
    await screen.findByText(/No local speech model/);
    expect(
      (screen.getByRole("button", { name: "Capture microphone" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(device.start).not.toHaveBeenCalled();
  });

  it("shows no usable capture when Core status endpoint is absent", async () => {
    const api = fakeApi({
      "GET /api/capabilities": () => ({ capabilities: [capability("capture-microphone")] }),
    });
    const client = new PhoenixClient({
      token: "secret-session",
      baseUrl: window.location.origin,
      WebSocketImpl: CaptureSocket as unknown as typeof WebSocket,
      fetchImpl: api.fetchImpl,
    });
    render(
      <CoreProvider client={client}>
        <Multimodal />
      </CoreProvider>,
    );
    act(() => FakeWebSocket.last.open());
    await screen.findByText("Core capture status is unavailable.");
    expect(
      (screen.getByRole("button", { name: "Capture microphone" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(device.start).not.toHaveBeenCalled();
  });

  it("waits for Core approval; rejected approval never requests device access", async () => {
    mount();
    const socket = await capture();
    expect(device.start).not.toHaveBeenCalled();
    expect(screen.getByText(/Waiting for Core approval/)).toBeTruthy();
    response(socket, { type: "error", error: "Approval rejected" });
    expect(screen.getByRole("alert").textContent).toContain("Approval rejected");
    expect(socket.closed).toBe(true);
    expect(device.start).not.toHaveBeenCalled();
  });

  it("reports OS denial after ready, stops the session and does not send media", async () => {
    device.start.mockRejectedValueOnce(new Error("Browser permission denied"));
    mount();
    const socket = await capture("screen");
    expect(device.start).not.toHaveBeenCalled();
    response(socket, { type: "ready" });
    await screen.findByText("Browser permission denied");
    expect(device.stop).toHaveBeenCalled();
    expect(socket.closed).toBe(true);
    expect(socket.sent).toHaveLength(1);
  });

  it("stops during pending approval and ignores a late ready message", async () => {
    mount();
    const socket = await capture();
    fireEvent.click(screen.getByRole("button", { name: "Stop capture" }));
    expect(socket.closed).toBe(true);
    response(socket, { type: "ready" });
    expect(device.start).not.toHaveBeenCalled();
    expect(screen.queryByText(/Waiting for Core approval/)).toBeNull();
  });

  it("stops an active browser session and discards a late read", async () => {
    let finish: (bytes: Uint8Array) => void = () => {};
    device.readFor.mockImplementationOnce(
      () =>
        new Promise<Uint8Array>((resolve) => {
          finish = resolve;
        }),
    );
    mount();
    const socket = await capture();
    response(socket, { type: "ready" });
    await waitFor(() => expect(device.readFor).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Stop capture" }));
    expect(device.stop).toHaveBeenCalled();
    expect(socket.closed).toBe(true);
    await act(async () => finish(new Uint8Array([1, 2])));
    expect(socket.sent).toHaveLength(1);
  });

  it("sends one frame and renders an inert plain-text result with provenance", async () => {
    const media = new Uint8Array([1, 2, 3]);
    device.readFor.mockResolvedValueOnce(media);
    device.stop.mockImplementationOnce(() => media.fill(0));
    mount();
    const socket = await capture("screen");
    response(socket, { type: "ready" });
    await waitFor(() => expect(socket.sent).toHaveLength(2));
    expect(media).toEqual(new Uint8Array([0, 0, 0]));
    expect(socket.sent[1]).toEqual(new Uint8Array([1, 2, 3]));
    response(socket, {
      type: "result",
      description: '<img src=x onerror="alert(1)">',
      provider: "ollama",
      locality: "local",
    });
    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText(/Screen description · ollama \(local\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear result" }));
    expect(screen.queryByText('<img src=x onerror="alert(1)">')).toBeNull();
  });

  it("opens only one capture socket on a rapid double click", async () => {
    mount();
    const button = await screen.findByRole("button", { name: "Capture microphone" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(FakeWebSocket.instances).toHaveLength(2);
  });
});
