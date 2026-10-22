// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRelayServer, MAX_FRAME_BYTES, MAX_STREAMS_PER_PEER } from "../src/server";

const ROUTE = "0123456789abcdef0123456789abcdef";
const DEVICE = "dev_0123456789ab";

/** An opaque sealed-looking frame. The relay has no key, so any well-formed one is as good as a real one. */
const frame = (sender: string, extra: Record<string, unknown> = {}) => ({
  sender,
  ephemeral_key: randomBytes(91).toString("base64"),
  iv: randomBytes(12).toString("base64"),
  ciphertext: randomBytes(64).toString("base64"),
  tag: randomBytes(16).toString("base64"),
  ...extra,
});

const servers: Server[] = [];
const aborts: AbortController[] = [];
afterEach(async () => {
  for (const abort of aborts.splice(0)) abort.abort();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
});

async function start(
  keepalive?: (beat: () => void) => () => void,
  backpressured?: (target: ServerResponse, message: string) => boolean,
) {
  const server = createRelayServer({
    ...(keepalive ? { keepalive } : {}),
    ...(backpressured ? { backpressured } : {}),
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const peerUrl = (base: string, peer: string, route = ROUTE) =>
  `${base}/v1/routes/${route}/peers/${peer}`;

const post = (url: string, body: string, headers: Record<string, string> = {}) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });

/** An open event stream plus the raw text it has delivered so far. */
async function listen(url: string) {
  const abort = new AbortController();
  aborts.push(abort);
  const response = await fetch(url, { signal: abort.signal });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  return {
    response,
    /** Reads until `needle` has arrived; a RegExp matches against everything received so far. */
    async until(needle: string | RegExp): Promise<string> {
      while (typeof needle === "string" ? !text.includes(needle) : !needle.test(text)) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += decoder.decode(chunk.value, { stream: true });
      }
      return text;
    },
    get text() {
      return text;
    },
  };
}

describe("forwarding", () => {
  it("delivers a frame byte-for-byte to the addressed peer only", async () => {
    const base = await start();
    const device = await listen(peerUrl(base, DEVICE));
    await device.until(": connected");
    const core = await listen(peerUrl(base, "core"));
    await core.until(": connected");
    const sent = frame("core");
    expect((await post(peerUrl(base, DEVICE), JSON.stringify(sent))).status).toBe(202);
    const received = await device.until(/data: .*\n\n/);
    const data = received.split("\n").find((row) => row.startsWith("data: "))!;
    expect(JSON.parse(data.slice(6))).toEqual(sent);
    expect(core.text).not.toContain("data:");
  });

  it("does not leak across routes", async () => {
    const base = await start();
    const other = await listen(peerUrl(base, DEVICE, "f".repeat(32)));
    await other.until(": connected");
    expect((await post(peerUrl(base, DEVICE), JSON.stringify(frame("core")))).status).toBe(503);
    expect(other.text).not.toContain("data:");
  });

  it("stores nothing: with nobody listening the post is refused and a late listener sees nothing", async () => {
    const base = await start();
    expect((await post(peerUrl(base, DEVICE), JSON.stringify(frame("core")))).status).toBe(503);
    const late = await listen(peerUrl(base, DEVICE));
    await late.until(": connected");
    expect(late.text).toBe(": connected\n\n");
  });

  it("fans one frame out to every stream of the same peer", async () => {
    const base = await start();
    const first = await listen(peerUrl(base, "core"));
    const second = await listen(peerUrl(base, "core"));
    await Promise.all([first.until(": connected"), second.until(": connected")]);
    expect((await post(peerUrl(base, "core"), JSON.stringify(frame(DEVICE)))).status).toBe(202);
    expect(await first.until("data: ")).toContain("data: ");
    expect(await second.until("data: ")).toContain("data: ");
  });

  it("drives the keep-alive beat from the injected hook and stops it when the stream closes", async () => {
    let beat = (): void => {};
    const stopped: number[] = [];
    const base = await start((fn) => {
      beat = fn;
      return () => stopped.push(1);
    });
    const device = await listen(peerUrl(base, DEVICE));
    await device.until(": connected");
    beat();
    expect(await device.until(": keepalive")).toContain(": keepalive");
    aborts.pop()!.abort();
    // The close handler runs on the server's next turn; a later request is served after it.
    await post(peerUrl(base, DEVICE), "{}");
    expect(stopped).toEqual([1]);
  });
});

