// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

export interface Call {
  method: string;
  path: string;
  body: unknown;
}

type Handler = (body: unknown, url: URL) => unknown;

const DEFAULTS: Record<string, Handler> = {
  "GET /api/confirmations": () => ({ confirmations: [] }),
  "GET /api/capabilities": () => ({ capabilities: [] }),
  "GET /api/security/kill-switch": () => ({ engaged: false }),
  "GET /api/events": () => ({ events: [] }),
  "GET /api/notifications": () => ({ notifications: [], unread: 0 }),
};

/** A fetch stand-in routed by "METHOD /path" (query ignored). Records every call. */
export function fakeApi(routes: Record<string, Handler> = {}) {
  const calls: Call[] = [];
  const table = { ...DEFAULTS, ...routes };
  const fetchImpl = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname + url.search, body });
    // Decoded like core's router does (kage%3A1 → kage:1).
    const handler = table[`${method} ${decodeURIComponent(url.pathname)}`];
    if (!handler) {
      if (method === "POST") return new Response("{}", { status: 200 });
      return new Response(JSON.stringify({ code: "RESOURCE_NOT_FOUND", message: "Not found" }), {
        status: 404,
      });
    }
    const result = handler(body, url);
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
