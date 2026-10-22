// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { route, sendJson, type Route } from "./http";
import { readRawBody } from "./raw-body";

/** The callback paths a chat provider is configured to call. */
export const CHAT_CALLBACK_PREFIX = "/api/chat-approvals/callback/";
/** Provider callbacks are small; the package refuses anything over this too. */
export const CHAT_BODY_MAX_BYTES = 64 * 1024;
export const CHAT_BODY_TIMEOUT_MS = 10_000;

export interface ChatApprovalsApi {
  handleCallback(
    provider: "slack" | "discord",
    request: { headers: Readonly<Record<string, string | string[] | undefined>>; body: Buffer },
  ): Promise<{ status: number; json?: unknown }>;
}

export interface ChatApprovalRouteOptions {
  bodyTimeoutMs?: number;
}

/**
 * `POST /api/chat-approvals/callback/slack|discord`: the one public door chat approvals have. It is
 * public only in that it does not use the Core session token (Slack and Discord cannot hold it).
 * Every request is authenticated by the provider's own signature over the exact bytes, checked
 * inside the capability; a request that fails it gets a bare status with no explanation. A button
 * press can only ever decide a request that is bound to the Core-computed request hash.
 */
export function chatApprovalRoutes(
  service: ChatApprovalsApi,
  options: ChatApprovalRouteOptions = {},
): Route[] {
  return [
    route(
      "POST",
      `${CHAT_CALLBACK_PREFIX}:provider`,
      async ({ req, res, params }) => {
        const provider = params.provider;
        if (provider !== "slack" && provider !== "discord")
          throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Not found");
        const body = await readRawBody(req, {
          maxBytes: CHAT_BODY_MAX_BYTES,
          timeoutMs: options.bodyTimeoutMs ?? CHAT_BODY_TIMEOUT_MS,
          // Slack sends a form; Discord sends JSON. The signature covers bytes, not the type.
          contentTypes: ["application/x-www-form-urlencoded", "application/json"],
        });
        const reply = await service.handleCallback(provider, { headers: req.headers, body });
        if (reply.json !== undefined) {
          sendJson(res, reply.status, reply.json);
          return undefined;
        }
        res.statusCode = reply.status;
        res.end();
        return undefined;
      },
      true,
    ),
  ];
}
