// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The little of JSON-RPC 2.0 and MCP (revision 2025-06-18) that Phoenix's MCP server speaks, written
// by hand: no SDK. Only `initialize`, `notifications/initialized`, `tools/list`, `tools/call` and
// `ping` exist; everything else is `-32601`.

import { isRecord } from "./guards";

export const JSONRPC_VERSION = "2.0";
/** Newest first. The server answers `initialize` with the client's version if listed, else the first. */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const MAX_ID_CHARS = 200;

export const RpcCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  /** Phoenix: the tool does not exist for this client (unknown and ungranted look the same). */
  NOT_AVAILABLE: -32001,
  /** Phoenix: the client was revoked or lost the grant while the call ran. */
  REVOKED: -32002,
  /** Phoenix: the client is calling too fast, or has too many calls in flight. */
  RATE_LIMITED: -32003,
} as const;

export type RpcId = string | number;

export type RpcMessage =
  | { kind: "request"; id: RpcId; method: string; params: Record<string, unknown> }
  | { kind: "notification"; method: string }
  | { kind: "response" }
  | { kind: "invalid"; id: RpcId | null; message: string };

/** Sorts one parsed JSON body into a request, a notification, a stray response or garbage. */
export function classify(body: unknown): RpcMessage {
  if (Array.isArray(body))
    return { kind: "invalid", id: null, message: "Batch requests are not supported" };
  if (!isRecord(body)) return { kind: "invalid", id: null, message: "Not a JSON-RPC message" };
  const { id, method, params } = body;
  const goodId =
    typeof id === "string"
      ? id.length > 0 && id.length <= MAX_ID_CHARS
      : typeof id === "number" && Number.isSafeInteger(id);
  const replyId: RpcId | null = goodId ? (id as RpcId) : null;
  if (body.jsonrpc !== JSONRPC_VERSION)
    return { kind: "invalid", id: replyId, message: '"jsonrpc" must be "2.0"' };
  if (method === undefined && (body.result !== undefined || body.error !== undefined))
    return { kind: "response" };
  if (typeof method !== "string" || method.length === 0 || method.length > 100)
    return { kind: "invalid", id: replyId, message: '"method" must be a string' };
  if (params !== undefined && !isRecord(params))
    return { kind: "invalid", id: replyId, message: '"params" must be an object' };
  if (id === undefined) return { kind: "notification", method };
  if (!goodId) return { kind: "invalid", id: null, message: '"id" must be a string or integer' };
  return { kind: "request", id: id as RpcId, method, params: params ?? {} };
}

export const rpcResult = (id: RpcId, result: unknown) => ({
  jsonrpc: JSONRPC_VERSION,
  id,
  result,
});

export const rpcError = (id: RpcId | null, code: number, message: string) => ({
  jsonrpc: JSONRPC_VERSION,
  id,
  error: { code, message },
});

/** What a transport sends back for one HTTP request. `body` absent = no content (a notification). */
export interface McpReply {
  status: number;
  body?: unknown;
  retryAfterSeconds?: number;
  /** Send `WWW-Authenticate: Bearer`. */
  challenge?: true;
}
