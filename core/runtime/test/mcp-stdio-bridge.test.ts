// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The stdio bridge script (scripts/mcp/phoenix-mcp-stdio.mjs): newline-delimited JSON-RPC on stdin,
// forwarded to the MCP endpoint, replies on stdout. Driven in-process with in-memory streams; the
// "real loopback" case uses a real Core listener, and the client is a SIMULATED one.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error the bridge is plain ESM JavaScript, run as its own process by MCP clients
import { endpointFrom, forwardLine, runBridge } from "../../../scripts/mcp/phoenix-mcp-stdio.mjs";
import { startCore, type TestCore } from "./helpers";

interface Forward {
  (
    line: string,
    deps: { token: string; url: string; fetchImpl: typeof fetch },
  ): Promise<string | null>;
}
const forward = forwardLine as Forward;

const cores: TestCore[] = [];
afterEach(async () => {
  for (const core of cores.splice(0).reverse()) await core.runtime.stop();
});

const TOKEN = ["pmcp", "_", "x".repeat(43)].join("");
const URL_OK = "http://127.0.0.1:47822/mcp";

function fakeFetch(respond: (init: RequestInit) => Response | Error) {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    const out = respond(init);
    if (out instanceof Error) throw out;
    return out;
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}

describe("endpoint", () => {
  it("accepts only plain-http loopback /mcp URLs, so the token cannot be sent off this computer", () => {
    expect(endpointFrom(undefined)).toBe(URL_OK);
    expect(endpointFrom("http://localhost:5000/mcp")).toBe("http://localhost:5000/mcp");
    for (const bad of [
      "https://127.0.0.1:47822/mcp",
      "http://192.168.1.5:47822/mcp",
      "http://example.com/mcp",
      "http://127.0.0.1.evil.example/mcp",
      "http://127.0.0.1:47822/other",
      "http://user:pw@evil.example/mcp",
    ]) {
      expect(() => endpointFrom(bad), bad).toThrow(/loopback|PHOENIX_MCP_URL/);
    }
  });
});

