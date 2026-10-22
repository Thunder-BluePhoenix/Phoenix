// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phoenix MCP stdio bridge. Many MCP clients start a server as a child process and speak
// newline-delimited JSON-RPC on stdin/stdout. This script reads those lines, forwards each one to
// Phoenix's local MCP endpoint (POST http://127.0.0.1:<port>/mcp) and writes the reply as one line.
//
//   PHOENIX_MCP_TOKEN   the client token shown once in Settings (read from the environment, never argv)
//   PHOENIX_MCP_URL     optional, default http://127.0.0.1:47822/mcp; must be a loopback http URL
//
// The token is never printed. Plain Node, no dependencies.
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

export const DEFAULT_URL = "http://127.0.0.1:47822/mcp";
const MAX_LINE_CHARS = 64 * 1024;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

/** The endpoint, or throws when it is not plain-http loopback (the token must not leave this computer). */
export function endpointFrom(raw) {
  const url = new URL(raw ?? DEFAULT_URL);
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname) || url.pathname !== "/mcp")
    throw new Error(
      "PHOENIX_MCP_URL must be http://127.0.0.1:<port>/mcp or http://localhost:<port>/mcp",
    );
  return url.toString();
}

const errorLine = (id, code, message) =>
  JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });

/** The id of a JSON-RPC request line, or null when it has none (a notification) or cannot be read. */
function requestId(parsed) {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const id = parsed.id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

/**
 * Forwards one stdin line. Returns the line to write to stdout, or null for nothing (a notification
 * the server accepted with 202). Never throws and never includes the token.
 */
export async function forwardLine(line, { token, url, fetchImpl }) {
  if (line.length > MAX_LINE_CHARS) return errorLine(null, -32600, "Message too large");
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return errorLine(null, -32700, "Parse error");
  }
  const id = requestId(parsed);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      // A redirect would replay the bearer token at whatever address it names: refuse it.
      redirect: "error",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: line,
    });
  } catch {
    return id === null ? null : errorLine(id, -32603, "Phoenix is not reachable");
  }
  if (response.status === 202) return null;
  const text = await response.text();
  try {
    // Re-serialised so the line is guaranteed to be one JSON value on one line.
    return JSON.stringify(JSON.parse(text));
  } catch {
    return id === null ? null : errorLine(id, -32603, `Phoenix answered HTTP ${response.status}`);
  }
}

/** Runs the bridge until `input` ends. Lines are handled in order, one at a time. */
export async function runBridge({ input, output, env, fetchImpl = fetch }) {
  const token = env.PHOENIX_MCP_TOKEN;
  if (!token) throw new Error("PHOENIX_MCP_TOKEN is not set");
  const url = endpointFrom(env.PHOENIX_MCP_URL);
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim().length === 0) continue;
    const reply = await forwardLine(line, { token, url, fetchImpl });
    if (reply !== null) output.write(`${reply}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBridge({ input: process.stdin, output: process.stdout, env: process.env }).catch((err) => {
    process.stderr.write(`phoenix-mcp-stdio: ${err.message}\n`);
    process.exitCode = 1;
  });
}
