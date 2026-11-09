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

/** The whole answer of the Teams link check: nothing about the request, the key or why it failed. */
export interface TeamsLinkVerdict {
  valid: boolean;
  approval_id: string | null;
}

/** A Teams link's query is about 250 bytes; the shell refuses anything over 600 too. */
export const TEAMS_LINK_QUERY_MAX = 600;
export const TEAMS_VERIFY_PATH = "/api/chat-approvals/teams/verify-link";

export interface ChatApprovalsApi {
  handleCallback(
    provider: "slack" | "discord",
    request: { headers: Readonly<Record<string, string | string[] | undefined>>; body: Buffer },
  ): Promise<{ status: number; json?: unknown }>;
  /** Checks the signature, expiry and current state of a Teams link's query. Holds the key. */
  verifyTeamsLink(query: string): Promise<TeamsLinkVerdict>;
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
 *
 * `POST /api/chat-approvals/teams/verify-link` is NOT public: it needs the session token.
 */
/** The query of a Teams link as text: printable ASCII, no fragment, bounded; anything else is a bad request. */
export function teamsLinkQuery(body: unknown): string {
  const value =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).query
      : undefined;
  if (typeof value !== "string")
    throw new PhoenixError(ErrorCode.INVALID_REQUEST, "query must be a string");
  const query = value.startsWith("?") ? value.slice(1) : value;
  if (
    query.length < 1 ||
    query.length > TEAMS_LINK_QUERY_MAX ||
    !/^[\x21-\x22\x24-\x7e]+$/.test(query)
  )
    throw new PhoenixError(ErrorCode.INVALID_REQUEST, "query is not a link query");
  return query;
}

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
    // Session-token route (not public): the desktop shell and web app hold the token, Core holds the
    // Teams signing key. The answer carries only `valid` and the approval id when valid.
    route("POST", TEAMS_VERIFY_PATH, async ({ body }) =>
      service.verifyTeamsLink(teamsLinkQuery(await body())),
    ),
  ];
}
