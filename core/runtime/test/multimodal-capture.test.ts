// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { WS_PROTOCOL, WS_TOKEN_PREFIX } from "@phoenix/api";
import { TOKEN, startCore, type TestCore } from "./helpers";

let core: TestCore | undefined;
const clients = new Set<WebSocket>();
afterEach(async () => {
  for (const client of clients) {
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
  clients.clear();
  await core?.runtime.stop();
  core = undefined;
});

function capture(options: { token?: string; origin?: string; path?: string } = {}) {
  const ws = new WebSocket(
    `ws://127.0.0.1:${core!.port}${options.path ?? "/api/multimodal/capture"}`,
    [WS_PROTOCOL, WS_TOKEN_PREFIX + (options.token ?? TOKEN)],
    { headers: options.origin === "absent" ? {} : { Origin: options.origin ?? core!.base } },
  );
  clients.add(ws);
  ws.once("close", () => clients.delete(ws));
  ws.on("error", () => {});
  const messages: Array<Record<string, unknown>> = [];
  ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
  const opened = new Promise<number>((resolve) => {
    ws.once("open", () => resolve(101));
    ws.once("unexpected-response", (_req, response) => resolve(response.statusCode ?? 0));
  });
  const next = (type: string) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const found = messages.find((message) => message.type === type);
      if (found) return resolve(found);
      ws.once("close", () => reject(new Error(`Socket closed before ${type} message`)));
      ws.on("message", (data) => {
        const message = JSON.parse(data.toString()) as Record<string, unknown>;
        if (message.type === type) resolve(message);
      });
    });
  return { ws, opened, next };
}

const localVision = vi.fn(async (url: string, init?: RequestInit) => {
  if (url.endsWith("/api/tags"))
    return new Response(JSON.stringify({ models: [{ name: "llava:latest" }] }));
  if (url.endsWith("/api/show")) return new Response(JSON.stringify({ capabilities: ["vision"] }));
  if (url.endsWith("/api/chat")) {
    expect(init?.signal?.aborted).toBe(false);
    return new Response(JSON.stringify({ message: { content: "A selected screen" } }));
  }
  throw new Error("Unexpected local model request");
});
const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function approvedScreen() {
  core ??= await startCore({}, { runtime: { visionModel: "llava", fetch: localVision } });
  const enabled = await core.api("POST", "/api/capabilities/capture-screen/enable", {});
  expect(enabled.status).toBe(200);
  const socket = capture();
  expect(await socket.opened).toBe(101);
  socket.ws.send(JSON.stringify({ kind: "screen", agent_id: "user" }));
  await vi.waitFor(() => expect(core!.runtime.permissions.pendingConfirmations()).toHaveLength(1));
  const confirmation = core.runtime.permissions.pendingConfirmations()[0]!;
  expect(confirmation.summary).toContain("selected screen image");
  return { ...socket, confirmation };
}

