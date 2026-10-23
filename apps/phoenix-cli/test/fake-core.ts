// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** A scripted stand-in for Core's loopback API. Speaks only the routes the CLI uses. */
export interface FakeEvent {
  seq: number;
  event: Record<string, unknown>;
  description: string;
}

export interface Recorded {
  method: string;
  path: string;
  authorization: string | undefined;
  client: string | undefined;
  body: unknown;
}

export interface FakeCore {
  url: string;
  token: string;
  requests: Recorded[];
  confirmations: Record<string, unknown>[];
  agentApprovals: Record<string, unknown>[];
  events: FakeEvent[];
  /** Ids decided through the fake, in order, with the verdict. */
  decided: { id: string; via: string; verdict: boolean }[];
  health: Record<string, unknown>;
  /** When set, every request is answered with this status and error body. */
  failWith?: { status: number; body: unknown };
  agentApprovalsMissing: boolean;
  stop: () => Promise<void>;
}

const send = (
  res: import("node:http").ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text === "" ? undefined : (JSON.parse(text) as unknown);
}

export async function startFakeCore(token = `fake-${crypto.randomUUID()}`): Promise<FakeCore> {
  const core: FakeCore = {
    url: "",
    token,
    requests: [],
    confirmations: [],
    agentApprovals: [],
    events: [],
    decided: [],
    health: {
      status: "ok",
      version: "0.0.0-test",
      protocol: "1.1",
      env: "dev",
      uptime_ms: 3_725_000,
      kill_switch: false,
      active_tasks: 2,
      capabilities: [
        { id: "git", status: "enabled", health: "healthy" },
        { id: "docker", status: "enabled", health: "unhealthy" },
        { id: "calendar", status: "disabled", health: "unknown" },
      ],
    },
    agentApprovalsMissing: false,
    stop: async () => {},
  };

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const method = req.method ?? "GET";
    const body = method === "POST" ? await readJson(req) : undefined;
    const header = (name: string): string | undefined => {
      const value = req.headers[name];
      return typeof value === "string" ? value : undefined;
    };
    core.requests.push({
      method,
      path: url.pathname + url.search,
      authorization: header("authorization"),
      client: header("x-phoenix-client"),
      body,
    });
    if (header("authorization") !== `Bearer ${core.token}`) {
      return send(res, 401, { code: "UNAUTHENTICATED", message: "Missing or invalid token" });
    }
    if (core.failWith) return send(res, core.failWith.status, core.failWith.body);

    if (method === "GET" && url.pathname === "/api/health") return send(res, 200, core.health);
    if (method === "GET" && url.pathname === "/api/pet/state") {
      return send(res, 200, {
        state: "WAITING",
        explanation: "Your input is needed",
        recording: false,
        sleeping: false,
        conditions: [],
      });
    }
    if (method === "GET" && url.pathname === "/api/confirmations") {
      return send(res, 200, {
        confirmations: core.confirmations.map((confirmation) => ({
          ...confirmation,
          ref: "c".repeat(64),
        })),
      });
    }
    if (method === "GET" && url.pathname === "/api/agent-approvals") {
      if (core.agentApprovalsMissing) {
        return send(res, 404, { code: "RESOURCE_NOT_FOUND", message: "Agent approvals not found" });
      }
      return send(res, 200, {
        approvals: core.agentApprovals.map((approval) => ({ ...approval, ref: "a".repeat(64) })),
      });
    }
    if (method === "GET" && url.pathname === "/api/events") {
      const after = Number(url.searchParams.get("after_seq") ?? "0");
      const limit = Number(url.searchParams.get("limit") ?? "100");
      const source = url.searchParams.get("source");
      const type = url.searchParams.get("type");
      const rows = core.events
        .filter((e) => e.seq > after)
        .filter((e) => !source || e.event.source === source)
        .filter((e) => !type || e.event.event_type === type)
        .sort((a, b) => b.seq - a.seq)
        .slice(0, limit);
      return send(res, 200, { events: rows });
    }

    const conf = /^\/api\/confirmations\/([^/]+)$/.exec(url.pathname);
    if (method === "POST" && conf) {
      const id = decodeURIComponent(conf[1]!);
      const index = core.confirmations.findIndex((c) => c.id === id);
      if (index < 0) return send(res, 404, { code: "RESOURCE_NOT_FOUND", message: "Not found" });
      const verdict = (body as { approve?: boolean }).approve === true;
      core.confirmations.splice(index, 1);
      core.decided.push({ id, via: "confirmation", verdict });
      return send(res, 200, { id, approved: verdict });
    }
    const agent = /^\/api\/agent-approvals\/([^/]+)\/decision$/.exec(url.pathname);
    if (method === "POST" && agent) {
      const id = decodeURIComponent(agent[1]!);
      const index = core.agentApprovals.findIndex((c) => c.id === id);
      if (index < 0) return send(res, 404, { code: "RESOURCE_NOT_FOUND", message: "Not found" });
      const verdict = (body as { behavior?: string }).behavior === "allow";
      core.agentApprovals.splice(index, 1);
      core.decided.push({ id, via: "agent", verdict });
      return send(res, 200, { id, outcome: verdict ? "allow" : "deny" });
    }
    return send(res, 404, { code: "RESOURCE_NOT_FOUND", message: "No such route" });
  });

  const listening = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", () => listening.resolve());
  await listening.promise;
  core.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  core.stop = () => {
    const stopped = Promise.withResolvers<void>();
    server.close(() => stopped.resolve());
    server.closeAllConnections();
    return stopped.promise;
  };
  return core;
}

export const confirmation = (
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  capabilityId: "git",
  command: "push",
  summary: "Push main to origin",
  sideEffect: "external",
  permissions: ["git.write"],
  requestedAt: "2026-10-22T10:00:00.000Z",
  expiresAt: "2099-01-01T00:00:00.000Z",
  ...overrides,
});

export const agentApproval = (
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  kind: "permission",
  agent: "claude-code",
  project: "phoenix",
  tool: "Bash",
  input_summary: { command: "rm -rf build" },
  via: "relay",
  created_at: "2026-10-22T10:00:00.000Z",
  expires_at: "2099-01-02T00:00:00.000Z",
  always_ok: false,
  ...overrides,
});

export const feedEvent = (
  seq: number,
  type: string,
  overrides: Record<string, unknown> = {},
  description = type,
): FakeEvent => ({
  seq,
  description,
  event: {
    event_id: `evt_${seq}`,
    event_type: type,
    version: "1.1",
    source: "terminal",
    timestamp: `2026-10-22T10:00:${String(seq % 60).padStart(2, "0")}.000Z`,
    severity: "info",
    payload: {},
    ...overrides,
  },
});