describe("what the relay refuses", () => {
  it("answers 404 for every other path and method", async () => {
    const base = await start();
    for (const [method, path] of [
      ["GET", "/"],
      ["GET", "/v1/routes"],
      ["GET", `/v1/routes/${ROUTE}/peers/nobody`],
      ["GET", `/v1/routes/short/peers/core`],
      ["DELETE", `/v1/routes/${ROUTE}/peers/core`],
      ["PUT", `/v1/routes/${ROUTE}/peers/core`],
      ["GET", `/v1/routes/${ROUTE}/peers/core/extra`],
    ] as const) {
      const res = await fetch(base + path, { method });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });

  it("rejects malformed, extended and oversized frames without forwarding them", async () => {
    const base = await start();
    const device = await listen(peerUrl(base, DEVICE));
    await device.until(": connected");
    const url = peerUrl(base, DEVICE);
    const bad: Record<string, unknown>[] = [
      frame("core", { extra: "x" }),
      frame("core", { sender: "evil" }),
      frame("core", { iv: "not base64!" }),
      frame("core", { iv: randomBytes(8).toString("base64") }),
      frame("core", { tag: randomBytes(8).toString("base64") }),
      frame("core", { ciphertext: 7 }),
      frame("core", { ephemeral_key: "A".repeat(300) }),
    ];
    for (const body of bad) expect((await post(url, JSON.stringify(body))).status).toBe(400);
    expect((await post(url, "[1,2]")).status).toBe(400);
    expect((await post(url, "{not json")).status).toBe(400);
    expect(device.text).not.toContain("data:");
  });

  it("enforces direction: Core's frames go to devices and devices' frames go to Core", async () => {
    const base = await start();
    expect((await post(peerUrl(base, "core"), JSON.stringify(frame("core")))).status).toBe(400);
    expect((await post(peerUrl(base, DEVICE), JSON.stringify(frame(DEVICE)))).status).toBe(400);
  });

  it("lets teammates talk to teammates and keeps team addresses apart from Core and phones", async () => {
    const base = await start();
    const ana = "tm_aaaaaaaaaaaa";
    const bo = "tm_bbbbbbbbbbbb";
    const listener = await listen(peerUrl(base, bo));
    await listener.until(": connected");
    const sent = frame(ana);
    expect((await post(peerUrl(base, bo), JSON.stringify(sent))).status).toBe(202);
    await listener.until(/data: .*\n\n/);
    // A teammate cannot post to Core or a phone, and Core or a phone cannot post to a teammate.
    expect((await post(peerUrl(base, "core"), JSON.stringify(frame(ana)))).status).toBe(400);
    expect((await post(peerUrl(base, DEVICE), JSON.stringify(frame(ana)))).status).toBe(400);
    expect((await post(peerUrl(base, bo), JSON.stringify(frame("core")))).status).toBe(400);
    expect((await post(peerUrl(base, bo), JSON.stringify(frame(DEVICE)))).status).toBe(400);
    // Only the exact shape is an address.
    for (const peer of [
      "tm_AAAAAAAAAAAA",
      "tm_aaaaaaaaaaa",
      "tm_aaaaaaaaaaaaa",
      "team_aaaaaaaaaaaa",
    ])
      expect((await fetch(peerUrl(base, peer))).status).toBe(404);
  });

  it("requires JSON and caps the body", async () => {
    const base = await start();
    const url = peerUrl(base, DEVICE);
    const text = await fetch(url, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(frame("core")),
    });
    expect(text.status).toBe(415);
    const big = JSON.stringify(frame("core", { ciphertext: "A".repeat(MAX_FRAME_BYTES + 1) }));
    expect((await post(url, big)).status).toBe(413);
  });

  it("limits streams per peer", async () => {
    const base = await start();
    for (let i = 0; i < MAX_STREAMS_PER_PEER; i++) {
      const open = await listen(peerUrl(base, DEVICE));
      expect(open.response.status).toBe(200);
    }
    expect((await fetch(peerUrl(base, DEVICE))).status).toBe(503);
    // Another peer of the same route is unaffected.
    expect((await listen(peerUrl(base, "core"))).response.status).toBe(200);
  });

  it("drops a backpressured stream instead of buffering frames without limit", async () => {
    // A stalled peer reports backpressure on its first data frame; the relay must close the stream.
    const base = await start(undefined, (_target, message) => message.startsWith("data:"));
    const device = await listen(peerUrl(base, DEVICE));
    await device.until(": connected");
    expect((await post(peerUrl(base, DEVICE), JSON.stringify(frame("core")))).status).toBe(202);
    await vi.waitFor(async () => {
      expect((await post(peerUrl(base, DEVICE), JSON.stringify(frame("core")))).status).toBe(503);
    });
  });

  it("re-serialises frames so embedded newlines cannot forge a second event", async () => {
    const base = await start();
    const device = await listen(peerUrl(base, DEVICE));
    await device.until(": connected");
    const body = `{"sender":"core",\n"ephemeral_key":"AAAA",\n"iv":"${randomBytes(12).toString("base64")}",\n"tag":"${randomBytes(16).toString("base64")}",\n"ciphertext":"AAAA"}`;
    expect((await post(peerUrl(base, DEVICE), body)).status).toBe(202);
    const text = await device.until(/data: .*\n\n/);
    expect(text.split("\n\n").filter((part) => part.includes("data: "))).toHaveLength(1);
    expect(text).not.toContain('"core",\n');
  });
});

describe("statelessness by construction", () => {
  it("imports no crypto, filesystem or persistence module, so it cannot hold a key or a log", () => {
    const source = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    expect(imports).toEqual(["node:http"]);
    expect(source).not.toMatch(/console\.|writeFile|createDecipher|createCipher|process\.env/);
  });
});
