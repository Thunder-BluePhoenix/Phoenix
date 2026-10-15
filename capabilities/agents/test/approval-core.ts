// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// An in-process fake of Phoenix Core's agent-approval HTTP API (node:http on 127.0.0.1, port 0),
// shared by the approval tests. It is a scripted stand-in, not Core: the real Core side is
// tested in core/runtime.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { approvalDigest, type ApprovalRequest } from "../src/approval-map";
import { isRecord } from "../src/guards";

export const ID = `apr_${"ab12".repeat(6)}`;
export const NONCE = "cd34".repeat(8);
export const TOKEN_FOR_TESTS = "approval-test-session";

export interface Hit {
  method: string;
  path: string;
  authorization: string | undefined;
  body: unknown;
}

export type Reply = { status: number; body?: unknown; raw?: string } | "hang";
export type Script = (hit: Hit, request: ApprovalRequest | null) => Reply;

export interface FakeCore {
  url: string;
  hits: Hit[];
  /** Resolves with the next hit whose path ends with `suffix` (registered before it happens). */
  nextHit(suffix: string): Promise<Hit>;
  close(): Promise<void>;
}

const send = (res: ServerResponse, reply: Exclude<Reply, "hang">) => {
  res.writeHead(reply.status, { "content-type": "application/json" });
  res.end(reply.raw ?? JSON.stringify(reply.body ?? {}));
};

async function readBody(req: IncomingMessage): Promise<unknown> {
  let text = "";
  for await (const chunk of req) text += (chunk as Buffer).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function startFakeCore(script: Script): Promise<FakeCore> {
  const hits: Hit[] = [];
  const waiters: { suffix: string; resolve: (hit: Hit) => void }[] = [];
  const server = createServer((req, res) => {
    void readBody(req).then((body) => {
      const hit: Hit = {
        method: req.method ?? "",
        path: req.url ?? "",
        authorization: req.headers.authorization,
        body,
      };
      hits.push(hit);
      for (const w of waiters.filter((x) => hit.path.endsWith(x.suffix))) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(hit);
      }
      const request = hit.path === "/api/agent-approvals" && isRecord(body) ? body : null;
      const reply = script(hit, request as ApprovalRequest | null);
      if (reply !== "hang") send(res, reply);
    });
  });
  const listening = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", () => listening.resolve());
  await listening.promise;
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    hits,
    nextHit(suffix) {
      const next = Promise.withResolvers<Hit>();
      waiters.push({ suffix, resolve: next.resolve });
      return next.promise;
    },
    async close() {
      server.closeAllConnections();
      const closed = Promise.withResolvers<void>();
      server.close(() => closed.resolve());
      await closed.promise;
    },
  };
}

export interface Decision {
  behavior: string;
  message?: string;
  answers?: Record<string, string>;
  [extra: string]: unknown;
}

/**
 * Core as the hook expects it: create answers `pending` with the real digest of the body, then
 * each wait takes the next entry of `waits` (the last one repeats). A wrong nonce is 404.
 */
export function pendingThen(...waits: ((digest: string) => Reply)[]): Script {
  let round = 0;
  let digest = "";
  return (hit, request) => {
    if (request) {
      digest = approvalDigest(request);
      return {
        status: 201,
        body: {
          id: ID,
          nonce: NONCE,
          digest,
          expires_at: "2099-01-01T00:00:00.000Z",
          status: "pending",
        },
      };
    }
    const body = isRecord(hit.body) ? hit.body : {};
    if (!hit.path.endsWith(`/${ID}/wait`) || body.nonce !== NONCE) {
      return { status: 404, body: { message: "not found" } };
    }
    return waits[Math.min(round++, waits.length - 1)]!(digest);
  };
}

/** A wait reply that carries a decision for the exact request. */
export const decided =
  (decision: Decision, decidedBy = "user") =>
  (digest: string): Reply => ({
    status: 200,
    body: { id: ID, digest, status: "decided", decision, decided_by: decidedBy },
  });

export const pending = (digest: string): Reply => ({
  status: 200,
  body: { id: ID, digest, status: "pending" },
});
