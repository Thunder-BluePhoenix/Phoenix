// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { browserAssistRoutes, type BrowserAssistApi } from "../src/browser-assist-routes";
import { matchRoute, sendError, sendJson, type Route } from "../src/http";

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
});

/** The same dispatch as ApiServer.onRequest for what matters here: route match, body, sendError. */
async function serve(routes: Route[]): Promise<string> {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const { route, params } = matchRoute(routes, req.method ?? "GET", url.pathname);
      const result = await route!.handler({
        req,
        res,
        url,
        params,
        body: async () => ({ goal: "x" }),
      });
      sendJson(res, 200, result);
    } catch (error) {
      sendError(res, error);
    }
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const post = (base: string, signal?: AbortSignal) =>
  fetch(`${base}/api/browser/assist`, { method: "POST", signal });

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 300 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
}

describe("browserAssistRoutes cap", () => {
  it("frees the slot after the service throws", async () => {
    let calls = 0;
    const service: BrowserAssistApi = {
      assist: () => {
        calls += 1;
        return Promise.reject(new Error("boom"));
      },
    };
    const base = await serve(browserAssistRoutes(service));
    expect((await post(base)).status).toBe(500);
    expect((await post(base)).status).toBe(500);
    expect(calls).toBe(2);
  });

  it("frees the slot after the client aborts a call that then throws", async () => {
    let started = 0;
    const service: BrowserAssistApi = {
      assist: (_input, signal) => {
        started += 1;
        if (started > 1) return Promise.resolve({ status: "ok" });
        return new Promise((_ok, reject) =>
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
        );
      },
    };
    const base = await serve(browserAssistRoutes(service));
    const client = new AbortController();
    const first = post(base, client.signal).catch(() => undefined);
    await until(() => started === 1);
    expect((await post(base)).status).toBe(429);
    client.abort();
    await first;
    await until(() => started === 1);
    let status = 0;
    for (let i = 0; i < 100 && status !== 200; i++) {
      status = (await post(base)).status;
      if (status !== 200) await new Promise((r) => setTimeout(r, 10));
    }
    expect(status).toBe(200);
  });

  it("answers 504 after the deadline, aborts the service and frees the slot", async () => {
    let aborted = false;
    let calls = 0;
    const service: BrowserAssistApi = {
      assist: (_input, signal) => {
        calls += 1;
        if (calls > 1) return Promise.resolve({ status: "ok" });
        signal?.addEventListener("abort", () => (aborted = true), { once: true });
        return new Promise(() => undefined);
      },
    };
    const base = await serve(browserAssistRoutes(service, { deadlineMs: 50 }));
    const res = await post(base);
    expect(res.status).toBe(504);
    expect(((await res.json()) as { code: string }).code).toBe("OPERATION_TIMEOUT");
    expect(aborted).toBe(true);
    expect((await post(base)).status).toBe(200);
  });

  it("each routes instance has its own count", async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let started = 0;
    const slow: BrowserAssistApi = {
      assist: async () => {
        started += 1;
        await held;
        return { status: "ok" };
      },
    };
    const a = await serve(browserAssistRoutes(slow));
    const b = await serve(browserAssistRoutes({ assist: () => Promise.resolve({ status: "ok" }) }));
    const first = post(a);
    await until(() => started === 1);
    expect((await post(a)).status).toBe(429);
    expect((await post(b)).status).toBe(200);
    release();
    expect((await first).status).toBe(200);
  });
});
