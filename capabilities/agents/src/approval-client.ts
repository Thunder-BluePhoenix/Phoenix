// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 56: creates an agent approval in Phoenix Core and waits for the decision, over loopback
// HTTP with the session token. It NEVER throws and fails open: every problem (Core down, slow,
// 4xx/5xx, malformed JSON, an id or digest that is not the one created, the deadline) is a
// `{ decision: null }` result, which the hook turns into "no output, the agent asks in its terminal".
// Only a response that echoes the exact id and digest of THIS request can carry a decision.
import { resolveSessionToken } from "@phoenix/sdk";
import {
  approvalDigest,
  parseDecision,
  type ApprovalDecision,
  type ApprovalRequest,
} from "./approval-map";
import { trustedCoreUrl } from "./core-url";
import { isRecord } from "./guards";
import { relayCall, relayPreference } from "./relay/client";

/** Budget for the create call; waiting is bounded separately by the request's `timeout_ms`. */
export const CREATE_TIMEOUT_MS = 5_000;
/** Longest single long-poll asked of Core (Core allows up to 30 s). */
export const WAIT_SLICE_MS = 25_000;
/** Extra time a long-poll HTTP call gets over `wait_ms` before it is given up on. */
const WAIT_GRACE_MS = 5_000;
/** Time left that is too short to be worth another round trip. */
const MIN_REMAINING_MS = 500;
/** Core answers a long-poll after at most `wait_ms`; a server that keeps answering at once is broken. */
const MAX_WAIT_ROUNDS = 100;
const MAX_RESPONSE_BYTES = 100_000;

const ID_PATTERN = /^apr_[0-9a-f]{24}$/;
const NONCE_PATTERN = /^[0-9a-f]{32}$/;

export interface ApprovalClientOptions {
  /** Default: $PHOENIX_CORE_URL or http://127.0.0.1:4870. */
  coreUrl?: string;
  /** Default: found like every Phoenix client (env, data dir, ~/.phoenix). */
  token?: string;
  /**
   * The local relay carries the calls first (Phase 57) unless `false`, or an explicit HTTP target
   * (`coreUrl` / $PHOENIX_CORE_URL) was chosen without an explicit relay. An unreachable relay
   * falls back to HTTP for the rest of the call; a relay that answered is never second-guessed.
   */
  relay?: false | { socketPath?: string };
}

/** `decision` is null for "no decision"; `reason` says why (for stderr only). */
export type ApprovalOutcome =
  | { decision: ApprovalDecision; decidedBy: string | undefined }
  | { decision: null; reason: string };

const UNTRUSTED_URL = "PHOENIX_CORE_URL is not a loopback address; nothing was sent";

const none = (reason: string): ApprovalOutcome => ({ decision: null, reason });

interface Reply {
  status: number;
  body: Record<string, unknown> | null;
}

/** One JSON POST. Never throws; a transport failure or a timeout is `null`. */
async function post(
  url: string,
  token: string,
  body: unknown,
  timeoutMs: number,
): Promise<Reply | null> {
  const controller = new AbortController();
  // setTimeout, not AbortSignal.timeout: the deadline must follow an injected clock in tests.
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: controller.signal,
    });
    const text = await res.text();
    if (text.length > MAX_RESPONSE_BYTES) return { status: res.status, body: null };
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { status: res.status, body: null };
    }
    return { status: res.status, body: isRecord(parsed) ? parsed : null };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** A decided reply, only if it names exactly this request. */
function decidedReply(
  body: Record<string, unknown>,
  id: string,
  digest: string,
): ApprovalOutcome | null {
  if (body.status !== "decided") return null;
  if (body.id !== id || body.digest !== digest) return none("id or digest mismatch");
  const decision = parseDecision(body.decision);
  if (!decision) return none("malformed decision");
  return {
    decision,
    decidedBy: typeof body.decided_by === "string" ? body.decided_by.slice(0, 40) : undefined,
  };
}

/**
 * Creates the approval and waits at most `request.timeout_ms` (from now) for its decision.
 * Never rejects.
 */
