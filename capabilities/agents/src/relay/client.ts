// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 57: the hook side of the local relay. One request, one reply, never throws.
import { connect } from "node:net";
import { isRecord } from "../guards";
import { relaySocketPath, RELAY_VERSION, resolveRelaySocket, type RelayOp } from "./protocol";
import { untrustedSocketReason } from "./socket-trust";

/** A reply longer than this is not from a Phoenix Core. */
const MAX_REPLY_BYTES = 2 * 1_048_576;

/**
 * `unavailable`: could not connect, timed out, or the connection closed without a reply (the caller
 * may fall back to another transport). `rejected`: the relay answered ok:false. `protocol`: the
 * answer was unparsable, oversized, or from another protocol version.
 */
export type RelayReply =
  | { ok: true; result: unknown }
  | { ok: false; kind: "unavailable" | "rejected" | "protocol"; code?: string; message: string };

export interface RelayCallOptions {
  /** Default: $PHOENIX_RELAY_SOCKET, else the socket under `dataDir`/the default data directory. */
  socketPath?: string;
  /** Covers connecting, sending, and waiting for the reply. */
  timeoutMs: number;
  dataDir?: string;
}

/**
 * Whether a hook should try the relay before HTTP, and where. An explicit HTTP target (a `coreUrl`
 * option or $PHOENIX_CORE_URL) wins unless the caller also chose the relay explicitly (a `relay`
 * object or $PHOENIX_RELAY_SOCKET). Returns null when the relay must not be used.
 */
export function relayPreference(
  relay: false | { socketPath?: string } | undefined,
  coreUrl: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { socketPath?: string } | null {
  if (relay === false) return null;
  const explicitRelay = relay !== undefined || Boolean(env.PHOENIX_RELAY_SOCKET);
  const explicitHttp = coreUrl !== undefined || Boolean(env.PHOENIX_CORE_URL);
  if (explicitHttp && !explicitRelay) return null;
  return relay ?? {};
}

export async function relayCall(
  op: RelayOp,
  body: unknown,
  options: RelayCallOptions,
): Promise<RelayReply> {
  const path =
    options.socketPath ??
    (options.dataDir ? relaySocketPath(options.dataDir) : resolveRelaySocket());
  // An untrusted path is "not there": the caller falls back to loopback HTTP.
  const untrusted = untrustedSocketReason(path);
  if (untrusted !== null) {
    return { ok: false, kind: "unavailable", message: `refusing the relay socket: ${untrusted}` };
  }
  const done = Promise.withResolvers<RelayReply>();
  const chunks: Buffer[] = [];
  let received = 0;
  const socket = connect(path);
  // setTimeout, not AbortSignal.timeout: the deadline must follow an injected clock in tests.
  const timer = setTimeout(() => {
    done.resolve({ ok: false, kind: "unavailable", message: `no reply from ${path} in time` });
    socket.destroy();
  }, options.timeoutMs);

  socket.on("connect", () => {
    socket.write(`${JSON.stringify({ v: RELAY_VERSION, op, body })}\n`);
  });
  socket.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (received > MAX_REPLY_BYTES) {
      done.resolve({ ok: false, kind: "protocol", message: "relay reply is too large" });
      socket.destroy();
      return;
    }
    chunks.push(chunk);
  });
  socket.on("error", (err) => {
    done.resolve({
      ok: false,
      kind: "unavailable",
      message: `cannot reach ${path}: ${err.message}`,
    });
  });
  socket.on("close", () => {
    done.resolve(parseReply(Buffer.concat(chunks).toString("utf8"), path));
  });

  try {
    return await done.promise;
  } finally {
    clearTimeout(timer);
    socket.destroy();
  }
}

function parseReply(text: string, path: string): RelayReply {
  const line = text.split("\n", 1)[0] ?? "";
  if (line === "") {
    return { ok: false, kind: "unavailable", message: `${path} closed without a reply` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { ok: false, kind: "protocol", message: "relay reply is not valid JSON" };
  }
  if (!isRecord(parsed) || parsed.v !== RELAY_VERSION || typeof parsed.ok !== "boolean") {
    return {
      ok: false,
      kind: "protocol",
      message: "relay reply has an unexpected shape or version",
    };
  }
  if (parsed.ok) return { ok: true, result: parsed.result };
  const error = isRecord(parsed.error) ? parsed.error : {};
  return {
    ok: false,
    kind: "rejected",
    code: typeof error.code === "string" ? error.code : undefined,
    message:
      typeof error.message === "string" ? error.message.slice(0, 300) : "relay refused the request",
  };
}
