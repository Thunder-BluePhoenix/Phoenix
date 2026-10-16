// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Delivers a Phase 58 step or usage report to Phoenix Core: the local relay first (Phase 57),
// loopback HTTP with the session token as the fallback, exactly like `sendReport`. Never throws.
import { resolveSessionToken } from "@phoenix/sdk";
import { trustedCoreUrl } from "./core-url";
import { relayCall, relayPreference } from "./relay/client";
import type { SendOptions, SendResult } from "./send";

export type LiveOp = "step" | "usage";

/** Same options as `sendReport`. */
export type LiveSendOptions = SendOptions;

export async function sendLive(
  op: LiveOp,
  body: unknown,
  options: LiveSendOptions = {},
): Promise<SendResult> {
  const timeoutMs = options.timeoutMs ?? 1_500;
  const viaRelay = relayPreference(options.relay, options.coreUrl);
  if (viaRelay) {
    const reply = await relayCall(op, body, { socketPath: viaRelay.socketPath, timeoutMs });
    if (reply.ok) return { ok: true };
    // The relay answered and refused: that is the result. Only "not there" falls back to HTTP.
    if (reply.kind !== "unavailable") return { ok: false, message: reply.message.slice(0, 300) };
  }
  // The address may come from the environment, which a project's agent settings can set: the
  // token is only ever sent to this machine, otherwise nothing is sent at all.
  const coreUrl = trustedCoreUrl(options.coreUrl);
  if (!coreUrl) return { ok: false, message: "Phoenix Core address is not a loopback address" };
  let token: string;
  try {
    token = resolveSessionToken(options.token);
  } catch {
    return { ok: false, message: "Phoenix Core is not running" };
  }
  try {
    const res = await fetch(`${coreUrl}/api/agent/live/${op}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return { ok: true };
    const reply = (await res.json().catch(() => null)) as { message?: unknown } | null;
    return {
      ok: false,
      message:
        typeof reply?.message === "string" ? reply.message.slice(0, 300) : `HTTP ${res.status}`,
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message.slice(0, 300) };
  }
}
