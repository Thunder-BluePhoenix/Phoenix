// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 57: asks the relay whether Phoenix Core is answering, for `phoenix` diagnostics and installers.
import { relayCall } from "./client";
import { RELAY_VERSION, resolveRelaySocket } from "./protocol";
import { isRecord } from "../guards";

export interface SelfTestOptions {
  socketPath?: string;
  timeoutMs?: number;
}

export interface SelfTestResult {
  pass: boolean;
  v?: number;
  coreVersion?: string;
  socket: string;
  message: string;
}

export async function runSelfTest(options: SelfTestOptions = {}): Promise<SelfTestResult> {
  const socket = options.socketPath ?? resolveRelaySocket();
  const reply = await relayCall(
    "ping",
    {},
    { socketPath: socket, timeoutMs: options.timeoutMs ?? 1_500 },
  );
  if (!reply.ok) return { pass: false, socket, message: `no relay at ${socket}: ${reply.message}` };
  const result = isRecord(reply.result) ? reply.result : {};
  const v = typeof result.v === "number" ? result.v : undefined;
  const coreVersion = typeof result.core_version === "string" ? result.core_version : undefined;
  if (v !== RELAY_VERSION) {
    return {
      pass: false,
      v,
      coreVersion,
      socket,
      message: `relay at ${socket} speaks v${String(result.v)}, expected v${RELAY_VERSION}`,
    };
  }
  return {
    pass: true,
    v,
    coreVersion,
    socket,
    message: `relay v${v} answered${coreVersion ? ` (Core ${coreVersion})` : ""}`,
  };
}
