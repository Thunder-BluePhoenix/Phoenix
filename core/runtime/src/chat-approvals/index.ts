// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Core's side of chat approvals (Phase 86): the pending list and audited decision path the package
// needs (the SAME ones the phone link uses), and the one HTTP transport it may use. The package
// itself opens no socket; this file is where the outside world is allowed in, so the transport is
// narrow: HTTPS POST to a fixed list of provider hosts, no redirects, no cookies, a timeout and a
// response size cap.
import type {
  ChatApprovalHost,
  DecideInput,
  HttpTransport,
} from "@phoenix/capability-chat-approvals";
import { TransportError, type ApprovalSnapshot } from "@phoenix/capability-chat-approvals";
import type { PermissionGateway } from "@phoenix/permissions";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import type { AgentApprovals } from "../agent-approvals";
import { PHONE_CAPABILITY, previewHash, requestHash } from "../phone-link";

/** Hosts a chat approval may POST to. Teams webhook hosts are matched by suffix, the rest exactly. */
const EXACT_HOSTS: Record<string, true> = {
  "slack.com": true,
  "hooks.slack.com": true,
  "discord.com": true,
};
const HOST_SUFFIXES = [".webhook.office.com", ".logic.azure.com", ".powerplatform.com"];
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_TITLE_CHARS = 200;

function hostAllowed(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    (Object.hasOwn(EXACT_HOSTS, url.hostname) ||
      HOST_SUFFIXES.some((s) => url.hostname.endsWith(s)))
  );
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * The only way chat approvals reach the network. Anything but an https POST to a provider host
 * fails before a byte is sent; redirects are refused (a redirect could carry a bot token to
 * another host), and the response is read up to a cap.
 */
export function createChatTransport(fetchImpl: FetchLike = fetch): HttpTransport {
  return async (request) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      throw new TransportError("Not a URL");
    }
    if (!hostAllowed(url)) throw new TransportError("Host is not a chat provider");
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method: "POST",
        headers: request.headers,
        body: request.body,
        redirect: "error",
        credentials: "omit",
        signal,
      });
    } catch {
      throw new TransportError("Request failed");
    }
    const text = await response.text().catch(() => "");
    return { status: response.status, body: text.slice(0, MAX_RESPONSE_BYTES) };
  };
}

export interface ChatHostDeps {
  permissions: Pick<PermissionGateway, "pendingConfirmations" | "resolveConfirmation">;
  agentApprovals: Pick<AgentApprovals, "list" | "decide">;
}

/**
 * Pending requests in the same shape (and with the same request_hash) the phone link shows, and a
 * decision that goes through the same audited calls. A request that is gone, expired or changed
 * since the hash was read is refused here, not trusted to the caller.
 */
export function createChatHost(deps: ChatHostDeps, now: () => number = Date.now): ChatApprovalHost {
  const snapshot = (
    source: "confirmation" | "agent",
    id: string,
    tool: string,
    title: string,
    preview: Record<string, unknown>,
    expiresAt: string,
    project?: string,
  ): ApprovalSnapshot => ({
    source,
    id,
    tool,
    title: title.slice(0, MAX_TITLE_CHARS),
    ...(project !== undefined ? { project } : {}),
    request_hash: requestHash({
      source,
      id,
      tool,
      preview_hash: previewHash(preview),
      expires_at: expiresAt,
    }),
    expires_at: expiresAt,
  });

  const pending = (): ApprovalSnapshot[] => {
    const out: ApprovalSnapshot[] = [];
    for (const c of deps.permissions.pendingConfirmations()) {
      if (c.capabilityId === PHONE_CAPABILITY) continue;
      const preview: Record<string, unknown> = {
        summary: c.summary,
        side_effect: c.sideEffect,
        permissions: c.permissions,
        ...(c.details ? { details: c.details } : {}),
      };
      out.push(
        snapshot(
          "confirmation",
          c.id,
          `${c.capabilityId}.${c.command}`,
          c.summary,
          preview,
          c.expiresAt,
        ),
      );
    }
    for (const a of deps.agentApprovals.list()) {
      if (a.kind !== "permission") continue;
      const preview: Record<string, unknown> = {
        agent: a.agent,
        project: a.project,
        input_summary: a.input_summary,
      };
      const title =
        a.input_summary.command ?? a.input_summary.path ?? a.input_summary.description ?? a.tool;
      out.push(snapshot("agent", a.id, a.tool, title, preview, a.expires_at, a.project));
    }
    return out;
  };

  const refuse = (code: ErrorCode, message: string): never => {
    throw new PhoenixError(code, message);
  };

  const decide = (input: DecideInput): void => {
    const current = pending().find((p) => p.source === input.source && p.id === input.id);
    if (!current) return refuse(ErrorCode.RESOURCE_NOT_FOUND, "That request is no longer pending");
    if (Date.parse(current.expires_at) <= now())
      return refuse(ErrorCode.OPERATION_TIMEOUT, "That request has expired");
    if (current.request_hash !== input.requestHash)
      return refuse(ErrorCode.SECURITY_POLICY_BLOCKED, "The request is not what was shown");
    const approve = input.decision === "approve";
    if (input.source === "confirmation") {
      if (!deps.permissions.resolveConfirmation(input.id, approve, input.actor))
        refuse(ErrorCode.RESOURCE_NOT_FOUND, "That request is no longer pending");
      return;
    }
    deps.agentApprovals.decide(input.id, { behavior: approve ? "allow" : "deny" }, input.actor);
  };

  return { pending, decide };
}
