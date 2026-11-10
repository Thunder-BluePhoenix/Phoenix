// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { route, type Route } from "./http";

/**
 * Session-token route for the Fawkes browsing assistant (Phase 95). The person's goal and the active
 * page go to an on-device model only; the answer is a PROPOSED plan (data). Nothing here runs an
 * action: each step is run through `POST /api/capabilities/browser/commands/<kind>`, which asks for
 * the person's approval.
 */
export interface BrowserAssistApi {
  assist(input: unknown, signal?: AbortSignal): Promise<unknown>;
}

export function browserAssistRoutes(service: BrowserAssistApi): Route[] {
  return [
    route("POST", "/api/browser/assist", async ({ body, res }) => {
      const abort = new AbortController();
      res.on("close", () => abort.abort());
      return service.assist(await body(), abort.signal);
    }),
  ];
}