describe("Core's user-owned capture WebSocket", () => {
  it("refuses missing or foreign origins and wrong session token", async () => {
    core = await startCore();
    expect(await capture({ origin: "absent" }).opened).toBe(403);
    expect(await capture({ origin: "http://attacker.invalid" }).opened).toBe(403);
    expect(await capture({ token: "wrong" }).opened).toBe(401);
    expect(await capture({ path: "/api/multimodal/capture?token=" + TOKEN }).opened).toBe(403);
  });

  it("rejects unconfigured models before prompting, and rejects missing grant even with model", async () => {
    core = await startCore();
    const missing = capture();
    expect(await missing.opened).toBe(101);
    missing.ws.send(JSON.stringify({ kind: "screen", agent_id: "user" }));
    expect((await missing.next("error")).error).toBeTruthy();
    expect(core.runtime.permissions.pendingConfirmations()).toHaveLength(0);
    await core.runtime.stop();
    core = await startCore({}, { runtime: { visionModel: "llava", fetch: localVision } });
    const noGrant = capture();
    expect(await noGrant.opened).toBe(101);
    noGrant.ws.send(JSON.stringify({ kind: "screen", agent_id: "user" }));
    expect((await noGrant.next("error")).error).toBeTruthy();
    expect(core.runtime.permissions.pendingConfirmations()).toHaveLength(0);
  });

  it("does not prompt even with a device grant when its local model is absent", async () => {
    core = await startCore();
    expect((await core.api("POST", "/api/capabilities/capture-screen/enable", {})).status).toBe(
      200,
    );
    const socket = capture();
    expect(await socket.opened).toBe(101);
    socket.ws.send(JSON.stringify({ kind: "screen", agent_id: "user" }));
    expect((await socket.next("error")).error).toBeTruthy();
    expect(core.runtime.permissions.pendingConfirmations()).toHaveLength(0);
  });

  it("does not let an agent request device capture on a user-only socket", async () => {
    core = await startCore({}, { runtime: { visionModel: "llava", fetch: localVision } });
    await core.api("POST", "/api/capabilities/capture-screen/enable", {});
    const socket = capture();
    expect(await socket.opened).toBe(101);
    socket.ws.send(JSON.stringify({ kind: "screen", agent_id: "agent-1" }));
    expect((await socket.next("error")).error).toBeTruthy();
    expect(core.runtime.permissions.pendingConfirmations()).toHaveLength(0);
  });

  it("requires per-use approval, and refuses a denied confirmation", async () => {
    localVision.mockClear();
    const socket = await approvedScreen();
    expect(socket.confirmation.capabilityId).toBe("capture-screen");
    core!.runtime.permissions.resolveConfirmation(socket.confirmation.id, false);
    expect((await socket.next("error")).error).toBeTruthy();
    expect(localVision.mock.calls.filter(([url]) => url.endsWith("/api/chat"))).toHaveLength(0);
  });

  it("accepts exactly one approved local frame and reports its provider", async () => {
    const socket = await approvedScreen();
    core!.runtime.permissions.resolveConfirmation(socket.confirmation.id, true);
    expect((await socket.next("ready")).type).toBe("ready");
    socket.ws.send(image);
    expect(await socket.next("result")).toMatchObject({
      description: "A selected screen",
      provider: "ollama",
      locality: "local",
    });
  });

  it("revokes authorization when grant or kill switch changes, and aborts on close", async () => {
    const socket = await approvedScreen();
    core!.runtime.permissions.revoke("capture-screen", ["screen_capture"]);
    core!.runtime.permissions.resolveConfirmation(socket.confirmation.id, true);
    expect((await socket.next("error")).error).toBeTruthy();
    await core!.api("POST", "/api/capabilities/capture-screen/disable", {});
    const second = await approvedScreen();
    core!.runtime.permissions.engageKillSwitch("user");
    expect((await second.next("error")).error).toBeTruthy();
    expect(core!.runtime.permissions.pendingConfirmations()).toHaveLength(0);
  });

  it("closes pending capture and cancels confirmation when Core stops", async () => {
    const socket = await approvedScreen();
    const closed = new Promise<void>((resolve) => socket.ws.once("close", () => resolve()));
    await core!.runtime.stop();
    await closed;
    expect(core!.runtime.permissions.pendingConfirmations()).toHaveLength(0);
    core = undefined;
  });

  it("rejects additional frames while the first local request is processing", async () => {
    const response = Promise.withResolvers<Response>();
    const socket = await approvedScreen();
    const existing = localVision.getMockImplementation()!;
    localVision.mockImplementation(async (url: string, init?: RequestInit) =>
      url.endsWith("/api/chat") ? response.promise : existing(url, init),
    );
    core!.runtime.permissions.resolveConfirmation(socket.confirmation.id, true);
    await socket.next("ready");
    socket.ws.send(image);
    socket.ws.send(image);
    expect((await socket.next("error")).error).toBeTruthy();
    response.resolve(new Response(JSON.stringify({ message: { content: "ignored" } })));
    localVision.mockImplementation(existing);
  });

  it("never emits a result after client closes during local model processing", async () => {
    const response = Promise.withResolvers<Response>();
    const socket = await approvedScreen();
    const existing = localVision.getMockImplementation()!;
    localVision.mockImplementation(async (url: string, init?: RequestInit) =>
      url.endsWith("/api/chat") ? response.promise : existing(url, init),
    );
    core!.runtime.permissions.resolveConfirmation(socket.confirmation.id, true);
    await socket.next("ready");
    socket.ws.send(image);
    await vi.waitFor(() =>
      expect(localVision.mock.calls.some(([url]) => url.endsWith("/api/chat"))).toBe(true),
    );
    socket.ws.close();
    await new Promise<void>((resolve) => socket.ws.once("close", resolve));
    response.resolve(
      new Response(JSON.stringify({ message: { content: "should never be sent" } })),
    );
    expect(socket.ws.readyState).toBe(WebSocket.CLOSED);
    localVision.mockImplementation(existing);
  });

  it("rejects oversized and second frames, and clears approval on client close", async () => {
    const socket = await approvedScreen();
    socket.ws.close();
    await new Promise<void>((resolve) => socket.ws.once("close", resolve));
    await vi.waitFor(() =>
      expect(core!.runtime.permissions.pendingConfirmations()).toHaveLength(0),
    );
    const second = capture();
    expect(await second.opened).toBe(101);
    second.ws.send(JSON.stringify({ kind: "screen", agent_id: "user" }));
    await vi.waitFor(() =>
      expect(core!.runtime.permissions.pendingConfirmations()).toHaveLength(1),
    );
    core!.runtime.permissions.resolveConfirmation(
      core!.runtime.permissions.pendingConfirmations()[0]!.id,
      true,
    );
    await second.next("ready");
    second.ws.send(Buffer.alloc(8 * 1024 * 1024 + 1));
    expect((await second.next("error")).error).toBeTruthy();
  });
});