export async function requestApproval(
  request: ApprovalRequest,
  options: ApprovalClientOptions = {},
): Promise<ApprovalOutcome> {
  const deadline = Date.now() + request.timeout_ms;
  const digest = approvalDigest(request);
  const viaRelay = relayPreference(options.relay, options.coreUrl);
  let relayUp = viaRelay !== null;
  // Resolved up front when HTTP is the plan, lazily (on relay failure) otherwise.
  let token: string | undefined;
  const resolveToken = (): string | undefined => {
    try {
      token ??= resolveSessionToken(options.token);
    } catch {
      return undefined;
    }
    return token;
  };
  // The token only ever goes to this machine: a Core URL from the environment is not trusted.
  const coreUrl = trustedCoreUrl(options.coreUrl);
  const base = coreUrl === null ? null : `${coreUrl}/api/agent-approvals`;
  if (!relayUp) {
    if (base === null) return none(UNTRUSTED_URL);
    if (resolveToken() === undefined) return none("Phoenix Core is not running");
  }

  /**
   * One call over whichever transport is up. `null`: no answer. `"no-token"`: HTTP without a
   * token or to a Core URL that is not loopback. The relay carries the approval id in the body; HTTP carries it in the URL.
   */
  const call = async (
    step: "create" | "wait",
    id: string,
    body: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<Reply | null | "no-token" | "untrusted-url"> => {
    if (relayUp) {
      const op = step === "create" ? "approval.create" : "approval.wait";
      const reply = await relayCall(op, step === "create" ? body : { id, ...body }, {
        socketPath: viaRelay?.socketPath,
        timeoutMs,
      });
      if (reply.ok) return { status: 200, body: isRecord(reply.result) ? reply.result : null };
      if (reply.kind === "rejected") {
        return {
          status: reply.code === "RESOURCE_NOT_FOUND" ? 404 : 400,
          body: { message: reply.message },
        };
      }
      if (reply.kind === "protocol") return { status: 502, body: null };
      relayUp = false;
    }
    if (base === null) return "untrusted-url";
    const bearer = resolveToken();
    if (bearer === undefined) return "no-token";
    return post(step === "create" ? base : `${base}/${id}/wait`, bearer, body, timeoutMs);
  };

  const created = await call(
    "create",
    "",
    { ...request },
    Math.min(CREATE_TIMEOUT_MS, request.timeout_ms),
  );
  if (created === "untrusted-url") return none(UNTRUSTED_URL);
  if (created === "no-token") return none("Phoenix Core is not running");
  if (!created) return none("Phoenix Core did not answer");
  if (created.status < 200 || created.status > 299 || !created.body) {
    return none(`create failed (HTTP ${created.status})`);
  }
  const { id, nonce } = created.body;
  if (typeof id !== "string" || !ID_PATTERN.test(id)) return none("malformed approval id");
  if (created.body.digest !== digest) return none("id or digest mismatch");
  const immediate = decidedReply(created.body, id, digest);
  if (immediate) return immediate;
  if (created.body.status !== "pending")
    return none(`unexpected status ${String(created.body.status)}`);
  if (typeof nonce !== "string" || !NONCE_PATTERN.test(nonce)) return none("malformed nonce");

  for (let round = 0; round < MAX_WAIT_ROUNDS; round++) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_REMAINING_MS) return none("timed out waiting for a decision");
    const waitMs = Math.max(1, Math.min(WAIT_SLICE_MS, remaining - MIN_REMAINING_MS));
    const reply = await call(
      "wait",
      id,
      { nonce, wait_ms: waitMs },
      Math.min(waitMs + WAIT_GRACE_MS, remaining),
    );
    if (reply === "untrusted-url") return none(UNTRUSTED_URL);
    if (reply === "no-token") return none("Phoenix Core is not running");
    if (!reply) return none("Phoenix Core did not answer");
    if (reply.status < 200 || reply.status > 299 || !reply.body) {
      return none(`wait failed (HTTP ${reply.status})`);
    }
    const { status } = reply.body;
    if (status === "decided") return decidedReply(reply.body, id, digest)!;
    if (status === "pending") {
      if (reply.body.id !== id || reply.body.digest !== digest)
        return none("id or digest mismatch");
      continue;
    }
    if (status === "terminal") return none("answered in the terminal");
    return none(`approval ${String(status)}`);
  }
  return none("too many wait rounds");
}
