// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
// Wire types of the /api/mcp routes (see core/api/src/mcp-routes.ts) and the pure helpers the
// Settings section uses. Nothing here touches the network, the clock or storage.
import type { MessageKey } from "../i18n";

export type McpSensitivity = "public" | "internal" | "sensitive";

export interface McpMemoryGrant {
  scope: string;
  max_sensitivity: McpSensitivity;
  domains?: string[];
}

export interface McpGrants {
  tools: string[];
  memory: McpMemoryGrant[];
  request_approval: boolean;
  notify: boolean;
}

export interface McpClient {
  id: string;
  name: string;
  grants: McpGrants;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/** GET /api/mcp/status, and what POST /api/mcp/settings answers. */
export interface McpStatus {
  enabled: boolean;
  listening: boolean;
  port: number;
  url: string | null;
  kill_switch: boolean;
  clients: number;
  unavailable: boolean;
}

/** POST /api/mcp/clients. The token is shown once and lives only in component state. */
export interface McpCreatedClient {
  client: McpClient;
  token: string;
}

/** The read tools a client can be granted, in display order, with their label keys. */
export const MCP_READ_TOOLS = [
  ["phoenix_activity", "mcp.grants.tool.phoenix_activity"],
  ["phoenix_meetings", "mcp.grants.tool.phoenix_meetings"],
  ["phoenix_graph_query", "mcp.grants.tool.phoenix_graph_query"],
  ["phoenix_ci_git_state", "mcp.grants.tool.phoenix_ci_git_state"],
  ["phoenix_memory_search", "mcp.grants.tool.phoenix_memory_search"],
] as const satisfies readonly (readonly [string, MessageKey])[];

export const MCP_SENSITIVITIES = [
  ["public", "mcp.sensitivity.public"],
  ["internal", "mcp.sensitivity.internal"],
  ["sensitive", "mcp.sensitivity.sensitive"],
] as const satisfies readonly (readonly [McpSensitivity, MessageKey])[];

/** Same shape Core accepts: `*`, `global`, or repo:/path:/meeting: text, optionally ending in `*`. */
const SCOPE = /^(?:\*|global|(?:repo|path|meeting):[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}*]{0,200}\*?)$/u;

export const isValidScope = (scope: string): boolean => SCOPE.test(scope);

/** Grants are equal when they would be saved as the same thing (tool order does not matter). */
export function sameGrants(a: McpGrants, b: McpGrants): boolean {
  return (
    a.request_approval === b.request_approval &&
    a.notify === b.notify &&
    [...a.tools].sort().join(",") === [...b.tools].sort().join(",") &&
    JSON.stringify(a.memory) === JSON.stringify(b.memory)
  );
}
