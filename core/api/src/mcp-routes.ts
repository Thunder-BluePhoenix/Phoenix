// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { expectObject, route, type Route } from "./http";
import type { CoreServices } from "./services";

/** One memory scope the owner opened to a client. Same shape as ai/memory's grants, snake_case. */
export interface McpMemoryGrantView {
  scope: string;
  max_sensitivity: "public" | "internal" | "sensitive";
  domains?: string[];
}

export interface McpGrantsView {
  /** Read tools the client may call. */
  tools: string[];
  memory: McpMemoryGrantView[];
  request_approval: boolean;
  notify: boolean;
}

/** A client as listed. Never carries the token or its hash. */
export interface McpClientView {
  id: string;
  name: string;
  grants: McpGrantsView;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/** The one place a client token leaves Core: the answer to the owner who just created the client. */
export interface McpCreatedClientView {
  client: McpClientView;
  token: string;
}

export interface McpStatusView {
  enabled: boolean;
  listening: boolean;
  /** The configured port (the bound one while listening). */
  port: number;
  /** `http://127.0.0.1:<port>/mcp` while listening. */
  url: string | null;
  kill_switch: boolean;
  /** Clients that are not revoked. */
  clients: number;
  /** True inside the demo runtime, which never opens a socket. */
  unavailable: boolean;
}

/** Desktop side: session-token routes on the loopback API. The MCP listener is a different server. */
export interface McpApi {
  status(): McpStatusView;
  configure(input: unknown): Promise<McpStatusView>;
  clients(): McpClientView[];
  createClient(input: unknown): McpCreatedClientView;
  setGrants(id: string, input: unknown): McpClientView;
  revokeClient(id: string): { id: string; revoked: true };
}

export function mcpRoutes(s: CoreServices): Route[] {
  const mcp = () => {
    if (!s.mcp)
      throw new PhoenixError(ErrorCode.CAPABILITY_UNAVAILABLE, "MCP server is unavailable");
    return s.mcp;
  };
  return [
    route("GET", "/api/mcp/status", () => mcp().status()),
    route("POST", "/api/mcp/settings", async ({ body }) =>
      mcp().configure(expectObject(await body())),
    ),
    route("GET", "/api/mcp/clients", () => ({ clients: mcp().clients() })),
    route("POST", "/api/mcp/clients", async ({ body, res }) => {
      const created = mcp().createClient(expectObject(await body()));
      res.statusCode = 201;
      // The token is in this response and nowhere else, ever.
      res.setHeader("cache-control", "no-store");
      return created;
    }),
    route("POST", "/api/mcp/clients/:id/grants", async ({ params, body }) =>
      mcp().setGrants(params.id!, expectObject(await body())),
    ),
    route("DELETE", "/api/mcp/clients/:id", ({ params }) => mcp().revokeClient(params.id!)),
  ];
}