describe("forwardLine", () => {
  it("sends the token as a bearer header and the line as the body, never anywhere else", async () => {
    const { fetchImpl, seen } = fakeFetch(
      () => new Response('{"jsonrpc":"2.0","id":1,"result":{}}', { status: 200 }),
    );
    const line = '{"jsonrpc":"2.0","id":1,"method":"ping"}';
    const reply = await forward(line, { token: TOKEN, url: URL_OK, fetchImpl });
    expect(reply).toBe('{"jsonrpc":"2.0","id":1,"result":{}}');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe(URL_OK);
    expect(seen[0]!.init.body).toBe(line);
    expect(seen[0]!.init.headers).toMatchObject({ authorization: `Bearer ${TOKEN}` });
  });

  it("writes nothing for a notification the server accepted", async () => {
    const { fetchImpl } = fakeFetch(() => new Response(null, { status: 202 }));
    expect(
      await forward('{"jsonrpc":"2.0","method":"notifications/initialized"}', {
        token: TOKEN,
        url: URL_OK,
        fetchImpl,
      }),
    ).toBeNull();
  });

  it("turns an unreachable Phoenix into a JSON-RPC error for the request id, without the token", async () => {
    const { fetchImpl } = fakeFetch(() => new Error(`connect refused ${TOKEN}`));
    const reply = await forward('{"jsonrpc":"2.0","id":7,"method":"ping"}', {
      token: TOKEN,
      url: URL_OK,
      fetchImpl,
    });
    expect(JSON.parse(reply!)).toMatchObject({ id: 7, error: { code: -32603 } });
    expect(reply).not.toContain(TOKEN);
  });

  it("answers parse errors and oversize lines itself and never forwards them", async () => {
    const { fetchImpl, seen } = fakeFetch(() => new Response("{}", { status: 200 }));
    expect(
      JSON.parse((await forward("{nope", { token: TOKEN, url: URL_OK, fetchImpl }))!).error.code,
    ).toBe(-32700);
    const big = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
      params: { pad: "x".repeat(70_000) },
    });
    expect(
      JSON.parse((await forward(big, { token: TOKEN, url: URL_OK, fetchImpl }))!).error.code,
    ).toBe(-32600);
    expect(seen).toHaveLength(0);
  });

  it("does not echo a non-JSON error page from the server", async () => {
    const { fetchImpl } = fakeFetch(() => new Response(`<html>${TOKEN}</html>`, { status: 502 }));
    const reply = await forward('{"jsonrpc":"2.0","id":3,"method":"ping"}', {
      token: TOKEN,
      url: URL_OK,
      fetchImpl,
    });
    expect(JSON.parse(reply!)).toMatchObject({
      id: 3,
      error: { message: "Phoenix answered HTTP 502" },
    });
  });

  it("refuses a redirect instead of following it, so the token is never replayed elsewhere", async () => {
    const hits: string[] = [];
    const target = createServer((req, res) => {
      hits.push(`${req.headers.authorization ?? ""}`);
      res.end("{}");
    });
    const { promise: targetUp, resolve: targetListening } = Promise.withResolvers<void>();
    target.listen(0, "127.0.0.1", () => targetListening());
    await targetUp;
    const targetPort = (target.address() as AddressInfo).port;
    const redirector = createServer((_req, res) => {
      res.writeHead(307, { location: `http://127.0.0.1:${targetPort}/mcp` });
      res.end();
    });
    const { promise: redirectorUp, resolve: redirectorListening } = Promise.withResolvers<void>();
    redirector.listen(0, "127.0.0.1", () => redirectorListening());
    await redirectorUp;
    try {
      const url = `http://127.0.0.1:${(redirector.address() as AddressInfo).port}/mcp`;
      const reply = await forward('{"jsonrpc":"2.0","id":9,"method":"ping"}', {
        token: TOKEN,
        url,
        fetchImpl: fetch,
      });
      expect(JSON.parse(reply!)).toMatchObject({ id: 9, error: { code: -32603 } });
      expect(reply).not.toContain(TOKEN);
      expect(hits).toEqual([]);
    } finally {
      redirector.close();
      target.close();
    }
  });

  it("asks fetch to refuse redirects", async () => {
    const { fetchImpl, seen } = fakeFetch(() => new Response("{}", { status: 200 }));
    await forward('{"jsonrpc":"2.0","id":1,"method":"ping"}', {
      token: TOKEN,
      url: URL_OK,
      fetchImpl,
    });
    expect(seen[0]!.init.redirect).toBe("error");
  });
});

describe("runBridge", () => {
  it("refuses to start without a token", async () => {
    await expect(
      runBridge({ input: new PassThrough(), output: new PassThrough(), env: {} }),
    ).rejects.toThrow(/PHOENIX_MCP_TOKEN/);
  });

  it("talks to a real Core over loopback HTTP: initialize, tools/list, a granted tool, one reply per line, in order", async () => {
    const core = await startCore({}, { runtime: { mcp: { port: 0 } } });
    cores.push(core);
    const port = (await core.api("POST", "/api/mcp/settings", { enabled: true })).json
      .port as number;
    const made = await core.api("POST", "/api/mcp/clients", { name: "Bridge" });
    await core.api("POST", `/api/mcp/clients/${made.json.client.id}/grants`, {
      tools: ["phoenix_activity"],
      memory: [],
      request_approval: false,
      notify: false,
    });

    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (c: Buffer) => chunks.push(c.toString("utf8")));
    const done = runBridge({
      input,
      output,
      env: { PHOENIX_MCP_TOKEN: made.json.token, PHOENIX_MCP_URL: `http://127.0.0.1:${port}/mcp` },
    });
    const send = (m: object) => input.write(`${JSON.stringify(m)}\n`);
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "phoenix_activity", arguments: {} },
    });
    send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "phoenix_notify", arguments: { state: "done" } },
    });
    input.end();
    await done;

    const replies = chunks
      .join("")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { id: number; result?: unknown; error?: { message: string } });
    expect(replies.map((r) => r.id)).toEqual([1, 2, 3, 4]);
    expect(replies[0]!.result).toMatchObject({ serverInfo: { name: "phoenix" } });
    expect(replies[1]!.result).toMatchObject({ tools: [{ name: "phoenix_activity" }] });
    expect(JSON.stringify(replies[2]!.result)).toContain("untrusted_data");
    expect(replies[3]!.error?.message).toBe("Unknown tool");
  });
});
