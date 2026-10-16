// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

export interface Call {
  method: string;
  path: string;
  body: unknown;
}

type Handler = (body: unknown, url: URL) => unknown;

/** What `fakeApi` hands to a test: the fetch stand-in, every recorded call and route helpers. */
export interface FakeApi {
  fetchImpl: typeof fetch;
  calls: Call[];
  posts(path: string): Call[];
  set(route: string, handler: Handler): void;
}

const DEFAULTS: Record<string, Handler> = {
  "GET /api/confirmations": () => ({ confirmations: [] }),
  "GET /api/capabilities": () => ({ capabilities: [] }),
  "GET /api/security/kill-switch": () => ({ engaged: false }),
  "GET /api/events": () => ({ events: [] }),
  "GET /api/notifications": () => ({ notifications: [], unread: 0 }),
  "GET /api/agent-approvals": () => ({ approvals: [] }),
  "GET /api/agent-approvals/rules": () => ({ rules: [] }),
  "GET /api/agent-relay/agents": () => ({
    relay: { running: false, version: 1, platform: "test" },
    agents: [],
  }),
  "GET /api/agent/usage": () => ({ usage: [], thresholds: [80, 95], unsupported: [] }),
  "GET /api/agent/sessions": () => ({ sessions: [] }),
};

/** A fetch stand-in routed by "METHOD /path" (query ignored). Records every call. */
export function fakeApi(routes: Record<string, Handler> = {}): FakeApi {
  const calls: Call[] = [];
  const table = { ...DEFAULTS, ...routes };
  const fetchImpl = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname + url.search, body });
    // Decoded like core's router does (kage%3A1 → kage:1).
    const path = decodeURIComponent(url.pathname);
    // A trailing "/*" key serves every path directly under that prefix (one segment).
    const handler =
      table[`${method} ${path}`] ?? table[`${method} ${path.slice(0, path.lastIndexOf("/"))}/*`];
    if (!handler) {
      if (method === "POST") return new Response("{}", { status: 200 });
      return new Response(JSON.stringify({ code: "RESOURCE_NOT_FOUND", message: "Not found" }), {
        status: 404,
      });
    }
    const result = await handler(body, url);
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result ?? {}), { status: 200 });
  }) as unknown as typeof fetch;
  return {
    fetchImpl,
    calls,
    posts: (path: string) => calls.filter((c) => c.method === "POST" && c.path === path),
    set(route: string, handler: Handler) {
      table[route] = handler;
    },
  };
}
