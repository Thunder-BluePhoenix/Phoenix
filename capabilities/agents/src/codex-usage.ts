// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 58: Codex plan usage through the one documented source, `account/rateLimits/read` of
// `codex app-server` (https://developers.openai.com/codex/app-server; result schema
// openai/codex codex-rs/app-server-protocol/schema/json/v2/GetAccountRateLimitsResponse.json).
//
// This runs ONLY when the user runs `phoenix-agent codex-usage`: nothing starts Codex in the
// background and no hook triggers it. The conversation is the documented stdio one (newline-delimited
// JSON-RPC): `initialize` (no `experimentalApi`, so only the stable surface), the `initialized`
// notification, one read-only `account/rateLimits/read`, then the process is stopped. Phoenix never
// reads Codex's credentials (Codex reads its own), sends no prompt, thread or turn, and keeps only
// the percentages, reset times and the reset-credit count (`mapCodexRateLimits`).
//
// UNVERIFIED: `codex` is not installed where this was written, so the real process was never run.
// The Codex documentation calls the app-server command experimental and not supported for production
// workloads, so this may break with a Codex update; the transport is an injected seam for that reason.
import { spawn } from "node:child_process";
import { isRecord } from "./guards";
import { mapCodexRateLimits, type UsageSample } from "./usage";

/** The documented stdio transport: write one JSON line, read JSON lines, stop the process. */
export interface AppServerSession {
  write(line: string): void;
  lines: AsyncIterable<string>;
  close(): void;
}
export type AppServerLauncher = () => AppServerSession;

export const CODEX_USAGE_TIMEOUT_MS = 10_000;
const MAX_LINE = 1_000_000;
const MAX_LINES = 200;

export type CodexUsageResult =
  { ok: true; samples: UsageSample[] } | { ok: false; message: string };

/** The default launcher: `codex app-server` over stdio, argv only (no shell). */
export const spawnCodexAppServer: AppServerLauncher = () => {
  const child = spawn("codex", ["app-server", "--listen", "stdio://"], {
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
  });
  const failed = Promise.withResolvers<never>();
  child.on("error", (err) => failed.reject(err));
  async function* lines(): AsyncGenerator<string> {
    let buffer = "";
    const next = (async function* () {
      for await (const chunk of child.stdout) yield chunk as Buffer;
    })();
    while (true) {
      const step = await Promise.race([next.next(), failed.promise]);
      if (step.done) return;
      buffer += step.value.toString("utf8");
      if (buffer.length > MAX_LINE) throw new Error("app-server line is too long");
      let at = buffer.indexOf("\n");
      while (at >= 0) {
        yield buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        at = buffer.indexOf("\n");
      }
    }
  }
  return {
    write: (line) => void child.stdin.write(line + "\n"),
    lines: lines(),
    close: () => void child.kill(),
  };
};

const FAILED = "Codex did not answer the rate-limit request";

/**
 * One `account/rateLimits/read` exchange. Never throws; the session is always closed. A response
 * is accepted only for the id it was sent with, and an `error` reply or a timeout is a failure.
 */
export async function readCodexRateLimits(
  launch: AppServerLauncher = spawnCodexAppServer,
  options: { nowMs?: number; timeoutMs?: number } = {},
): Promise<CodexUsageResult> {
  const nowMs = options.nowMs ?? Date.now();
  let session: AppServerSession | undefined;
  let timer: NodeJS.Timeout | undefined;
  const run = (async (): Promise<CodexUsageResult> => {
    session = launch();
    const send = (message: unknown) => session!.write(JSON.stringify(message));
    send({
      method: "initialize",
      id: 0,
      params: { clientInfo: { name: "phoenix_agent", title: "Phoenix", version: "1.0.0" } },
    });
    let seen = 0;
    let readSent = false;
    for await (const line of session.lines) {
      if (++seen > MAX_LINES || line.length > MAX_LINE) return { ok: false, message: FAILED };
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        continue; // not a JSON-RPC line (logs): ignored
      }
      if (!isRecord(message) || typeof message.id !== "number") continue; // notifications
      if (isRecord(message.error)) {
        const code = typeof message.error.code === "number" ? ` (error ${message.error.code})` : "";
        return { ok: false, message: `${FAILED}${code}` };
      }
      if (message.id === 0 && !readSent) {
        readSent = true;
        send({ method: "initialized", params: {} });
        send({ method: "account/rateLimits/read", id: 1 });
      } else if (message.id === 1) {
        return { ok: true, samples: mapCodexRateLimits(message.result, nowMs) };
      }
    }
    return { ok: false, message: FAILED };
  })();
  const deadline = Promise.withResolvers<CodexUsageResult>();
  timer = setTimeout(
    () => deadline.resolve({ ok: false, message: `${FAILED} within the time limit` }),
    options.timeoutMs ?? CODEX_USAGE_TIMEOUT_MS,
  );
  try {
    return await Promise.race([run, deadline.promise]);
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
    return { ok: false, message: missing ? "codex was not found on PATH" : FAILED };
  } finally {
    clearTimeout(timer);
    try {
      session?.close();
    } catch {
      // already gone
    }
  }
}

export interface CodexUsageBody {
  agent: "codex";
  samples: Array<Pick<UsageSample, "window" | "used_pct" | "resets_at" | "reset_credits">>;
}

/** The body for `sendLive("usage", …)`: Core validates it again and stamps its own clock. */
export function codexUsageBody(samples: readonly UsageSample[]): CodexUsageBody {
  return {
    agent: "codex",
    samples: samples.map(({ window, used_pct, resets_at, reset_credits }) => ({
      window,
      used_pct,
      resets_at,
      ...(reset_credits === undefined ? {} : { reset_credits }),
    })),
  };
}
