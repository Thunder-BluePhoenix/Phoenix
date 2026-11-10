// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { route, sendJson, type Route } from "./http";

/** Calls that may run a local model at once, per Core. */
export const ASSIST_MAX_IN_FLIGHT = 1;
/**
 * One call may hold its slot at most this long (a little over the Ollama adapter's own 120 s generate
 * timeout). After it the call is aborted and answered 504, so a hung model or page read cannot lock
 * the assistant for good.
 */
export const ASSIST_DEADLINE_MS = 130_000;

/**
 * Session-token route for the Fawkes browsing assistant (Phase 95). The person's goal and the active
 * page go to an on-device model only; the answer is a PROPOSED plan (data). Nothing here runs an
 * action: each step is run through `POST /api/capabilities/browser/commands/<kind>`, which asks for
 * the person's approval.
 *
 * Each call runs a local model, so an unbounded burst could exhaust the machine: at most
 * `maxInFlight` calls run at once per Core (the count lives in this closure, and `buildRoutes` makes
 * one per Core). Another call is refused at once with 429 + `Retry-After`, not queued. The slot is
 * released in `finally` on every path: answer, model error, client abort and the deadline.
 */
export interface BrowserAssistApi {
  assist(input: unknown, signal?: AbortSignal): Promise<unknown>;
}

export interface BrowserAssistRouteOptions {
  maxInFlight?: number;
  deadlineMs?: number;
}

export function browserAssistRoutes(
  service: BrowserAssistApi,
  options: BrowserAssistRouteOptions = {},
): Route[] {
  const maxInFlight = options.maxInFlight ?? ASSIST_MAX_IN_FLIGHT;
  const deadlineMs = options.deadlineMs ?? ASSIST_DEADLINE_MS;
  let inFlight = 0;
  return [
    route("POST", "/api/browser/assist", async ({ body, res }) => {
      const abort = new AbortController();
      const onClose = () => abort.abort();
      res.on("close", onClose);
      let held = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const input = await body();
        if (inFlight >= maxInFlight) {
          res.setHeader("retry-after", "5");
          sendJson(res, 429, {
            code: ErrorCode.CAPABILITY_UNAVAILABLE,
            message: "The assistant is already working on another request. Try again in a moment.",
            details: [],
          });
          return undefined;
        }
        inFlight += 1;
        held = true;
        const { promise: deadline, reject } = Promise.withResolvers<never>();
        timer = setTimeout(() => {
          abort.abort();
          reject(new PhoenixError(ErrorCode.OPERATION_TIMEOUT, "The assistant took too long."));
        }, deadlineMs);
        return await Promise.race([service.assist(input, abort.signal), deadline]);
      } finally {
        clearTimeout(timer);
        res.off("close", onClose);
        if (held) inFlight -= 1;
      }
    }),
  ];
}
