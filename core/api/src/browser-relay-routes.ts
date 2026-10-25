// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { BROWSER_RELAY_BODY_MAX_BYTES, expectObject, route, type Route } from "./http";

/**
 * Session-token routes for the Phoenix browser's CHROME page (Phase 95). The page long-polls `next`,
 * runs the request through its chrome-window-only Tauri commands and posts the answer. A web page
 * loaded in a tab has no session token and no Tauri access, so it can neither poll nor answer.
 */
export interface BrowserRelayApi {
  next(waitMs: number, signal?: AbortSignal): Promise<unknown>;
  complete(id: string, body: unknown): boolean;
}

const ID = /^[A-Za-z0-9_-]{1,80}$/;

export function browserRelayRoutes(relay: BrowserRelayApi): Route[] {
  return [
    route("GET", "/api/browser/relay/next", async ({ url, res }) => {
      const raw = url.searchParams.get("wait") ?? "0";
      if (!/^\d{1,5}$/.test(raw))
        throw new PhoenixError(
          ErrorCode.INVALID_REQUEST,
          '"wait" must be a number of milliseconds',
        );
      const abort = new AbortController();
      // `res` closes when the chrome page goes away mid-poll (the request side closes once read).
      res.on("close", () => abort.abort());
      return { request: await relay.next(Number(raw), abort.signal) };
    }),
    route("POST", "/api/browser/relay/:id/result", async ({ params, body }) => {
      const id = params.id ?? "";
      if (!ID.test(id)) throw new PhoenixError(ErrorCode.INVALID_REQUEST, "Not a request id");
      const accepted = relay.complete(id, expectObject(await body(BROWSER_RELAY_BODY_MAX_BYTES)));
      if (!accepted)
        throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "That request is not waiting");
      return { accepted: true };
    }),
  ];
}
