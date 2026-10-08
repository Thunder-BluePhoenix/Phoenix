// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Delivers an AgentReport to Phoenix Core's `agents` capability, the same way
// `phoenix run` reports to the terminal capability (session token, loopback API).
import { DEFAULT_CORE_URL, resolveSessionToken } from "@phoenix/sdk";
import type { AgentReport } from "./report";

export type SendResult = { ok: true } | { ok: false; message: string };

export interface SendOptions {
  /** Default: $PHOENIX_CORE_URL or http://127.0.0.1:4870. */
  coreUrl?: string;
  /** Default: found like every Phoenix client (env, data dir, ~/.phoenix). */
  token?: string;
  /** Per-request budget; hooks must never hold an agent up. */
  timeoutMs?: number;
}

/** Never throws: Core being down, slow, or refusing is reported in the result. */
export async function sendReport(
  report: AgentReport,
  options: SendOptions = {},
): Promise<SendResult> {
  let token: string;
  try {
    token = resolveSessionToken(options.token);
  } catch {
    return { ok: false, message: "Phoenix Core is not running" };
  }
  const coreUrl = (options.coreUrl ?? process.env.PHOENIX_CORE_URL ?? DEFAULT_CORE_URL).replace(
    /\/$/,
    "",
  );
  try {
    const res = await fetch(`${coreUrl}/api/capabilities/agents/commands/report`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ input: report }),
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? 1_500),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
    return {
      ok: false,
      message:
        typeof body?.message === "string" ? body.message.slice(0, 300) : `HTTP ${res.status}`,
    };
  } catch (err) {
    return { ok: false, message: (err as Error).message.slice(0, 300) };
  }
}
