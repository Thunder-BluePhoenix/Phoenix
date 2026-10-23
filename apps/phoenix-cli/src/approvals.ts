// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createHash } from "node:crypto";
import type { CoreClient } from "./client";
import { CoreError, RefusedError, UsageError } from "./errors";
import { canonicalJson, clean } from "./format";
import { parseAgentApprovals, parseConfirmations, type PendingApproval } from "./model";

/** Length of the request reference shown by `list` and checked by `approve` / `deny`. */
export const REF_LENGTH = 16;

const REF_DOMAIN = "phoenix-cli-approval-v1\n";

/**
 * A short fingerprint of exactly what Core listed for one request: its source, id, requester,
 * expiry and every other field. A decision that quotes it is a decision about that request; if
 * anything about the request differs when the decision is sent, the reference no longer matches.
 */
export function requestRef(approval: PendingApproval): string {
  return createHash("sha256")
    .update(REF_DOMAIN + canonicalJson({ source: approval.source, ...approval.raw }))
    .digest("hex")
    .slice(0, REF_LENGTH);
}

export type Decision = "approve" | "deny";

export interface PendingView {
  source: PendingApproval["source"];
  id: string;
  ref: string;
  title: string;
  requester: string;
  expires_at: string;
}

/** Everything waiting for a person, from both places Core keeps requests, soonest expiry first. */
export async function listPending(client: CoreClient): Promise<PendingApproval[]> {
  const [confirmations, agent] = await Promise.all([
    client.request("GET", "/api/confirmations").then(parseConfirmations),
    // Core without the agent-approval service answers 404; that is "none", not a failure.
    client.request("GET", "/api/agent-approvals").then(parseAgentApprovals, (err: unknown) => {
      if (err instanceof CoreError && err.status === 404) return [];
      throw err;
    }),
  ]);
  return [...confirmations, ...agent].sort(
    (a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt) || a.id.localeCompare(b.id),
  );
}

export function toView(approval: PendingApproval): PendingView {
  return {
    source: approval.source,
    id: approval.id,
    ref: requestRef(approval),
    title: clean(approval.title),
    requester: clean(approval.requester, 60),
    expires_at: approval.expiresAt,
  };
}

export function renderList(pending: readonly PendingApproval[]): string {
  if (pending.length === 0) return "No approvals are waiting.\n";
  const lines = pending.map((a) => {
    const v = toView(a);
    return [
      `${v.id}  ref ${v.ref}  ${v.source}  from ${v.requester}`,
      `  ${v.title}`,
      `  expires ${v.expires_at || "unknown"}`,
    ].join("\n");
  });
  return `${lines.join("\n\n")}\n\nDecide with: phoenix approvals approve <id> --ref <ref>   (or deny)\n`;
}

/** What a person is shown before they confirm: the requester and every field Core gave. */
export function renderDetail(approval: PendingApproval): string {
  const v = toView(approval);
  return [
    `Request ${v.id} (${v.source}) from ${v.requester}, ref ${v.ref}`,
    `  ${v.title}`,
    ...approval.detail.map((line) => `  ${clean(line, 300)}`),
    `  expires ${v.expires_at || "unknown"}`,
  ].join("\n");
}

export interface DecideOptions {
  client: CoreClient;
  id: string;
  decision: Decision;
  /** The reference printed by `approvals list`. */
  ref?: string;
  now: () => number;
  /** Asks a person at a terminal; absent when there is none. */
  confirm?: (prompt: string) => Promise<boolean>;
  write: (text: string) => void;
}

export interface DecideResult {
  id: string;
  source: PendingApproval["source"];
  decision: Decision;
  ref: string;
}

/**
 * Sends one approve or deny through Core's own audited routes. Approving is bound to the request:
 * the CLI re-reads what is pending, refuses a request that is gone, expired, or no longer matches
 * the reference the caller quoted, and without a reference makes a person at a terminal confirm
 * the exact text first. The CLI never decides on its own and has no "approve all".
 */
export async function decide(options: DecideOptions): Promise<DecideResult> {
  const { client, id, decision, ref } = options;
  if (ref !== undefined && !/^[0-9a-f]+$/.test(ref)) {
    throw new UsageError(`--ref must be the ${REF_LENGTH} hex characters shown by approvals list`);
  }
  const current = (await listPending(client)).find((a) => a.id === id);
  if (!current) {
    throw new RefusedError(`${id} is not waiting for a decision (decided, expired or unknown)`);
  }
  const actual = requestRef(current);
  if (ref !== undefined && ref !== actual) {
    throw new RefusedError(
      `${id} is not the request ref ${ref} was shown for (it is now ref ${actual}); list again and review it`,
    );
  }
  const expires = Date.parse(current.expiresAt);
  if (Number.isFinite(expires) && expires <= options.now()) {
    throw new RefusedError(`${id} has expired`);
  }

  if (decision === "approve" && ref === undefined) {
    if (!options.confirm) {
      throw new UsageError(
        "Approving needs the request reference: pass --ref <ref> from `phoenix approvals list`, or run in a terminal to review and confirm",
      );
    }
    options.write(`${renderDetail(current)}\n`);
    if (!(await options.confirm("Approve this request? [y/N] "))) {
      throw new RefusedError("Not approved");
    }
  }

  try {
    if (current.source === "confirmation") {
      await client.request("POST", `/api/confirmations/${encodeURIComponent(id)}`, {
        approve: decision === "approve",
        ref: current.ref,
      });
    } else {
      await client.request("POST", `/api/agent-approvals/${encodeURIComponent(id)}/decision`, {
        behavior: decision === "approve" ? "allow" : "deny",
        ref: current.ref,
      });
    }
  } catch (err) {
    // 404 (gone) and 409 (already resolved) mean someone else got there first.
    if (err instanceof CoreError && (err.status === 404 || err.status === 409)) {
      throw new RefusedError(`${id} was decided or expired before this decision arrived`);
    }
    throw err;
  }
  return { id, source: current.source, decision, ref: actual };
}
